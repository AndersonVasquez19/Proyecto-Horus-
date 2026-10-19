<?php

use App\Http\Controllers\ContenidoPublicoController;
use App\Http\Middleware\ContenidoPublicoHabilitado;
use Illuminate\Support\Facades\Route;

/*
 * API pública de contenido (solo lectura) para la web React: /api/contenido/*.
 * Grupo «api» sin sesión ni cookies. Responde 404 mientras HORUS_CONTENIDO_API
 * no se active. No sustituye ninguna otra ruta /api: NestJS sigue siendo el
 * proveedor del sitio y del chatbot.
 */
Route::prefix('contenido')
    ->name('contenido.')
    ->middleware([ContenidoPublicoHabilitado::class, 'throttle:contenido-publico'])
    ->controller(ContenidoPublicoController::class)
    ->group(function (): void {
        Route::get('cursos', 'cursos')->name('cursos');
        Route::get('cursos/{id}', 'curso')->whereNumber('id')->name('curso');
        Route::get('servicios', 'servicios')->name('servicios');
        Route::get('servicios/{id}', 'servicio')->whereNumber('id')->name('servicio');
        Route::get('preguntas-frecuentes', 'preguntas')->name('preguntas');
        Route::get('preguntas-frecuentes/{id}', 'pregunta')->whereNumber('id')->name('pregunta');
        Route::get('galeria', 'galeria')->name('galeria');
        Route::get('galeria/{id}', 'foto')->whereNumber('id')->name('foto');
        Route::get('convenios', 'convenios')->name('convenios');
        Route::get('convenios/{id}', 'convenio')->whereNumber('id')->name('convenio');
        Route::get('settings', 'ajustes')->name('ajustes');
    });
