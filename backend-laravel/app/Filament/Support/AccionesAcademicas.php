<?php

namespace App\Filament\Support;

use App\Enums\EstadoMatricula;
use App\Exceptions\RegistroProtegidoException;
use App\Models\Matricula;
use App\Support\HistorialMatriculas;
use Closure;
use Filament\Actions\Action;
use Filament\Actions\DeleteAction;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Schemas\Schema;
use Filament\Support\Exceptions\Halt;
use Filament\Support\Icons\Heroicon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * Acciones de Filament compartidas por los recursos académicos.
 */
final class AccionesAcademicas
{
    /** Sitúa los rechazos finales del modelo en los campos del modal abierto. */
    public static function matricularEnModal(callable $operacion, Schema $formulario, string $campoEdicion = 'edicion_id'): Model
    {
        try {
            return $operacion();
        } catch (ValidationException $e) {
            $errores = [];

            foreach ($e->errors() as $campo => $mensajes) {
                $campo = $campo === 'edicion_id' ? $campoEdicion : $campo;
                $errores[$formulario->getStatePath().'.'.$campo] = $mensajes;
            }

            throw ValidationException::withMessages($errores);
        }
    }

    /**
     * Eliminación protegida: la acción se oculta si el registro tiene historial
     * y, si aun así llega a ejecutarse, el modelo la rechaza con un aviso claro.
     *
     * @param  Closure(Model): bool  $tieneHistorial
     */
    public static function eliminarProtegido(Closure $tieneHistorial): DeleteAction
    {
        return DeleteAction::make()
            ->authorize('delete')
            ->hidden(fn (Model $record): bool => $tieneHistorial($record))
            ->using(function (Model $record): bool {
                Gate::authorize('delete', $record);

                try {
                    return (bool) $record->delete();
                } catch (RegistroProtegidoException $e) {
                    Notification::make()
                        ->danger()
                        ->title('No se puede eliminar')
                        ->body($e->getMessage())
                        ->send();

                    throw new Halt;
                }
            });
    }

    /**
     * Cambia el estado de una matrícula ofreciendo solo las transiciones permitidas.
     */
    public static function cambiarEstadoMatricula(): Action
    {
        return Action::make('cambiarEstado')
            ->authorize('cambiarEstado')
            ->label('Cambiar estado')
            ->icon(Heroicon::OutlinedArrowsRightLeft)
            ->color('gray')
            ->visible(fn (Matricula $record): bool => $record->estado->transicionesPermitidas() !== [])
            ->modalHeading(fn (Matricula $record): string => 'Cambiar estado de la matrícula de '.$record->estudiante->nombre_completo)
            ->modalDescription(fn (Matricula $record): string => 'Estado actual: '.$record->estado->getLabel().'. '.$record->edicion->etiqueta.'.')
            ->modalSubmitActionLabel('Guardar estado')
            ->schema([
                Select::make('estado')
                    ->label('Nuevo estado')
                    ->options(fn (Matricula $record): array => collect($record->estado->transicionesPermitidas())
                        ->mapWithKeys(fn (EstadoMatricula $estado): array => [$estado->value => $estado->getLabel().' — '.$estado->getDescription()])
                        ->all())
                    ->required(),
                self::campoMotivo('Motivo (opcional)'),
            ])
            ->action(function (Matricula $record, array $data): void {
                Gate::authorize('cambiarEstado', $record);
                self::ejecutarConAviso(fn () => $record->conMotivo($data['motivo'] ?? null)->update(['estado' => $data['estado']]));

                Notification::make()
                    ->success()
                    ->title('Estado actualizado a «'.$record->estado->getLabel().'»')
                    ->send();
            });
    }

    /**
     * Motivo opcional de un cambio de estado; se guarda en el historial de la matrícula.
     */
    public static function campoMotivo(string $etiqueta): Textarea
    {
        return Textarea::make('motivo')
            ->label($etiqueta)
            ->helperText('Se guarda en el historial de la matrícula. No incluya datos personales sensibles.')
            ->maxLength(HistorialMatriculas::LONGITUD_MAXIMA_MOTIVO)
            ->rows(2);
    }

    /**
     * Ejecuta una operación del modelo; si una regla académica la rechaza,
     * muestra el motivo y detiene la acción sin cerrar el modal.
     */
    public static function ejecutarConAviso(callable $operacion): mixed
    {
        try {
            return $operacion();
        } catch (ValidationException $e) {
            Notification::make()
                ->danger()
                ->title('No se pudo guardar')
                ->body(implode(' ', array_merge(...array_values($e->errors()))))
                ->send();

            throw new Halt;
        }
    }
}
