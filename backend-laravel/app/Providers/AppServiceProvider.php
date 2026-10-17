<?php

namespace App\Providers;

use Filament\Actions\CreateAction;
use Filament\Support\Icons\Heroicon;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

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
        RateLimiter::for('public-register', fn (Request $request) => Limit::perMinute(5)->by('register:'.$request->ip()));
        RateLimiter::for('public-login', function (Request $request): array {
            $email = $request->input('email');
            $identidad = is_string($email) ? Str::lower(trim($email)) : '';

            return [
                Limit::perMinute(30)->by('login-ip:'.$request->ip()),
                Limit::perMinute(5)->by('login-account:'.hash('sha256', $identidad.'|'.$request->ip())),
            ];
        });

        // Tema Horus Academic (Fase 2, solo presentación): todos los botones de alta
        // («Nuevo estudiante», «Matricular»…) llevan el icono «+». Se aplica al crear la
        // acción, así que un ->icon() explícito en un recurso sigue teniendo prioridad.
        CreateAction::configureUsing(fn (CreateAction $accion): CreateAction => $accion->icon(Heroicon::OutlinedPlus));
    }
}
