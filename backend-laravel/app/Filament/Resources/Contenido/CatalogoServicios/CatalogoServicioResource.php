<?php

namespace App\Filament\Resources\Contenido\CatalogoServicios;

use App\Filament\Resources\Contenido\CatalogoServicios\Pages\CreateCatalogoServicio;
use App\Filament\Resources\Contenido\CatalogoServicios\Pages\EditCatalogoServicio;
use App\Filament\Resources\Contenido\CatalogoServicios\Pages\ListCatalogoServicios;
use App\Filament\Resources\Contenido\CatalogoServicios\Schemas\CatalogoServicioForm;
use App\Filament\Resources\Contenido\CatalogoServicios\Tables\CatalogoServiciosTable;
use App\Models\CatalogoServicio;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use UnitEnum;

class CatalogoServicioResource extends Resource
{
    protected static ?string $model = CatalogoServicio::class;

    protected static ?string $slug = 'contenido/servicios';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedWrenchScrewdriver;

    protected static string|UnitEnum|null $navigationGroup = 'Contenido web';

    protected static ?int $navigationSort = 2;

    protected static ?string $navigationLabel = 'Servicios';

    protected static ?string $modelLabel = 'servicio';

    protected static ?string $pluralModelLabel = 'servicios';

    protected static ?string $recordTitleAttribute = 'titulo';

    public static function form(Schema $schema): Schema
    {
        return CatalogoServicioForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return CatalogoServiciosTable::configure($table);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListCatalogoServicios::route('/'),
            'create' => CreateCatalogoServicio::route('/create'),
            'edit' => EditCatalogoServicio::route('/{record}/edit'),
        ];
    }
}
