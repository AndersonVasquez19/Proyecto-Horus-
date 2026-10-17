<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * Añade restricciones CHECK a tablas ya creadas, de forma compatible con
 * varios motores.
 *
 * - SQLite no admite ALTER TABLE ... ADD CONSTRAINT, así que la regla se
 *   aplica con dos triggers (INSERT y UPDATE) que abortan la operación.
 * - MySQL 8.0.16+, MariaDB y PostgreSQL usan CHECK nativo.
 *
 * Solo la variante SQLite está cubierta por las pruebas automatizadas de
 * esta entrega; las demás deben verificarse al cambiar de motor.
 */
final class RestriccionesBd
{
    /**
     * @param  string  $condicionSqlite  Condición válida en un trigger (columnas con prefijo NEW.).
     *                                   Un resultado NULL se trata como incumplimiento.
     * @param  string  $condicionCheck  Condición para CHECK en MySQL/MariaDB/PostgreSQL (columnas sin prefijo).
     */
    public static function agregar(string $tabla, string $nombre, string $condicionSqlite, string $condicionCheck): void
    {
        self::validarIdentificador($tabla);
        self::validarIdentificador($nombre);

        $driver = DB::connection()->getDriverName();

        if ($driver === 'sqlite') {
            foreach (['INSERT', 'UPDATE'] as $evento) {
                $trigger = $nombre.'_'.strtolower($evento);
                DB::unprepared(sprintf(
                    'CREATE TRIGGER "%s" BEFORE %s ON "%s" FOR EACH ROW WHEN NOT COALESCE((%s), 0) BEGIN SELECT RAISE(ABORT, \'CHECK constraint failed: %s\'); END;',
                    $trigger,
                    $evento,
                    $tabla,
                    $condicionSqlite,
                    $nombre,
                ));
            }

            return;
        }

        DB::statement(sprintf('ALTER TABLE %s ADD CONSTRAINT %s CHECK (%s)', $tabla, $nombre, $condicionCheck));
    }

    public static function eliminar(string $tabla, string $nombre): void
    {
        self::validarIdentificador($tabla);
        self::validarIdentificador($nombre);

        $driver = DB::connection()->getDriverName();

        if ($driver === 'sqlite') {
            foreach (['insert', 'update'] as $evento) {
                DB::unprepared(sprintf('DROP TRIGGER IF EXISTS "%s_%s";', $nombre, $evento));
            }

            return;
        }

        $sql = match ($driver) {
            'mysql' => 'ALTER TABLE %s DROP CHECK %s',
            default => 'ALTER TABLE %s DROP CONSTRAINT %s',
        };

        DB::statement(sprintf($sql, $tabla, $nombre));
    }

    private static function validarIdentificador(string $identificador): void
    {
        if (! preg_match('/^[a-z_][a-z0-9_]*$/', $identificador)) {
            throw new InvalidArgumentException('Identificador SQL no válido.');
        }
    }
}
