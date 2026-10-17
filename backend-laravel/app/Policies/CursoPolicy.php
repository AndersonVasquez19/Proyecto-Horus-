<?php

namespace App\Policies;

use App\Models\Curso;
use App\Models\User;

class CursoPolicy extends PoliticaAcademica
{
    public function delete(User $user, Curso $curso): bool
    {
        return $user->puedeGestionarAcademico() && ! $curso->ediciones()->exists();
    }
}
