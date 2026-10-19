<?php

namespace Tests\Feature\Contenido;

use App\Enums\Contenido\EstadoPublicacion;
use App\Exceptions\RegistroProtegidoException;
use App\Models\AjustePublico;
use App\Models\CatalogoCurso;
use App\Models\CatalogoServicio;
use App\Models\Convenio;
use App\Models\ConvenioFoto;
use App\Models\Curso;
use App\Models\GaleriaItem;
use App\Models\PreguntaFrecuente;
use App\Rules\ImagenPublica;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Reglas del contenido público en el modelo y en la base de datos (datos ficticios).
 */
class ModelosContenidoTest extends TestCase
{
    use RefreshDatabase;

    public function test_un_curso_exige_modalidad_y_duracion_y_una_capacitacion_no(): void
    {
        $this->assertErrores(fn () => CatalogoCurso::create($this->curso(['modalidad' => null, 'duracion' => '  '])), ['modalidad', 'duracion']);

        $capacitacion = CatalogoCurso::create($this->curso(['tipo' => 'capacitacion', 'modalidad' => null, 'duracion' => '']));
        $this->assertNull($capacitacion->fresh()->duracion);

        // También la base de datos, para escrituras que se salten el modelo.
        $this->expectException(QueryException::class);
        DB::table('catalogo_cursos')->insert(['titulo' => 'X', 'slug' => 'x', 'descripcion' => 'X', 'tipo' => 'curso']);
    }

    public function test_normaliza_textos_y_valida_slug_listas_cerradas_y_longitudes(): void
    {
        $curso = CatalogoCurso::create($this->curso(['titulo' => '  Excel avanzado ', 'area' => '   ', 'temario' => '']));
        $curso->refresh();
        $this->assertSame('Excel avanzado', $curso->titulo);
        $this->assertNull($curso->area);
        $this->assertNull($curso->temario);
        $this->assertSame(EstadoPublicacion::Borrador, $curso->estado);
        $this->assertSame('indigo', $curso->color);

        $this->assertErrores(fn () => CatalogoCurso::create($this->curso(['slug' => 'Excel Avanzado'])), ['slug']);
        $this->assertErrores(fn () => CatalogoCurso::create($this->curso(['slug' => 'otro', 'color' => 'rojo', 'icono' => 'calavera'])), ['color', 'icono']);
        $this->assertErrores(fn () => CatalogoCurso::create($this->curso(['slug' => 'otro', 'titulo' => str_repeat('a', 161)])), ['titulo']);
        $this->assertErrores(fn () => CatalogoServicio::create(['titulo' => 'S', 'slug' => 's', 'descripcion' => 'D', 'categoria' => 'otros']), ['categoria']);
        $this->assertErrores(fn () => CatalogoServicio::create(['titulo' => 'S', 'slug' => 's', 'descripcion' => 'D', 'categoria' => 'soporte', 'presentacion' => 'rara']), ['presentacion']);
        $this->assertErrores(fn () => PreguntaFrecuente::create(['pregunta' => ' ', 'respuesta' => 'R', 'categoria' => 'C']), ['pregunta']);
    }

    public function test_el_slug_duplicado_se_rechaza_con_mensaje_claro(): void
    {
        CatalogoCurso::create($this->curso());
        $this->assertErrores(fn () => CatalogoCurso::create($this->curso(['titulo' => 'Otro'])), ['slug']);

        CatalogoServicio::factory()->create(['slug' => 'redes']);
        $this->assertErrores(fn () => CatalogoServicio::factory()->create(['slug' => 'redes']), ['slug']);
    }

    public function test_la_ficha_enlaza_un_curso_academico_sin_duplicarlo(): void
    {
        $academico = Curso::factory()->create();
        $ficha = CatalogoCurso::create($this->curso(['curso_id' => $academico->id]));
        $this->assertTrue($ficha->curso->is($academico));

        $this->assertErrores(fn () => CatalogoCurso::create($this->curso(['slug' => 'otra', 'curso_id' => $academico->id])), ['curso_id']);
        $this->assertErrores(fn () => CatalogoCurso::create($this->curso(['slug' => 'otra', 'curso_id' => 999])), ['curso_id']);

        // Un curso académico sin ediciones puede eliminarse: la ficha pública se conserva sin enlace.
        $academico->delete();
        $this->assertNull($ficha->fresh()->curso_id);
    }

    public static function imagenes(): iterable
    {
        yield 'subida' => ['/api/uploads/123e4567-e89b-12d3-a456-426614174000.webp', true];
        yield 'original' => ['/site-original/aula_1.jpg', true];
        yield 'https' => ['https://cdn.example.test/foto.jpg', true];
        yield 'javascript' => ['javascript:alert(1)', false];
        yield 'data' => ['data:image/png;base64,AAAA', false];
        yield 'protocol relative' => ['//evil.example/x.png', false];
        yield 'retroceso' => ['/api/uploads/../.env', false];
        yield 'retroceso codificado' => ['/api/%2e%2e/x.png', false];
        yield 'espacio' => ['/galeria/mi foto.jpg', false];
        yield 'barra invertida' => ['/galeria\\x.jpg', false];
        yield 'credenciales' => ['https://usuario@example.test/x.jpg', false];
        yield 'ftp' => ['ftp://example.test/x.jpg', false];
    }

    #[DataProvider('imagenes')]
    public function test_valida_las_imagenes_publicas(string $valor, bool $valida): void
    {
        $this->assertSame($valida, ImagenPublica::valida($valor));

        $operacion = fn () => GaleriaItem::create(['titulo' => 'Foto', 'categoria' => 'eventos', 'imagen_url' => $valor]);

        if ($valida) {
            $this->assertSame($valor, $operacion()->fresh()->imagen_url);
        } else {
            $this->assertErrores($operacion, ['imagen_url']);
        }
    }

    public function test_cursos_y_preguntas_se_conservan_y_servicios_galeria_y_convenios_se_eliminan(): void
    {
        foreach ([CatalogoCurso::factory()->create(), PreguntaFrecuente::factory()->create()] as $protegido) {
            try {
                $protegido->delete();
                $this->fail('Se eliminó contenido que debe archivarse.');
            } catch (RegistroProtegidoException) {
                $this->assertModelExists($protegido);
            }
        }

        $servicio = CatalogoServicio::factory()->create();
        $servicio->delete();
        $this->assertModelMissing($servicio);

        $convenio = Convenio::factory()->create();
        $fotos = ConvenioFoto::factory()->count(2)->create(['convenio_id' => $convenio->id]);
        $convenio->delete();
        $this->assertModelMissing($fotos[0]);
        $this->assertSame(0, ConvenioFoto::query()->count());
    }

    public function test_galeria_y_convenios_nacen_ocultos_y_los_ambitos_publicos_filtran(): void
    {
        $this->assertFalse(GaleriaItem::create(['titulo' => 'Foto', 'categoria' => 'eventos', 'imagen_url' => '/galeria/a.jpg'])->fresh()->activo);
        $this->assertFalse(Convenio::create(['nombre' => 'Inst', 'descripcion_corta' => 'Desc'])->fresh()->visible);

        CatalogoCurso::factory()->publicado()->create();
        CatalogoCurso::factory()->create();
        CatalogoCurso::factory()->create(['estado' => 'archivado']);
        GaleriaItem::factory()->activo()->create();
        Convenio::factory()->visible()->create();

        $this->assertSame(1, CatalogoCurso::query()->publicados()->count());
        $this->assertSame(1, GaleriaItem::query()->publicados()->count());
        $this->assertSame(1, Convenio::query()->publicados()->count());
    }

    public function test_la_foto_debe_pertenecer_a_un_convenio_existente_y_se_ordena(): void
    {
        $this->assertErrores(fn () => ConvenioFoto::create(['convenio_id' => 999, 'imagen_url' => '/galeria/a.jpg']), ['convenio_id']);

        $convenio = Convenio::factory()->create();
        $segunda = ConvenioFoto::factory()->create(['convenio_id' => $convenio->id, 'orden' => 2]);
        $primera = ConvenioFoto::factory()->create(['convenio_id' => $convenio->id, 'orden' => 1]);
        $this->assertSame([$primera->id, $segunda->id], $convenio->fotos()->pluck('id')->all());
    }

    public function test_ajustes_publicos_solo_claves_conocidas_validadas_y_en_transaccion(): void
    {
        $this->assertSame(array_fill_keys(['empresa_nombre', 'ruc', 'email_contacto', 'telefono_principal', 'whatsapp', 'direccion',
            'horario_atencion', 'facebook_url', 'instagram_url', 'linkedin_url'], ''), AjustePublico::publicos());
        $this->assertSame(0, AjustePublico::query()->count(), 'Leer no debe escribir valores de ejemplo.');

        $this->assertSame(2, AjustePublico::guardar(['email_contacto' => ' contacto@example.test ', 'whatsapp' => '+51912345678']));
        $this->assertSame('contacto@example.test', AjustePublico::publicos()['email_contacto']);

        foreach ([['clave_rara' => 'x'], ['email_contacto' => 'no-es-correo'], ['facebook_url' => 'javascript:alert(1)'], ['whatsapp' => '12'], ['ruc' => ['array']]] as $invalido) {
            $this->assertErrores(fn () => AjustePublico::guardar($invalido + ['empresa_nombre' => 'Horus']), []);
        }
        $this->assertErrores(fn () => AjustePublico::guardar([]), ['ajustes']);

        // Ninguno de los envíos inválidos guardó su parte válida.
        $this->assertSame('', AjustePublico::publicos()['empresa_nombre']);

        AjustePublico::guardar(['email_contacto' => 'otro@example.test']);
        $this->assertSame(1, AjustePublico::query()->where('clave', 'email_contacto')->count());
        $this->assertSame('otro@example.test', AjustePublico::publicos()['email_contacto']);
    }

    /**
     * @param  array<string, mixed>  $cambios
     * @return array<string, mixed>
     */
    private function curso(array $cambios = []): array
    {
        return $cambios + [
            'titulo' => 'Excel', 'slug' => 'excel', 'descripcion' => 'Curso ficticio.', 'tipo' => 'curso',
            'modalidad' => 'virtual', 'duracion' => '12 horas',
        ];
    }

    /**
     * @param  list<string>  $campos  Campos que deben tener error (lista vacía: basta con el rechazo).
     */
    private function assertErrores(callable $operacion, array $campos): void
    {
        try {
            $operacion();
            $this->fail('Se esperaba un rechazo de validación.');
        } catch (ValidationException $e) {
            foreach ($campos as $campo) {
                $this->assertArrayHasKey($campo, $e->errors());
            }
        }
    }
}
