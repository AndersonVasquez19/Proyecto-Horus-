<?php

namespace App\Filament\Resources\Contenido\CatalogoCursos;

use App\Filament\Resources\Contenido\CatalogoCursos\Pages\CreateCatalogoCurso;
use App\Filament\Resources\Contenido\CatalogoCursos\Pages\EditCatalogoCurso;
use App\Filament\Resources\Contenido\CatalogoCursos\Pages\ListCatalogoCursos;
use App\Filament\Resources\Contenido\CatalogoCursos\Schemas\CatalogoCursoForm;
use App\Filament\Resources\Contenido\CatalogoCursos\Tables\CatalogoCursosTable;
use App\Models\CatalogoCurso;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use UnitEnum;

/** Fichas públicas del catálogo de Educación (no son los cursos académicos). */
class CatalogoCursoResource extends Resource
{
    protected static ?string $model = CatalogoCurso::class;

    protected static ?string $slug = 'contenido/catalogo-educacion';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedAcademicCap;

    protected static string|UnitEnum|null $navigationGroup = 'Contenido web';

    protected static ?int $navigationSort = 1;

    protected static ?string $navigationLabel = 'Catálogo de Educación';

    protected static ?string $modelLabel = 'ficha de curso o capacitación';

    protected static ?string $pluralModelLabel = 'catálogo de Educación';

    protected static ?string $recordTitleAttribute = 'titulo';

    public static function form(Schema $schema): Schema
    {
        return CatalogoCursoForm::configure($schema);
    }

    public static function table(Table $table): Table
    {
        return CatalogoCursosTable::configure($table);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListCatalogoCursos::route('/'),
            'create' => CreateCatalogoCurso::route('/create'),
            'edit' => EditCatalogoCurso::route('/{record}/edit'),
        ];
    }
}
