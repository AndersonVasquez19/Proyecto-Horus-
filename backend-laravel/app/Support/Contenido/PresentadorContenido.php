<?php

namespace App\Support\Contenido;

use App\Models\CatalogoCurso;
use App\Models\CatalogoServicio;
use App\Models\Convenio;
use App\Models\ConvenioFoto;
use App\Models\GaleriaItem;
use App\Models\PreguntaFrecuente;
use Carbon\CarbonInterface;

/**
 * Representación pública del contenido, con las claves y formatos que la web
 * React ya recibe de NestJS (frontend/src/types/public.ts y convenios.ts).
 * Lista explícita de campos: estado, enlaces internos y marcas administrativas
 * nunca salen por la API pública.
 */
final class PresentadorContenido
{
    /**
     * @return array<string, mixed>
     */
    public static function curso(CatalogoCurso $c): array
    {
        return [
            'id' => $c->id, 'titulo' => $c->titulo, 'slug' => $c->slug, 'descripcion' => $c->descripcion,
            'tipo' => $c->tipo->value, 'modalidad' => $c->modalidad?->value, 'duracion' => $c->duracion,
            'area' => $c->area, 'certificacion' => $c->certificacion, 'icono' => $c->icono, 'color' => $c->color,
            'orden' => $c->orden, 'temario' => $c->temario, 'imagen_url' => $c->imagen_url,
            // Fecha de calendario con el formato de Prisma (medianoche UTC): el día no cambia por zona horaria.
            'fecha_inicio' => $c->fecha_inicio ? $c->fecha_inicio->format('Y-m-d').'T00:00:00.000Z' : null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function servicio(CatalogoServicio $s): array
    {
        return [
            'id' => $s->id, 'titulo' => $s->titulo, 'slug' => $s->slug, 'descripcion' => $s->descripcion,
            'categoria' => $s->categoria->value, 'presentacion' => $s->presentacion, 'nombre_corto' => $s->nombre_corto,
            'destacado' => $s->destacado, 'dato_principal' => $s->dato_principal, 'dato_secundario' => $s->dato_secundario,
            'etiquetas' => $s->etiquetas, 'icono' => $s->icono, 'color' => $s->color, 'orden' => $s->orden,
            'alcance' => $s->alcance, 'imagen_url' => $s->imagen_url,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function pregunta(PreguntaFrecuente $p): array
    {
        return ['id' => $p->id, 'pregunta' => $p->pregunta, 'respuesta' => $p->respuesta, 'categoria' => $p->categoria, 'orden' => $p->orden];
    }

    /**
     * @return array<string, mixed>
     */
    public static function foto(GaleriaItem $g): array
    {
        return ['id' => $g->id, 'titulo' => $g->titulo, 'descripcion' => $g->descripcion, 'categoria' => $g->categoria, 'imagen_url' => $g->imagen_url, 'orden' => $g->orden];
    }

    /**
     * @return array<string, mixed>
     */
    public static function convenio(Convenio $c): array
    {
        return [
            'id' => $c->id, 'nombre' => $c->nombre, 'sigla' => $c->sigla, 'logo_url' => $c->logo_url,
            'descripcion_corta' => $c->descripcion_corta, 'orden' => $c->orden, 'visible' => $c->visible,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function convenioDetalle(Convenio $c): array
    {
        return self::convenio($c) + [
            'descripcion_completa' => $c->descripcion_completa,
            'informacion_adicional' => $c->informacion_adicional,
            'fotos' => $c->fotos->map(fn (ConvenioFoto $f): array => [
                'id' => $f->id, 'convenio_id' => $f->convenio_id, 'imagen_url' => $f->imagen_url, 'orden' => $f->orden,
                'createdAt' => self::instante($f->created_at),
            ])->values()->all(),
        ];
    }

    private static function instante(?CarbonInterface $momento): ?string
    {
        return $momento?->copy()->utc()->format('Y-m-d\TH:i:s.v\Z');
    }
}
