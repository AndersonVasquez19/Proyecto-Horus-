<?php

namespace App\Providers;

use Filament\Actions\CreateAction;
use Filament\Support\Icons\Heroicon;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Tema Horus Academic (Fase 2, solo presentación): todos los botones de alta
        // («Nuevo estudiante», «Matricular»…) llevan el icono «+». Se aplica al crear la
        // acción, así que un ->icon() explícito en un recurso sigue teniendo prioridad.
        CreateAction::configureUsing(fn (CreateAction $accion): CreateAction => $accion->icon(Heroicon::OutlinedPlus));
    }
}
