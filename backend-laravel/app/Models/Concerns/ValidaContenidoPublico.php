<?php

namespace App\Models\Concerns;

use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Validación del contenido público en el propio modelo: la aplican el panel,
 * los comandos y cualquier otro escritor, no solo los formularios.
 *
 * El modelo declara reglas(), los campos de texto opcionales (cadena vacía → null)
 * y los índices únicos con su mensaje.
 */
trait ValidaContenidoPublico
{
    /**
     * @return array<string, mixed>
     */
    abstract public function reglas(): array;

    /**
     * Columnas de texto que se recortan; las opcionales vacías se guardan como null.
     *
     * @return array{obligatorios: list<string>, opcionales: list<string>}
     */
    abstract protected function camposDeTexto(): array;

    /**
     * Mensaje por columna de un índice único (la base de datos protege las carreras).
     *
     * @return array<string, string>
     */
    protected function mensajesDeUnicidad(): array
    {
        return [];
    }

    public static function bootValidaContenidoPublico(): void
    {
        static::saving(function (self $modelo): void {
            $modelo->normalizarTextos();
            $modelo->validarContenido();
        });
    }

    /**
     * Un valor desconocido en un atributo con enum produce un error de validación
     * (no un ValueError/500) y la cadena vacía equivale a «sin valor».
     */
    public function setAttribute($key, $value)
    {
        if (is_string($value) && $this->isEnumCastable($key)) {
            $enum = $this->getCasts()[$key];
            $value = trim($value);

            if ($value === '') {
                $value = null;
            } elseif ($enum::tryFrom($value) === null) {
                throw ValidationException::withMessages([$key => 'El valor seleccionado no es válido.']);
            }
        }

        return parent::setAttribute($key, $value);
    }

    public function save(array $options = [])
    {
        try {
            return parent::save($options);
        } catch (UniqueConstraintViolationException $e) {
            foreach ($this->mensajesDeUnicidad() as $columna => $mensaje) {
                if (in_array($columna, $e->columns, true) || str_contains((string) $e->index, $columna)) {
                    throw ValidationException::withMessages([$columna => $mensaje]);
                }
            }

            throw $e;
        }
    }

    private function normalizarTextos(): void
    {
        $campos = $this->camposDeTexto();

        foreach ([...$campos['obligatorios'], ...$campos['opcionales']] as $campo) {
            $valor = $this->getAttribute($campo);

            if (is_string($valor)) {
                $valor = trim($valor);
                $this->setAttribute($campo, $valor === '' && in_array($campo, $campos['opcionales'], true) ? null : $valor);
            }
        }
    }

    /**
     * @throws ValidationException
     */
    private function validarContenido(): void
    {
        $datos = [];

        foreach (array_keys($this->reglas()) as $campo) {
            $valor = $this->getAttributes()[$campo] ?? null;
            $datos[$campo] = $valor instanceof \BackedEnum ? $valor->value : $valor;
        }

        $validador = Validator::make($datos, $this->reglas(), [], $this->etiquetasDeCampos());

        if ($validador->fails()) {
            throw new ValidationException($validador);
        }
    }

    /**
     * @return array<string, string>
     */
    protected function etiquetasDeCampos(): array
    {
        return [];
    }
}
