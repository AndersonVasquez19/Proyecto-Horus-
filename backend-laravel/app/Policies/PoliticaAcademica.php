<?php

namespace App\Policies;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

abstract class PoliticaAcademica
{
    public function viewAny(User $user): bool
    {
        return $user->puedeGestionarAcademico();
    }

    public function view(User $user, Model $record): bool
    {
        return $user->puedeGestionarAcademico();
    }

    public function create(User $user): bool
    {
        return $user->puedeGestionarAcademico();
    }

    public function update(User $user, Model $record): bool
    {
        return $user->puedeGestionarAcademico();
    }

    public function deleteAny(User $user): bool
    {
        return false;
    }

    public function reorder(User $user): bool
    {
        return false;
    }

    public function replicate(User $user, Model $record): bool
    {
        return false;
    }

    public function restore(User $user, Model $record): bool
    {
        return false;
    }

    public function restoreAny(User $user): bool
    {
        return false;
    }

    public function forceDelete(User $user, Model $record): bool
    {
        return false;
    }

    public function forceDeleteAny(User $user): bool
    {
        return false;
    }
}
