<?php

namespace Tests\MySql;

use App\Models\AjustePublico;
use App\Models\CatalogoCurso;
use App\Models\CatalogoServicio;
use App\Models\Convenio;
use App\Models\ConvenioFoto;
use App\Models\Curso;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** Contenido público sobre InnoDB: restricciones, cascadas y la API con su SQL real. */
class ContenidoMysqlTest extends MysqlTestCase
{
    use DatabaseTruncation;

    protected function setUp(): void
    {
        parent::setUp();
        config(['contenido-publico.api_habilitada' => true]);
    }

    public function test_restricciones_y_relaciones_del_contenido_en_mysql(): void
    {
        try {
            DB::table('catalogo_cursos')->insert(['titulo' => 'X', 'slug' => 'x', 'descripcion' => 'X', 'tipo' => 'curso']);
            $this->fail('El CHECK de curso completo no actuó.');
        } catch (QueryException $e) {
            $this->assertSame(3819, $e->errorInfo[1]);
        }

        $academico = Curso::factory()->create();
        $ficha = CatalogoCurso::factory()->create(['curso_id' => $academico->id]);
        $academico->delete();
        $this->assertNull($ficha->fresh()->curso_id, 'nullOnDelete en MySQL.');

        CatalogoServicio::factory()->create(['slug' => 'redes']);
        try {
            CatalogoServicio::factory()->create(['slug' => 'redes']);
            $this->fail('Slug duplicado aceptado.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('slug', $e->errors());
        }

        $convenio = Convenio::factory()->create();
        ConvenioFoto::factory()->count(2)->create(['convenio_id' => $convenio->id]);
        $convenio->delete();
        $this->assertSame(0, ConvenioFoto::query()->count(), 'CASCADE en MySQL.');

        AjustePublico::guardar(['ruc' => '20123456789', 'whatsapp' => '+51912345678']);
        AjustePublico::guardar(['ruc' => '20999999999']);
        $this->assertSame(['ruc' => '20999999999', 'whatsapp' => '+51912345678'], AjustePublico::query()->orderBy('clave')->pluck('valor', 'clave')->all());
    }

    public function test_la_api_busca_literal_ordena_y_filtra_por_fecha_en_mysql(): void
    {
        $a = CatalogoCurso::factory()->publicado()->create(['titulo' => 'Excel 100% práctico', 'fecha_inicio' => now('America/Lima')->toDateString()]);
        $b = CatalogoCurso::factory()->publicado()->create(['titulo' => 'Excel_básico', 'fecha_inicio' => now('America/Lima')->subDay()->toDateString()]);
        CatalogoCurso::factory()->create(['titulo' => 'Excel borrador']);

        $this->assertSame([$a->id], array_column($this->getJson('/api/contenido/cursos?search=100%25')->assertOk()->json('items'), 'id'));
        $this->assertSame([$b->id], array_column($this->getJson('/api/contenido/cursos?search=_')->json('items'), 'id'));
        // El propio carácter de escape también se busca literalmente.
        $this->assertSame([], $this->getJson('/api/contenido/cursos?search=!')->assertOk()->json('items'));
        // Colación sin tildes ni mayúsculas de MySQL: «PRACTICO» encuentra «práctico».
        $this->assertSame([$a->id], array_column($this->getJson('/api/contenido/cursos?search=PRACTICO')->json('items'), 'id'));
        $this->assertSame([$a->id], array_column($this->getJson('/api/contenido/cursos?periodo=upcoming')->json('items'), 'id'));
        $this->assertSame([$b->id], array_column($this->getJson('/api/contenido/cursos?periodo=past')->json('items'), 'id'));
        $this->getJson('/api/contenido/cursos/'.$a->id)->assertOk()->assertJsonPath('item.fecha_inicio', $a->fecha_inicio->format('Y-m-d').'T00:00:00.000Z');
    }
}
