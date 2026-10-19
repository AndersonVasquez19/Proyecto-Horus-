<?php

use App\Support\RestriccionesBd;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Restricción de base de datos para el celular del estudiante: NULL o
 * 9 dígitos que empiezan por 9. Cubre escrituras que se saltan el modelo.
 *
 * Migración aditiva: no cambia columnas ni datos. Si ya hay teléfonos que
 * no cumplen la regla, se detiene sin tocarlos para que se revisen a mano
 * (php artisan estudiantes:revisar-telefonos).
 */
return new class extends Migration
{
    private const RESTRICCION = 'estudiantes_telefono_valido';

    public function up(): void
    {
        $invalidos = DB::table('estudiantes')
            ->whereNotNull('telefono')
            ->orderBy('id')
            ->get(['id', 'telefono'])
            ->reject(fn (object $fila): bool => preg_match('/^9\d{8}$/', (string) $fila->telefono) === 1)
            ->pluck('id');

        if ($invalidos->isNotEmpty()) {
            throw new RuntimeException(sprintf(
                'Hay %d estudiante(s) con un teléfono que no cumple «9 dígitos y empieza por 9» (id: %s). '
                .'No se modificaron. Revíselos con «php artisan estudiantes:revisar-telefonos» y vuelva a migrar.',
                $invalidos->count(),
                $invalidos->implode(', '),
            ));
        }

        RestriccionesBd::agregar(
            'estudiantes',
            self::RESTRICCION,
            "NEW.telefono IS NULL OR (length(NEW.telefono) = 9 AND NEW.telefono GLOB '9[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')",
            "telefono IS NULL OR telefono REGEXP '^9[0-9]{8}$'",
        );
    }

    public function down(): void
    {
        RestriccionesBd::eliminar('estudiantes', self::RESTRICCION);
    }
};
