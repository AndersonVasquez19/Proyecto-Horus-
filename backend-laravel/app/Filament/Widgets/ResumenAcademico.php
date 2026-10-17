<?php

namespace App\Filament\Widgets;

use App\Enums\EstadoEdicion;
use App\Enums\EstadoMatricula;
use App\Filament\Resources\Cursos\CursoResource;
use App\Filament\Resources\Ediciones\EdicionResource;
use App\Filament\Resources\Estudiantes\EstudianteResource;
use App\Filament\Resources\Matriculas\MatriculaResource;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use Filament\Support\Icons\Heroicon;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

/**
 * Totales académicos. Consulta la base de datos en cada carga; no hay cifras de ejemplo.
 */
class ResumenAcademico extends StatsOverviewWidget
{
    public static function canView(): bool
    {
        return EstudianteResource::canViewAny() && CursoResource::canViewAny()
            && EdicionResource::canViewAny() && MatriculaResource::canViewAny();
    }

    protected static ?int $sort = 1;

    protected static bool $isLazy = false;

    protected ?string $pollingInterval = null;

    protected ?string $heading = 'Resumen académico';

    /** 1 columna en móvil, 2 en tablet y 4 en escritorio (consultas de contenedor de Filament). */
    protected int | array | null $columns = ['@md' => 2, '@4xl' => 4, '!@md' => 2, '!@xl' => 4];

    protected function getStats(): array
    {
        $estudiantes = Estudiante::query()->count();
        $cursos = Curso::query()->count();
        $cursosActivos = Curso::query()->activos()->count();
        $ediciones = Edicion::query()->count();
        $edicionesAbiertas = Edicion::query()
            ->whereIn('estado', [EstadoEdicion::Planificada->value, EstadoEdicion::EnCurso->value])
            ->count();
        $matriculas = Matricula::query()->count();
        $vigentes = Matricula::query()
            ->whereIn('estado', array_map(fn (EstadoMatricula $e): string => $e->value, EstadoMatricula::ocupanCupo()))
            ->count();

        return [
            Stat::make('Estudiantes', $estudiantes)
                ->description($estudiantes === 0 ? 'Aún no hay estudiantes registrados' : 'Registrados en el sistema')
                ->icon(Heroicon::OutlinedUserGroup)
                ->url(EstudianteResource::getUrl())
                ->extraAttributes(['class' => 'horus-stat horus-tono-azul']),
            Stat::make('Cursos activos', $cursosActivos)
                ->description($cursos === 0 ? 'Aún no hay cursos registrados' : "{$cursos} curso(s) en total")
                ->icon(Heroicon::OutlinedBookOpen)
                ->url(CursoResource::getUrl())
                ->extraAttributes(['class' => 'horus-stat horus-tono-turquesa']),
            Stat::make('Ediciones', $ediciones)
                ->description($ediciones === 0 ? 'Aún no hay ediciones registradas' : "{$edicionesAbiertas} planificada(s) o en curso")
                ->icon(Heroicon::OutlinedCalendarDays)
                ->url(EdicionResource::getUrl())
                ->extraAttributes(['class' => 'horus-stat horus-tono-coral']),
            Stat::make('Matrículas', $matriculas)
                ->description($matriculas === 0 ? 'Aún no hay matrículas registradas' : "{$vigentes} vigente(s): matriculados o culminados")
                ->icon(Heroicon::OutlinedClipboardDocumentList)
                ->url(MatriculaResource::getUrl())
                ->extraAttributes(['class' => 'horus-stat horus-tono-intenso']),
        ];
    }
}
