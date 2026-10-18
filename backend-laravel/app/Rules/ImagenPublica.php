<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Imagen que la web puede mostrar: URL http(s) absoluta o ruta del propio sitio
 * (/api/uploads/…, /site-original/…, /galeria/…). Rechaza otros esquemas
 * (javascript:, data:), rutas protocol-relative (//), «..», espacios y barras
 * invertidas. No descarga ni comprueba que la imagen exista.
 */
final class ImagenPublica implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! self::valida($value)) {
            $fail('La imagen debe ser una URL http(s) o una ruta del sitio que empiece por «/» (por ejemplo /api/uploads/…).');
        }
    }

    public static function valida(string $valor): bool
    {
        if (preg_match('/[\s\\\\]/', $valor) === 1 || str_contains($valor, '..')) {
            return false;
        }

        if (str_starts_with($valor, '/')) {
            // Sin «%»: impide «..» codificado (%2e%2e); las rutas del sitio no lo necesitan.
            return preg_match('#^/(?!/)[A-Za-z0-9._~/-]+$#', $valor) === 1;
        }

        $partes = parse_url($valor);

        return is_array($partes)
            && in_array(strtolower($partes['scheme'] ?? ''), ['http', 'https'], true)
            && filled($partes['host'] ?? null)
            && ! isset($partes['user'])
            && filter_var($valor, FILTER_VALIDATE_URL) !== false;
    }
}
