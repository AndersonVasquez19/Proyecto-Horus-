<?php

namespace App\Filament\Resources\Ediciones;

use App\Filament\Resources\Ediciones\Pages\CreateEdicion;
use App\Filament\Resources\Ediciones\Pages\EditEdicion;
use App\Filament\Resources\Ediciones\Pages\ListEdiciones;
use App\Filament\Resources\Ediciones\Pages\ViewEdicion;
use App\Filament\Resources\Ediciones\RelationManagers\MatriculasRelationManager;
use App\Filament\Resources\Ediciones\Schemas\EdicionForm;
use App\Filament\Resources\Ediciones\Schemas\EdicionInfolist;
use App\Filament\Resources\Ediciones\Tables\EdicionesTable;
use App\Models\Edicion;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;
use UnitEnum;

class EdicionResource extends Resource
{
    protected static ?string $model = Edicion::class;

    protected static ?string $slug = 'ediciones';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedCalendarDays;

    protected static string|UnitEnum|null $navigationGroup = 'Gestión académica';

    protected static ?int $navigationSort = 3;

    protected static ?string $modelLabel = 'edición';

    protected static ?string $pluralModelLabel = 'ediciones';

    public static function getRecordTitle(?Model $record): ?string
    {
        return $record instanceof Edicion ? $record->etiqueta : null;
    }

    public static function form(Schema $schema): Schema
    {
        return EdicionForm::configure($schema);
    }

    public static function infolist(Schema $schema): Schema
    {
        return EdicionInfolist::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return EdicionesTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [
            MatriculasRelationManager::class,
        ];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListEdiciones::route('/'),
            'create' => CreateEdicion::route('/create'),
            'view' => ViewEdicion::route('/{record}'),
            'edit' => EditEdicion::route('/{record}/edit'),
        ];
    }
}
