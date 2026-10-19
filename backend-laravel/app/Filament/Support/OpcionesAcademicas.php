<?php

namespace App\Filament\Support;

use App\Enums\EstadoEdicion;
use App\Enums\EstadoMatricula;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;

/**
 * Opciones de los selectores de estudiante y edición del panel.
 */
final class OpcionesAcademicas
{
    /**
     * Ediciones que admiten matrículas, como «Curso — Edición».
     * Si se indica un estudiante, se excluyen las ediciones donde ya está matriculado.
     *
     * @return array<int, string>
     */
    public static function edicionesParaMatricular(mixed $estudianteId = null): array
    {
        $ocupanCupo = array_map(fn (EstadoMatricula $e): string => $e->value, EstadoMatricula::ocupanCupo());

        return Edicion::query()
            ->with('curso')
            ->withCount(['matriculas as vigentes_count' => fn ($q) => $q->whereIn('estado', $ocupanCupo)])
            ->where('estado', '!=', EstadoEdicion::Cancelada->value)
            ->when(filled($estudianteId), fn ($q) => $q->whereDoesntHave('matriculas', fn ($m) => $m->where('estudiante_id', $estudianteId)))
            ->orderBy(Curso::query()->select('nombre')->whereColumn('cursos.id', 'ediciones.curso_id'))
            ->orderByDesc('fecha_inicio')
            ->orderBy('nombre')
            ->get()
            ->mapWithKeys(fn (Edicion $edicion): array => [$edicion->getKey() => self::etiquetaEdicionConCupo($edicion)])
            ->all();
    }

    public static function etiquetaEdicionConCupo(Edicion $edicion): string
    {
        $etiqueta = $edicion->etiqueta.' ('.$edicion->estado->getLabel();

        if ($edicion->cupo !== null) {
            $vigentes = $edicion->vigentes_count ?? $edicion->matriculasQueOcupanCupo();
            $etiqueta .= ", {$vigentes}/{$edicion->cupo} plazas";
        }

        return $etiqueta.')';
    }

    /**
     * @return array<int, string>
     */
    public static function buscarEstudiantes(?string $termino): array
    {
        return Estudiante::query()
            ->buscar($termino)
            ->orderBy('apellidos')
            ->orderBy('nombres')
            ->limit(50)
            ->get()
            ->mapWithKeys(fn (Estudiante $e): array => [$e->getKey() => self::etiquetaEstudiante($e)])
            ->all();
    }

    public static function etiquetaEstudiante(?Estudiante $estudiante): ?string
    {
        return $estudiante ? $estudiante->nombre_completo.' — '.$estudiante->documento : null;
    }
}
