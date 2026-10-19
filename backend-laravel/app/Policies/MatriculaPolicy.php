<?php

namespace App\Policies;

use App\Models\Matricula;
use App\Models\User;

class MatriculaPolicy extends PoliticaAcademica
{
    public function delete(User $user, Matricula $matricula): bool
    {
        return false;
    }

    public function cambiarEstado(User $user, Matricula $matricula): bool
    {
        return $this->update($user, $matricula) && $matricula->estado->transicionesPermitidas() !== [];
    }
}
