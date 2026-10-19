<?php

namespace Tests\Feature\Panel;

use App\Filament\Resources\Ediciones\Pages\ViewEdicion;
use App\Filament\Resources\Ediciones\RelationManagers\MatriculasRelationManager as MatriculasDeEdicion;
use App\Filament\Resources\Estudiantes\Pages\ViewEstudiante;
use App\Filament\Resources\Estudiantes\RelationManagers\MatriculasRelationManager as MatriculasDeEstudiante;
use App\Filament\Resources\Matriculas\Pages\CreateMatricula;
use App\Filament\Resources\Matriculas\Pages\ListMatriculas;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use App\Models\User;
use Filament\Actions\Testing\TestAction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Livewire\Livewire;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class RobustezMatriculasPanelTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::factory()->administrador()->create());
    }

    public static function altas(): array
    {
        return [['estudiante'], ['edicion'], ['pagina']];
    }

    #[DataProvider('altas')]
    public function test_una_colision_sql_real_se_traduce_y_conserva_formulario_e_historial(string $origen): void
    {
        $existente = Matricula::factory()->create(['observaciones' => 'Conservar historial']);
        $nuevo = Estudiante::factory()->create();
        $antes = $existente->fresh()->getAttributes();

        // La validación previa acepta al estudiante nuevo. En creating provocamos
        // la restricción SQL real para cubrir la defensa final, no solo el precheck.
        Matricula::creating(function () use ($existente): void {
            DB::table('matriculas')->insert([
                'estudiante_id' => $existente->estudiante_id,
                'edicion_id' => $existente->edicion_id,
                'estado' => 'MATRICULADO',
            ]);
        });

        if ($origen === 'pagina') {
            Livewire::test(CreateMatricula::class)
                ->fillForm(['estudiante_id' => $nuevo->id, 'edicion_id' => $existente->edicion_id, 'observaciones' => 'No perder'])
                ->call('create')
                ->assertHasFormErrors(['edicion_id'])
                ->assertSee('El estudiante ya está matriculado en esta edición.')
                ->assertSet('data.observaciones', 'No perder');
        } else {
            $desdeEstudiante = $origen === 'estudiante';
            $campo = $desdeEstudiante ? 'edicion_id' : 'estudiante_id';
            Livewire::test($desdeEstudiante ? MatriculasDeEstudiante::class : MatriculasDeEdicion::class, [
                'ownerRecord' => $desdeEstudiante ? $nuevo : $existente->edicion,
                'pageClass' => $desdeEstudiante ? ViewEstudiante::class : ViewEdicion::class,
            ])
                ->callAction(TestAction::make('create')->table(), data: [
                    $campo => $desdeEstudiante ? $existente->edicion_id : $nuevo->id,
                    'observaciones' => 'No perder',
                ])
                ->assertHasFormErrors([$campo => 'El estudiante ya está matriculado en esta edición.'])
                ->assertActionMounted(TestAction::make('create')->table())
                ->assertSet('mountedActions.0.data.observaciones', 'No perder');
        }

        $this->assertDatabaseCount('matriculas', 1);
        $this->assertSame($antes, $existente->fresh()->getAttributes());
    }

    public function test_el_modal_rechaza_reactivar_una_matricula_cancelada_y_la_conserva(): void
    {
        $matricula = Matricula::factory()->create();
        $matricula->update(['estado' => 'RETIRADO']);
        $matricula->edicion->update(['estado' => 'CANCELADA']);

        Livewire::test(ListMatriculas::class)
            ->callAction(TestAction::make('cambiarEstado')->table($matricula), data: ['estado' => 'MATRICULADO'])
            ->assertNotified('No se pudo guardar');

        $this->assertSame('RETIRADO', $matricula->fresh()->estado->value);
        $this->assertSame('CANCELADA', Edicion::findOrFail($matricula->edicion_id)->estado->value);
    }
}
