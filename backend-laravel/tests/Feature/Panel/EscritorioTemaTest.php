<?php

namespace Tests\Feature\Panel;

use App\Enums\EstadoMatricula;
use App\Filament\AvatarProviders\Iniciales;
use App\Filament\Widgets\AccesosRapidos;
use App\Filament\Widgets\MatriculasPorEstado;
use App\Models\Matricula;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Tema «Horus Academic» (Fase 1): carga del CSS, recursos locales y widgets del escritorio.
 */
class EscritorioTemaTest extends TestCase
{
    use RefreshDatabase;

    public function test_el_panel_carga_el_tema_y_no_pide_recursos_externos(): void
    {
        $respuesta = $this->actingAs(User::factory()->administrador()->create(['name' => 'Ana Pérez']))
            ->get('/gestion')
            ->assertOk()
            ->assertSee('css/app/horus-academic.css', false)
            ->assertSee('images/horus/logo-horus.png', false)
            ->assertSee('Resumen de la gestión académica de Horus Group')
            ->assertSee('Accesos rápidos')
            ->assertDontSee('ui-avatars.com', false)
            ->assertDontSee('fonts.bunny.net', false);

        $this->assertFileExists(public_path('css/app/horus-academic.css'));
        $this->assertFileEquals(resource_path('css/horus-academic.css'), public_path('css/app/horus-academic.css'), 'Publique el tema con: php artisan filament:assets');
        $this->assertFileExists(public_path('images/horus/logo-horus.png'));
        $respuesta->assertDontSee('fi-theme-switcher', false);
    }

    public function test_la_pantalla_de_acceso_tambien_usa_el_tema(): void
    {
        $this->get('/gestion/login')
            ->assertOk()
            ->assertSee('css/app/horus-academic.css', false)
            ->assertSee('Horus Group');
    }

    public function test_los_accesos_rapidos_enlazan_a_las_pantallas_de_alta_reales(): void
    {
        $this->actingAs(User::factory()->administrador()->create());

        Livewire::test(AccesosRapidos::class)
            ->assertSeeInOrder(['Nueva matrícula', 'Nuevo estudiante', 'Nueva edición', 'Nuevo curso'])
            ->assertSee('/gestion/matriculas/create', false)
            ->assertSee('/gestion/estudiantes/create', false)
            ->assertSee('/gestion/ediciones/create', false)
            ->assertSee('/gestion/cursos/create', false);
    }

    public function test_matriculas_por_estado_muestra_porcentajes_reales(): void
    {
        $this->actingAs(User::factory()->administrador()->create());
        Matricula::factory()->count(3)->create();
        Matricula::factory()->create()->update(['estado' => EstadoMatricula::Retirado]);

        Livewire::test(MatriculasPorEstado::class)
            ->assertSee('4 matrículas registradas en total')
            ->assertSeeInOrder(['Matriculado', '3', '75 %', 'Culminado', '0', '0 %', 'Retirado', '1', '25 %', 'Anulado', '0', '0 %']);
    }

    public function test_matriculas_por_estado_sin_datos_muestra_estado_vacio(): void
    {
        $this->actingAs(User::factory()->administrador()->create());
        Livewire::test(MatriculasPorEstado::class)
            ->assertSee('Sin matrículas')
            ->assertSee('Cuando registre la primera, verá aquí su distribución.')
            ->assertDontSee('horus-barra', false);
    }

    public function test_el_avatar_es_un_svg_local_con_iniciales(): void
    {
        $avatar = (new Iniciales)->get(User::factory()->make(['name' => 'ana pérez <b>']));

        $this->assertStringStartsWith('data:image/svg+xml;base64,', $avatar);

        $svg = base64_decode(substr($avatar, strlen('data:image/svg+xml;base64,')));
        $this->assertStringContainsString('>AP<', $svg);
        $this->assertStringNotContainsString('<b>', $svg);
    }
}
