<?php

namespace App\Console\Commands;

use App\Support\Traslado\TrasladoException;
use App\Support\Traslado\TrasladoSqliteMysql;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * Traslado SQLite → MySQL. Por defecto es un simulacro: copia, verifica y revierte.
 * Ver docs/mysql-traslado.md.
 */
class TrasladarSqliteMysql extends Command
{
    protected $signature = 'horus:trasladar-sqlite-mysql
        {--origen= : Ruta del archivo SQLite de origen (se abre en solo lectura; preferiblemente una copia)}
        {--destino=mysql : Conexión MySQL de destino, ya migrada y vacía}
        {--aplicar : Confirmar la copia (sin esta opción se revierte siempre)}
        {--yes : No pedir confirmación al aplicar}
        {--informe= : Ruta opcional de un informe JSON (sin datos personales)}';

    protected $description = 'Traslada los datos académicos de SQLite a una base MySQL nueva, con verificación de recuentos y firmas';

    public function handle(): int
    {
        $origen = (string) $this->option('origen');
        $aplicar = (bool) $this->option('aplicar');

        if ($origen === '') {
            $this->error('Indique --origen con la ruta de la base SQLite.');

            return self::INVALID;
        }

        try {
            $destino = DB::connection((string) $this->option('destino'));
        } catch (InvalidArgumentException) {
            $this->error('La conexión de destino no está configurada.');

            return self::INVALID;
        }

        $this->line(sprintf('Destino: conexión «%s», base «%s».', $this->option('destino'), $destino->getDatabaseName()));

        if ($aplicar && ! $this->option('yes') && ! $this->confirm('Se escribirán los datos en el destino. ¿Hizo el respaldo del origen y detuvo la aplicación?')) {
            $this->warn('Cancelado: no se escribió nada.');

            return self::FAILURE;
        }

        try {
            $informe = (new TrasladoSqliteMysql($origen, $destino))->ejecutar($aplicar);
        } catch (TrasladoException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $this->table(['Tabla', 'Filas', 'Firma SHA-256 (inicio)'], array_map(
            fn (string $tabla, array $r): array => [$tabla, $r['filas'], substr($r['firma'], 0, 16)],
            array_keys($informe['tablas']), $informe['tablas'],
        ));

        foreach ($informe['avisos'] as $aviso) {
            $this->warn($aviso);
        }

        if (filled($this->option('informe'))) {
            file_put_contents((string) $this->option('informe'), json_encode($informe, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
            $this->line('Informe guardado.');
        }

        $this->info($aplicar
            ? 'Traslado aplicado y verificado: recuentos, firmas e integridad referencial coinciden.'
            : 'Simulacro correcto: la copia se verificó y se revirtió. Repita con --aplicar para confirmarla.');
        $this->line('Firma global: '.$informe['firma_global']);

        return self::SUCCESS;
    }
}
