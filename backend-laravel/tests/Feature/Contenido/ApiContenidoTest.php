<?php

namespace Tests\Feature\Contenido;

use App\Models\AjustePublico;
use App\Models\CatalogoCurso;
use App\Models\CatalogoServicio;
use App\Models\Convenio;
use App\Models\ConvenioFoto;
use App\Models\Curso;
use App\Models\GaleriaItem;
use App\Models\PreguntaFrecuente;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class ApiContenidoTest extends TestCase
{
    use RefreshDatabase;

    private const RUTAS = [
        '/api/contenido/cursos', '/api/contenido/cursos/1', '/api/contenido/servicios', '/api/contenido/servicios/1',
        '/api/contenido/preguntas-frecuentes', '/api/contenido/preguntas-frecuentes/1', '/api/contenido/galeria',
        '/api/contenido/galeria/1', '/api/contenido/convenios', '/api/contenido/convenios/1', '/api/contenido/settings',
    ];

    public function test_desactivada_por_defecto_responde_como_ruta_inexistente(): void
    {
        $this->assertFalse(config('contenido-publico.api_habilitada'));
        CatalogoCurso::factory()->publicado()->create(['id' => 1]);

        foreach (self::RUTAS as $ruta) {
            $this->getJson($ruta)->assertNotFound()->assertJsonMissingPath('items');
        }
    }

    public function test_cursos_solo_publicados_con_el_contrato_de_nestjs_y_sin_campos_administrativos(): void
    {
        $this->habilitar();
        $academico = Curso::factory()->create();
        $publicado = CatalogoCurso::factory()->publicado()->create(['curso_id' => $academico->id, 'fecha_inicio' => '2026-11-02', 'orden' => 1]);
        CatalogoCurso::factory()->create();
        CatalogoCurso::factory()->create(['estado' => 'archivado']);

        $respuesta = $this->getJson('/api/contenido/cursos?estado=borrador')->assertOk();

        $respuesta->assertExactJson([
            'ok' => true,
            'items' => [[
                'id' => $publicado->id, 'titulo' => $publicado->titulo, 'slug' => $publicado->slug, 'descripcion' => $publicado->descripcion,
                'tipo' => 'curso', 'modalidad' => 'presencial', 'duracion' => '20 horas', 'area' => null, 'certificacion' => null,
                'icono' => null, 'color' => 'indigo', 'orden' => 1, 'temario' => null, 'imagen_url' => null,
                'fecha_inicio' => '2026-11-02T00:00:00.000Z',
            ]],
            'pagination' => ['page' => 1, 'limit' => 20, 'total' => 1, 'pages' => 1],
        ]);
        $this->assertFalse($respuesta->headers->has('Set-Cookie'), 'La API pública no abre sesiones.');

        $this->getJson('/api/contenido/cursos/'.$publicado->id)->assertOk()->assertJsonPath('item.slug', $publicado->slug)->assertJsonMissingPath('item.estado');
    }

    public function test_detalles_ocultos_o_inexistentes_responden_404_con_mensaje(): void
    {
        $this->habilitar();
        $borrador = CatalogoCurso::factory()->create();
        $archivado = CatalogoServicio::factory()->create(['estado' => 'archivado']);
        $oculta = GaleriaItem::factory()->create();
        $oculto = Convenio::factory()->create();

        foreach (['cursos/'.$borrador->id, 'cursos/999', 'servicios/'.$archivado->id, 'galeria/'.$oculta->id, 'preguntas-frecuentes/999'] as $ruta) {
            $this->getJson('/api/contenido/'.$ruta)->assertNotFound()->assertExactJson(['ok' => false, 'mensaje' => 'Contenido no encontrado.']);
        }

        $this->getJson('/api/contenido/convenios/'.$oculto->id)->assertNotFound()->assertExactJson(['ok' => false, 'mensaje' => 'Convenio no encontrado.']);
        $this->getJson('/api/contenido/cursos/abc')->assertNotFound();
    }

    public function test_filtros_busqueda_literal_orden_y_paginacion_del_catalogo(): void
    {
        $this->habilitar();
        $a = CatalogoCurso::factory()->publicado()->create(['titulo' => 'Excel 100% práctico', 'orden' => 2]);
        $b = CatalogoCurso::factory()->publicado()->create(['titulo' => 'Excel básico', 'orden' => 1, 'modalidad' => 'virtual']);
        $c = CatalogoCurso::factory()->publicado()->capacitacion()->create(['titulo' => 'Brigadas', 'orden' => 1]);

        // Como NestJS: orden ascendente y, a igual orden, el más reciente primero.
        $this->assertIds([$c->id, $b->id, $a->id], $this->getJson('/api/contenido/cursos')->json('items'));
        $this->assertIds([$b->id, $a->id], $this->getJson('/api/contenido/cursos?tipo=curso')->json('items'));
        $this->assertIds([$b->id], $this->getJson('/api/contenido/cursos?modalidad=virtual')->json('items'));
        $this->assertIds([$a->id], $this->getJson('/api/contenido/cursos?search=100%25')->json('items'));
        $this->assertIds([], $this->getJson('/api/contenido/cursos?search=_')->json('items'));

        $pagina = $this->getJson('/api/contenido/cursos?page=2&limit=2')->assertOk();
        $this->assertIds([$a->id], $pagina->json('items'));
        $pagina->assertJsonPath('pagination', ['page' => 2, 'limit' => 2, 'total' => 3, 'pages' => 2]);

        $this->getJson('/api/contenido/cursos?page=9')->assertOk()->assertJsonPath('items', []);
    }

    public function test_periodo_usa_la_fecha_de_peru(): void
    {
        $this->habilitar();
        // 03:00 UTC del 18 = 22:00 del 17 en Lima: «hoy» todavía es el 17.
        $this->travelTo(now()->setDate(2026, 10, 18)->setTime(3, 0));
        $hoy = CatalogoCurso::factory()->publicado()->create(['fecha_inicio' => '2026-10-17']);
        $pasado = CatalogoCurso::factory()->publicado()->create(['fecha_inicio' => '2026-10-16']);
        $sinFecha = CatalogoCurso::factory()->publicado()->create(['fecha_inicio' => null]);

        $this->assertIds([$hoy->id], $this->getJson('/api/contenido/cursos?periodo=upcoming')->json('items'));
        $this->assertIds([$pasado->id], $this->getJson('/api/contenido/cursos?periodo=past')->json('items'));
        $this->assertIds([$sinFecha->id], $this->getJson('/api/contenido/cursos?periodo=unscheduled')->json('items'));
    }

    public static function consultasInvalidas(): iterable
    {
        yield 'parámetro desconocido' => ['cursos?ordenar=id'];
        yield 'página cero' => ['cursos?page=0'];
        yield 'límite excesivo' => ['cursos?limit=101'];
        yield 'límite no entero' => ['cursos?limit=1e3'];
        yield 'tipo desconocido' => ['cursos?tipo=taller'];
        yield 'periodo desconocido' => ['cursos?periodo=siempre'];
        yield 'búsqueda vacía' => ['cursos?search='];
        yield 'búsqueda como lista' => ['cursos?search[]=x'];
        yield 'búsqueda demasiado larga' => ['cursos?search='.str_repeat('a', 101)];
        yield 'categoría de servicio' => ['servicios?categoria=soporte,otros'];
        yield 'estado inventado' => ['servicios?estado=todos'];
        yield 'galería con búsqueda' => ['galeria?search=x'];
        yield 'convenios estado' => ['convenios?estado=publicado'];
    }

    #[DataProvider('consultasInvalidas')]
    public function test_parametros_invalidos_responden_400_sin_detalles_internos(string $ruta): void
    {
        $this->habilitar();

        $respuesta = $this->getJson('/api/contenido/'.$ruta)->assertStatus(400)->assertJsonPath('ok', false);
        $this->assertIsArray($respuesta->json('mensaje'));
        $this->assertStringNotContainsStringIgnoringCase('sql', $respuesta->getContent());
    }

    public function test_un_parametro_de_cliente_nunca_habilita_borradores(): void
    {
        $this->habilitar();
        CatalogoCurso::factory()->create();
        CatalogoServicio::factory()->create(['estado' => 'archivado']);
        Convenio::factory()->create();

        $this->getJson('/api/contenido/cursos?estado=borrador')->assertJsonPath('pagination.total', 0);
        $this->getJson('/api/contenido/servicios?estado=archivado')->assertJsonPath('pagination.total', 0);
        $this->getJson('/api/contenido/convenios?estado=oculto')->assertJsonPath('pagination.total', 0);
    }

    public function test_servicios_por_una_o_varias_categorias_y_preguntas_por_categoria(): void
    {
        $this->habilitar();
        $soporte = CatalogoServicio::factory()->publicado()->create(['categoria' => 'soporte']);
        $camaras = CatalogoServicio::factory()->publicado()->create(['categoria' => 'camaras']);
        CatalogoServicio::factory()->publicado()->create(['categoria' => 'cableado']);

        $this->assertIds([$soporte->id], $this->getJson('/api/contenido/servicios?categoria=soporte')->json('items'));
        $this->assertEqualsCanonicalizing([$soporte->id, $camaras->id], array_column($this->getJson('/api/contenido/servicios?categoria=soporte, camaras')->json('items'), 'id'));
        $this->getJson('/api/contenido/servicios/'.$soporte->id)->assertOk()->assertJsonPath('item.categoria', 'soporte')->assertJsonPath('item.presentacion', 'normal');

        $pago = PreguntaFrecuente::factory()->publicado()->create(['categoria' => 'Pagos', 'pregunta' => '¿Cómo pago?']);
        PreguntaFrecuente::factory()->publicado()->create(['categoria' => 'Cursos']);
        PreguntaFrecuente::factory()->create(['categoria' => 'Pagos']);
        $this->assertIds([$pago->id], $this->getJson('/api/contenido/preguntas-frecuentes?categoria=Pagos')->json('items'));
        $this->assertIds([$pago->id], $this->getJson('/api/contenido/preguntas-frecuentes?search=pago')->json('items'));
        $this->assertSame(['id', 'pregunta', 'respuesta', 'categoria', 'orden'], array_keys($this->getJson('/api/contenido/preguntas-frecuentes')->json('items.0')));
    }

    public function test_galeria_visible_con_categorias_total_y_pagina_por_defecto(): void
    {
        $this->habilitar();
        GaleriaItem::factory()->activo()->count(25)->create(['categoria' => 'eventos']);
        GaleriaItem::factory()->activo()->create(['categoria' => 'aulas']);
        GaleriaItem::factory()->create(['categoria' => 'privada']);

        $respuesta = $this->getJson('/api/contenido/galeria')->assertOk();
        $this->assertSame(['ok', 'total', 'items', 'categorias', 'pagination'], array_keys($respuesta->json()));
        $this->assertCount(24, $respuesta->json('items'));
        $this->assertSame(26, $respuesta->json('total'));
        $this->assertSame(['aulas', 'eventos'], $respuesta->json('categorias'));
        $this->assertSame(['id', 'titulo', 'descripcion', 'categoria', 'imagen_url', 'orden'], array_keys($respuesta->json('items.0')));

        $this->getJson('/api/contenido/galeria?page=1&limit=4&categoria=aulas')->assertJsonPath('pagination.total', 1)->assertJsonCount(1, 'items');
    }

    public function test_convenios_lista_resumida_y_detalle_con_fotos_sin_n_mas_1(): void
    {
        $this->habilitar();
        $visible = Convenio::factory()->visible()->create(['nombre' => 'Universidad Ficticia', 'sigla' => 'UF', 'descripcion_completa' => 'Larga', 'orden' => 1]);
        Convenio::factory()->visible()->create(['orden' => 2]);
        Convenio::factory()->create(['sigla' => 'UF']);
        $segunda = ConvenioFoto::factory()->create(['convenio_id' => $visible->id, 'orden' => 2]);
        $primera = ConvenioFoto::factory()->create(['convenio_id' => $visible->id, 'orden' => 1]);

        $lista = $this->getJson('/api/contenido/convenios?search=UF')->assertOk();
        $lista->assertJsonPath('pagination.total', 1);
        $this->assertSame(['id', 'nombre', 'sigla', 'logo_url', 'descripcion_corta', 'orden', 'visible'], array_keys($lista->json('items.0')));

        DB::enableQueryLog();
        $detalle = $this->getJson('/api/contenido/convenios/'.$visible->id)->assertOk();
        $consultas = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertLessThanOrEqual(2, $consultas, 'El detalle debe cargar convenio y fotos en dos consultas.');
        $this->assertSame([$primera->id, $segunda->id], array_column($detalle->json('item.fotos'), 'id'));
        $this->assertSame('Larga', $detalle->json('item.descripcion_completa'));
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/', $detalle->json('item.fotos.0.createdAt'));
        $this->assertSame(['id', 'convenio_id', 'imagen_url', 'orden', 'createdAt'], array_keys($detalle->json('item.fotos.0')));
    }

    public function test_activar_el_panel_no_activa_la_api(): void
    {
        config(['contenido-publico.panel_habilitado' => true]);
        CatalogoServicio::factory()->publicado()->create();

        $this->getJson('/api/contenido/servicios')->assertNotFound();
    }

    public function test_es_de_solo_lectura_y_los_servicios_exponen_solo_campos_publicos(): void
    {
        $this->habilitar();
        $servicio = CatalogoServicio::factory()->publicado()->create(['titulo' => 'Original']);

        foreach (['postJson', 'putJson', 'patchJson', 'deleteJson'] as $metodo) {
            $this->{$metodo}('/api/contenido/servicios', ['titulo' => 'Cambio'])->assertStatus(405);
            $this->{$metodo}('/api/contenido/servicios/'.$servicio->id, ['titulo' => 'Cambio'])->assertStatus(405);
        }
        $this->assertSame('Original', $servicio->fresh()->titulo);

        $this->assertSame([
            'id', 'titulo', 'slug', 'descripcion', 'categoria', 'presentacion', 'nombre_corto', 'destacado', 'dato_principal',
            'dato_secundario', 'etiquetas', 'icono', 'color', 'orden', 'alcance', 'imagen_url',
        ], array_keys($this->getJson('/api/contenido/servicios/'.$servicio->id)->assertOk()->json('item')));
    }

    public function test_settings_expone_solo_claves_conocidas(): void
    {
        $this->habilitar();
        AjustePublico::guardar(['email_contacto' => 'contacto@example.test']);
        DB::table('ajustes_publicos')->insert(['clave' => 'clave_interna', 'valor' => 'secreto', 'created_at' => now(), 'updated_at' => now()]);

        $ajustes = $this->getJson('/api/contenido/settings')->assertOk()->json('settings');
        $this->assertSame('contacto@example.test', $ajustes['email_contacto']);
        $this->assertArrayNotHasKey('clave_interna', $ajustes);
        $this->assertCount(10, $ajustes);
    }

    public function test_limite_de_frecuencia_por_ip(): void
    {
        $this->habilitar();
        config(['contenido-publico.peticiones_por_minuto' => 2]);

        $this->getJson('/api/contenido/settings')->assertOk();
        $this->getJson('/api/contenido/settings')->assertOk();
        $this->getJson('/api/contenido/settings')->assertStatus(429)->assertHeader('Retry-After');
    }

    public function test_sin_tablas_de_contenido_responde_503_neutro(): void
    {
        $this->habilitar();
        Schema::drop('catalogo_servicios');

        $respuesta = $this->getJson('/api/contenido/servicios')->assertStatus(503);
        $respuesta->assertExactJson(['ok' => false, 'mensaje' => 'El contenido no está disponible en este momento.']);
    }

    private function habilitar(): void
    {
        config(['contenido-publico.api_habilitada' => true]);
    }

    /**
     * @param  list<int>  $esperados
     * @param  list<array<string, mixed>>  $items
     */
    private function assertIds(array $esperados, array $items): void
    {
        $this->assertSame($esperados, array_column($items, 'id'));
    }
}
