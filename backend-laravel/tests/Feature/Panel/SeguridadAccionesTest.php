<?php

namespace Tests\Feature\Panel;

use App\Enums\EstadoMatricula;
use App\Filament\Resources\Cursos\Pages\ViewCurso;
use App\Filament\Resources\Cursos\RelationManagers\EdicionesRelationManager;
use App\Filament\Resources\Ediciones\Pages\ViewEdicion;
use App\Filament\Resources\Ediciones\RelationManagers\MatriculasRelationManager as MatriculasDeEdicion;
use App\Filament\Resources\Estudiantes\Pages\CreateEstudiante;
use App\Filament\Resources\Estudiantes\Pages\EditEstudiante;
use App\Filament\Resources\Estudiantes\Pages\ViewEstudiante;
use App\Filament\Resources\Estudiantes\RelationManagers\MatriculasRelationManager as MatriculasDeEstudiante;
use App\Filament\Resources\Matriculas\Pages\EditMatricula;
use App\Filament\Resources\Matriculas\Pages\ListMatriculas;
use App\Filament\Widgets\AccesosRapidos;
use App\Filament\Widgets\MatriculasPorEstado;
use App\Filament\Widgets\ResumenAcademico;
use App\Models\Estudiante;
use App\Models\Matricula;
use App\Models\User;
use Filament\Actions\Testing\TestAction;
use Filament\Facades\Filament;
use Filament\Http\Middleware\Authenticate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Livewire\Livewire;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class SeguridadAccionesTest extends TestCase
{
    use RefreshDatabase;

    public function test_las_politicas_no_otorgan_al_administrador_operaciones_prohibidas(): void
    {
        foreach ([User::factory()->administrador()->create(), User::factory()->coordinador()->create()] as $user) {
            $this->actingAs($user);
            $matricula = Matricula::factory()->create();
            foreach ([$matricula, $matricula->estudiante, $matricula->edicion, $matricula->edicion->curso] as $record) {
                $this->assertFalse(Gate::allows('delete', $record));
                foreach (['deleteAny', 'restoreAny', 'forceDeleteAny'] as $ability) {
                    $this->assertFalse(Gate::allows($ability, $record::class));
                }
                foreach (['restore', 'forceDelete', 'replicate'] as $ability) {
                    $this->assertFalse(Gate::allows($ability, $record));
                }
            }
            $this->assertTrue(Gate::allows('delete', Estudiante::factory()->create()));
        }
    }

    public function test_un_coordinador_ejecuta_acciones_academicas_autorizadas(): void
    {
        $this->actingAs(User::factory()->coordinador()->create());
        Livewire::test(CreateEstudiante::class)
            ->fillForm(['tipo_documento' => 'DNI', 'numero_documento' => '70112233', 'apellidos' => 'Prueba', 'nombres' => 'Coordinador'])
            ->call('create')->assertHasNoFormErrors();
        $matricula = Matricula::factory()->create();
        Livewire::test(ListMatriculas::class)
            ->callAction(TestAction::make('cambiarEstado')->table($matricula), data: ['estado' => 'CULMINADO'])
            ->assertHasNoFormErrors();
        $this->assertSame(EstadoMatricula::Culminado, $matricula->fresh()->estado);
    }

    public function test_los_relation_managers_denegan_acceso_directo_sin_rol(): void
    {
        $matricula = Matricula::factory()->create();
        $this->actingAs(User::factory()->create());
        foreach ([
            [MatriculasDeEstudiante::class, $matricula->estudiante, ViewEstudiante::class],
            [MatriculasDeEdicion::class, $matricula->edicion, ViewEdicion::class],
            [EdicionesRelationManager::class, $matricula->edicion->curso, ViewCurso::class],
        ] as [$componente, $record, $pagina]) {
            Livewire::test($componente, ['ownerRecord' => $record, 'pageClass' => $pagina])->assertForbidden();
        }
        $this->assertDatabaseCount('matriculas', 1);
    }

    public function test_revocar_el_rol_impide_guardar_un_formulario_abierto(): void
    {
        $user = User::factory()->coordinador()->create();
        $estudiante = Estudiante::factory()->create();
        $this->actingAs($user);
        $pagina = Livewire::test(EditEstudiante::class, ['record' => $estudiante->id])->fillForm(['nombres' => 'No autorizado']);
        DB::table('users')->where('id', $user->id)->update(['rol' => null]);
        $pagina->call('save')->assertForbidden();
        $this->assertNotSame('No autorizado', $estudiante->fresh()->nombres);
        $this->get('/gestion')->assertForbidden();
    }

    public function test_desactivar_impide_crear_desde_un_formulario_abierto(): void
    {
        $user = User::factory()->administrador()->create();
        $this->actingAs($user);
        $pagina = Livewire::test(CreateEstudiante::class)->fillForm(['tipo_documento' => 'DNI', 'numero_documento' => '70112233', 'apellidos' => 'Prueba', 'nombres' => 'Sin acceso']);
        DB::table('users')->where('id', $user->id)->update(['activo' => false]);
        $pagina->call('create')->assertForbidden();
        $this->assertDatabaseCount('estudiantes', 0);
    }

    public function test_revocar_impide_ejecutar_un_cambio_de_estado_ya_montado(): void
    {
        $user = User::factory()->coordinador()->create();
        $matricula = Matricula::factory()->create();
        $this->actingAs($user);
        $pagina = Livewire::test(ListMatriculas::class)->mountAction(TestAction::make('cambiarEstado')->table($matricula));
        DB::table('users')->where('id', $user->id)->update(['rol' => 'secretaria']);
        $pagina->callMountedAction(['estado' => 'CULMINADO'])->assertForbidden();
        $this->assertSame(EstadoMatricula::Matriculado, $matricula->fresh()->estado);
    }

    public function test_revocar_impide_matricular_desde_un_relation_manager_abierto(): void
    {
        $user = User::factory()->coordinador()->create();
        $matricula = Matricula::factory()->create();
        $this->actingAs($user);
        $pagina = Livewire::test(MatriculasDeEstudiante::class, ['ownerRecord' => $matricula->estudiante, 'pageClass' => ViewEstudiante::class])->mountAction(TestAction::make('create')->table());
        DB::table('users')->where('id', $user->id)->update(['activo' => false]);
        $pagina->callMountedAction(['edicion_id' => $matricula->edicion_id])->assertForbidden();
        $this->assertDatabaseCount('matriculas', 1);
    }

    public static function widgets(): array
    {
        return [[AccesosRapidos::class], [ResumenAcademico::class], [MatriculasPorEstado::class]];
    }

    #[DataProvider('widgets')]
    public function test_los_widgets_revalidan_una_sesion_abierta(string $widget): void
    {
        $user = User::factory()->coordinador()->create();
        $this->actingAs($user);
        $componente = Livewire::test($widget)->assertOk();
        DB::table('users')->where('id', $user->id)->update(['rol' => null]);
        $componente->call('$refresh')->assertForbidden();
    }

    public function test_el_panel_no_ofrece_borrado_de_matriculas_ni_acciones_masivas(): void
    {
        $this->actingAs(User::factory()->administrador()->create());
        $matricula = Matricula::factory()->create();
        Livewire::test(ListMatriculas::class)
            ->assertActionDoesNotExist(TestAction::make('delete')->table($matricula))
            ->assertActionDoesNotExist(TestAction::make('delete')->bulk());
        Livewire::test(EditMatricula::class, ['record' => $matricula->id])->assertActionDoesNotExist('delete');
        $this->assertModelExists($matricula);
    }

    public function test_la_autenticacion_del_panel_es_persistente_en_livewire(): void
    {
        $this->assertContains(Authenticate::class, Livewire::getPersistentMiddleware());
        $this->assertTrue(Filament::isAuthorizationStrict());
    }
}
