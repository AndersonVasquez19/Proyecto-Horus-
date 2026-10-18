<?php

namespace App\Support\Traslado;

use Illuminate\Database\Connection;
use Illuminate\Database\QueryException;
use PDO;
use Pdo\Sqlite;
use Throwable;

/**
 * Traslada los datos de una base SQLite de Laravel a una base MySQL ya migrada.
 *
 * Garantías:
 * - El origen se abre en solo lectura (SQLITE_OPEN_READONLY y query_only) y se lee
 *   dentro de una única transacción; su SHA-256 se compara antes y después.
 * - El destino debe ser MySQL/InnoDB, distinto de las bases de NestJS y del sistema,
 *   estar migrado al menos hasta la versión del origen y tener sus tablas vacías.
 * - Todo se valida antes de escribir. La copia es una única transacción con
 *   identificadores conservados; antes de confirmar se comparan recuentos, firmas
 *   SHA-256 normalizadas e integridad referencial. Cualquier diferencia revierte.
 * - Sin $aplicar la copia siempre se revierte (simulacro completo).
 * - Los mensajes y el informe nunca contienen valores de las filas.
 */
final class TrasladoSqliteMysql
{
    /** Tablas efímeras o propias de cada base que no se trasladan. */
    public const EXCLUIDAS = [
        'migrations', 'sessions', 'cache', 'cache_locks', 'jobs', 'job_batches', 'failed_jobs', 'password_reset_tokens',
    ];

    /** Bases que nunca son destino válido (NestJS y sistema). */
    public const BASES_PROHIBIDAS = ['horus_db', 'mysql', 'sys', 'information_schema', 'performance_schema'];

    /** Tablas que delatan la base de NestJS (horus_db o una copia). */
    public const TABLAS_NESTJS = ['admin_users', 'horus_migrations', 'empresa_settings', 'contactos', 'attention_records'];

    private const LOTE = 500;

    private const ENTEROS = ['tinyint', 'smallint', 'mediumint', 'int', 'bigint'];

    private const TEXTOS = ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext'];

    private ?PDO $origen = null;

    private string $huellaOrigen = '';

    /** @var array<string, array{pk: list<string>, columnas: list<string>, tipos: array<string, array<string, mixed>>}> */
    private array $tablas = [];

    public function __construct(private readonly string $rutaOrigen, private readonly Connection $destino) {}

    /**
     * @return array<string, mixed> Informe sin datos personales.
     */
    public function ejecutar(bool $aplicar): array
    {
        try {
            return $this->trasladar($aplicar);
        } finally {
            // Cierra el archivo de origen en cuanto termina (en Windows, un PDO abierto lo bloquea).
            if ($this->origen?->inTransaction()) {
                $this->origen->rollBack();
            }
            $this->origen = null;
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function trasladar(bool $aplicar): array
    {
        $inicio = microtime(true);
        $huellaInicial = $this->huellaOrigen = $this->abrirOrigen();
        $this->validarDestino();

        $this->origen->beginTransaction();

        try {
            $migraciones = $this->compararMigraciones();
            $orden = $this->prepararTablas();
            $firmasOrigen = [];

            foreach ($orden as $tabla) {
                $firmasOrigen[$tabla] = $this->validarYFirmarOrigen($tabla);
            }

            $resultado = $this->copiar($orden, $firmasOrigen, $aplicar);
            $secuencias = $aplicar ? $this->secuenciasOrigen($orden) : [];
        } finally {
            $this->origen->rollBack();
        }

        $avisos = $aplicar ? $this->ajustarAutoincrementos($secuencias) : [];

        return [
            'modo' => $aplicar ? 'aplicado' : 'simulacro (ROLLBACK)',
            'origen_sha256' => $huellaInicial,
            'destino' => ['base' => $this->destino->getDatabaseName(), 'servidor' => $this->destino->selectOne('SELECT VERSION() AS v')->v],
            'migraciones_origen' => $migraciones,
            'tablas' => $resultado,
            'firma_global' => hash('sha256', implode("\n", array_map(
                fn (string $t, array $r): string => $t.':'.$r['filas'].':'.$r['firma'], array_keys($resultado), $resultado,
            ))),
            'avisos' => $avisos,
            'segundos' => round(microtime(true) - $inicio, 3),
        ];
    }

    private function abrirOrigen(): string
    {
        if (! is_file($this->rutaOrigen) || ! is_readable($this->rutaOrigen)) {
            throw new TrasladoException('No se encontró la base SQLite de origen o no se puede leer.');
        }

        $huella = hash_file('sha256', $this->rutaOrigen);
        // PHP 8.4 expone las constantes en Pdo\Sqlite; composer.json admite también 8.3.
        $nativas = class_exists(Sqlite::class);
        $this->origen = new PDO('sqlite:'.$this->rutaOrigen, null, null, [
            ($nativas ? Sqlite::ATTR_OPEN_FLAGS : PDO::SQLITE_ATTR_OPEN_FLAGS) => $nativas ? Sqlite::OPEN_READONLY : PDO::SQLITE_OPEN_READONLY,
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->origen->exec('PRAGMA query_only = 1');

        if ($this->origen->query("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'migrations'")->fetchColumn() != 1) {
            throw new TrasladoException('El origen no es una base de Laravel (falta la tabla migrations).');
        }

        return $huella;
    }

    private function validarDestino(): void
    {
        if ($this->destino->getDriverName() !== 'mysql') {
            throw new TrasladoException('El destino debe ser una conexión MySQL.');
        }

        $base = (string) $this->destino->getDatabaseName();

        if ($base === '' || in_array(strtolower($base), self::BASES_PROHIBIDAS, true)) {
            throw new TrasladoException("La base «{$base}» no puede ser destino del traslado.");
        }

        $tablas = $this->tablasDestino();
        $nest = array_values(array_intersect(self::TABLAS_NESTJS, array_keys($tablas)));

        if ($nest !== []) {
            throw new TrasladoException('El destino contiene tablas de NestJS ('.implode(', ', $nest).'). Use una base exclusiva para Laravel.');
        }

        if (! isset($tablas['migrations'])) {
            throw new TrasladoException('El destino no está migrado. Ejecute antes «php artisan migrate» sobre la base MySQL nueva.');
        }

        $otroMotor = array_keys(array_filter($tablas, fn (string $motor): bool => strcasecmp($motor, 'InnoDB') !== 0));

        if ($otroMotor !== []) {
            throw new TrasladoException('Tablas del destino sin InnoDB (sin transacciones): '.implode(', ', $otroMotor).'.');
        }
    }

    /**
     * @return array<string, string> tabla => motor
     */
    private function tablasDestino(): array
    {
        $filas = $this->destino->select(
            "SELECT TABLE_NAME AS t, ENGINE AS e FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
        );

        return array_column(array_map(fn (object $f): array => ['t' => $f->t, 'e' => (string) $f->e], $filas), 'e', 't');
    }

    private function compararMigraciones(): int
    {
        $origen = $this->origen->query('SELECT migration FROM migrations')->fetchAll(PDO::FETCH_COLUMN);
        $destino = $this->destino->table('migrations')->pluck('migration')->all();
        $faltan = array_values(array_diff($origen, $destino));

        if ($faltan !== []) {
            throw new TrasladoException('El destino no tiene estas migraciones del origen: '.implode(', ', $faltan).'. Migre el destino con la versión actual del código.');
        }

        return count($origen);
    }

    /**
     * Prepara metadatos, comprueba estructura y vacío del destino y devuelve el orden de copia.
     *
     * @return list<string>
     */
    private function prepararTablas(): array
    {
        $tablasOrigen = $this->origen->query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )->fetchAll(PDO::FETCH_COLUMN);
        $tablasDestino = $this->tablasDestino();
        $copiar = array_values(array_diff($tablasOrigen, self::EXCLUIDAS));

        foreach ($copiar as $tabla) {
            if (! isset($tablasDestino[$tabla])) {
                throw new TrasladoException("La tabla {$tabla} del origen no existe en el destino.");
            }

            $this->tablas[$tabla] = $this->describir($tabla);
        }

        // Nada se sobrescribe: todas las tablas de datos del destino deben estar vacías.
        foreach (array_diff(array_keys($tablasDestino), self::EXCLUIDAS) as $tabla) {
            if ($this->destino->table($tabla)->exists()) {
                throw new TrasladoException("La tabla {$tabla} del destino ya tiene datos. El traslado solo se hace sobre una base recién migrada.");
            }
        }

        return $this->ordenarPorDependencias($copiar);
    }

    /**
     * @return array{pk: list<string>, columnas: list<string>, tipos: array<string, array<string, mixed>>}
     */
    private function describir(string $tabla): array
    {
        $info = $this->origen->query('PRAGMA table_info('.$this->comillasSqlite($tabla).')')->fetchAll();
        $pk = array_column(array_filter($info, fn (array $c): bool => $c['pk'] > 0), 'name', 'pk');
        ksort($pk);

        if ($pk === []) {
            throw new TrasladoException("La tabla {$tabla} no tiene clave primaria: no se puede verificar fila a fila.");
        }

        $columnasDestino = [];

        foreach ($this->destino->select(
            'SELECT COLUMN_NAME AS nombre, DATA_TYPE AS tipo, COLUMN_TYPE AS definicion, CHARACTER_MAXIMUM_LENGTH AS longitud,'
            .' IS_NULLABLE AS nulo, COLUMN_DEFAULT AS defecto, EXTRA AS extra'
            .' FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$tabla],
        ) as $columna) {
            $columnasDestino[$columna->nombre] = (array) $columna;
        }

        $columnas = array_column($info, 'name');
        sort($columnas);

        foreach ($columnas as $columna) {
            if (! isset($columnasDestino[$columna])) {
                throw new TrasladoException("La columna {$tabla}.{$columna} no existe en el destino.");
            }

            $tipo = strtolower($columnasDestino[$columna]['tipo']);

            if (! in_array($tipo, [...self::ENTEROS, ...self::TEXTOS, 'enum', 'date', 'datetime', 'timestamp'], true)) {
                throw new TrasladoException("Tipo {$tipo} de {$tabla}.{$columna} no soportado por el traslado; amplíe y pruebe el normalizador antes de continuar.");
            }
        }

        foreach (array_diff_key($columnasDestino, array_flip($columnas)) as $nombre => $columna) {
            if ($columna['nulo'] === 'NO' && $columna['defecto'] === null && ! str_contains((string) $columna['extra'], 'auto_increment')) {
                throw new TrasladoException("La columna obligatoria {$tabla}.{$nombre} del destino no existe en el origen.");
            }
        }

        return ['pk' => array_values($pk), 'columnas' => $columnas, 'tipos' => array_intersect_key($columnasDestino, array_flip($columnas))];
    }

    /**
     * Orden topológico según las claves foráneas declaradas en el destino.
     *
     * @param  list<string>  $tablas
     * @return list<string>
     */
    private function ordenarPorDependencias(array $tablas): array
    {
        $dependencias = array_fill_keys($tablas, []);

        foreach ($this->clavesForaneas() as $fk) {
            if (isset($dependencias[$fk->tabla]) && isset($dependencias[$fk->referencia]) && $fk->tabla !== $fk->referencia) {
                $dependencias[$fk->tabla][] = $fk->referencia;
            }
        }

        $orden = [];
        $visitando = [];
        $visitar = static function (string $tabla) use (&$visitar, &$orden, &$visitando, $dependencias): void {
            if (in_array($tabla, $orden, true)) {
                return;
            }

            if (isset($visitando[$tabla])) {
                throw new TrasladoException("Dependencia circular entre claves foráneas en {$tabla}.");
            }

            $visitando[$tabla] = true;

            foreach ($dependencias[$tabla] as $referencia) {
                $visitar($referencia);
            }

            unset($visitando[$tabla]);
            $orden[] = $tabla;
        };

        foreach ($tablas as $tabla) {
            $visitar($tabla);
        }

        return $orden;
    }

    /**
     * @return list<object{tabla: string, columna: string, referencia: string, columna_referencia: string, nombre: string}>
     */
    private function clavesForaneas(): array
    {
        return $this->destino->select(
            'SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, REFERENCED_TABLE_NAME AS referencia,'
            .' REFERENCED_COLUMN_NAME AS columna_referencia, CONSTRAINT_NAME AS nombre'
            .' FROM information_schema.KEY_COLUMN_USAGE'
            .' WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME'
        );
    }

    /**
     * Recorre el origen, valida cada valor contra el tipo de destino y calcula su firma.
     *
     * @return array{filas: int, firma: string}
     */
    private function validarYFirmarOrigen(string $tabla): array
    {
        $hash = hash_init('sha256');
        $filas = 0;
        $errores = [];

        foreach ($this->leerOrigen($tabla) as $fila) {
            try {
                $normalizada = $this->normalizarFila($tabla, $fila, true);
                hash_update($hash, $this->lineaFirma($normalizada));
            } catch (TrasladoException $e) {
                $errores[] = $e->getMessage();

                if (count($errores) >= 20) {
                    break;
                }
            }

            $filas++;
        }

        if ($errores !== []) {
            throw new TrasladoException("Datos de {$tabla} que MySQL no conservaría tal cual (no se escribió nada):\n- ".implode("\n- ", $errores));
        }

        return ['filas' => $filas, 'firma' => hash_final($hash)];
    }

    /**
     * @return iterable<array<string, mixed>>
     */
    private function leerOrigen(string $tabla): iterable
    {
        $meta = $this->tablas[$tabla];
        $orden = implode(', ', array_map($this->comillasSqlite(...), $meta['pk']));
        $columnas = implode(', ', array_map($this->comillasSqlite(...), $meta['columnas']));
        $consulta = $this->origen->query("SELECT {$columnas} FROM {$this->comillasSqlite($tabla)} ORDER BY {$orden}");

        while (($fila = $consulta->fetch()) !== false) {
            yield $fila;
        }
    }

    /**
     * @param  array<string, mixed>  $fila
     * @return array<string, mixed>
     */
    private function normalizarFila(string $tabla, array $fila, bool $validar): array
    {
        $meta = $this->tablas[$tabla];
        $id = implode('/', array_map(fn (string $c): string => (string) $fila[$c], $meta['pk']));
        $salida = [];

        foreach ($meta['columnas'] as $columna) {
            $salida[$columna] = $this->normalizarValor($fila[$columna], $meta['tipos'][$columna], $validar, "{$tabla}.{$columna} (id {$id})");
        }

        return $salida;
    }

    /**
     * Representación canónica común a ambos motores. Con $validar, rechaza todo lo
     * que MySQL truncaría, convertiría en silencio o no podría guardar.
     *
     * @param  array<string, mixed>  $tipo
     */
    private function normalizarValor(mixed $valor, array $tipo, bool $validar, string $donde): int|string|null
    {
        if ($valor === null) {
            if ($validar && $tipo['nulo'] === 'NO') {
                throw new TrasladoException("{$donde}: valor nulo en una columna obligatoria.");
            }

            return null;
        }

        $clase = strtolower($tipo['tipo']);

        if (in_array($clase, self::ENTEROS, true)) {
            if (is_int($valor) || (is_string($valor) && preg_match('/^-?\d{1,19}$/', $valor) === 1)) {
                return (int) $valor;
            }

            throw new TrasladoException("{$donde}: se esperaba un número entero.");
        }

        $texto = is_string($valor) || is_int($valor) ? (string) $valor : null;

        if ($texto === null || ($validar && ! mb_check_encoding($texto, 'UTF-8'))) {
            throw new TrasladoException("{$donde}: valor no textual o con codificación no válida.");
        }

        if ($clase === 'date') {
            if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?: 00:00:00)?$/', $texto, $m) !== 1 || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
                throw new TrasladoException("{$donde}: fecha no válida o con hora distinta de 00:00:00 (MySQL la truncaría).");
            }

            return "{$m[1]}-{$m[2]}-{$m[3]}";
        }

        if ($clase === 'datetime' || $clase === 'timestamp') {
            if (preg_match('/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/', $texto, $m) !== 1
                || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1]) || $m[4] > 23 || $m[5] > 59 || $m[6] > 59) {
                throw new TrasladoException("{$donde}: fecha y hora con formato no admitido (se espera AAAA-MM-DD HH:MM:SS).");
            }

            if ($clase === 'timestamp' && ($texto < '1970-01-01 00:00:01' || $texto > '2038-01-19 03:14:07')) {
                throw new TrasladoException("{$donde}: fecha fuera del rango de TIMESTAMP en MySQL.");
            }

            return $texto;
        }

        if ($validar && $clase === 'enum') {
            preg_match_all("/'((?:[^']|'')*)'/", (string) $tipo['definicion'], $valores);

            if (! in_array($texto, str_replace("''", "'", $valores[1]), true)) {
                throw new TrasladoException("{$donde}: valor fuera de la lista exacta (MySQL lo cambiaría de mayúsculas o lo rechazaría).");
            }
        }

        if ($validar && $tipo['longitud'] !== null) {
            $medida = in_array($clase, ['char', 'varchar'], true) ? mb_strlen($texto) : strlen($texto);

            if ($medida > (int) $tipo['longitud']) {
                throw new TrasladoException("{$donde}: supera la longitud máxima del destino ({$tipo['longitud']}).");
            }
        }

        return $texto;
    }

    /**
     * @param  array<string, mixed>  $fila
     */
    private function lineaFirma(array $fila): string
    {
        return json_encode($fila, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
    }

    /**
     * @param  list<string>  $orden
     * @param  array<string, array{filas: int, firma: string}>  $firmasOrigen
     * @return array<string, array{filas: int, firma: string}>
     */
    private function copiar(array $orden, array $firmasOrigen, bool $aplicar): array
    {
        $this->destino->beginTransaction();

        try {
            foreach ($orden as $tabla) {
                $this->insertar($tabla);
            }

            $resultado = [];
            $diferencias = [];

            foreach ($orden as $tabla) {
                $resultado[$tabla] = $this->firmarDestino($tabla);

                if ($resultado[$tabla] !== $firmasOrigen[$tabla]) {
                    $diferencias[] = "{$tabla} (origen {$firmasOrigen[$tabla]['filas']} filas, destino {$resultado[$tabla]['filas']}; firmas ".
                        ($resultado[$tabla]['firma'] === $firmasOrigen[$tabla]['firma'] ? 'iguales' : 'distintas').')';
                }
            }

            foreach ($this->clavesForaneas() as $fk) {
                if (isset($this->tablas[$fk->tabla])) {
                    $huerfanas = $this->destino->table($fk->tabla.' as h')
                        ->leftJoin($fk->referencia.' as r', 'r.'.$fk->columna_referencia, '=', 'h.'.$fk->columna)
                        ->whereNotNull('h.'.$fk->columna)->whereNull('r.'.$fk->columna_referencia)->count();

                    if ($huerfanas > 0) {
                        $diferencias[] = "{$fk->nombre}: {$huerfanas} referencia(s) sin destino";
                    }
                }
            }

            if (hash_file('sha256', $this->rutaOrigen) !== $this->huellaOrigen) {
                // No debería ocurrir en solo lectura y con lectura transaccional: otro proceso escribió.
                $diferencias[] = 'el archivo de origen cambió durante la lectura; detenga la aplicación, copie la base y repita con la copia';
            }

            if ($diferencias !== []) {
                throw new TrasladoException("La verificación posterior a la copia falló; se revirtió todo:\n- ".implode("\n- ", $diferencias));
            }

            if ($aplicar) {
                $this->destino->commit();
            } else {
                $this->destino->rollBack();
            }

            return $resultado;
        } catch (Throwable $e) {
            if ($this->destino->transactionLevel() > 0) {
                $this->destino->rollBack();
            }

            if ($e instanceof QueryException) {
                throw new TrasladoException('MySQL rechazó la copia y se revirtió todo: '.$this->errorSeguro($e));
            }

            throw $e;
        }
    }

    private function insertar(string $tabla): void
    {
        $lote = [];

        foreach ($this->leerOrigen($tabla) as $fila) {
            $lote[] = $this->normalizarFila($tabla, $fila, false);

            if (count($lote) === self::LOTE) {
                $this->insertarLote($tabla, $lote);
                $lote = [];
            }
        }

        if ($lote !== []) {
            $this->insertarLote($tabla, $lote);
        }
    }

    /**
     * @param  list<array<string, mixed>>  $lote
     */
    private function insertarLote(string $tabla, array $lote): void
    {
        try {
            $this->destino->table($tabla)->insert($lote);
        } catch (QueryException $e) {
            $pk = $this->tablas[$tabla]['pk'][0];

            throw new TrasladoException("Tabla {$tabla}, ids {$lote[0][$pk]}–".end($lote)[$pk].': '.$this->errorSeguro($e).'. Se revirtió todo.');
        }
    }

    /**
     * @return array{filas: int, firma: string}
     */
    private function firmarDestino(string $tabla): array
    {
        $meta = $this->tablas[$tabla];
        $hash = hash_init('sha256');
        $filas = 0;

        foreach ($this->destino->table($tabla)->select($meta['columnas'])->orderBy($meta['pk'][0])
            ->when(count($meta['pk']) > 1, fn ($q) => $q->orderBy($meta['pk'][1]))->cursor() as $fila) {
            hash_update($hash, $this->lineaFirma($this->normalizarFila($tabla, (array) $fila, false)));
            $filas++;
        }

        return ['filas' => $filas, 'firma' => hash_final($hash)];
    }

    /**
     * Describe el error de MySQL sin citar valores (los mensajes 1062 incluyen el dato duplicado).
     */
    private function errorSeguro(QueryException $e): string
    {
        $codigo = (int) ($e->errorInfo[1] ?? 0);
        $mensaje = (string) ($e->errorInfo[2] ?? '');
        $nombre = fn (string $patron): string => preg_match($patron, $mensaje, $m) === 1 ? $m[1] : 'desconocida';

        return match ($codigo) {
            1062 => 'duplicado en el índice único '.$nombre("/for key '([^']+)'/").' (MySQL compara sin distinguir mayúsculas ni tildes)',
            3819 => 'incumple la restricción '.$nombre("/constraint '([^']+)'/"),
            1452 => 'clave foránea sin registro relacionado ('.$nombre('/CONSTRAINT `([^`]+)`/').')',
            1406 => 'texto demasiado largo para la columna '.$nombre("/column '([^']+)'/"),
            default => "error MySQL {$codigo} (SQLSTATE ".($e->errorInfo[0] ?? '?').')',
        };
    }

    /**
     * @param  list<string>  $orden
     * @return array<string, int>
     */
    private function secuenciasOrigen(array $orden): array
    {
        if ($this->origen->query("SELECT count(*) FROM sqlite_master WHERE name = 'sqlite_sequence'")->fetchColumn() == 0) {
            return [];
        }

        $secuencias = [];

        foreach ($this->origen->query('SELECT name, seq FROM sqlite_sequence') as $fila) {
            if (in_array($fila['name'], $orden, true)) {
                $secuencias[$fila['name']] = (int) $fila['seq'];
            }
        }

        return $secuencias;
    }

    /**
     * SQLite AUTOINCREMENT no reutiliza ids de filas borradas; InnoDB continuaría desde
     * el máximo actual. Tras confirmar, se lleva cada contador al siguiente de la
     * secuencia de origen (DDL fuera de la transacción ya confirmada).
     *
     * @param  array<string, int>  $secuencias
     * @return list<string>
     */
    private function ajustarAutoincrementos(array $secuencias): array
    {
        $avisos = [];

        foreach ($secuencias as $tabla => $secuencia) {
            $maximo = (int) $this->destino->table($tabla)->max($this->tablas[$tabla]['pk'][0]);

            if ($secuencia > $maximo) {
                try {
                    $this->destino->statement(sprintf('ALTER TABLE `%s` AUTO_INCREMENT = %d', $tabla, $secuencia + 1));
                } catch (QueryException $e) {
                    $avisos[] = "No se pudo ajustar AUTO_INCREMENT de {$tabla}: ".$this->errorSeguro($e);
                }
            }
        }

        return $avisos;
    }

    private function comillasSqlite(string $identificador): string
    {
        return '"'.str_replace('"', '""', $identificador).'"';
    }
}
