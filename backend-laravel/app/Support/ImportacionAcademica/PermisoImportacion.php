<?php

namespace App\Support\ImportacionAcademica;

use App\Models\Estudiante;
use App\Models\Matricula;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * Importar es registrar estudiantes y matrículas: se exige exactamente lo que
 * ya exigen las políticas actuales para crearlos a mano (EstudiantePolicy y
 * MatriculaPolicy::create → rol académico y cuenta activa, leídos de la base).
 * No define ningún permiso nuevo ni amplía roles.
 */
final class PermisoImportacion
{
    public static function permite(mixed $usuario): bool
    {
        return $usuario instanceof User
            && Gate::forUser($usuario)->allows('create', Estudiante::class)
            && Gate::forUser($usuario)->allows('create', Matricula::class);
    }
}
