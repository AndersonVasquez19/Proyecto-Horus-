<?php

namespace App\Policies;

use App\Models\MatriculaMovimiento;
use App\Models\User;

/**
 * El historial de matrículas solo se consulta; nadie lo crea, edita ni borra
 * desde el panel (lo escribe el modelo Matricula dentro de su transacción).
 */
class MatriculaMovimientoPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->puedeGestionarAcademico();
    }

    public function view(User $user, MatriculaMovimiento $movimiento): bool
    {
        return $user->puedeGestionarAcademico();
    }

    public function create(User $user): bool
    {
        return false;
    }

    public function update(User $user, MatriculaMovimiento $movimiento): bool
    {
        return false;
    }

    public function delete(User $user, MatriculaMovimiento $movimiento): bool
    {
        return false;
    }

    public function deleteAny(User $user): bool
    {
        return false;
    }

    public function restore(User $user, MatriculaMovimiento $movimiento): bool
    {
        return false;
    }

    public function restoreAny(User $user): bool
    {
        return false;
    }

    public function forceDelete(User $user, MatriculaMovimiento $movimiento): bool
    {
        return false;
    }

    public function forceDeleteAny(User $user): bool
    {
        return false;
    }

    public function replicate(User $user, MatriculaMovimiento $movimiento): bool
    {
        return false;
    }

    public function reorder(User $user): bool
    {
        return false;
    }

    public function associate(User $user, MatriculaMovimiento $movimiento): bool
    {
        return false;
    }

    public function dissociate(User $user, MatriculaMovimiento $movimiento): bool
    {
        return false;
    }

    public function dissociateAny(User $user): bool
    {
        return false;
    }
}
