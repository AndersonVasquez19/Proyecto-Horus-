<?php

namespace App\Filament\Resources\Matriculas;

use App\Filament\Resources\Matriculas\Pages\CreateMatricula;
use App\Filament\Resources\Matriculas\Pages\EditMatricula;
use App\Filament\Resources\Matriculas\Pages\ListMatriculas;
use App\Filament\Resources\Matriculas\Pages\ViewMatricula;
use App\Filament\Resources\Matriculas\Schemas\MatriculaForm;
use App\Filament\Resources\Matriculas\Schemas\MatriculaInfolist;
use App\Filament\Resources\Matriculas\Tables\MatriculasTable;
use App\Models\Matricula;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;
use UnitEnum;

class MatriculaResource extends Resource
{
    protected static ?string $model = Matricula::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedClipboardDocumentList;

    protected static string|UnitEnum|null $navigationGroup = 'Gestión académica';

    protected static ?int $navigationSort = 4;

    protected static ?string $modelLabel = 'matrícula';

    protected static ?string $pluralModelLabel = 'matrículas';

    public static function getRecordTitle(?Model $record): ?string
    {
        if (! $record instanceof Matricula) {
            return null;
        }

        return $record->estudiante->nombre_completo.' — '.$record->edicion->etiqueta;
    }

    /**
     * Las matrículas son historial: nunca se eliminan desde el panel.
     */
    public static function canDelete(Model $record): bool
    {
        return false;
    }

    public static function canDeleteAny(): bool
    {
        return false;
    }

    public static function form(Schema $schema): Schema
    {
        return MatriculaForm::configure($schema);
    }

    public static function infolist(Schema $schema): Schema
    {
        return MatriculaInfolist::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return MatriculasTable::configure($table);
    }

    public static function getRelations(): array
    {
        return [];
    }

    public static function getPages(): array
    {
        return [
            'index' => ListMatriculas::route('/'),
            'create' => CreateMatricula::route('/create'),
            'view' => ViewMatricula::route('/{record}'),
            'edit' => EditMatricula::route('/{record}/edit'),
        ];
    }
}
