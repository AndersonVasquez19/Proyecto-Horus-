<?php

namespace App\Models;

use App\Support\Contenido\OpcionesContenido;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Dato institucional público (contacto, redes). Solo existen las claves de
 * OpcionesContenido::AJUSTES; leer nunca escribe valores de ejemplo.
 */
#[Fillable(['clave', 'valor'])]
class AjustePublico extends Model
{
    protected $table = 'ajustes_publicos';

    /**
     * Todas las claves conocidas, con cadena vacía si no tienen valor guardado.
     *
     * @return array<string, string>
     */
    public static function publicos(): array
    {
        $guardados = static::query()->whereIn('clave', array_keys(OpcionesContenido::AJUSTES))->pluck('valor', 'clave');

        return array_map(fn (string $clave): string => (string) ($guardados[$clave] ?? ''), array_combine(
            array_keys(OpcionesContenido::AJUSTES), array_keys(OpcionesContenido::AJUSTES),
        ));
    }

    /**
     * Guarda varios ajustes en una transacción, tras validarlos todos.
     *
     * @param  array<string, mixed>  $valores
     *
     * @throws ValidationException
     */
    public static function guardar(array $valores): int
    {
        $desconocidas = array_diff(array_keys($valores), array_keys(OpcionesContenido::AJUSTES));

        if ($valores === [] || $desconocidas !== []) {
            throw ValidationException::withMessages(['ajustes' => 'Envíe al menos un ajuste y solo claves conocidas.']);
        }

        $limpios = array_map(fn (mixed $valor): mixed => is_string($valor) ? trim($valor) : $valor, $valores);
        $reglas = [];

        foreach (array_keys($limpios) as $clave) {
            $reglas[$clave] = OpcionesContenido::reglasAjuste($clave);
        }

        Validator::make($limpios, $reglas, [], array_map(fn (array $a): string => $a['etiqueta'], OpcionesContenido::AJUSTES))->validate();

        // upsert atómico: dos guardados simultáneos no chocan con el índice único de «clave».
        $ahora = now();
        DB::transaction(fn () => static::query()->upsert(array_map(
            fn (string $clave, mixed $valor): array => ['clave' => $clave, 'valor' => (string) ($valor ?? ''), 'created_at' => $ahora, 'updated_at' => $ahora],
            array_keys($limpios), $limpios,
        ), ['clave'], ['valor', 'updated_at']));

        return count($limpios);
    }
}
