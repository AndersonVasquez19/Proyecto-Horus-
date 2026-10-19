<?php

namespace App\Policies;

use App\Models\Estudiante;
use App\Models\User;

class EstudiantePolicy extends PoliticaAcademica
{
    public function delete(User $user, Estudiante $estudiante): bool
    {
        return $user->puedeGestionarAcademico() && ! $estudiante->matriculas()->exists();
    }
}
