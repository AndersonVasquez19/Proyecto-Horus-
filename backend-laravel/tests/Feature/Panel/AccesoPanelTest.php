<?php

namespace Tests\Feature\Panel;

use App\Http\Middleware\EstablecerIdiomaPanel;
use App\Models\Estudiante;
use App\Models\Matricula;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AccesoPanelTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return array<string, array{string}>
     */
    public static function rutasProtegidas(): array
    {
        return [
            'escritorio' => ['/gestion'],
            'estudiantes' => ['/gestion/estudiantes'],
            'nuevo estudiante' => ['/gestion/estudiantes/create'],
            'cursos' => ['/gestion/cursos'],
            'ediciones' => ['/gestion/ediciones'],
            'matrículas' => ['/gestion/matriculas'],
            'nueva matrícula' => ['/gestion/matriculas/create'],
        ];
    }

    #[DataProvider('rutasProtegidas')]
    public function test_un_visitante_no_autenticado_es_redirigido_al_login(string $ruta): void
    {
        $this->get($ruta)->assertRedirect('/gestion/login');
    }

    public function test_la_pagina_de_login_se_muestra_en_espanol(): void
    {
        // El .env de desarrollo usa APP_LOCALE=en: el middleware del panel fuerza el español.
        $this->get('/gestion/login')
            ->assertOk()
            ->assertSee('lang="es"', false)
            ->assertSee('Horus Group')
            ->assertSee('Entre a su cuenta')
            ->assertSee('Correo electrónico')
            ->assertSee('Contraseña');
    }

    public function test_el_idioma_tambien_se_aplica_a_las_peticiones_de_livewire(): void
    {
        $this->assertContains(EstablecerIdiomaPanel::class, Livewire::getPersistentMiddleware());
    }

    #[DataProvider('rutasProtegidas')]
    public function test_un_administrador_autenticado_accede_al_panel(string $ruta): void
    {
        $this->actingAs(User::factory()->administrador()->create())
            ->get($ruta)
            ->assertOk();
    }

    public function test_el_menu_agrupa_los_cuatro_modulos_en_gestion_academica(): void
    {
        $this->actingAs(User::factory()->administrador()->create())
            ->get('/gestion')
            ->assertOk()
            ->assertSeeInOrder(['Gestión académica', 'Estudiantes', 'Cursos', 'Ediciones', 'Matrículas']);
    }

    public function test_el_escritorio_muestra_estados_vacios_sin_inventar_cifras(): void
    {
        $this->actingAs(User::factory()->administrador()->create())
            ->get('/gestion')
            ->assertOk()
            ->assertSee('Resumen académico')
            ->assertSee('Aún no hay estudiantes registrados')
            ->assertSee('Sin matrículas')
            // Se retiraron los widgets de ejemplo de Filament.
            ->assertDontSee('fi-filament-info-widget', false)
            ->assertDontSee('https://filamentphp.com', false);
    }

    /**
     * Los relation managers se cargan en diferido (lazy); su contenido se prueba
     * en GestionAcademicaPanelTest. Aquí se comprueba que cada ficha abre y
     * muestra los datos principales.
     */
    public function test_las_fichas_de_los_registros_se_abren(): void
    {
        $matricula = Matricula::factory()->create();
        $estudiante = $matricula->estudiante;
        $edicion = $matricula->edicion;
        $usuario = User::factory()->administrador()->create();

        $this->actingAs($usuario)->get("/gestion/estudiantes/{$estudiante->id}")->assertOk()->assertSee($estudiante->apellidos)->assertSee($estudiante->numero_documento);
        $this->actingAs($usuario)->get("/gestion/estudiantes/{$estudiante->id}/edit")->assertOk();
        $this->actingAs($usuario)->get("/gestion/ediciones/{$edicion->id}")->assertOk()->assertSee($edicion->curso->nombre)->assertSee($edicion->nombre);
        $this->actingAs($usuario)->get("/gestion/cursos/{$edicion->curso_id}")->assertOk()->assertSee($edicion->curso->nombre);
        $this->actingAs($usuario)->get("/gestion/matriculas/{$matricula->id}")->assertOk()->assertSee($estudiante->apellidos)->assertSee($edicion->nombre);
        $this->actingAs($usuario)->get("/gestion/matriculas/{$matricula->id}/edit")->assertOk();
    }

    public function test_el_escritorio_cuenta_datos_reales(): void
    {
        Estudiante::factory()->count(3)->create();

        $this->actingAs(User::factory()->administrador()->create())
            ->get('/gestion')
            ->assertOk()
            ->assertSee('Registrados en el sistema');
    }
}
