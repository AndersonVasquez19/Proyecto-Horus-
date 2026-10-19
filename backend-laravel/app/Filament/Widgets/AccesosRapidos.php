<?php

namespace App\Filament\Widgets;

use App\Filament\Resources\Cursos\CursoResource;
use App\Filament\Resources\Ediciones\EdicionResource;
use App\Filament\Resources\Estudiantes\EstudianteResource;
use App\Filament\Resources\Matriculas\MatriculaResource;
use Filament\Support\Icons\Heroicon;
use Filament\Widgets\Widget;

/**
 * Enlaces a las pantallas de alta existentes. No hace consultas de datos.
 *
 * Cada acceso solo se muestra si el recurso tiene página de creación y el
 * usuario tiene permiso para crear (las mismas comprobaciones que el botón
 * «Crear» de cada listado).
 */
class AccesosRapidos extends Widget
{
    public static function canView(): bool
    {
        return MatriculaResource::canCreate() || EstudianteResource::canCreate()
            || EdicionResource::canCreate() || CursoResource::canCreate();
    }

    protected static ?int $sort = 3;

    protected static bool $isLazy = false;

    protected string $view = 'filament.widgets.accesos-rapidos';

    protected int|string|array $columnSpan = ['default' => 'full', 'xl' => 1];

    /**
     * @return array<string, mixed>
     */
    protected function getViewData(): array
    {
        /** @var list<array{0: class-string<\Filament\Resources\Resource>, 1: string, 2: string, 3: Heroicon, 4: string}> $accesos */
        $accesos = [
            [MatriculaResource::class, 'Nueva matrícula', 'Inscribir a un estudiante en una edición', Heroicon::OutlinedClipboardDocumentCheck, 'azul'],
            [EstudianteResource::class, 'Nuevo estudiante', 'Registrar sus datos y documento', Heroicon::OutlinedUserPlus, 'turquesa'],
            [EdicionResource::class, 'Nueva edición', 'Programar una edición de un curso', Heroicon::OutlinedCalendarDays, 'coral'],
            [CursoResource::class, 'Nuevo curso', 'Agregar un curso al catálogo', Heroicon::OutlinedBookOpen, 'intenso'],
        ];

        $visibles = [];

        foreach ($accesos as [$recurso, $titulo, $descripcion, $icono, $tono]) {
            if (! $recurso::hasPage('create') || ! $recurso::canCreate()) {
                continue;
            }

            $visibles[] = [
                'titulo' => $titulo,
                'descripcion' => $descripcion,
                'icono' => $icono,
                'tono' => $tono,
                'url' => $recurso::getUrl('create'),
            ];
        }

        return ['accesos' => $visibles];
    }
}
