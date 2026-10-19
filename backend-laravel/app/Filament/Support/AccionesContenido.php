<?php

namespace App\Filament\Support;

use App\Enums\Contenido\EstadoPublicacion;
use App\Exceptions\RegistroProtegidoException;
use Filament\Actions\Action;
use Filament\Actions\DeleteAction;
use Filament\Notifications\Notification;
use Filament\Support\Exceptions\Halt;
use Filament\Support\Icons\Heroicon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;

/**
 * Acciones de publicación del contenido público. Cada una vuelve a autorizar en
 * el servidor y guarda a través del modelo, que rechaza contenido incompleto.
 */
final class AccionesContenido
{
    public static function publicar(): Action
    {
        return self::cambiarEstado('publicar', 'Publicar', EstadoPublicacion::Publicado, Heroicon::OutlinedGlobeAlt, 'success',
            'Aparecerá en la web en cuanto la API de contenido esté activa.');
    }

    public static function despublicar(): Action
    {
        return self::cambiarEstado('despublicar', 'Pasar a borrador', EstadoPublicacion::Borrador, Heroicon::OutlinedEyeSlash, 'gray',
            'Dejará de mostrarse en la web; se conserva para editarlo y publicarlo de nuevo.');
    }

    public static function archivar(): Action
    {
        return self::cambiarEstado('archivar', 'Archivar', EstadoPublicacion::Archivado, Heroicon::OutlinedArchiveBox, 'warning',
            'Se retira de la web y se conserva con su identificador; puede volver a publicarse.');
    }

    /** Muestra u oculta en la web un registro con un campo booleano (activo, visible). */
    public static function alternarVisibilidad(string $campo): Action
    {
        return Action::make('alternarVisibilidad')
            ->authorize('update')
            ->label(fn (Model $record): string => $record->{$campo} ? 'Ocultar de la web' : 'Mostrar en la web')
            ->icon(fn (Model $record) => $record->{$campo} ? Heroicon::OutlinedEyeSlash : Heroicon::OutlinedEye)
            ->color(fn (Model $record): string => $record->{$campo} ? 'gray' : 'success')
            ->requiresConfirmation()
            ->modalDescription(fn (Model $record): string => $record->{$campo}
                ? 'Dejará de mostrarse en la web; el registro se conserva.'
                : 'Se mostrará en la web en cuanto la API de contenido esté activa.')
            ->action(function (Model $record) use ($campo): void {
                Gate::authorize('update', $record);
                AccionesAcademicas::ejecutarConAviso(fn () => $record->update([$campo => ! $record->{$campo}]));
                Notification::make()->success()->title($record->{$campo} ? 'Visible en la web' : 'Oculto de la web')->send();
            });
    }

    /** Eliminación definitiva con confirmación; la política decide si el tipo la admite. */
    public static function eliminar(): DeleteAction
    {
        return DeleteAction::make()
            ->authorize('delete')
            ->modalDescription('Esta acción es definitiva. Si solo quiere retirarlo de la web, ocúltelo o archívelo.')
            ->using(function (Model $record): bool {
                Gate::authorize('delete', $record);

                try {
                    return (bool) $record->delete();
                } catch (RegistroProtegidoException $e) {
                    Notification::make()->danger()->title('No se puede eliminar')->body($e->getMessage())->send();

                    throw new Halt;
                }
            });
    }

    private static function cambiarEstado(string $nombre, string $etiqueta, EstadoPublicacion $destino, Heroicon $icono, string $color, string $descripcion): Action
    {
        return Action::make($nombre)
            ->authorize('update')
            ->label($etiqueta)
            ->icon($icono)
            ->color($color)
            ->visible(fn (Model $record): bool => $record->estado !== $destino)
            ->requiresConfirmation()
            ->modalDescription($descripcion)
            ->action(function (Model $record) use ($destino, $etiqueta): void {
                Gate::authorize('update', $record);
                // El modelo valida el registro completo: no se publica contenido incompleto.
                AccionesAcademicas::ejecutarConAviso(fn () => $record->update(['estado' => $destino]));
                Notification::make()->success()->title($etiqueta.': hecho')->body('Estado actual: '.$destino->getLabel().'.')->send();
            });
    }
}
