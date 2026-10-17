<?php

use App\Http\Controllers\Auth\SesionPublicaController;
use App\Http\Middleware\CuentaPublicaActiva;
use App\Http\Middleware\SesionPublica;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Http\Controllers\CsrfCookieController;

if (config('public-auth.enabled')) {
    // El grupo web aporta cookies cifradas, sesión y protección CSRF también a POST.
    Route::middleware(SesionPublica::class)->group(function (): void {
        Route::get('/sanctum/csrf-cookie', [CsrfCookieController::class, 'show'])->name('sanctum.csrf-cookie');

        Route::prefix('api/auth')->name('public-auth.')->group(function (): void {
            Route::post('/register', [SesionPublicaController::class, 'register'])->middleware('throttle:public-register')->name('register');
            Route::post('/login', [SesionPublicaController::class, 'login'])->middleware('throttle:public-login')->name('login');

            // Guard de sesión explícito: no aceptar Authorization: Bearer ni emitir tokens.
            Route::middleware(['auth:web', CuentaPublicaActiva::class])->group(function (): void {
                Route::get('/me', [SesionPublicaController::class, 'me'])->name('me');
                Route::post('/logout', [SesionPublicaController::class, 'logout'])->name('logout');
            });
        });
    });
}
