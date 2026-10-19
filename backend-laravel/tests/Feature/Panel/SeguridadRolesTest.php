<?php

namespace Tests\Feature\Panel;

use App\Filament\Support\AccionesAcademicas;
use App\Filament\Widgets\AccesosRapidos;
use App\Filament\Widgets\MatriculasPorEstado;
use App\Filament\Widgets\ResumenAcademico;
use App\Models\Matricula;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Livewire\Livewire;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class SeguridadRolesTest extends TestCase
{
    use RefreshDatabase;

    public function test_la_cuenta_basica_no_puede_acceder_al_panel(): void
    {
        $usuario = User::factory()->create();

        $this->assertFalse($usuario->canAccessPanel(Filament::getPanel('admin')));
    }

    public static function cuentas(): array
    {
        return [
            'básica' => [null, true, false],
            'secretaría' => ['secretaria', true, false],
            'coordinador' => ['coordinador_institucional', true, true],
            'administrador' => ['administrador_general', true, true],
            'administrador inactivo' => ['administrador_general', false, false],
            'coordinador inactivo' => ['coordinador_institucional', false, false],
        ];
    }

    #[DataProvider('cuentas')]
    public function test_aplica_roles_y_estado_en_acceso_directo_y_politicas(?string $rol, bool $activo, bool $permitido): void
    {
        $usuario = User::factory()->create(['rol' => $rol, 'activo' => $activo]);
        $this->actingAs($usuario);
        $matricula = Matricula::factory()->create();
        $this->assertSame($permitido, $usuario->canAccessPanel(Filament::getPanel('admin')));
        foreach ([$matricula, $matricula->estudiante, $matricula->edicion, $matricula->edicion->curso] as $record) {
            foreach (['viewAny', 'create'] as $ability) {
                $this->assertSame($permitido, Gate::allows($ability, $record::class));
            }
            foreach (['view', 'update'] as $ability) {
                $this->assertSame($permitido, Gate::allows($ability, $record));
            }
        }
        foreach (['/gestion', '/gestion/estudiantes', '/gestion/cursos', '/gestion/ediciones', '/gestion/matriculas', '/gestion/estudiantes/create', '/gestion/matriculas/create', '/gestion/matriculas/'.$matricula->id.'/edit'] as $ruta) {
            $this->get($ruta)->assertStatus($permitido ? 200 : 403);
        }
    }

    public static function widgets(): array
    {
        return [[AccesosRapidos::class], [ResumenAcademico::class], [MatriculasPorEstado::class]];
    }

    #[DataProvider('widgets')]
    public function test_los_widgets_no_filtran_datos_a_una_cuenta_basica(string $widget): void
    {
        $this->actingAs(User::factory()->create());
        Livewire::test($widget)->assertForbidden();
    }

    public function test_la_accion_personalizada_exige_permiso_de_cambio_de_estado(): void
    {
        $this->actingAs(User::factory()->create());
        $accion = AccionesAcademicas::cambiarEstadoMatricula()->record(Matricula::factory()->create());
        $this->assertFalse($accion->isAuthorized());
    }
}
