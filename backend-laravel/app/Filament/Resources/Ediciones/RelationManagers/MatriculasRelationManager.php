<?php

namespace App\Filament\Resources\Ediciones\RelationManagers;

use App\Enums\EstadoMatricula;
use App\Filament\Resources\Matriculas\MatriculaResource;
use App\Filament\Support\AccionesAcademicas;
use App\Filament\Support\OpcionesAcademicas;
use App\Models\Edicion;
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
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;

/**
 * Estudiantes matriculados en la edición.
 */
class MatriculasRelationManager extends RelationManager
{
    protected static string $relationship = 'matriculas';

    protected static ?string $title = 'Estudiantes matriculados';

    protected static ?string $modelLabel = 'matrícula';

    protected static ?string $pluralModelLabel = 'matrículas';

    public function isReadOnly(): bool
    {
        return false;
    }

    public function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn (Builder $query) => $query->with('estudiante'))
            ->searchable()
            ->searchUsing(fn (Builder $query, string $search) => $query->whereHas('estudiante', fn (Builder $q) => $q->buscar($search)))
            ->searchPlaceholder('Buscar por DNI o nombre')
            ->columns([
                TextColumn::make('estudiante.apellidos')
                    ->label('Apellidos')
                    ->weight('medium'),
                TextColumn::make('estudiante.nombres')
                    ->label('Nombres'),
                TextColumn::make('estudiante.numero_documento')
                    ->label('Documento')
                    ->placeholder('Sin documento'),
                TextColumn::make('fecha_matricula')
                    ->label('Fecha de matrícula')
                    ->date('d/m/Y')
                    ->placeholder('Sin fecha'),
                TextColumn::make('estado')
                    ->label('Estado')
                    ->badge(),
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
                    ->label('Matricular estudiante')
                    ->modalHeading('Matricular estudiante en esta edición')
                    ->createAnother(false)
                    ->visible(fn (): bool => $this->edicion()->estado->admiteMatriculas())
                    ->schema(fn (): array => [
                        Select::make('estudiante_id')
                            ->label('Estudiante')
                            ->searchable()
                            ->searchPrompt('Escriba DNI, apellidos o nombres')
                            ->noSearchResultsMessage('No se encontraron estudiantes.')
                            ->getSearchResultsUsing(fn (string $search): array => OpcionesAcademicas::buscarEstudiantes($search))
                            ->getOptionLabelUsing(fn ($value): ?string => OpcionesAcademicas::etiquetaEstudiante(Estudiante::query()->find($value)))
                            ->required()
                            ->rules([
                                fn (): Closure => function (string $attribute, mixed $value, Closure $fail): void {
                                    $motivo = Matricula::motivoParaNoMatricular($value, $this->edicion()->getKey());

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
                    ->using(fn (array $data): Model => AccionesAcademicas::matricularEnModal(
                        fn (): Model => $this->edicion()->matriculas()->create($data),
                        $this->getMountedActionSchema(),
                        campoEdicion: 'estudiante_id',
                    ))
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
            ->emptyStateHeading('Sin estudiantes matriculados')
            ->emptyStateDescription('Use «Matricular estudiante» para registrar la primera matrícula.');
    }

    private function edicion(): Edicion
    {
        /** @var Edicion */
        return $this->getOwnerRecord();
    }
}
