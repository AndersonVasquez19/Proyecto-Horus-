<?php

namespace App\Support\ImportacionAcademica;

use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\ImportacionAcademica;
use App\Models\ImportacionAcademicaFila;
use App\Models\Matricula;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\ConcurrencyErrorDetector;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Confirma una importación analizada. Todo o nada: las filas válidas se
 * importan en una única transacción o no se importa ninguna.
 *
 * 1. Vuelve a autorizar, comprueba que el archivo es el mismo (SHA-256) y lo
 *    vuelve a analizar: si el resultado difiere de la vista previa confirmada
 *    (huella distinta), se detiene y devuelve el plan actualizado.
 * 2. Dentro de la transacción inserta primero el lote: su ficha UUID y su
 *    huella son UNIQUE (impiden la doble confirmación y reimportar el mismo
 *    archivo) y, en SQLite, esa primera escritura reserva la base. En MySQL se
 *    bloquean además las ediciones afectadas en orden de id.
 * 3. Bajo ese bloqueo vuelve a analizar y exige la misma huella.
 * 4. Crea estudiantes y matrículas con los modelos Eloquent, que aplican sus
 *    propias reglas, el bloqueo de disponibilidad y el historial de matrículas.
 *    Cualquier rechazo revierte la importación completa.
 */
final class EjecutorImportacion
{
    public function __construct(
        private readonly LectorArchivo $lector,
        private readonly AnalizadorImportacion $analizador,
        private readonly AlmacenImportaciones $almacen,
    ) {}

    public function confirmar(User $usuario, ArchivoPreparado $archivo, OpcionesImportacion $opciones, string $huellaConfirmada): ImportacionAcademica
    {
        if (! PermisoImportacion::permite($usuario)) {
            throw new AuthorizationException('No tiene permiso para importar información académica.');
        }

        $ruta = $this->almacen->ruta($archivo->token, $archivo->formato);
        $this->exigirNoConfirmada($archivo->token);

        if (! is_file($ruta) || ! hash_equals($archivo->sha256, (string) hash_file('sha256', $ruta))) {
            throw new ImportacionRechazadaException('El archivo ya no está disponible o cambió desde la vista previa. Vuelva a subirlo.');
        }

        $lectura = $this->lector->leer($ruta, $archivo->formato);
        $plan = $this->analizador->analizar($lectura, $opciones);
        $huellaLote = hash('sha256', $archivo->sha256.'|'.$plan->hoja.'|'.$opciones->claveDestino());
        $this->exigirNoImportado($huellaLote);
        $this->exigirMismoPlan($plan, $huellaConfirmada);

        $conexion = DB::connection();
        $nivel = $conexion->transactionLevel();
        $filaActual = null;

        try {
            $conexion->beginTransaction();
            $resumen = $plan->resumen();
            $lote = (new ImportacionAcademica)->forceFill([
                'uuid' => $archivo->token,
                'huella' => $huellaLote,
                'user_id' => $usuario->getKey(),
                'edicion_id' => $plan->edicionDestinoId,
                'nombre_archivo' => $archivo->nombre,
                'formato' => $archivo->formato,
                'hoja' => $archivo->formato === 'xlsx' ? $plan->hoja : null,
                'archivo_sha256' => $archivo->sha256,
                'filas_total' => $resumen['total'],
                'filas_importadas' => $resumen['validas'],
                'filas_omitidas' => $resumen['omitidas'],
                'filas_rechazadas' => $resumen['invalidas'],
                'estudiantes_creados' => $resumen['estudiantes_nuevos'],
                'matriculas_creadas' => $resumen['matriculas_nuevas'],
            ]);
            $lote->save();

            if ($conexion->getDriverName() !== 'sqlite' && $plan->edicionesAfectadas() !== []) {
                Edicion::query()->whereKey($plan->edicionesAfectadas())->orderBy('id')->lockForUpdate()->get(['id']);
            }

            // Revalidación bajo bloqueo: el estado académico debe seguir siendo el de la vista previa.
            $actual = $this->analizador->analizar($lectura, $opciones);
            $this->exigirMismoPlan($actual, $huellaConfirmada);

            $creados = [];
            $registros = [];
            $motivo = 'Importación académica #'.$lote->getKey();

            foreach ($actual->filas as $numero => $f) {
                $filaActual = $numero;
                $registro = [
                    'importacion_academica_id' => $lote->getKey(),
                    'fila' => $numero,
                    'resultado' => match ($f['estado']) {
                        PlanImportacion::VALIDA => ImportacionAcademicaFila::IMPORTADA,
                        PlanImportacion::OMITIDA => ImportacionAcademicaFila::OMITIDA,
                        default => ImportacionAcademicaFila::RECHAZADA,
                    },
                    'operacion' => PlanImportacion::NINGUNA,
                    'estudiante_id' => null,
                    'matricula_id' => null,
                    'detalle' => self::detalle($f),
                    'created_at' => now(),
                ];

                if ($f['estado'] === PlanImportacion::VALIDA) {
                    if ($f['operacion'] === PlanImportacion::CREAR_Y_MATRICULAR) {
                        $estudiante = new Estudiante([
                            'tipo_documento' => $f['tipo_documento'],
                            'numero_documento' => $f['numero_documento'],
                            'apellidos' => $f['apellidos'],
                            'nombres' => $f['nombres'],
                            'telefono' => $f['telefono'],
                            'email' => $f['email'],
                        ]);
                        $estudiante->save();
                        $creados[$numero] = $estudiante;
                    } elseif ($f['fila_estudiante'] !== null) {
                        $estudiante = $creados[$f['fila_estudiante']];
                    } else {
                        $estudiante = Estudiante::query()->findOrFail($f['estudiante_id']);
                    }

                    // Siempre «Matriculado» (regla del modelo). Pasa por DisponibilidadAcademica e HistorialMatriculas.
                    $matricula = (new Matricula([
                        'estudiante_id' => $estudiante->getKey(),
                        'edicion_id' => $f['edicion_id'],
                        'fecha_matricula' => $f['fecha_matricula'],
                    ]))->conMotivo($motivo);
                    $matricula->save();

                    $registro['operacion'] = $f['operacion'];
                    $registro['estudiante_id'] = $estudiante->getKey();
                    $registro['matricula_id'] = $matricula->getKey();
                } elseif ($f['estado'] === PlanImportacion::OMITIDA && $f['matricula_id'] !== null) {
                    // Trazabilidad de la matrícula existente que hizo omitir la fila (no se modifica).
                    $registro['estudiante_id'] = $f['estudiante_id'];
                    $registro['matricula_id'] = $f['matricula_id'];
                }

                $registros[] = $registro;
            }

            $filaActual = null;

            foreach (array_chunk($registros, 200) as $bloque) {
                ImportacionAcademicaFila::query()->insert($bloque);
            }

            $conexion->commit();
        } catch (Throwable $e) {
            $conexion->rollBack($nivel);

            throw $this->traducir($e, $filaActual, $archivo->token);
        }

        $this->almacen->eliminar($archivo->token, $archivo->formato);

        return $lote->fresh() ?? $lote;
    }

    /**
     * @param  array<string, mixed>  $fila
     */
    public static function detalle(array $fila): ?string
    {
        $mensajes = $fila['estado'] === PlanImportacion::INVALIDA ? $fila['errores'] : $fila['avisos'];
        $texto = implode(' ', array_unique($mensajes));

        return $texto === '' ? null : mb_substr($texto, 0, 500);
    }

    private function exigirMismoPlan(PlanImportacion $plan, string $huellaConfirmada): void
    {
        if (! $plan->puedeConfirmarse()) {
            throw new ImportacionRechazadaException('No hay filas válidas para importar. Revise la vista previa.', $plan);
        }

        if (! hash_equals($huellaConfirmada, $plan->huella)) {
            throw new ImportacionRechazadaException(
                'Los datos académicos cambiaron desde la vista previa (por ejemplo, otra matrícula ocupó una plaza o se registró un estudiante). No se importó nada: revise la vista previa actualizada y vuelva a confirmar.',
                $plan,
            );
        }
    }

    private function exigirNoConfirmada(string $token): void
    {
        $previo = ImportacionAcademica::query()->where('uuid', $token)->first(['id']);

        if ($previo !== null) {
            throw new ImportacionRechazadaException('Esta importación ya fue confirmada (importación #'.$previo->id.'). No se volvió a importar.');
        }
    }

    private function exigirNoImportado(string $huellaLote): void
    {
        $previo = ImportacionAcademica::query()->where('huella', $huellaLote)->first(['id', 'created_at']);

        if ($previo !== null) {
            throw new ImportacionRechazadaException('Este archivo ya se importó en la misma hoja y destino el '.$previo->created_at?->format('d/m/Y H:i').' (importación #'.$previo->id.'). No se volvió a importar; si necesita añadir filas, impórtelas en un archivo nuevo.');
        }
    }

    private function traducir(Throwable $e, ?int $fila, string $token): Throwable
    {
        if ($e instanceof ImportacionRechazadaException || $e instanceof AuthorizationException) {
            return $e;
        }

        $sinCambios = ' No se importó ningún registro.';

        if ($e instanceof ValidationException) {
            $motivos = implode(' ', array_merge(...array_values($e->errors())));

            return new ImportacionRechazadaException(($fila !== null ? "La fila {$fila} no se pudo importar: " : 'No se pudo importar: ').$motivos.$sinCambios.' Vuelva a analizar el archivo.');
        }

        if ($e instanceof UniqueConstraintViolationException) {
            $indice = (string) ($e->index ?? '');
            $columnas = $e->columns ?? [];

            if (str_contains($indice, 'importaciones_academicas_uuid') || $columnas === ['uuid']) {
                return new ImportacionRechazadaException('Esta importación ya fue confirmada. No se volvió a importar.');
            }

            if (str_contains($indice, 'importaciones_academicas_huella') || $columnas === ['huella']) {
                return new ImportacionRechazadaException('Este archivo ya se importó en la misma hoja y destino. No se volvió a importar.');
            }

            return new ImportacionRechazadaException('Otra operación registró al mismo tiempo datos que coinciden con este archivo.'.$sinCambios.' Vuelva a analizar el archivo.');
        }

        // Sin mensajes ni SQL en el registro: pueden contener datos personales de las filas.
        Log::warning('importacion_academica.fallo', [
            'importacion' => $token,
            'fila' => $fila,
            'excepcion' => $e::class,
            'sqlstate' => $e instanceof QueryException ? $e->getCode() : null,
        ]);

        if ((new ConcurrencyErrorDetector)->causedByConcurrencyError($e)) {
            return new ImportacionRechazadaException('Otra operación está modificando los mismos datos en este momento.'.$sinCambios.' Vuelva a intentarlo en unos segundos.');
        }

        return new ImportacionRechazadaException('No se pudo completar la importación por un error interno.'.$sinCambios);
    }
}
