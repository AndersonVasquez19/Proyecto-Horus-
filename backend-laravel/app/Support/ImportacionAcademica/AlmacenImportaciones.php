<?php

namespace App\Support\ImportacionAcademica;

use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Copias temporales de los archivos a importar, en el disco privado «local»
 * (storage/app/private), nunca en almacenamiento público. Cada archivo se
 * nombra con una ficha UUID generada aquí; el nombre original solo se conserva
 * como texto para mostrarlo. Se borran al confirmar, al cancelar o, como
 * máximo, a las 24 horas.
 */
final class AlmacenImportaciones
{
    public const DIRECTORIO = 'importaciones-academicas';

    private const HORAS_MAXIMAS = 24;

    public function guardar(string $rutaOrigen, string $nombreOriginal): ArchivoPreparado
    {
        $formato = Str::lower(pathinfo($nombreOriginal, PATHINFO_EXTENSION));

        if (! in_array($formato, LectorArchivo::FORMATOS, true)) {
            throw new ArchivoNoValidoException('Formato no admitido. Use un archivo CSV o XLSX (no XLS, XLSM ni ODS).');
        }

        $tamano = is_file($rutaOrigen) ? filesize($rutaOrigen) : false;

        if ($tamano === false || $tamano === 0) {
            throw new ArchivoNoValidoException('El archivo está vacío.');
        }

        if ($tamano > LectorArchivo::TAMANO_MAXIMO_KB * 1024) {
            throw new ArchivoNoValidoException('El archivo supera el tamaño máximo de '.(LectorArchivo::TAMANO_MAXIMO_KB / 1024).' MB.');
        }

        $this->limpiarAntiguos();
        $token = (string) Str::uuid();
        $flujo = fopen($rutaOrigen, 'rb');

        try {
            $this->disco()->put($this->rutaRelativa($token, $formato), $flujo);
        } finally {
            if (is_resource($flujo)) {
                fclose($flujo);
            }
        }

        return new ArchivoPreparado($token, $formato, $this->nombreVisible($nombreOriginal), (string) hash_file('sha256', $this->ruta($token, $formato)));
    }

    public function ruta(string $token, string $formato): string
    {
        return $this->disco()->path($this->rutaRelativa($token, $formato));
    }

    public function existe(string $token, string $formato): bool
    {
        return $this->disco()->exists($this->rutaRelativa($token, $formato));
    }

    public function eliminar(?string $token, ?string $formato): void
    {
        if ($token === null || $formato === null || ! Str::isUuid($token) || ! in_array($formato, LectorArchivo::FORMATOS, true)) {
            return;
        }

        $this->disco()->delete($this->rutaRelativa($token, $formato));
    }

    public function limpiarAntiguos(): void
    {
        $limite = now()->subHours(self::HORAS_MAXIMAS)->getTimestamp();

        foreach ($this->disco()->files(self::DIRECTORIO) as $archivo) {
            if (preg_match('/^'.self::DIRECTORIO.'\/[0-9a-f-]{36}\.(csv|xlsx)$/', $archivo) === 1
                && $this->disco()->lastModified($archivo) < $limite) {
                $this->disco()->delete($archivo);
            }
        }
    }

    private function rutaRelativa(string $token, string $formato): string
    {
        // Solo fichas generadas por el servidor y formatos admitidos: ninguna ruta arbitraria.
        if (! Str::isUuid($token) || ! in_array($formato, LectorArchivo::FORMATOS, true)) {
            throw new ArchivoNoValidoException('El archivo ya no está disponible. Vuelva a subirlo.');
        }

        return self::DIRECTORIO.'/'.Str::lower($token).'.'.$formato;
    }

    private function nombreVisible(string $nombre): string
    {
        $nombre = basename(str_replace('\\', '/', $nombre));
        $nombre = trim(preg_replace('/[\p{C}]+/u', '', $nombre) ?? '');

        return mb_substr($nombre === '' ? 'archivo' : $nombre, 0, 255);
    }

    private function disco(): Filesystem
    {
        return Storage::disk('local');
    }
}
