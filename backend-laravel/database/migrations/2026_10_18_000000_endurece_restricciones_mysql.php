<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Equipara en MySQL las restricciones CHECK con las que SQLite ya aplica mediante
 * triggers (GLOB y comparaciones exactas). Verificado en MySQL 8.4: con la colación
 * utf8mb4_unicode_ci, REGEXP no distingue mayúsculas, «$» admite un salto de línea
 * final e IN ignora mayúsculas y espacios finales. Sin este ajuste MySQL aceptaría
 * «abcd» como CE, «12345678\n» como DNI o «SECRETARIA » como rol.
 *
 * Aditiva: en SQLite (y en cualquier motor que no sea MySQL) no hace nada. En MySQL
 * no cambia columnas ni datos; si alguna fila no cumple la regla estricta se detiene
 * antes de alterar la tabla, y cada sustitución es un único ALTER atómico.
 */
return new class extends Migration
{
    private const ESTADOS = "'MATRICULADO', 'CULMINADO', 'RETIRADO', 'ANULADO'";

    private const TIPOS = "'CREACION', 'CAMBIO_ESTADO', 'RETIRO', 'ANULACION', 'REACTIVACION'";

    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'mysql') {
            return;
        }

        $estrictas = $this->estrictas();

        foreach ($estrictas as [$tabla, $nombre, $condicion]) {
            $incumplen = DB::table($tabla)->whereRaw("NOT COALESCE(({$condicion}), 0)")->count();

            if ($incumplen > 0) {
                throw new RuntimeException(sprintf(
                    'La tabla %s tiene %d fila(s) que no cumplen %s. No se modificó nada; revíselas antes de migrar.',
                    $tabla, $incumplen, $nombre,
                ));
            }
        }

        foreach ($estrictas as [$tabla, $nombre, $condicion]) {
            DB::statement("ALTER TABLE {$tabla} DROP CHECK {$nombre}, ADD CONSTRAINT {$nombre} CHECK ({$condicion})");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() !== 'mysql') {
            return;
        }

        // Definiciones originales de las migraciones del 2026-10-17.
        foreach ($this->originales() as [$tabla, $nombre, $condicion]) {
            DB::statement("ALTER TABLE {$tabla} DROP CHECK {$nombre}, ADD CONSTRAINT {$nombre} CHECK ({$condicion})");
        }
    }

    /**
     * @return list<array{string, string, string}>
     */
    private function estrictas(): array
    {
        $b = fn (string $columna): string => "CAST({$columna} AS BINARY)";

        return [
            ['estudiantes', 'estudiantes_documento_valido',
                "({$b('tipo_documento')} = 'SIN_DOCUMENTO' AND numero_documento IS NULL)"
                ." OR ({$b('tipo_documento')} = 'DNI' AND numero_documento IS NOT NULL AND CHAR_LENGTH(numero_documento) = 8"
                ." AND NOT REGEXP_LIKE(numero_documento, '[^0-9]', 'c'))"
                ." OR ({$b('tipo_documento')} IN ('CE', 'PASAPORTE') AND numero_documento IS NOT NULL"
                ." AND CHAR_LENGTH(numero_documento) BETWEEN 4 AND 20 AND NOT REGEXP_LIKE(numero_documento, '[^A-Z0-9]', 'c'))"],
            ['estudiantes', 'estudiantes_telefono_valido',
                "telefono IS NULL OR (CHAR_LENGTH(telefono) = 9 AND LEFT(telefono, 1) = '9'"
                ." AND NOT REGEXP_LIKE(telefono, '[^0-9]', 'c'))"],
            ['users', 'users_rol_valido',
                "rol IS NULL OR {$b('rol')} IN ('administrador_general', 'coordinador_institucional', 'secretaria')"],
            ['matricula_movimientos', 'matricula_movimientos_valores_validos',
                "{$b('tipo')} IN (".self::TIPOS.") AND {$b('estado_nuevo')} IN (".self::ESTADOS.') AND ('
                ."({$b('tipo')} = 'CREACION' AND estado_anterior IS NULL AND {$b('estado_nuevo')} = 'MATRICULADO')"
                ." OR ({$b('tipo')} <> 'CREACION' AND {$b('estado_anterior')} IN (".self::ESTADOS.')'
                ." AND {$b('estado_anterior')} <> {$b('estado_nuevo')}))"],
        ];
    }

    /**
     * @return list<array{string, string, string}>
     */
    private function originales(): array
    {
        return [
            ['estudiantes', 'estudiantes_documento_valido',
                "(tipo_documento = 'SIN_DOCUMENTO' AND numero_documento IS NULL)"
                ." OR (tipo_documento = 'DNI' AND numero_documento IS NOT NULL AND numero_documento REGEXP '^[0-9]{8}$')"
                ." OR (tipo_documento IN ('CE', 'PASAPORTE') AND numero_documento IS NOT NULL AND numero_documento REGEXP '^[A-Z0-9]{4,20}$')"],
            ['estudiantes', 'estudiantes_telefono_valido', "telefono IS NULL OR telefono REGEXP '^9[0-9]{8}$'"],
            ['users', 'users_rol_valido', "rol IS NULL OR rol IN ('administrador_general', 'coordinador_institucional', 'secretaria')"],
            ['matricula_movimientos', 'matricula_movimientos_valores_validos',
                'tipo IN ('.self::TIPOS.') AND estado_nuevo IN ('.self::ESTADOS.') AND ('
                ."(tipo = 'CREACION' AND estado_anterior IS NULL AND estado_nuevo = 'MATRICULADO')"
                ." OR (tipo <> 'CREACION' AND estado_anterior IN (".self::ESTADOS.') AND estado_anterior <> estado_nuevo))'],
        ];
    }
};
