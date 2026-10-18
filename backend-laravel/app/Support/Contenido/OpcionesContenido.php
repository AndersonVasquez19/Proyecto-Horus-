<?php

namespace App\Support\Contenido;

/**
 * Listas cerradas del contenido público, idénticas a las de los DTO de NestJS
 * (backend/src/catalogo/catalogo.dto.ts y settings.service.ts) para que React
 * reciba los mismos valores sea cual sea el proveedor.
 */
final class OpcionesContenido
{
    public const PATRON_SLUG = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

    public const COLORES = ['indigo', 'coral', 'verde', 'violeta', 'oscuro'];

    public const ICONOS = [
        'heart', 'legal', 'finance', 'technology', 'education', 'business', 'network', 'camera', 'bell',
        'cloud', 'mobile', 'tools', 'software', 'emergency', 'star', 'users', 'target', 'handshake',
    ];

    public const PRESENTACIONES = [
        'normal', 'cableado', 'camara', 'alertas', 'nube', 'app', 'mantenimiento', 'software', 'redes',
        'emergencia', 'asesoria', 'beneficio',
    ];

    public const ORDEN_MAXIMO = 1000000;

    /**
     * Claves públicas de los datos institucionales: etiqueta, grupo y formato.
     *
     * @var array<string, array{etiqueta: string, grupo: string, formato: 'texto'|'correo'|'url'|'whatsapp'}>
     */
    public const AJUSTES = [
        'empresa_nombre' => ['etiqueta' => 'Nombre oficial de la empresa', 'grupo' => 'general', 'formato' => 'texto'],
        'ruc' => ['etiqueta' => 'RUC', 'grupo' => 'general', 'formato' => 'texto'],
        'email_contacto' => ['etiqueta' => 'Correo institucional de contacto', 'grupo' => 'contacto', 'formato' => 'correo'],
        'telefono_principal' => ['etiqueta' => 'Teléfono o central telefónica', 'grupo' => 'contacto', 'formato' => 'texto'],
        'whatsapp' => ['etiqueta' => 'WhatsApp de atención', 'grupo' => 'contacto', 'formato' => 'whatsapp'],
        'direccion' => ['etiqueta' => 'Dirección u oficina', 'grupo' => 'contacto', 'formato' => 'texto'],
        'horario_atencion' => ['etiqueta' => 'Horario de atención', 'grupo' => 'contacto', 'formato' => 'texto'],
        'facebook_url' => ['etiqueta' => 'Página de Facebook', 'grupo' => 'redes', 'formato' => 'url'],
        'instagram_url' => ['etiqueta' => 'Perfil de Instagram', 'grupo' => 'redes', 'formato' => 'url'],
        'linkedin_url' => ['etiqueta' => 'Perfil de LinkedIn', 'grupo' => 'redes', 'formato' => 'url'],
    ];

    public const LONGITUD_AJUSTE = 5000;

    /**
     * @return array<string, string>
     */
    public static function etiquetas(array $valores): array
    {
        return array_combine($valores, array_map('ucfirst', $valores));
    }

    /**
     * Reglas de validación de un ajuste según su formato.
     *
     * @return list<mixed>
     */
    public static function reglasAjuste(string $clave): array
    {
        $formato = self::AJUSTES[$clave]['formato'];

        return array_values(array_filter([
            'nullable', 'string', 'max:'.self::LONGITUD_AJUSTE,
            $formato === 'correo' ? 'email:rfc' : null,
            $formato === 'url' ? 'url:http,https' : null,
            $formato === 'whatsapp' ? 'regex:/^\+?\d{7,15}$/' : null,
        ]));
    }
}
