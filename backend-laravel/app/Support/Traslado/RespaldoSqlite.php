<?php

namespace App\Support\Traslado;

use RuntimeException;
use SQLite3;
use Throwable;

/** Instantánea nativa: incluye WAL confirmado y nunca abre el origen para escritura. */
final class RespaldoSqlite
{
    public function crear(string $origen, string $destino): array
    {
        if (! is_file($origen) || file_exists($destino) || ! is_dir(dirname($destino))) {
            throw new RuntimeException('Origen ausente, destino existente o carpeta de destino inexistente.');
        }

        $source = new SQLite3($origen, SQLITE3_OPEN_READONLY);
        $source->enableExceptions(true);
        $source->busyTimeout(5000);
        $source->exec('PRAGMA query_only=ON');
        $target = null;
        $creado = false;

        try {
            $source->exec('BEGIN');
            $antes = $this->describir($source);
            // Reserva exclusiva: no sobrescribir incluso ante una ejecución concurrente.
            $reserva = @fopen($destino, 'x');
            if ($reserva === false) {
                throw new RuntimeException('No se pudo reservar un respaldo nuevo.');
            }
            fclose($reserva);
            $creado = true;
            $target = new SQLite3($destino, SQLITE3_OPEN_READWRITE);
            $target->enableExceptions(true);
            if (! $source->backup($target)) {
                throw new RuntimeException('SQLite no completó el respaldo nativo.');
            }
            $despues = $this->describir($target);
            if ($antes !== $despues) {
                throw new RuntimeException('El respaldo no coincide con la instantánea del origen.');
            }
            $target->close();
            $target = null;

            return $antes + ['archivo_sha256' => hash_file('sha256', $destino), 'fecha_utc' => gmdate('c')];
        } catch (Throwable $e) {
            $target?->close();
            if ($creado) {
                unlink($destino);
            }
            throw $e;
        } finally {
            $source->exec('ROLLBACK');
            $source->close();
        }
    }

    private function describir(SQLite3 $db): array
    {
        if ($db->querySingle('PRAGMA integrity_check') !== 'ok') {
            throw new RuntimeException('SQLite no supera integrity_check.');
        }
        $fk = $db->query('PRAGMA foreign_key_check');
        if ($fk->fetchArray(SQLITE3_ASSOC) !== false) {
            throw new RuntimeException('SQLite no supera la integridad referencial.');
        }
        $fk->finalize();
        $schema = $db->query('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name');
        $objetos = [];
        $tablas = [];
        while ($row = $schema->fetchArray(SQLITE3_ASSOC)) {
            $objetos[] = $row;
            if ($row['type'] !== 'table') {
                continue;
            }
            $name = '"'.str_replace('"', '""', $row['name']).'"';
            $rows = $db->query('SELECT * FROM '.$name);
            $firmas = [];
            while ($data = $rows->fetchArray(SQLITE3_ASSOC)) {
                // serialize conserva tipos y BLOB sin mostrar valores ni exigir UTF-8.
                $firmas[] = hash('sha256', serialize($data));
            }
            $rows->finalize();
            sort($firmas, SORT_STRING);
            $tablas[$row['name']] = ['filas' => count($firmas), 'sha256' => hash('sha256', implode("\n", $firmas))];
        }
        $schema->finalize();

        return ['integridad' => 'ok', 'esquema_sha256' => hash('sha256', serialize($objetos)), 'tablas' => $tablas];
    }
}
