<?php

namespace Tests\Feature\Panel;

use App\Filament\Resources\Cursos\Pages\CreateCurso;
use App\Filament\Resources\Cursos\Pages\ViewCurso;
use App\Filament\Resources\Ediciones\Pages\CreateEdicion;
use App\Filament\Resources\Ediciones\Pages\ViewEdicion;
use App\Filament\Resources\Estudiantes\EstudianteResource;
use App\Filament\Resources\Estudiantes\Pages\CreateEstudiante;
use App\Filament\Resources\Estudiantes\Pages\ViewEstudiante;
use App\Filament\Resources\Matriculas\Pages\CreateMatricula;
use App\Filament\Resources\Matriculas\Pages\ViewMatricula;
use App\Http\Middleware\EstablecerIdiomaPanel;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use App\Models\User;
use Filament\Forms\Components\Field;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Tema «Horus Academic» (Fase 2B): solo presentación de formularios y fichas.
 * Comprueba que la reorganización visual no cambió qué campos son obligatorios
 * y que las fichas muestran únicamente datos reales.
 */
class TemaFormulariosFichasTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        app()->setLocale(EstablecerIdiomaPanel::IDIOMA);

        $this->actingAs(User::factory()->administrador()->create());
    }

    /**
     * @return array<string, array{class-string, list<string>, list<string>}>
     */
    public static function formulariosDeAlta(): array
    {
        return [
            'estudiante' => [CreateEstudiante::class, ['tipo_documento', 'numero_documento', 'apellidos', 'nombres'], ['telefono', 'email', 'observaciones']],
            'curso' => [CreateCurso::class, ['nombre'], ['codigo', 'descripcion', 'activo']],
            'edición' => [CreateEdicion::class, ['curso_id', 'nombre', 'estado'], ['fecha_inicio', 'fecha_fin', 'cupo']],
            'matrícula' => [CreateMatricula::class, ['estudiante_id', 'edicion_id'], ['fecha_matricula', 'observaciones']],
        ];
    }

    /**
     * @param  class-string  $pagina
     * @param  list<string>  $obligatorios
     * @param  list<string>  $opcionales
     */
    #[DataProvider('formulariosDeAlta')]
    public function test_los_formularios_conservan_sus_campos_obligatorios_y_opcionales(string $pagina, array $obligatorios, array $opcionales): void
    {
        $prueba = Livewire::test($pagina);

        foreach ($obligatorios as $campo) {
            $prueba->assertFormFieldExists($campo, fn (Field $f): bool => $f->isRequired());
        }

        foreach ($opcionales as $campo) {
            $prueba->assertFormFieldExists($campo, fn (Field $f): bool => ! $f->isRequired());
        }
    }

    public function test_la_ficha_de_edicion_separa_cupo_y_plazas_disponibles_reales(): void
    {
        $edicion = Edicion::factory()->create(['cupo' => 30]);
        Matricula::factory()->create(['edicion_id' => $edicion->id]);

        Livewire::test(ViewEdicion::class, ['record' => $edicion->id])
            ->assertSee('Fechas y cupo')
            ->assertSee('30 plazas')
            ->assertSee('Plazas disponibles')
            ->assertSee('29 disponibles');

        $sinLimite = Edicion::factory()->create(['cupo' => null]);

        Livewire::test(ViewEdicion::class, ['record' => $sinLimite->id])
            ->assertSee('Sin límite')
            ->assertDontSee('Plazas disponibles');
    }

    public function test_la_ficha_de_curso_muestra_el_estado_como_insignia(): void
    {
        $inactivo = Curso::factory()->inactivo()->create();
        $activo = Curso::factory()->create();

        Livewire::test(ViewCurso::class, ['record' => $inactivo->id])
            ->assertSee('Inactivo')
            ->assertSee('no aparece al crear ediciones nuevas');

        Livewire::test(ViewCurso::class, ['record' => $activo->id])
            ->assertSee('Activo')
            ->assertDontSee('no aparece al crear ediciones nuevas');
    }

    public function test_las_fichas_de_estudiante_y_matricula_conservan_sus_datos_y_enlaces(): void
    {
        $estudiante = Estudiante::factory()->create(['telefono' => null, 'email' => null]);
        $matricula = Matricula::factory()->create(['estudiante_id' => $estudiante->id]);

        Livewire::test(ViewEstudiante::class, ['record' => $estudiante->id])
            ->assertSee($estudiante->nombre_completo)
            ->assertSee($estudiante->documento)
            ->assertSee('Sin teléfono registrado')
            ->assertSee('Sin correo registrado')
            ->assertDontSee('Posibles coincidencias por nombre');

        Livewire::test(ViewMatricula::class, ['record' => $matricula->id])
            ->assertSee('Estado de la matrícula')
            ->assertSee('Matriculado')
            ->assertSee(EstudianteResource::getUrl('view', ['record' => $estudiante->id]), false);
    }

    public function test_el_css_publicado_incluye_la_fase_2b(): void
    {
        $css = (string) file_get_contents(public_path('css/app/horus-academic.css'));

        foreach (['FASE 2B', '.fi-fo-field-wrp-error-message', '.fi-input-wrp.fi-invalid', '.fi-input-wrp.fi-disabled', '.fi-in-entry-label', 'a.fi-in-entry-content', '.horus-seccion-secundaria', '.horus-accion-certificado', '.horus-accion-seguimiento'] as $regla) {
            $this->assertStringContainsString($regla, $css, "Falta {$regla}: ejecute php artisan filament:assets");
        }

        $this->assertSame(
            file_get_contents(resource_path('css/horus-academic.css')),
            $css,
            'La copia publicada no coincide con resources/css/horus-academic.css: ejecute php artisan filament:assets',
        );
        $this->assertDoesNotMatchRegularExpression('#url\(\s*["\']?https?://#i', $css);
        $this->assertStringNotContainsString('@import', $css);
    }
}
