<?php

namespace Tests\Feature\Contenido;

use App\Models\CatalogoCurso;
use App\Models\CatalogoServicio;
use App\Models\Convenio;
use App\Models\ConvenioFoto;
use App\Models\GaleriaItem;
use App\Models\PreguntaFrecuente;
use App\Support\Contenido\ImportarContenido;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

class ImportarContenidoTest extends TestCase
{
    use RefreshDatabase;

    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = sys_get_temp_dir().'/horus-content-'.bin2hex(random_bytes(8));
        mkdir($this->dir);
        file_put_contents($this->dir.'/foto.jpg', 'imagen-ficticia');
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir.'/*') as $file) {
            unlink($file);
        }
        rmdir($this->dir);
        parent::tearDown();
    }

    public function test_simulacro_aplicacion_y_repeticion_conservan_contrato_sin_activar_api(): void
    {
        $file = $this->archivo($this->datos());
        $service = new ImportarContenido;
        $preview = $service->ejecutar($file, false, $this->dir, $this->dir);
        $this->assertSame('simulacro', $preview['modo']);
        $this->assertSame(0, DB::table('catalogo_cursos')->count());
        $result = $service->ejecutar($file, true, $this->dir, $this->dir);
        $this->assertSame('aplicado', $result['modo']);
        $this->assertSame('reutilizado', $service->ejecutar($file, true, $this->dir, $this->dir)['modo']);
        $this->assertSame(71, CatalogoCurso::sole()->id);
        $this->assertNull(CatalogoCurso::sole()->curso_id);
        $this->assertSame('publicado', CatalogoCurso::sole()->estado->value);
        $this->assertFalse(GaleriaItem::sole()->activo);
        $this->assertSame('/api/uploads/foto.jpg', ConvenioFoto::sole()->imagen_url);
        $this->assertSame(71, ConvenioFoto::sole()->convenio_id);
        $this->assertSame('2026-10-01 12:00:00', CatalogoCurso::sole()->getRawOriginal('created_at'));
        $this->getJson('/api/contenido/cursos')->assertNotFound();
        config(['contenido-publico.api_habilitada' => true]);
        $this->getJson('/api/contenido/cursos/71')->assertOk()->assertJsonPath('item.slug', 'curso-fixture');
        $this->getJson('/api/contenido/galeria/71')->assertNotFound();
        $this->assertSame(1, $result['ajustes_omitidos']);
    }

    public function test_error_tardio_revierte_todo_y_permite_reintentar(): void
    {
        $data = $this->datos();
        $data['tablas']['convenio_fotos'][0]['convenio_id'] = 999;
        try {
            (new ImportarContenido)->ejecutar($this->archivo($data), true, $this->dir, $this->dir);
            $this->fail('Aceptó una foto huérfana.');
        } catch (RuntimeException $e) {
            $this->assertStringNotContainsString('999', $e->getMessage());
            $this->assertSame(0, CatalogoCurso::count());
            $this->assertSame(0, Convenio::count());
        }
        $this->assertSame('aplicado', (new ImportarContenido)->ejecutar($this->archivo($this->datos()), true, $this->dir, $this->dir)['modo']);
    }

    public function test_no_sobrescribe_ediciones_locales(): void
    {
        $service = new ImportarContenido;
        $file = $this->archivo($this->datos());
        $service->ejecutar($file, true, $this->dir, $this->dir);
        CatalogoCurso::sole()->update(['titulo' => 'Edición local']);
        $this->expectExceptionMessage('destino contiene contenido diferente');
        $service->ejecutar($file, true, $this->dir, $this->dir);
    }

    public function test_preflight_del_comando_no_expone_errores_de_conexion(): void
    {
        DB::shouldReceive('connection')->once()->andThrow(new RuntimeException('detalle-privado-ficticio'));
        $this->artisan('horus:importar-contenido-nestjs')
            ->expectsOutput('Destino no confirmado: se requiere MySQL, la base exacta y su server_uuid.')
            ->assertExitCode(1);
    }

    public function test_rechaza_archivos_ausentes_url_remota_y_fechas_con_hora_sin_escribir(): void
    {
        foreach (['/api/uploads/ausente.jpg', 'https://example.test/foto.jpg', '/api/uploads/../foto.jpg'] as $url) {
            $data = $this->datos();
            $data['tablas']['convenio_fotos'][0]['imagen_url'] = $url;
            $this->rechaza($data);
        }
        $data = $this->datos();
        $data['tablas']['cursos'][0]['fecha_inicio'] = '2026-11-01 12:00:00';
        $this->rechaza($data);
        $data = $this->datos();
        $data['tablas']['cursos'][0]['campo_inesperado'] = 'secreto-ficticio';
        $this->rechaza($data);
    }

    private function rechaza(array $data): void
    {
        try {
            (new ImportarContenido)->ejecutar($this->archivo($data), true, $this->dir, $this->dir);
            $this->fail('Debía rechazar el intercambio.');
        } catch (RuntimeException $e) {
            $this->assertStringNotContainsString('secreto-ficticio', $e->getMessage());
            $this->assertSame(0, CatalogoCurso::count());
        }
    }

    private function archivo(array $data): string
    {
        file_put_contents($this->dir.'/intercambio.json', json_encode($data, JSON_THROW_ON_ERROR));

        return $this->dir.'/intercambio.json';
    }

    private function datos(): array
    {
        $tables = [];
        foreach (['cursos' => CatalogoCurso::class, 'servicios' => CatalogoServicio::class,
            'preguntas_frecuentes' => PreguntaFrecuente::class, 'galeria_items' => GaleriaItem::class,
            'convenios' => Convenio::class, 'convenio_fotos' => ConvenioFoto::class] as $table => $class) {
            // make() también resuelve factories de relaciones: fijar el id evita crear un convenio.
            $model = $class::factory()->make($table === 'convenio_fotos' ? ['convenio_id' => 71] : []);
            $row = array_replace(array_fill_keys($model->getFillable(), null), $model->getAttributes());
            unset($row['curso_id']);
            $row['id'] = 71;
            $row['createdAt'] = '2026-10-01 12:00:00';
            if ($table !== 'convenio_fotos') {
                $row['updatedAt'] = '2026-10-02 12:00:00';
            }
            if ($table === 'cursos') {
                $row['slug'] = 'curso-fixture';
                $row['estado'] = 'publicado';
                $row['fecha_inicio'] = '2026-11-01 00:00:00';
            }
            if ($table === 'galeria_items') {
                $row['activo'] = false;
            }
            foreach (['imagen_url', 'logo_url'] as $field) {
                if (array_key_exists($field, $row)) {
                    $row[$field] = '/api/uploads/foto.jpg';
                }
            }
            if ($table === 'convenio_fotos') {
                $row['convenio_id'] = 71;
            }
            $tables[$table] = [$row];
        }
        $tables['empresa_settings'] = [['id' => 71, 'clave' => 'empresa_nombre', 'valor' => 'Empresa ficticia',
            'createdAt' => '2026-10-01 12:00:00', 'updatedAt' => '2026-10-02 12:00:00'], ['clave' => 'interna', 'valor' => 'no copiar']];

        return ['version' => 1, 'tablas' => $tables];
    }
}
