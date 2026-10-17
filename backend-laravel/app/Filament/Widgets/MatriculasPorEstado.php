<?php

namespace App\Filament\Widgets;

use App\Enums\EstadoMatricula;
use App\Filament\Resources\Matriculas\MatriculaResource;
use App\Models\Matricula;
use Filament\Widgets\Widget;

/**
 * Número de matrículas en cada estado, consultado en la base de datos.
 *
 * Se muestra como una barra apilada con CSS (sin librería de gráficos) y una
 * leyenda con la cantidad y la descripción de cada estado.
 */
class MatriculasPorEstado extends Widget
{
    public static function canView(): bool
    {
        return MatriculaResource::canViewAny();
    }

    protected static ?int $sort = 2;

    protected static bool $isLazy = false;

    protected string $view = 'filament.widgets.matriculas-por-estado';

    protected int|string|array $columnSpan = ['default' => 'full', 'xl' => 2];

    /**
     * Modificador de color (horus-academic.css) por estado.
     */
    private const TONOS = [
        'MATRICULADO' => 'azul',
        'CULMINADO' => 'verde',
        'RETIRADO' => 'coral',
        'ANULADO' => 'gris',
    ];

    /**
     * @return array<string, mixed>
     */
    protected function getViewData(): array
    {
        /** @var array<string, int> $conteos */
        $conteos = Matricula::query()
            ->selectRaw('estado, COUNT(*) as total')
            ->groupBy('estado')
            ->pluck('total', 'estado')
            ->map(fn ($total): int => (int) $total)
            ->all();

        $total = array_sum($conteos);

        $estados = array_map(
            fn (EstadoMatricula $estado): array => [
                'etiqueta' => $estado->getLabel(),
                'descripcion' => $estado->getDescription(),
                'cantidad' => $cantidad = $conteos[$estado->value] ?? 0,
                'porcentaje' => $total > 0 ? round($cantidad * 100 / $total, 1) : 0,
                'tono' => self::TONOS[$estado->value] ?? 'gris',
            ],
            EstadoMatricula::cases(),
        );

        return [
            'total' => $total,
            'estados' => $estados,
            'urlMatriculas' => MatriculaResource::getUrl(),
        ];
    }
}
