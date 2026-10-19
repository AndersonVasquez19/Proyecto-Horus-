<?php

namespace Tests\Feature\Panel;

use App\Filament\Resources\Matriculas\MatriculaResource;
use App\Filament\Resources\Matriculas\Pages\CreateMatricula;
use App\Filament\Resources\Matriculas\Pages\EditMatricula;
use App\Filament\Resources\Matriculas\Pages\ListMatriculas;
use App\Filament\Resources\Matriculas\Pages\ViewMatricula;
use App\Filament\Resources\Matriculas\RelationManagers\MovimientosRelationManager;
use App\Http\Middleware\EstablecerIdiomaPanel;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use App\Models\MatriculaMovimiento;
use App\Models\User;
use Filament\Actions\Testing\TestAction;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Livewire\Livewire;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Historial de matrículas desde Filament: registro con responsable y motivo,
 * consulta de solo lectura y acceso restringido (datos ficticios).
 */
class HistorialMatriculasPanelTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        app()->setLocale(EstablecerIdiomaPanel::IDIOMA);
    }

    /**
     * @return list<array{0: string, 1: ?string, 2: string, 3: ?int, 4: ?string}>
     */
    private function historial(Matricula $matricula): array
    {
        return $matricula->movimientos()->orderBy('id')->get()
            ->map(fn (MatriculaMovimiento $m): array => [$m->tipo->value, $m->estado_anterior?->value, $m->estado_nuevo->value, $m->user_id, $m->motivo])
            ->all();
    }

    public function test_crear_desde_el_panel_registra_la_creacion_con_el_responsable(): void
    {
        $usuario = User::factory()->coordinador()->create();
        $this->actingAs($usuario);
        $estudiante = Estudiante::factory()->create();
        $edicion = Edicion::factory()->create();

        Livewire::test(CreateMatricula::class)
            ->fillForm(['estudiante_id' => $estudiante->id, 'edicion_id' => $edicion->id])
            ->call('create')
            ->assertHasNoFormErrors();

        $this->assertSame([['CREACION', null, 'MATRICULADO', $usuario->id, null]], $this->historial(Matricula::query()->sole()));
    }

    public function test_cambiar_estado_desde_el_modal_registra_responsable_y_motivo(): void
    {
        // Creada sin sesión: su alta queda sin responsable.
        $matricula = Matricula::factory()->create();
        $usuario = User::factory()->administrador()->create();
        $this->actingAs($usuario);

        Livewire::test(ListMatriculas::class)
            ->callAction(TestAction::make('cambiarEstado')->table($matricula), data: ['estado' => 'RETIRADO', 'motivo' => '  Dejó el curso por trabajo  '])
            ->assertHasNoFormErrors()
            ->assertNotified('Estado actualizado a «Retirado»');

        Livewire::test(ListMatriculas::class)
            ->callAction(TestAction::make('cambiarEstado')->table($matricula), data: ['estado' => 'MATRICULADO'])
            ->assertHasNoFormErrors();

        $this->assertSame([
            ['CREACION', null, 'MATRICULADO', null, null],
            ['RETIRO', 'MATRICULADO', 'RETIRADO', $usuario->id, 'Dejó el curso por trabajo'],
            ['REACTIVACION', 'RETIRADO', 'MATRICULADO', $usuario->id, null],
        ], $this->historial($matricula));
    }

    public function test_un_cambio_rechazado_desde_el_modal_no_registra_historial(): void
    {
        $this->actingAs(User::factory()->administrador()->create());
        $edicion = Edicion::factory()->create(['cupo' => 1]);
        $anulada = Matricula::factory()->for($edicion)->create();
        $anulada->update(['estado' => 'ANULADO']);
        Matricula::factory()->for($edicion)->create();
        $antes = MatriculaMovimiento::query()->count();

        Livewire::test(ListMatriculas::class)
            ->callAction(TestAction::make('cambiarEstado')->table($anulada), data: ['estado' => 'MATRICULADO', 'motivo' => 'Sin plaza'])
            ->assertNotified('No se pudo guardar');
        Livewire::test(ListMatriculas::class)
            ->callAction(TestAction::make('cambiarEstado')->table($anulada), data: ['estado' => 'MATRICULADO', 'motivo' => str_repeat('a', 501)])
            ->assertHasFormErrors(['motivo']);

        $this->assertSame($antes, MatriculaMovimiento::query()->count());
        $this->assertSame('ANULADO', $anulada->fresh()->estado->value);
    }

    public function test_editar_el_estado_con_motivo_lo_registra_y_editar_otros_datos_no(): void
    {
        $matricula = Matricula::factory()->create();
        $usuario = User::factory()->coordinador()->create();
        $this->actingAs($usuario);

        Livewire::test(EditMatricula::class, ['record' => $matricula->id])
            ->assertSchemaComponentHidden('motivo', 'form')
            ->fillForm(['estado' => 'ANULADO'])
            ->assertSchemaComponentVisible('motivo', 'form')
            ->fillForm(['motivo' => 'Registro duplicado'])
            ->call('save')
            ->assertHasNoFormErrors();

        Livewire::test(EditMatricula::class, ['record' => $matricula->id])
            ->fillForm(['observaciones' => 'Solo una observación', 'fecha_matricula' => '2026-03-02'])
            ->assertSchemaComponentHidden('motivo', 'form')
            ->call('save')
            ->assertHasNoFormErrors();

        $this->assertSame([
            ['CREACION', null, 'MATRICULADO', null, null],
            ['ANULACION', 'MATRICULADO', 'ANULADO', $usuario->id, 'Registro duplicado'],
        ], $this->historial($matricula));
        $this->assertSame('Solo una observación', $matricula->fresh()->observaciones);
    }

    public function test_el_detalle_muestra_el_historial_de_solo_lectura(): void
    {
        $matricula = Matricula::factory()->create();
        $usuario = User::factory()->administrador()->create(['name' => 'Ana Ficticia']);
        $this->actingAs($usuario);
        $matricula->conMotivo('Dejó el curso')->update(['estado' => 'RETIRADO']);
        $movimientos = $matricula->movimientos()->get();

        $this->assertContains(MovimientosRelationManager::class, MatriculaResource::getRelations());
        $this->assertNull(Filament::getPanel('admin')->getModelResource(MatriculaMovimiento::class));

        foreach ([ViewMatricula::class, EditMatricula::class] as $pagina) {
            $componente = Livewire::test(MovimientosRelationManager::class, ['ownerRecord' => $matricula, 'pageClass' => $pagina])
                ->assertOk()
                ->assertCanSeeTableRecords($movimientos)
                ->assertSeeInOrder(['Retiro', 'Matriculado', 'Retirado', 'Ana Ficticia', 'Dejó el curso', 'Matrícula registrada', 'Sin usuario registrado'])
                ->assertActionDoesNotExist(TestAction::make('create')->table())
                ->assertActionDoesNotExist(TestAction::make('delete')->bulk());

            foreach ($movimientos as $movimiento) {
                foreach (['edit', 'delete', 'view', 'forceDelete', 'replicate'] as $accion) {
                    $componente->assertActionDoesNotExist(TestAction::make($accion)->table($movimiento));
                }
            }
        }

        $this->get(MatriculaResource::getUrl('view', ['record' => $matricula]))
            ->assertOk()
            ->assertSee('Estado de la matrícula');
    }

    public function test_una_matricula_sin_historial_lo_indica_sin_inventarlo(): void
    {
        $this->actingAs(User::factory()->coordinador()->create());
        $matricula = Matricula::factory()->create();
        // Simula una matrícula anterior a la activación del historial.
        DB::table('matricula_movimientos')->where('matricula_id', $matricula->id)->delete();

        Livewire::test(MovimientosRelationManager::class, ['ownerRecord' => $matricula, 'pageClass' => ViewMatricula::class])
            ->assertOk()
            ->assertCountTableRecords(0)
            ->assertSee('Sin movimientos registrados')
            ->assertSee('los cambios anteriores no se reconstruyen');
    }

    public static function cuentasSinAcceso(): array
    {
        return [
            'básica' => [null, true],
            'secretaría' => ['secretaria', true],
            'administrador inactivo' => ['administrador_general', false],
            'coordinador inactivo' => ['coordinador_institucional', false],
        ];
    }

    #[DataProvider('cuentasSinAcceso')]
    public function test_las_cuentas_sin_permiso_no_consultan_el_historial(?string $rol, bool $activo): void
    {
        $matricula = Matricula::factory()->create();
        $this->actingAs(User::factory()->create(['rol' => $rol, 'activo' => $activo]));

        $this->assertFalse(Gate::allows('viewAny', MatriculaMovimiento::class));
        $this->assertFalse(Gate::allows('view', $matricula->movimientos()->sole()));
        Livewire::test(MovimientosRelationManager::class, ['ownerRecord' => $matricula, 'pageClass' => ViewMatricula::class])
            ->assertForbidden();
        $this->get(MatriculaResource::getUrl('view', ['record' => $matricula]))->assertForbidden();
    }

    public function test_ninguna_cuenta_puede_crear_editar_ni_borrar_el_historial(): void
    {
        $movimiento = Matricula::factory()->create()->movimientos()->sole();

        foreach ([User::factory()->administrador()->create(), User::factory()->coordinador()->create()] as $usuario) {
            $this->actingAs($usuario);
            $this->assertTrue(Gate::allows('viewAny', MatriculaMovimiento::class));
            $this->assertTrue(Gate::allows('view', $movimiento));
            foreach (['create', 'deleteAny', 'restoreAny', 'forceDeleteAny', 'reorder', 'dissociateAny'] as $habilidad) {
                $this->assertFalse(Gate::allows($habilidad, MatriculaMovimiento::class), $habilidad);
            }
            foreach (['update', 'delete', 'restore', 'forceDelete', 'replicate', 'associate', 'dissociate'] as $habilidad) {
                $this->assertFalse(Gate::allows($habilidad, $movimiento), $habilidad);
            }
        }

        $this->assertModelExists($movimiento);
    }

    public function test_revocar_el_rol_impide_seguir_consultando_el_historial(): void
    {
        $usuario = User::factory()->coordinador()->create();
        $matricula = Matricula::factory()->create();
        $this->actingAs($usuario);
        $this->get(MatriculaResource::getUrl('view', ['record' => $matricula]))->assertOk();

        DB::table('users')->where('id', $usuario->id)->update(['rol' => null]);

        $this->get(MatriculaResource::getUrl('view', ['record' => $matricula]))->assertForbidden();
        Livewire::test(MovimientosRelationManager::class, ['ownerRecord' => $matricula, 'pageClass' => ViewMatricula::class])
            ->assertForbidden();
    }
}
