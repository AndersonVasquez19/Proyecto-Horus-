<?php

namespace App\Filament\Resources\Contenido\PreguntasFrecuentes;

use App\Enums\Contenido\EstadoPublicacion;
use App\Filament\Resources\Contenido\PreguntasFrecuentes\Pages\CreatePreguntaFrecuente;
use App\Filament\Resources\Contenido\PreguntasFrecuentes\Pages\EditPreguntaFrecuente;
use App\Filament\Resources\Contenido\PreguntasFrecuentes\Pages\ListPreguntasFrecuentes;
use App\Filament\Support\AccionesContenido;
use App\Filament\Support\CamposContenido;
use App\Models\PreguntaFrecuente;
use BackedEnum;
use Filament\Actions\ActionGroup;
use Filament\Actions\EditAction;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use UnitEnum;

class PreguntaFrecuenteResource extends Resource
{
    protected static ?string $model = PreguntaFrecuente::class;

    protected static ?string $slug = 'contenido/preguntas-frecuentes';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedQuestionMarkCircle;

    protected static string|UnitEnum|null $navigationGroup = 'Contenido web';

    protected static ?int $navigationSort = 3;

    protected static ?string $navigationLabel = 'Preguntas frecuentes';

    protected static ?string $modelLabel = 'pregunta frecuente';

    protected static ?string $pluralModelLabel = 'preguntas frecuentes';

    protected static ?string $recordTitleAttribute = 'pregunta';

    public static function form(Schema $schema): Schema
    {
        return $schema->components([
            Section::make('Pregunta frecuente')
                ->icon(Heroicon::OutlinedQuestionMarkCircle)
                ->extraAttributes(['class' => 'horus-tono-azul'])
                ->columns(2)
                ->columnSpanFull()
                ->schema([
                    TextInput::make('pregunta')->label('Pregunta')->required()->maxLength(300)->columnSpanFull(),
                    Textarea::make('respuesta')->label('Respuesta')->required()->maxLength(12000)->rows(5)->columnSpanFull(),
                    TextInput::make('categoria')->label('Categoría')->required()->maxLength(100)
                        ->datalist(fn (): array => PreguntaFrecuente::query()->distinct()->orderBy('categoria')->limit(50)->pluck('categoria')->all()),
                    CamposContenido::orden(),
                    CamposContenido::estado(),
                ]),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('orden')
            ->searchPlaceholder('Buscar por pregunta o categoría')
            ->columns([
                TextColumn::make('pregunta')->label('Pregunta')->searchable()->wrap()->weight('medium'),
                TextColumn::make('categoria')->label('Categoría')->searchable()->sortable()->badge()->color('gray'),
                TextColumn::make('estado')->label('Estado')->badge()->sortable(),
                TextColumn::make('orden')->label('Orden')->sortable()->alignCenter(),
                TextColumn::make('updated_at')->label('Actualizado')->since()->sortable()->toggleable(),
            ])
            ->filters([
                SelectFilter::make('estado')->label('Estado')->options(EstadoPublicacion::class),
            ])
            ->recordActions([
                EditAction::make(),
                ActionGroup::make([
                    AccionesContenido::publicar(),
                    AccionesContenido::despublicar(),
                    AccionesContenido::archivar(),
                ]),
            ])
            ->emptyStateHeading('Aún no hay preguntas frecuentes')
            ->emptyStateDescription('Cree una pregunta. Se guarda como borrador hasta publicarla.');
    }

    public static function getPages(): array
    {
        return [
            'index' => ListPreguntasFrecuentes::route('/'),
            'create' => CreatePreguntaFrecuente::route('/create'),
            'edit' => EditPreguntaFrecuente::route('/{record}/edit'),
        ];
    }
}
