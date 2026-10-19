<?php

namespace App\Filament\Resources\Matriculas\Schemas;

use App\Enums\EstadoMatricula;
use App\Filament\Support\AccionesAcademicas;
use App\Filament\Support\OpcionesAcademicas;
use App\Models\Estudiante;
use App\Models\Matricula;
use Closure;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Components\Utilities\Get;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;

class MatriculaForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Matrícula')
                    ->icon(Heroicon::OutlinedClipboardDocumentList)
                    ->extraAttributes(['class' => 'horus-tono-azul'])
                    ->description('Registrar una matrícula indica que el estudiante está inscrito en la edición. No implica pago, asistencia ni aprobación.')
                    ->columns(2)
                    ->columnSpanFull()
                    ->schema([
                        Select::make('estudiante_id')
                            ->label('Estudiante')
                            ->searchable()
                            ->searchPrompt('Escriba DNI, apellidos o nombres')
                            ->noSearchResultsMessage('No se encontraron estudiantes.')
                            ->getSearchResultsUsing(fn (string $search): array => OpcionesAcademicas::buscarEstudiantes($search))
                            ->getOptionLabelUsing(fn ($value): ?string => OpcionesAcademicas::etiquetaEstudiante(Estudiante::query()->find($value)))
                            ->default(fn (): ?int => request()->integer('estudiante_id') ?: null)
                            ->required()
                            ->live()
                            ->disabledOn('edit')
                            ->helperText(fn (string $operation): ?string => $operation === 'edit' ? 'El estudiante y la edición no se cambian. Si hubo un error, anule esta matrícula y registre otra.' : null),
                        Select::make('edicion_id')
                            ->label('Curso y edición')
                            ->options(fn (Get $get, string $operation, ?Matricula $record): array => $operation === 'edit' && $record
                                ? [$record->edicion_id => $record->edicion->etiqueta]
                                : OpcionesAcademicas::edicionesParaMatricular($get('estudiante_id')))
                            ->searchable()
                            ->required()
                            ->disabledOn('edit')
                            ->noOptionsMessage('No hay ediciones disponibles.')
                            ->rules([
                                fn (Get $get, string $operation): Closure => function (string $attribute, mixed $value, Closure $fail) use ($get, $operation): void {
                                    if ($operation !== 'create') {
                                        return;
                                    }

                                    $motivo = Matricula::motivoParaNoMatricular($get('estudiante_id'), $value);

                                    if ($motivo !== null) {
                                        $fail($motivo);
                                    }
                                },
                            ]),
                        DatePicker::make('fecha_matricula')
                            ->label('Fecha de matrícula')
                            ->helperText('Opcional. Déjela vacía si no se conoce.'),
                        Select::make('estado')
                            ->label('Estado')
                            ->hiddenOn('create')
                            ->options(fn (?Matricula $record): array => collect($record?->estadosDisponibles() ?? [EstadoMatricula::Matriculado])
                                ->mapWithKeys(fn (EstadoMatricula $estado): array => [$estado->value => $estado->getLabel()])
                                ->all())
                            ->selectablePlaceholder(false)
                            ->required()
                            ->helperText(fn ($state): ?string => ($state instanceof EstadoMatricula ? $state : EstadoMatricula::tryFrom((string) $state))?->getDescription())
                            ->live(),
                        // Solo al editar y cuando se elige un estado distinto del guardado.
                        AccionesAcademicas::campoMotivo('Motivo del cambio de estado (opcional)')
                            ->visible(fn (string $operation, Get $get, ?Matricula $record): bool => $operation === 'edit'
                                && $record !== null
                                && self::valorEstado($get('estado')) !== $record->estado->value)
                            ->columnSpanFull(),
                        Textarea::make('observaciones')
                            ->label('Observaciones')
                            ->rows(3)
                            ->columnSpanFull(),
                    ]),
            ]);
    }

    private static function valorEstado(mixed $estado): ?string
    {
        return $estado instanceof EstadoMatricula ? $estado->value : (filled($estado) ? (string) $estado : null);
    }
}
