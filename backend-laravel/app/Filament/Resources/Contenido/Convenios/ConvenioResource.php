<?php

namespace App\Filament\Resources\Contenido\Convenios;

use App\Filament\Resources\Contenido\Convenios\Pages\CreateConvenio;
use App\Filament\Resources\Contenido\Convenios\Pages\EditConvenio;
use App\Filament\Resources\Contenido\Convenios\Pages\ListConvenios;
use App\Filament\Resources\Contenido\Convenios\RelationManagers\FotosRelationManager;
use App\Filament\Support\AccionesContenido;
use App\Filament\Support\CamposContenido;
use App\Models\Convenio;
use BackedEnum;
use Filament\Actions\ActionGroup;
use Filament\Actions\EditAction;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use UnitEnum;

class ConvenioResource extends Resource
{
    protected static ?string $model = Convenio::class;

    protected static ?string $slug = 'contenido/convenios';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedBuildingLibrary;

    protected static string|UnitEnum|null $navigationGroup = 'Contenido web';

    protected static ?int $navigationSort = 5;

    protected static ?string $navigationLabel = 'Convenios';

    protected static ?string $modelLabel = 'convenio';

    protected static ?string $pluralModelLabel = 'convenios';

    protected static ?string $recordTitleAttribute = 'nombre';

    public static function form(Schema $schema): Schema
    {
        return $schema->components([
            Section::make('Convenio')
                ->icon(Heroicon::OutlinedBuildingLibrary)
                ->extraAttributes(['class' => 'horus-tono-azul'])
                ->columns(2)
                ->columnSpanFull()
                ->schema([
                    TextInput::make('nombre')->label('Institución')->required()->maxLength(160),
                    TextInput::make('sigla')->label('Sigla')->maxLength(50),
                    CamposContenido::imagen('logo_url', 'Logo')->columnSpanFull(),
                    Textarea::make('descripcion_corta')->label('Descripción corta')->helperText('Se muestra en la tarjeta de la portada.')
                        ->required()->maxLength(2000)->rows(2)->columnSpanFull(),
                    Textarea::make('descripcion_completa')->label('Descripción completa')->maxLength(20000)->rows(4)->columnSpanFull(),
                    Textarea::make('informacion_adicional')->label('Información adicional')->maxLength(20000)->rows(3)->columnSpanFull(),
                    CamposContenido::orden(),
                    Toggle::make('visible')->label('Visible en la web')->helperText('Los convenios nuevos quedan ocultos hasta activarlos.')->default(false),
                ]),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('orden')
            ->searchPlaceholder('Buscar por institución o sigla')
            ->columns([
                TextColumn::make('nombre')->label('Institución')->searchable()->sortable()->weight('medium'),
                TextColumn::make('sigla')->label('Sigla')->searchable()->placeholder('—'),
                IconColumn::make('visible')->label('Visible')->boolean()->alignCenter(),
                TextColumn::make('fotos_count')->label('Fotos')->counts('fotos')->alignCenter(),
                TextColumn::make('orden')->label('Orden')->sortable()->alignCenter(),
                TextColumn::make('updated_at')->label('Actualizado')->since()->sortable()->toggleable(),
            ])
            ->filters([
                TernaryFilter::make('visible')->label('Visible')->trueLabel('Solo visibles')->falseLabel('Solo ocultos'),
            ])
            ->recordActions([
                EditAction::make(),
                ActionGroup::make([
                    AccionesContenido::alternarVisibilidad('visible'),
                    AccionesContenido::eliminar()->modalDescription('Se eliminarán también los registros de sus fotos (los archivos de imagen no se borran). Esta acción es definitiva.'),
                ]),
            ])
            ->emptyStateHeading('Aún no hay convenios')
            ->emptyStateDescription('Registre un convenio. Quedará oculto hasta activarlo.');
    }

    public static function getRelations(): array
    {
        return [
            FotosRelationManager::class,
        ];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListConvenios::route('/'),
            'create' => CreateConvenio::route('/create'),
            'edit' => EditConvenio::route('/{record}/edit'),
        ];
    }
}
