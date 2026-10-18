<?php

namespace App\Support\Contenido;

use App\Models\CatalogoCurso;
use App\Models\CatalogoServicio;
use App\Models\Convenio;
use App\Models\ConvenioFoto;
use App\Models\GaleriaItem;
use App\Models\PreguntaFrecuente;
use App\Rules\ImagenPublica;
use App\Support\Traslado\DestinoMysqlLaravel;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use RuntimeException;
use Throwable;

/** Intercambio offline: no conecta a NestJS, no descarga imágenes ni sobrescribe contenido. */
final class ImportarContenido
{
    public const MODELOS = [
        'cursos' => CatalogoCurso::class,
        'servicios' => CatalogoServicio::class,
        'preguntas_frecuentes' => PreguntaFrecuente::class,
        'galeria_items' => GaleriaItem::class,
        'convenios' => Convenio::class,
        'convenio_fotos' => ConvenioFoto::class,
    ];

    public function ejecutar(string $archivo, bool $aplicar, string $uploads, string $publicos): array
    {
        $db = DB::connection();
        $mysql = $db->getDriverName() === 'mysql';
        $memoria = app()->environment('testing') && $db->getDriverName() === 'sqlite' && $db->getDatabaseName() === ':memory:';
        if (! $memoria && (! $mysql || ! DestinoMysqlLaravel::nombrePermitido($db->getDatabaseName()))) {
            throw new RuntimeException('Destino rechazado: use MySQL exclusivo horus_group o la base aislada de pruebas.');
        }
        if ($mysql && ! in_array($db->selectOne('SELECT @@session.time_zone AS zona')->zona, ['+00:00', 'UTC'], true)) {
            throw new RuntimeException('La zona horaria de la sesión MySQL debe ser UTC (+00:00); no se escribió nada.');
        }
        if (! is_file($archivo) || filesize($archivo) > 32 * 1024 * 1024) {
            throw new RuntimeException('Intercambio ausente o demasiado grande (máximo 32 MiB).');
        }
        try {
            $raw = file_get_contents($archivo);
            $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            throw new RuntimeException('Intercambio JSON no válido.');
        }
        $tablas = [...array_keys(self::MODELOS), 'empresa_settings'];
        if (! is_array($data) || ($data['version'] ?? null) !== 1 || ! is_array($data['tablas'] ?? null)
            || array_diff(array_keys($data), ['version', 'tablas']) !== []
            || array_diff(array_keys($data['tablas']), $tablas) !== [] || array_diff($tablas, array_keys($data['tablas'])) !== []) {
            throw new RuntimeException('Versión o inventario de tablas no válido.');
        }

        $lock = 'horus-content-'.substr(hash('sha256', $db->getDatabaseName()), 0, 40);
        if ($mysql) {
            if ((int) $db->selectOne('SELECT GET_LOCK(?, 0) AS adquirido', [$lock])->adquirido !== 1) {
                throw new RuntimeException('Otra importación está en curso.');
            }
        }
        $nivel = $db->transactionLevel();
        try {
            if ($mysql) {
                $engines = $db->select('SELECT TABLE_NAME AS nombre, ENGINE AS motor FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
                $map = array_column(array_map(fn ($r) => (array) $r, $engines), 'motor', 'nombre');
                if (DestinoMysqlLaravel::tablasAjenas(array_keys($map)) !== []) {
                    throw new RuntimeException('El destino contiene tablas ajenas a Laravel. Use una base exclusiva para Laravel.');
                }
                foreach ([...(array_map(fn ($c) => (new $c)->getTable(), self::MODELOS)), 'ajustes_publicos'] as $table) {
                    if (($map[$table] ?? null) !== 'InnoDB') {
                        throw new RuntimeException('Falta una tabla migrada InnoDB de contenido.');
                    }
                }
            }
            $db->beginTransaction();
            $esperado = [];
            foreach (self::MODELOS as $origen => $clase) {
                $modelo = new $clase;
                $esperado[$modelo->getTable()] = $this->preparar($data['tablas'][$origen], $modelo, $origen, $uploads, $publicos);
            }
            [$esperado['ajustes_publicos'], $omitidos] = $this->ajustes($data['tablas']['empresa_settings']);
            $vacio = true;
            $igual = true;
            foreach ($esperado as $table => $rows) {
                $existentes = $db->table($table)->orderBy('id')->get()->map(fn ($r) => $this->canonico((array) $r))->all();
                $vacio = $vacio && $existentes === [];
                $igual = $igual && $existentes === $rows;
            }
            if (! $vacio && ! $igual) {
                throw new RuntimeException('El destino contiene contenido diferente; no se sobrescribe.');
            }
            if ($vacio) {
                foreach ($esperado as $table => $rows) {
                    foreach (array_chunk($rows, 100) as $chunk) {
                        $db->table($table)->insert($chunk);
                    }
                }
            }

            $informe = [];
            foreach ($esperado as $table => $rows) {
                $actual = $db->table($table)->orderBy('id')->get()->map(fn ($r) => $this->canonico((array) $r))->all();
                if ($actual !== $rows) {
                    throw new RuntimeException('Diferencia de datos tras copiar; se revierte todo.');
                }
                $informe[$table] = ['filas' => count($rows), 'sha256' => hash('sha256', json_encode($rows, JSON_THROW_ON_ERROR))];
            }
            // Validar con las mismas reglas de los modelos; nunca normalizar o cambiar valores.
            foreach (self::MODELOS as $clase) {
                $modelo = new $clase;
                foreach ($esperado[$modelo->getTable()] as $row) {
                    if (Validator::make($row, $modelo->reglas())->fails()) {
                        throw new RuntimeException('El contenido no supera las reglas de sus modelos; se revierte todo.');
                    }
                }
            }
            if ($aplicar) {
                $db->commit();
            } else {
                $db->rollBack();
            }

            return ['modo' => $igual && ! $vacio ? 'reutilizado' : ($aplicar ? 'aplicado' : 'simulacro'),
                'archivo_sha256' => hash('sha256', $raw), 'tablas' => $informe, 'ajustes_omitidos' => $omitidos];
        } catch (Throwable $e) {
            if ($db->transactionLevel() > $nivel) {
                $db->rollBack();
            }
            // Los errores SQL y de validación pueden incluir valores; no publicarlos.
            throw new RuntimeException($e instanceof RuntimeException && ! $e instanceof QueryException
                ? $e->getMessage() : 'La importación no superó las restricciones; se revirtió todo.');
        } finally {
            if ($mysql) {
                $db->select('SELECT RELEASE_LOCK(?)', [$lock]);
            }
        }
    }

    private function preparar(mixed $filas, $modelo, string $origen, string $uploads, string $publicos): array
    {
        if (! is_array($filas) || ! array_is_list($filas)) {
            throw new RuntimeException('Las filas deben ser listas.');
        }
        $fields = array_values(array_diff($modelo->getFillable(), ['curso_id']));
        $meta = ['id', 'createdAt', ...($origen === 'convenio_fotos' ? [] : ['updatedAt'])];
        $internos = match ($origen) {
            'cursos', 'servicios', 'galeria_items' => ['origen_original'],
            'convenios' => ['origen_local'],
            default => [],
        };
        $result = [];
        $ids = [];
        foreach ($filas as $fila) {
            if (! is_array($fila) || array_diff([...$fields, ...$meta], array_keys($fila)) !== []
                || array_diff(array_keys($fila), [...$fields, ...$meta, ...$internos]) !== []
                || ! is_int($fila['id']) || $fila['id'] < 1 || isset($ids[$fila['id']])) {
                throw new RuntimeException('Campos o identificadores no válidos en el intercambio.');
            }
            $ids[$fila['id']] = true;
            $row = array_intersect_key($fila, array_flip([...$fields, 'id']));
            $row['created_at'] = $this->fecha($fila['createdAt']);
            $row['updated_at'] = $this->fecha($origen === 'convenio_fotos' ? $fila['createdAt'] : $fila['updatedAt']);
            if ($origen === 'cursos') {
                $row['curso_id'] = null;
                if ($row['fecha_inicio'] !== null) {
                    $fecha = $row['fecha_inicio'];
                    if (! is_string($fecha) || preg_match('/^\d{4}-\d{2}-\d{2}(?: 00:00:00)?$/D', $fecha) !== 1) {
                        throw new RuntimeException('fecha_inicio contiene un formato o una hora que no se conservaría.');
                    }
                    $calendario = \DateTimeImmutable::createFromFormat('!Y-m-d', substr($fecha, 0, 10));
                    if ($calendario === false || $calendario->format('Y-m-d') !== substr($fecha, 0, 10)
                        || $calendario->format('Y-m-d') < '1000-01-01') {
                        throw new RuntimeException('fecha_inicio no es una fecha de calendario válida para MySQL.');
                    }
                    $row['fecha_inicio'] = substr($fecha, 0, 10);
                }
            }
            foreach (['imagen_url', 'logo_url'] as $field) {
                if (isset($row[$field]) && $row[$field] !== '') {
                    $this->imagen($row[$field], $uploads, $publicos);
                }
            }
            $result[] = $this->canonico($row);
        }
        usort($result, fn ($a, $b) => $a['id'] <=> $b['id']);

        return $result;
    }

    private function ajustes(mixed $filas): array
    {
        if (! is_array($filas) || ! array_is_list($filas)) {
            throw new RuntimeException('Ajustes no válidos.');
        }
        $result = [];
        $omitidos = 0;
        $keys = [];
        $ids = [];
        foreach ($filas as $row) {
            if (! is_array($row) || ! is_string($row['clave'] ?? null)) {
                throw new RuntimeException('Ajuste sin clave válida.');
            }
            if (! isset(OpcionesContenido::AJUSTES[$row['clave']])) {
                $omitidos++;

                continue;
            }
            if (! is_int($row['id'] ?? null) || $row['id'] < 1 || isset($keys[$row['clave']]) || isset($ids[$row['id']])
                || ! is_string($row['valor'] ?? null)
                || array_diff(array_keys($row), ['id', 'clave', 'valor', 'descripcion', 'grupo', 'createdAt', 'updatedAt']) !== []
                || Validator::make(['valor' => $row['valor']], ['valor' => OpcionesContenido::reglasAjuste($row['clave'])])->fails()) {
                throw new RuntimeException('Ajuste público inválido o duplicado.');
            }
            $keys[$row['clave']] = true;
            $ids[$row['id']] = true;
            $result[] = $this->canonico(['id' => $row['id'], 'clave' => $row['clave'], 'valor' => $row['valor'],
                'created_at' => $this->fecha($row['createdAt'] ?? null), 'updated_at' => $this->fecha($row['updatedAt'] ?? null)]);
        }
        usort($result, fn ($a, $b) => $a['id'] <=> $b['id']);

        return [$result, $omitidos];
    }

    private function fecha(mixed $value): string
    {
        $fecha = is_string($value) ? \DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $value) : false;
        if ($fecha === false || $fecha->format('Y-m-d H:i:s') !== $value || $value < '1970-01-01 00:00:01' || $value > '2038-01-19 03:14:07') {
            throw new RuntimeException('Fecha no válida o fuera del rango TIMESTAMP de MySQL.');
        }

        return $value;
    }

    private function imagen(mixed $url, string $uploads, string $publicos): void
    {
        if (! is_string($url) || ! ImagenPublica::valida($url) || ! str_starts_with($url, '/')) {
            throw new RuntimeException('Imagen rechazada; las URL remotas requieren verificación futura independiente.');
        }
        $upload = str_starts_with($url, '/api/uploads/');
        $root = realpath($upload ? $uploads : $publicos);
        $file = $root === false ? false : realpath($root.'/'.($upload ? substr($url, 13) : ltrim($url, '/')));
        $normal = static fn ($p) => strtolower(str_replace('\\', '/', $p));
        if ($root === false || $file === false || ! is_file($file) || ! is_readable($file)
            || ! str_starts_with($normal($file), $normal($root).'/')) {
            throw new RuntimeException('Imagen local ausente o fuera del directorio autorizado.');
        }
    }

    private function canonico(array $row): array
    {
        foreach (['id', 'orden', 'activo', 'visible', 'convenio_id', 'curso_id'] as $field) {
            if (isset($row[$field]) && (is_int($row[$field]) || is_bool($row[$field]) || (is_string($row[$field]) && ctype_digit($row[$field])))) {
                $row[$field] = (int) $row[$field];
            }
        }
        ksort($row);

        return $row;
    }
}
