<?php

namespace App\Filament\Resources\Contenido\Convenios\RelationManagers;

use App\Filament\Support\CamposContenido;
use Filament\Actions\CreateAction;
use Filament\Actions\DeleteAction;
use Filament\Actions\EditAction;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

/**
 * Fotos del convenio (independientes de la galería). Retirar una foto borra su
 * registro, nunca el archivo de imagen, que puede estar compartido.
 * Autorización: ConvenioFotoPolicy.
 */
class FotosRelationManager extends RelationManager
{
    protected static string $relationship = 'fotos';

    protected static ?string $title = 'Fotos del convenio';

    protected static ?string $modelLabel = 'foto';

    protected static ?string $pluralModelLabel = 'fotos';

    public function isReadOnly(): bool
    {
        return false;
    }

    public function form(Schema $schema): Schema
    {
        return $schema->components([
            CamposContenido::imagen(obligatoria: true)->columnSpanFull(),
            CamposContenido::orden(),
        ]);
    }

    public function table(Table $table): Table
    {
        return $table
            ->defaultSort('orden')
            ->columns([
                TextColumn::make('imagen_url')->label('Imagen')->limit(70)->tooltip(fn ($record): string => $record->imagen_url),
                TextColumn::make('orden')->label('Orden')->sortable()->alignCenter(),
                TextColumn::make('created_at')->label('Agregada')->dateTime('d/m/Y H:i'),
            ])
            ->headerActions([
                CreateAction::make()->label('Agregar foto'),
            ])
            ->recordActions([
                EditAction::make(),
                DeleteAction::make()->label('Retirar')->modalDescription('Se retira la foto del convenio; el archivo de imagen no se borra.'),
            ])
            ->toolbarActions([])
            ->emptyStateHeading('Sin fotos')
            ->emptyStateDescription('Agregue fotos con su ruta o URL.');
    }
}
