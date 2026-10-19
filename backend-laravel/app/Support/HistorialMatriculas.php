<?php

namespace App\Support;

use App\Enums\EstadoMatricula;
use App\Enums\TipoMovimientoMatricula;
use App\Models\Matricula;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * Escribe el historial de matrículas.
 *
 * Se invoca desde los eventos created/updated de Matricula, que se ejecutan
 * dentro de la transacción abierta por DisponibilidadAcademica::guardar(): si
 * la operación se revierte, su entrada de historial se revierte con ella. Una
 * operación rechazada antes del INSERT/UPDATE no llega a registrar nada.
 */
final class HistorialMatriculas
{
    public const TABLA = 'matricula_movimientos';

    public const LONGITUD_MAXIMA_MOTIVO = 500;

    public static function normalizarMotivo(?string $motivo): ?string
    {
        if ($motivo === null) {
            return null;
        }

        $motivo = trim(preg_replace('/[ \t]+/u', ' ', $motivo) ?? '');

        return $motivo === '' ? null : $motivo;
    }

    /**
     * Sin la tabla de historial la operación se rechaza (no se registra una
     * matrícula sin su historial). Ocurre solo en una base sin migrar.
     *
     * @throws ValidationException
     */
    public static function exigirDisponible(Matricula $matricula, string $campo): void
    {
        if (! $matricula->getConnection()->getSchemaBuilder()->hasTable(self::TABLA)) {
            throw ValidationException::withMessages([
                $campo => 'El historial de matrículas aún no está activado en esta base de datos. Solicite al administrador que aplique la migración pendiente.',
            ]);
        }
    }

    /**
     * @throws ValidationException
     */
    public static function validarMotivo(?string $motivo): void
    {
        if ($motivo !== null && mb_strlen($motivo) > self::LONGITUD_MAXIMA_MOTIVO) {
            throw ValidationException::withMessages([
                'motivo' => 'El motivo no puede superar los '.self::LONGITUD_MAXIMA_MOTIVO.' caracteres.',
            ]);
        }
    }

    public static function registrarCreacion(Matricula $matricula, ?string $motivo): void
    {
        self::registrar($matricula, TipoMovimientoMatricula::Creacion, null, $matricula->estado, $motivo);
    }

    public static function registrarCambioDeEstado(Matricula $matricula, EstadoMatricula $anterior, ?string $motivo): void
    {
        self::registrar(
            $matricula,
            TipoMovimientoMatricula::paraCambio($anterior, $matricula->estado),
            $anterior,
            $matricula->estado,
            $motivo,
        );
    }

    private static function registrar(
        Matricula $matricula,
        TipoMovimientoMatricula $tipo,
        ?EstadoMatricula $anterior,
        EstadoMatricula $nuevo,
        ?string $motivo,
    ): void {
        // Solo el identificador del responsable: ningún otro dato de la cuenta.
        $matricula->movimientos()->make()->forceFill([
            'tipo' => $tipo,
            'estado_anterior' => $anterior,
            'estado_nuevo' => $nuevo,
            'user_id' => Auth::id(),
            'motivo' => $motivo,
        ])->save();
    }
}
