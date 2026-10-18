<?php

namespace App\Filament\Resources\Contenido\GaleriaItems;

use App\Filament\Resources\Contenido\GaleriaItems\Pages\CreateGaleriaItem;
use App\Filament\Resources\Contenido\GaleriaItems\Pages\EditGaleriaItem;
use App\Filament\Resources\Contenido\GaleriaItems\Pages\ListGaleriaItems;
use App\Filament\Support\AccionesContenido;
use App\Filament\Support\CamposContenido;
use App\Models\GaleriaItem;
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
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use UnitEnum;

class GaleriaItemResource extends Resource
{
    protected static ?string $model = GaleriaItem::class;

    protected static ?string $slug = 'contenido/galeria';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedPhoto;

    protected static string|UnitEnum|null $navigationGroup = 'Contenido web';

    protected static ?int $navigationSort = 4;

    protected static ?string $navigationLabel = 'Galería';

    protected static ?string $modelLabel = 'foto de la galería';

    protected static ?string $pluralModelLabel = 'galería';

    protected static ?string $recordTitleAttribute = 'titulo';

    public static function form(Schema $schema): Schema
    {
        return $schema->components([
            Section::make('Fotografía')
                ->icon(Heroicon::OutlinedPhoto)
                ->extraAttributes(['class' => 'horus-tono-azul'])
                ->columns(2)
                ->columnSpanFull()
                ->schema([
                    TextInput::make('titulo')->label('Título')->required()->maxLength(150),
                    TextInput::make('categoria')->label('Categoría')->required()->maxLength(50)->default('general')
                        ->datalist(fn (): array => GaleriaItem::query()->distinct()->orderBy('categoria')->limit(50)->pluck('categoria')->all()),
                    CamposContenido::imagen(longitud: 500, obligatoria: true)->columnSpanFull(),
                    Textarea::make('descripcion')->label('Descripción')->maxLength(20000)->rows(3)->columnSpanFull(),
                    CamposContenido::orden(),
                    Toggle::make('activo')->label('Visible en la web')->helperText('Las fotos nuevas quedan ocultas hasta activarlas.')->default(false),
                ]),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('orden')
            ->searchPlaceholder('Buscar por título o categoría')
            ->columns([
                TextColumn::make('titulo')->label('Título')->searchable()->sortable()->weight('medium'),
                TextColumn::make('categoria')->label('Categoría')->searchable()->sortable()->badge()->color('gray'),
                IconColumn::make('activo')->label('Visible')->boolean()->alignCenter(),
                TextColumn::make('orden')->label('Orden')->sortable()->alignCenter(),
                TextColumn::make('updated_at')->label('Actualizado')->since()->sortable()->toggleable(),
            ])
            ->filters([
                TernaryFilter::make('activo')->label('Visible')->trueLabel('Solo visibles')->falseLabel('Solo ocultas'),
                SelectFilter::make('categoria')->label('Categoría')
                    ->options(fn (): array => GaleriaItem::query()->distinct()->orderBy('categoria')->pluck('categoria', 'categoria')->all()),
            ])
            ->recordActions([
                EditAction::make(),
                ActionGroup::make([
                    AccionesContenido::alternarVisibilidad('activo'),
                    AccionesContenido::eliminar(),
                ]),
            ])
            ->emptyStateHeading('Aún no hay fotos en la galería')
            ->emptyStateDescription('Agregue una foto con su ruta o URL. Quedará oculta hasta activarla.');
    }

    public static function getPages(): array
    {
        return [
            'index' => ListGaleriaItems::route('/'),
            'create' => CreateGaleriaItem::route('/create'),
            'edit' => EditGaleriaItem::route('/{record}/edit'),
        ];
    }
}
