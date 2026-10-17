<?php

namespace App\Filament\AvatarProviders;

use Filament\AvatarProviders\Contracts\AvatarProvider;
use Filament\Facades\Filament;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;

/**
 * Avatar con las iniciales del usuario, generado como SVG en línea.
 *
 * Sustituye al proveedor por defecto de Filament (ui-avatars.com) para que el
 * panel no dependa de Internet ni envíe el nombre del usuario a un tercero.
 */
class Iniciales implements AvatarProvider
{
    public function get(Model|Authenticatable $record): string
    {
        $iniciales = str(Filament::getNameForDefaultAvatar($record))
            ->trim()
            ->explode(' ')
            ->map(fn (string $parte): string => mb_substr((string) preg_replace('/^[^\p{L}\p{N}]+/u', '', $parte), 0, 1))
            ->filter()
            ->take(2)
            ->join('');

        $iniciales = htmlspecialchars(mb_strtoupper($iniciales !== '' ? $iniciales : '?'), ENT_QUOTES | ENT_XML1, 'UTF-8');

        $svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            .'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
            .'<stop offset="0" stop-color="#2554EB"/><stop offset="1" stop-color="#1D3FCC"/>'
            .'</linearGradient></defs>'
            .'<rect width="64" height="64" fill="url(#g)"/>'
            .'<text x="32" y="32" dy=".35em" text-anchor="middle" fill="#FFFFFF" '
            .'font-family="Inter Variable, Inter, Segoe UI, Arial, sans-serif" font-size="24" font-weight="600">'
            .$iniciales.'</text></svg>';

        return 'data:image/svg+xml;base64,'.base64_encode($svg);
    }
}
