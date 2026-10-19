<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Str;

final class CorreoUsuario
{
    public static function filtrar(Builder $query, string $correo): Builder
    {
        $conexion = $query->getConnection();

        if ($conexion->getDriverName() === 'sqlite') {
            // LOWER de SQLite solo convierte ASCII. Función de esta conexión,
            // sin alterar el esquema ni los correos de las cuentas anteriores.
            $conexion->getPdo()->sqliteCreateFunction(
                'horus_email_lower',
                fn (string $valor): string => Str::lower($valor),
                1,
            );

            return $query->whereRaw('horus_email_lower(email) = ?', [$correo]);
        }

        return $query->whereRaw('LOWER(email) = ?', [$correo]);
    }
}
