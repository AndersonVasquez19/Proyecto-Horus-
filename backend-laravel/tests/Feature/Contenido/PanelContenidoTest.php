<?php

namespace Tests\Feature\Contenido;

use App\Enums\RolUsuario;
use App\Filament\Pages\DatosInstitucionales;
use App\Filament\Resources\Contenido\CatalogoCursos\Pages\CreateCatalogoCurso;
use App\Filament\Resources\Contenido\CatalogoCursos\Pages\EditCatalogoCurso;
use App\Filament\Resources\Contenido\CatalogoCursos\Pages\ListCatalogoCursos;
use App\Filament\Resources\Contenido\CatalogoServicios\Pages\ListCatalogoServicios;
use App\Filament\Resources\Contenido\Convenios\Pages\EditConvenio;
use App\Filament\Resources\Contenido\Convenios\RelationManagers\FotosRelationManager;
use App\Filament\Resources\Contenido\GaleriaItems\Pages\ListGaleriaItems;
use App\Filament\Resources\Contenido\PreguntasFrecuentes\Pages\CreatePreguntaFrecuente;
use App\Filament\Resources\Contenido\PreguntasFrecuentes\Pages\ListPreguntasFrecuentes;
use App\Http\Middleware\EstablecerIdiomaPanel;
use App\Models\AjustePublico;
use App\Models\CatalogoCurso;
use App\Models\CatalogoServicio;
use App\Models\Convenio;
use App\Models\ConvenioFoto;
use App\Models\Curso;
use App\Models\GaleriaItem;
use App\Models\PreguntaFrecuente;
use App\Models\User;
use Filament\Actions\Testing\TestAction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Livewire\Livewire;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class PanelContenidoTest extends TestCase
{
    use RefreshDatabase;

    private const RUTAS = [
        '/gestion/contenido/catalogo-educacion', '/gestion/contenido/catalogo-educacion/create',
        '/gestion/contenido/servicios', '/gestion/contenido/servicios/create',
        '/gestion/contenido/preguntas-frecuentes', '/gestion/contenido/preguntas-frecuentes/create',
        '/gestion/contenido/galeria', '/gestion/contenido/galeria/create',
        '/gestion/contenido/convenios', '/gestion/contenido/convenios/create',
        '/gestion/contenido/datos-institucionales',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        app()->setLocale(EstablecerIdiomaPanel::IDIOMA);
    }

    public function test_desactivado_por_defecto_nadie_ve_ni_abre_el_contenido_web(): void
    {
        $this->assertFalse(config('contenido-publico.panel_habilitado'));
        $admin = User::factory()->administrador()->create();
        $this->actingAs($admin);

        $this->assertFalse($admin->puedeGestionarContenidoPublico());
        $this->assertFalse(Gate::allows('viewAny', CatalogoCurso::class));

        foreach (self::RUTAS as $ruta) {
            $this->get($ruta)->assertForbidden();
        }

        // El panel académico sigue intacto y sin el grupo nuevo en el menú.
        $this->get('/gestion')->assertOk()->assertDontSee('Contenido web');
        $this->get('/gestion/cursos')->assertOk();
    }

    public static function cuentas(): array
    {
        return [
            'administración general' => ['administrador_general', true, true],
            'coordinación' => ['coordinador_institucional', true, false],
            'secretaría' => ['secretaria', true, false],
            'cuenta básica' => [null, true, false],
            'administración inactiva' => ['administrador_general', false, false],
            'coordinación inactiva' => ['coordinador_institucional', false, false],
        ];
    }

    public function test_el_permiso_aprobado_es_solo_de_la_administracion_general(): void
    {
        $this->assertTrue(RolUsuario::AdministradorGeneral->gestionaContenidoPublico());
        $this->assertFalse(RolUsuario::CoordinadorInstitucional->gestionaContenidoPublico());
        $this->assertFalse(RolUsuario::Secretaria->gestionaContenidoPublico());

        // Los privilegios académicos existentes no cambian.
        $this->assertTrue(RolUsuario::AdministradorGeneral->gestionaAcademico());
        $this->assertTrue(RolUsuario::CoordinadorInstitucional->gestionaAcademico());
        $this->assertFalse(RolUsuario::Secretaria->gestionaAcademico());
    }

    public static function denegadas(): array
    {
        // Solo rol y estado: la prueba no recibe la columna «permitido» (siempre falsa aquí).
        return array_map(
            fn (array $cuenta): array => [$cuenta[0], $cuenta[1]],
            array_filter(self::cuentas(), fn (array $cuenta): bool => ! $cuenta[2]),
        );
    }

    #[DataProvider('denegadas')]
    public function test_livewire_rechaza_montar_el_contenido_sin_permiso(?string $rol, bool $activo): void
    {
        config(['contenido-publico.panel_habilitado' => true]);
        $this->actingAs(User::factory()->create(['rol' => $rol, 'activo' => $activo]));
        $curso = CatalogoCurso::factory()->create();
        $convenio = Convenio::factory()->create();

        Livewire::test(ListCatalogoCursos::class)->assertForbidden();
        Livewire::test(CreateCatalogoCurso::class)->assertForbidden();
        Livewire::test(EditCatalogoCurso::class, ['record' => $curso->getRouteKey()])->assertForbidden();
        Livewire::test(ListCatalogoServicios::class)->assertForbidden();
        Livewire::test(ListPreguntasFrecuentes::class)->assertForbidden();
        Livewire::test(ListGaleriaItems::class)->assertForbidden();
        Livewire::test(EditConvenio::class, ['record' => $convenio->getRouteKey()])->assertForbidden();
        Livewire::test(FotosRelationManager::class, ['ownerRecord' => $convenio, 'pageClass' => EditConvenio::class])->assertForbidden();
        Livewire::test(DatosInstitucionales::class)->assertForbidden();
    }

    public static function revocaciones(): array
    {
        return [
            'pasa a coordinación' => [['rol' => 'coordinador_institucional']],
            'pasa a secretaría' => [['rol' => 'secretaria']],
            'pierde el rol' => [['rol' => null]],
            'se desactiva' => [['activo' => false]],
        ];
    }

    #[DataProvider('revocaciones')]
    public function test_revocar_impide_guardar_crear_y_publicar_con_la_pagina_abierta(array $cambio): void
    {
        $admin = $this->comoAdministracion();
        $ficha = CatalogoCurso::factory()->create(['titulo' => 'Original']);
        $foto = GaleriaItem::factory()->create();

        $edicion = Livewire::test(EditCatalogoCurso::class, ['record' => $ficha->getRouteKey()])->fillForm(['titulo' => 'No autorizado']);
        $alta = Livewire::test(CreateCatalogoCurso::class)->fillForm(['titulo' => 'No autorizada', 'tipo' => 'capacitacion', 'descripcion' => 'Ficticio.']);
        $publicar = Livewire::test(ListCatalogoCursos::class)->mountAction(TestAction::make('publicar')->table($ficha));
        $mostrar = Livewire::test(ListGaleriaItems::class)->mountAction(TestAction::make('alternarVisibilidad')->table($foto));

        DB::table('users')->where('id', $admin->id)->update($cambio);

        $edicion->call('save')->assertForbidden();
        $alta->call('create')->assertForbidden();
        $publicar->callMountedAction()->assertForbidden();
        $mostrar->callMountedAction()->assertForbidden();

        $this->assertSame('Original', $ficha->fresh()->titulo);
        $this->assertSame('borrador', $ficha->fresh()->estado->value);
        $this->assertSame(1, CatalogoCurso::query()->count());
        $this->assertFalse($foto->fresh()->activo);
    }

    public function test_el_post_http_livewire_no_crea_contenido_tras_pasar_a_coordinacion(): void
    {
        $admin = $this->comoAdministracion();
        $html = $this->get('/gestion/contenido/preguntas-frecuentes/create')->assertOk()->getContent();
        preg_match_all('/wire:snapshot="([^"]+)"/', $html, $coincidencias);
        // La página contiene varios componentes (barra superior, menú…): se usa el del formulario.
        $snapshot = collect($coincidencias[1])
            ->map(fn (string $s): string => html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8'))
            ->first(fn (string $s): bool => (json_decode($s, true)['memo']['name'] ?? null) === CreatePreguntaFrecuente::class);
        $this->assertIsString($snapshot, 'La página debe entregar el snapshot firmado del formulario.');
        $llamada = fn (array $updates, string $metodo) => $this->postJson(Livewire::getUpdateUri(), ['components' => [[
            'snapshot' => $snapshot,
            'updates' => $updates,
            'calls' => [['path' => '', 'method' => $metodo, 'params' => []]],
        ]]], ['X-Livewire' => 'true']);

        // Control positivo: el mismo snapshot y la misma ruta responden mientras el rol es válido.
        $llamada([], '$refresh')->assertOk();
        Livewire::flushState();
        // Coordinación conserva el panel académico, pero no el contenido web.
        DB::table('users')->where('id', $admin->id)->update(['rol' => 'coordinador_institucional']);

        $llamada(['data.pregunta' => '¿Pregunta no autorizada?', 'data.respuesta' => 'Ficticia.', 'data.categoria' => 'General'], 'create')
            ->assertForbidden();

        $this->assertSame(0, PreguntaFrecuente::query()->count());
        $this->get('/gestion/cursos')->assertOk();
    }

    #[DataProvider('cuentas')]
    public function test_habilitado_solo_los_roles_aprobados_acceden(?string $rol, bool $activo, bool $permitido): void
    {
        config(['contenido-publico.panel_habilitado' => true]);
        $usuario = User::factory()->create(['rol' => $rol, 'activo' => $activo]);
        $this->actingAs($usuario);

        $this->assertSame($permitido, $usuario->puedeGestionarContenidoPublico());

        foreach ([CatalogoCurso::class, CatalogoServicio::class, PreguntaFrecuente::class, GaleriaItem::class, Convenio::class, ConvenioFoto::class] as $modelo) {
            $this->assertSame($permitido, Gate::allows('viewAny', $modelo), $modelo);
            $this->assertSame($permitido, Gate::allows('create', $modelo), $modelo);
            $this->assertFalse(Gate::allows('deleteAny', $modelo), $modelo);
        }

        foreach (self::RUTAS as $ruta) {
            $this->get($ruta)->assertStatus($permitido ? 200 : 403);
        }

        if ($permitido) {
            $this->get('/gestion')->assertOk()->assertSee('Contenido web');
        }
    }

    public function test_un_rol_revocado_pierde_el_acceso_en_la_siguiente_peticion(): void
    {
        config(['contenido-publico.panel_habilitado' => true]);
        $admin = User::factory()->administrador()->create();
        $this->actingAs($admin)->get('/gestion/contenido/servicios')->assertOk();

        DB::table('users')->where('id', $admin->id)->update(['rol' => 'secretaria']);
        $this->get('/gestion/contenido/servicios')->assertForbidden();
    }

    public function test_crea_una_ficha_en_borrador_y_avisa_en_los_campos(): void
    {
        $this->comoAdministracion();
        $academico = Curso::factory()->create();

        Livewire::test(CreateCatalogoCurso::class)
            ->fillForm(['titulo' => 'Excel avanzado', 'tipo' => 'curso', 'descripcion' => 'Ficticio.'])
            ->assertSchemaStateSet(['slug' => 'excel-avanzado'])
            ->call('create')
            ->assertHasFormErrors(['modalidad' => 'required', 'duracion' => 'required']);

        Livewire::test(CreateCatalogoCurso::class)
            ->fillForm(['titulo' => 'Excel avanzado', 'tipo' => 'curso', 'modalidad' => 'virtual', 'duracion' => '20 horas',
                'descripcion' => 'Ficticio.', 'imagen_url' => 'javascript:alert(1)', 'curso_id' => $academico->id])
            ->call('create')
            ->assertHasFormErrors(['imagen_url']);

        Livewire::test(CreateCatalogoCurso::class)
            ->fillForm(['titulo' => 'Excel avanzado', 'tipo' => 'curso', 'modalidad' => 'virtual', 'duracion' => '20 horas',
                'descripcion' => 'Ficticio.', 'imagen_url' => '/site-original/excel.jpg', 'curso_id' => $academico->id])
            ->call('create')
            ->assertHasNoFormErrors();

        $ficha = CatalogoCurso::query()->sole();
        $this->assertSame('borrador', $ficha->estado->value);
        $this->assertSame($academico->id, $ficha->curso_id);

        Livewire::test(CreateCatalogoCurso::class)
            ->fillForm(['titulo' => 'Otra', 'slug' => 'excel-avanzado', 'tipo' => 'capacitacion', 'descripcion' => 'Ficticio.'])
            ->call('create')
            ->assertHasFormErrors(['slug' => 'unique']);
    }

    public function test_al_editar_no_se_reescribe_el_slug_y_se_valida_en_el_modelo(): void
    {
        $this->comoAdministracion();
        $ficha = CatalogoCurso::factory()->create(['slug' => 'enlace-compartido']);

        Livewire::test(EditCatalogoCurso::class, ['record' => $ficha->getRouteKey()])
            ->fillForm(['titulo' => 'Título nuevo'])
            ->call('save')
            ->assertHasNoFormErrors();

        $this->assertSame('enlace-compartido', $ficha->fresh()->slug);
        $this->assertSame('Título nuevo', $ficha->fresh()->titulo);
    }

    public function test_publicar_despublicar_y_archivar_desde_la_tabla(): void
    {
        $this->comoAdministracion();
        $ficha = CatalogoCurso::factory()->create();

        Livewire::test(ListCatalogoCursos::class)
            ->callAction(TestAction::make('publicar')->table($ficha))
            ->assertNotified();
        $this->assertSame('publicado', $ficha->fresh()->estado->value);

        Livewire::test(ListCatalogoCursos::class)->callAction(TestAction::make('archivar')->table($ficha));
        $this->assertSame('archivado', $ficha->fresh()->estado->value);

        Livewire::test(ListCatalogoCursos::class)->callAction(TestAction::make('despublicar')->table($ficha));
        $this->assertSame('borrador', $ficha->fresh()->estado->value);

        // Sin acción de borrado: las fichas se conservan.
        Livewire::test(ListCatalogoCursos::class)->assertActionDoesNotExist(TestAction::make('delete')->table($ficha));
    }

    public function test_no_se_publica_contenido_incompleto(): void
    {
        $this->comoAdministracion();
        $ficha = CatalogoCurso::factory()->create();
        // Dato inconsistente heredado (sin pasar por el modelo): un curso sin duración.
        DB::table('catalogo_cursos')->where('id', $ficha->id)->update(['tipo' => 'capacitacion', 'duracion' => null]);
        DB::table('catalogo_cursos')->where('id', $ficha->id)->update(['descripcion' => '']);

        Livewire::test(ListCatalogoCursos::class)
            ->callAction(TestAction::make('publicar')->table($ficha->fresh()))
            ->assertNotified('No se pudo guardar');

        $this->assertSame('borrador', $ficha->fresh()->estado->value);
    }

    public function test_eliminacion_solo_donde_el_proyecto_la_admite(): void
    {
        $this->comoAdministracion();
        $servicio = CatalogoServicio::factory()->create();
        $pregunta = PreguntaFrecuente::factory()->create();
        $foto = GaleriaItem::factory()->create();

        Livewire::test(ListPreguntasFrecuentes::class)->assertActionDoesNotExist(TestAction::make('delete')->table($pregunta));
        Livewire::test(ListCatalogoServicios::class)->callAction(TestAction::make('delete')->table($servicio));
        Livewire::test(ListGaleriaItems::class)->callAction(TestAction::make('delete')->table($foto));

        $this->assertModelMissing($servicio);
        $this->assertModelMissing($foto);
        $this->assertModelExists($pregunta);
    }

    public function test_mostrar_y_ocultar_galeria_y_gestionar_fotos_de_convenio(): void
    {
        $this->comoAdministracion();
        $foto = GaleriaItem::factory()->create();

        Livewire::test(ListGaleriaItems::class)->callAction(TestAction::make('alternarVisibilidad')->table($foto));
        $this->assertTrue($foto->fresh()->activo);

        $convenio = Convenio::factory()->create();
        Livewire::test(FotosRelationManager::class, ['ownerRecord' => $convenio, 'pageClass' => EditConvenio::class])
            ->callAction(TestAction::make('create')->table(), data: ['imagen_url' => '/api/uploads/123e4567-e89b-12d3-a456-426614174000.jpg', 'orden' => 2])
            ->assertHasNoFormErrors()
            ->callAction(TestAction::make('create')->table(), data: ['imagen_url' => '//evil.example/x.png'])
            ->assertHasFormErrors(['imagen_url']);

        $this->assertSame(['/api/uploads/123e4567-e89b-12d3-a456-426614174000.jpg'], $convenio->fotos()->pluck('imagen_url')->all());
    }

    public function test_datos_institucionales_se_validan_y_guardan(): void
    {
        $this->comoAdministracion();

        Livewire::test(DatosInstitucionales::class)
            ->fillForm(['email_contacto' => 'no-es-correo', 'facebook_url' => 'javascript:alert(1)'])
            ->call('save')
            ->assertHasFormErrors(['email_contacto', 'facebook_url']);
        $this->assertSame(0, AjustePublico::query()->count());

        Livewire::test(DatosInstitucionales::class)
            ->fillForm(['empresa_nombre' => 'Horus Group SRL', 'email_contacto' => 'contacto@example.test', 'whatsapp' => '+51912345678'])
            ->call('save')
            ->assertHasNoFormErrors()
            ->assertNotified('Datos institucionales guardados');

        $this->assertSame('Horus Group SRL', AjustePublico::publicos()['empresa_nombre']);
        Livewire::test(DatosInstitucionales::class)->assertSchemaStateSet(['email_contacto' => 'contacto@example.test']);
    }

    public function test_guardar_datos_vuelve_a_autorizar(): void
    {
        $admin = $this->comoAdministracion();
        $pagina = Livewire::test(DatosInstitucionales::class)->fillForm(['empresa_nombre' => 'Intento']);

        DB::table('users')->where('id', $admin->id)->update(['activo' => false]);
        $pagina->call('save')->assertForbidden();

        $this->assertSame(0, AjustePublico::query()->count());
    }

    private function comoAdministracion(): User
    {
        config(['contenido-publico.panel_habilitado' => true]);
        $admin = User::factory()->administrador()->create();
        $this->actingAs($admin);

        return $admin;
    }
}
