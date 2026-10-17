<?php

namespace App\Filament\Resources\Ediciones\Schemas;

use App\Enums\EstadoEdicion;
use App\Models\Edicion;
use Closure;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Components\Utilities\Get;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\Rules\Unique;

class EdicionForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Edición o convocatoria')
                    ->icon(Heroicon::OutlinedRectangleStack)
                    ->extraAttributes(['class' => 'horus-tono-azul'])
                    ->description('Una edición es cada vez que se dicta un curso. Las fechas y el cupo son opcionales: no registre fechas que no consten.')
                    ->columns(2)
                    ->columnSpanFull()
                    ->schema([
                        Select::make('curso_id')
                            ->label('Curso')
                            ->relationship(
                                'curso',
                                'nombre',
                                // Al crear, solo cursos activos; al editar se conserva el curso actual.
                                fn (Builder $query, ?Model $record) => $query->where(
                                    fn (Builder $q) => $q->where('activo', true)->when($record?->curso_id, fn ($q2, $id) => $q2->orWhere('id', $id))
                                ),
                            )
                            ->default(fn (): ?int => request()->integer('curso_id') ?: null)
                            ->searchable()
                            ->preload()
                            ->required()
                            ->live()
                            ->disabled(fn (?Edicion $record): bool => (bool) $record?->matriculas()->exists())
                            ->helperText(fn (?Edicion $record): ?string => $record?->matriculas()->exists() ? 'No se puede cambiar el curso porque la edición ya tiene matrículas.' : null),
                        TextInput::make('nombre')
                            ->label('Nombre o identificador de la edición')
                            ->placeholder('Ej.: 2024, Grupo A – marzo 2025')
                            ->required()
                            ->maxLength(150)
                            ->unique(
                                ignoreRecord: true,
                                modifyRuleUsing: fn (Unique $rule, Get $get) => $rule->where('curso_id', $get('curso_id')),
                            )
                            ->validationMessages(['unique' => 'Este curso ya tiene una edición con ese nombre.']),
                        Select::make('estado')
                            ->label('Estado')
                            ->options(EstadoEdicion::class)
                            ->default(EstadoEdicion::Planificada->value)
                            ->selectablePlaceholder(false)
                            ->required(),
                    ]),
                // Solo agrupación visual: los campos conservan su nombre, estado y reglas.
                Section::make('Fechas y cupo')
                    ->icon(Heroicon::OutlinedCalendarDays)
                    ->extraAttributes(['class' => 'horus-tono-turquesa'])
                    ->columns(['default' => 1, 'md' => 3])
                    ->columnSpanFull()
                    ->schema([
                        DatePicker::make('fecha_inicio')
                            ->label('Fecha de inicio')
                            ->live(),
                        DatePicker::make('fecha_fin')
                            ->label('Fecha de fin')
                            ->rules([
                                fn (Get $get): Closure => function (string $attribute, mixed $value, Closure $fail) use ($get): void {
                                    $inicio = $get('fecha_inicio');

                                    if (filled($value) && filled($inicio) && strtotime((string) $value) < strtotime((string) $inicio)) {
                                        $fail('La fecha de fin no puede ser anterior a la fecha de inicio.');
                                    }
                                },
                            ]),
                        TextInput::make('cupo')
                            ->label('Cupo')
                            ->helperText('Opcional. Déjelo vacío si no hay límite de estudiantes.')
                            ->integer()
                            ->minValue(1)
                            ->maxValue(65535),
                    ]),
            ]);
    }
}
