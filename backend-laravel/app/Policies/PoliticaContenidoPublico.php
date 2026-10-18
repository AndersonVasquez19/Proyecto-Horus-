<?php

namespace App\Policies;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * Contenido público de la web. Mínimo privilegio: todo depende de
 * User::puedeGestionarContenidoPublico() (desactivado por defecto). Declara todas
 * las habilidades porque el panel usa autorización estricta. Sin operaciones
 * masivas, réplicas ni reordenación por arrastre.
 */
abstract class PoliticaContenidoPublico
{
    /** Si el tipo de contenido admite eliminación definitiva. */
    protected const ELIMINABLE = false;

    public function viewAny(User $user): bool
    {
        return $user->puedeGestionarContenidoPublico();
    }

    public function view(User $user, Model $record): bool
    {
        return $user->puedeGestionarContenidoPublico();
    }

    public function create(User $user): bool
    {
        return $user->puedeGestionarContenidoPublico();
    }

    public function update(User $user, Model $record): bool
    {
        return $user->puedeGestionarContenidoPublico();
    }

    public function delete(User $user, Model $record): bool
    {
        return static::ELIMINABLE && $user->puedeGestionarContenidoPublico();
    }

    public function deleteAny(User $user): bool
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

    public function replicate(User $user, Model $record): bool
    {
        return false;
    }

    public function reorder(User $user): bool
    {
        return false;
    }
}
