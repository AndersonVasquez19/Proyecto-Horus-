<?php

namespace App\Filament\Pages;

use App\Models\User;
use Filament\Facades\Filament;
use Filament\Pages\Dashboard as BaseDashboard;

/**
 * Escritorio del panel. Conserva la ruta, el título y los widgets de Filament;
 * solo fija la rejilla y el subtítulo.
 */
class Dashboard extends BaseDashboard
{
    public static function canAccess(): bool
    {
        $user = Filament::auth()->user();

        return $user instanceof User && $user->puedeGestionarAcademico();
    }

    /**
     * Una columna hasta 1280 px; desde ahí, «Matrículas por estado» (2/3)
     * y «Accesos rápidos» (1/3) comparten fila.
     */
    public function getColumns(): int | array
    {
        return ['default' => 1, 'xl' => 3];
    }

    public function getSubheading(): ?string
    {
        return 'Resumen de la gestión académica de Horus Group';
    }
}
