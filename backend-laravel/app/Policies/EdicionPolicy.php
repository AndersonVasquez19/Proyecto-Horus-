<?php

namespace App\Policies;

use App\Models\Edicion;
use App\Models\User;

class EdicionPolicy extends PoliticaAcademica
{
    public function delete(User $user, Edicion $edicion): bool
    {
        return $user->puedeGestionarAcademico() && ! $edicion->matriculas()->exists();
    }
}
