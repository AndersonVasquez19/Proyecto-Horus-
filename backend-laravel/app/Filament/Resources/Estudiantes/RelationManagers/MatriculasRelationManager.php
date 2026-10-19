<?php

namespace App\Filament\Resources\Estudiantes\RelationManagers;

use App\Enums\EstadoMatricula;
use App\Filament\Resources\Matriculas\MatriculaResource;
use App\Filament\Support\AccionesAcademicas;
use App\Filament\Support\OpcionesAcademicas;
use App\Models\Estudiante;
use App\Models\Matricula;
use Closure;
use Filament\Actions\Action;
use Filament\Actions\CreateAction;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;

/**
 * Historial de matrículas del estudiante (también visible en su ficha).
 */
class MatriculasRelationManager extends RelationManager
{
    protected static string $relationship = 'matriculas';

    protected static ?string $title = 'Historial de matrículas';

    protected static ?string $modelLabel = 'matrícula';

    protected static ?string $pluralModelLabel = 'matrículas';

    /**
     * Permite matricular y cambiar estados también desde la ficha (vista) del estudiante.
     */
    public function isReadOnly(): bool
    {
        return false;
    }

    public function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->with('edicion.curso'))
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('edicion.curso.nombre')
                    ->label('Curso')
                    ->weight('medium'),
                TextColumn::make('edicion.nombre')
                    ->label('Edición')
                    ->description(fn (Matricula $record): ?string => $record->edicion->fecha_inicio?->format('d/m/Y')),
                TextColumn::make('fecha_matricula')
                    ->label('Fecha de matrícula')
                    ->date('d/m/Y')
                    ->placeholder('Sin fecha'),
                TextColumn::make('estado')
                    ->label('Estado')
                    ->badge(),
                TextColumn::make('observaciones')
                    ->label('Observaciones')
                    ->limit(40)
                    ->placeholder('—')
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('estado')
                    ->label('Estado')
                    ->options(EstadoMatricula::class),
            ])
            ->headerActions([
                CreateAction::make()
                    ->authorize(fn (): bool => Gate::allows('create', Matricula::class))
                    ->before(fn () => Gate::authorize('create', Matricula::class))
                    ->label('Matricular en una edición')
                    ->modalHeading('Matricular en una edición')
                    ->createAnother(false)
                    ->schema(fn (): array => [
                        Select::make('edicion_id')
                            ->label('Curso y edición')
                            ->options(fn (): array => OpcionesAcademicas::edicionesParaMatricular($this->getOwnerRecord()->getKey()))
                            ->searchable()
                            ->required()
                            ->noOptionsMessage('No hay ediciones disponibles para este estudiante.')
                            ->rules([
                                fn (): Closure => function (string $attribute, mixed $value, Closure $fail): void {
                                    $motivo = Matricula::motivoParaNoMatricular($this->getOwnerRecord()->getKey(), $value);

                                    if ($motivo !== null) {
                                        $fail($motivo);
                                    }
                                },
                            ]),
                        DatePicker::make('fecha_matricula')
                            ->label('Fecha de matrícula')
                            ->helperText('Opcional. Déjela vacía si no se conoce.'),
                        Textarea::make('observaciones')
                            ->label('Observaciones')
                            ->rows(2),
                    ])
                    ->using(function (array $data): Model {
                        /** @var Estudiante $estudiante */
                        $estudiante = $this->getOwnerRecord();

                        return AccionesAcademicas::matricularEnModal(
                            fn (): Model => $estudiante->matriculas()->create($data),
                            $this->getMountedActionSchema(),
                        );
                    })
                    ->successNotificationTitle('Estudiante matriculado'),
            ])
            ->recordActions([
                AccionesAcademicas::cambiarEstadoMatricula(),
                Action::make('abrir')
                    ->authorize('view')
                    ->label('Abrir')
                    ->icon(Heroicon::OutlinedEye)
                    ->color('gray')
                    ->url(fn (Matricula $record): string => MatriculaResource::getUrl('view', ['record' => $record])),
            ])
            ->emptyStateHeading('Sin matrículas')
            ->emptyStateDescription('Este estudiante todavía no está matriculado en ninguna edición.');
    }
}
