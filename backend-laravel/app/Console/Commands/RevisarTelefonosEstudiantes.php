<?php

namespace App\Console\Commands;

use App\Models\Estudiante;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Lista los estudiantes cuyo teléfono guardado no es un celular peruano válido.
 * Solo lee: no corrige ni borra nada. La corrección se hace a mano en el panel.
 */
class RevisarTelefonosEstudiantes extends Command
{
    protected $signature = 'estudiantes:revisar-telefonos';

    protected $description = 'Lista (sin modificar) los estudiantes con un teléfono que no tiene 9 dígitos o no empieza por 9';

    public function handle(): int
    {
        $filas = DB::table('estudiantes')
            ->whereNotNull('telefono')
            ->orderBy('id')
            ->get(['id', 'apellidos', 'nombres', 'telefono'])
            ->reject(fn (object $fila): bool => preg_match(Estudiante::PATRON_TELEFONO, (string) $fila->telefono) === 1);

        if ($filas->isEmpty()) {
            $this->info('Todos los teléfonos registrados son válidos (o están vacíos).');

            return self::SUCCESS;
        }

        $this->warn("{$filas->count()} estudiante(s) requieren revisión del teléfono. No se modificó ningún registro.");

        // No se imprime el número completo: basta el motivo para localizarlo en el panel.
        $this->table(
            ['ID', 'Estudiante', 'Motivo'],
            $filas->map(fn (object $fila): array => [
                $fila->id,
                trim($fila->apellidos.', '.$fila->nombres, ', '),
                self::motivo((string) $fila->telefono),
            ])->all(),
        );

        return self::FAILURE;
    }

    private static function motivo(string $telefono): string
    {
        $normalizado = Estudiante::normalizarTelefono($telefono);

        if ($normalizado === null) {
            return 'Solo contiene espacios (debería estar vacío)';
        }

        if (preg_match(Estudiante::PATRON_TELEFONO, $normalizado) === 1) {
            return 'Contiene espacios o guiones (se normaliza al guardarlo)';
        }

        if (preg_match('/\D/', $normalizado) === 1) {
            return 'Contiene caracteres que no son dígitos';
        }

        if (strlen($normalizado) !== 9) {
            return 'Tiene '.strlen($normalizado).' dígito(s) en lugar de 9';
        }

        return 'No empieza por 9';
    }
}
