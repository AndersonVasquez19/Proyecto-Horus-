<?php

namespace App\Filament\Concerns;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Validation\ValidationException;

/**
 * Para páginas CreateRecord/EditRecord de Filament.
 *
 * Los modelos validan sus reglas de negocio y lanzan ValidationException con
 * claves de atributo («numero_documento»). Este trait las reubica en la ruta
 * del formulario («data.numero_documento») para que el mensaje aparezca junto
 * al campo. Si la base de datos rechaza un duplicado (p. ej. dos envíos
 * simultáneos), se muestra un mensaje claro en lugar de un error 500.
 */
trait TraduceErroresDeDominio
{
    /**
     * Campo del formulario donde mostrar un rechazo por restricción UNIQUE.
     */
    abstract protected function campoErrorDeUnicidad(): string;

    protected function mensajeErrorDeUnicidad(): string
    {
        return 'Ya existe un registro con estos datos.';
    }

    protected function handleRecordCreation(array $data): Model
    {
        return $this->conErroresEnFormulario(fn (): Model => parent::handleRecordCreation($data));
    }

    protected function handleRecordUpdate(Model $record, array $data): Model
    {
        return $this->conErroresEnFormulario(fn (): Model => parent::handleRecordUpdate($record, $data));
    }

    /**
     * @template T
     *
     * @param  callable(): T  $operacion
     * @return T
     *
     * @throws ValidationException
     */
    private function conErroresEnFormulario(callable $operacion): mixed
    {
        try {
            return $operacion();
        } catch (ValidationException $e) {
            $errores = [];

            foreach ($e->errors() as $campo => $mensajes) {
                $clave = str_starts_with($campo, 'data.') ? $campo : 'data.'.$campo;
                $errores[$clave] = $mensajes;
            }

            throw ValidationException::withMessages($errores);
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages([
                'data.'.$this->campoErrorDeUnicidad() => $this->mensajeErrorDeUnicidad(),
            ]);
        }
    }
}
