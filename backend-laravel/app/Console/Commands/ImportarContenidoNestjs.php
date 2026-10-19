<?php

namespace App\Console\Commands;

use App\Support\Contenido\ImportarContenido;
use App\Support\Traslado\DestinoMysqlLaravel;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class ImportarContenidoNestjs extends Command
{
    protected $signature = 'horus:importar-contenido-nestjs
        {--archivo= : Intercambio JSON privado versión 1, sin conexión al origen}
        {--uploads= : Directorio de uploads autorizado, solo lectura}
        {--publicos= : Directorio público autorizado, solo lectura}
        {--base-esperada= : Nombre exacto de la base MySQL Laravel}
        {--servidor-uuid= : UUID del servidor MySQL comprobado}
        {--aplicar : Confirmar la importación; por defecto revierte todo}';

    protected $description = 'Verifica e importa un intercambio de contenido; nunca conecta a NestJS';

    public function handle(ImportarContenido $importador): int
    {
        try {
            $db = DB::connection();
            $confirmado = $db->getDriverName() === 'mysql'
                && DestinoMysqlLaravel::nombrePermitido($db->getDatabaseName())
                && $db->getDatabaseName() === $this->option('base-esperada')
                && $this->option('servidor-uuid')
                && strtolower((string) $db->selectOne('SELECT @@server_uuid AS uuid')->uuid) === strtolower($this->option('servidor-uuid'));
        } catch (Throwable) {
            $confirmado = false;
        }
        if (! $confirmado) {
            $this->error('Destino no confirmado: se requiere MySQL, la base exacta y su server_uuid.');

            return self::FAILURE;
        }
        if ($this->option('aplicar') && ! $this->confirm('¿Está autorizado importar este intercambio en la base comprobada, con la edición de contenido detenida?')) {
            return self::FAILURE;
        }
        try {
            $informe = $importador->ejecutar((string) $this->option('archivo'), (bool) $this->option('aplicar'),
                (string) $this->option('uploads'), (string) $this->option('publicos'));
            $this->line(json_encode($informe, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT));

            return self::SUCCESS;
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
    }
}
