<?php

namespace App\Support;

final class SeguridadPanel
{
    public static function activa(): bool
    {
        return ! app()->environment('local') || config('seguridad.activar_en_local') === true;
    }

    public static function ruta(): string
    {
        return self::activa() ? 'gestion' : 'admin';
    }
}
