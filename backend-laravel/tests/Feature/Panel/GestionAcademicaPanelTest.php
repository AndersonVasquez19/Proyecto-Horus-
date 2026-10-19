<?php

namespace Tests\Feature\Panel;

use App\Enums\EstadoMatricula;
use App\Filament\Resources\Cursos\Pages\CreateCurso;
use App\Filament\Resources\Ediciones\Pages\CreateEdicion;
use App\Filament\Resources\Ediciones\Pages\EditEdicion;
use App\Filament\Resources\Ediciones\Pages\ViewEdicion;
use App\Filament\Resources\Ediciones\RelationManagers\MatriculasRelationManager as MatriculasDeEdicion;
use App\Filament\Resources\Estudiantes\Pages\CreateEstudiante;
use App\Filament\Resources\Estudiantes\Pages\EditEstudiante;
use App\Filament\Resources\Estudiantes\Pages\ListEstudiantes;
use App\Filament\Resources\Estudiantes\Pages\ViewEstudiante;
use App\Filament\Resources\Estudiantes\RelationManagers\MatriculasRelationManager as MatriculasDeEstudiante;
use App\Filament\Resources\Matriculas\Pages\CreateMatricula;
use App\Filament\Resources\Matriculas\Pages\EditMatricula;
use App\Filament\Resources\Matriculas\Pages\ListMatriculas;
use App\Filament\Widgets\MatriculasPorEstado;
use App\Filament\Widgets\ResumenAcademico;
use App\Http\Middleware\EstablecerIdiomaPanel;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use App\Models\User;
use Filament\Actions\Testing\TestAction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Flujo completo desde los formularios y acciones de Filament (datos ficticios).
 */
class GestionAcademicaPanelTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Livewire::test() no pasa por el middleware HTTP; se aplica aquí el
        // mismo idioma que fija EstablecerIdiomaPanel en el panel real.
        app()->setLocale(EstablecerIdiomaPanel::IDIOMA);

        $this->actingAs(User::factory()->administrador()->create());
    }

    public function test_registra_un_estudiante_desde_el_formulario(): void
    {
        Livewire::test(CreateEstudiante::class)
            ->fillForm([
                'tipo_documento' => 'DNI',
                'numero_documento' => '70112233',
                'apellidos' => 'Prueba Ficticia',
                'nombres' => 'Rosa',
            ])
            ->call('create')
            ->assertHasNoFormErrors()
            ->assertNotified('Estudiante registrado');

        $this->assertDatabaseHas('estudiantes', ['numero_documento' => '70112233', 'nombres' => 'Rosa']);
    }

    public function test_el_formulario_rechaza_un_dni_invalido_con_mensaje_claro(): void
    {
        Livewire::test(CreateEstudiante::class)
            ->fillForm([
                'tipo_documento' => 'DNI',
                'numero_documento' => '12345',
                'apellidos' => 'Prueba',
                'nombres' => 'Dni Corto',
            ])
            ->call('create')
            ->assertHasFormErrors(['numero_documento'])
            ->assertSee('El DNI debe tener exactamente 8 dígitos.');

        $this->assertDatabaseCount('estudiantes', 0);
    }

    public function test_el_formulario_acepta_un_celular_valido_o_vacio(): void
    {
        Livewire::test(CreateEstudiante::class)
            ->fillForm(['tipo_documento' => 'DNI', 'numero_documento' => '70112233', 'apellidos' => 'Prueba', 'nombres' => 'Con Celular', 'telefono' => '987 654 321'])
            ->call('create')
            ->assertHasNoFormErrors();

        Livewire::test(CreateEstudiante::class)
            ->fillForm(['tipo_documento' => 'DNI', 'numero_documento' => '70112234', 'apellidos' => 'Prueba', 'nombres' => 'Sin Celular', 'telefono' => ''])
            ->call('create')
            ->assertHasNoFormErrors();

        $this->assertDatabaseHas('estudiantes', ['nombres' => 'Con Celular', 'telefono' => '987654321']);
        $this->assertDatabaseHas('estudiantes', ['nombres' => 'Sin Celular', 'telefono' => null]);
    }

    public function test_el_formulario_rechaza_un_celular_invalido_al_crear(): void
    {
        foreach (['98765432', '887654321', '98765432a', '+51987654321'] as $telefono) {
            Livewire::test(CreateEstudiante::class)
                ->fillForm(['tipo_documento' => 'DNI', 'numero_documento' => '70112233', 'apellidos' => 'Prueba', 'nombres' => 'Celular', 'telefono' => $telefono])
                ->call('create')
                ->assertHasFormErrors(['telefono'])
                ->assertSee('El celular debe tener 9 dígitos y comenzar con 9.');
        }

        $this->assertDatabaseCount('estudiantes', 0);
    }

    public function test_el_formulario_rechaza_un_celular_invalido_al_editar(): void
    {
        $estudiante = Estudiante::factory()->create(['telefono' => '987654321']);

        Livewire::test(EditEstudiante::class, ['record' => $estudiante->getRouteKey()])
            ->fillForm(['telefono' => '12345'])
            ->call('save')
            ->assertHasFormErrors(['telefono'])
            ->assertSee('El celular debe tener 9 dígitos y comenzar con 9.');

        $this->assertSame('987654321', $estudiante->fresh()->telefono);

        Livewire::test(EditEstudiante::class, ['record' => $estudiante->getRouteKey()])
            ->fillForm(['telefono' => '912345678'])
            ->call('save')
            ->assertHasNoFormErrors();

        $this->assertSame('912345678', $estudiante->fresh()->telefono);
    }

    public function test_el_formulario_rechaza_un_documento_duplicado(): void
    {
        Estudiante::factory()->create(['numero_documento' => '70112233']);

        Livewire::test(CreateEstudiante::class)
            ->fillForm([
                'tipo_documento' => 'DNI',
                'numero_documento' => '70112233',
                'apellidos' => 'Otra',
                'nombres' => 'Persona',
            ])
            ->call('create')
            ->assertHasFormErrors(['numero_documento'])
            ->assertSee('Ya existe un estudiante registrado con este documento.');

        $this->assertDatabaseCount('estudiantes', 1);
    }

    public function test_el_formulario_exige_campos_obligatorios_en_espanol(): void
    {
        Livewire::test(CreateEstudiante::class)
            ->fillForm(['tipo_documento' => 'DNI', 'numero_documento' => '', 'apellidos' => '', 'nombres' => ''])
            ->call('create')
            ->assertHasFormErrors(['numero_documento' => 'required', 'apellidos' => 'required', 'nombres' => 'required'])
            ->assertSee('es obligatorio');
    }

    public function test_registra_un_estudiante_sin_documento_y_avisa_de_homonimos(): void
    {
        Estudiante::factory()->create(['apellidos' => 'Pérez Ruiz', 'nombres' => 'José']);

        Livewire::test(CreateEstudiante::class)
            ->fillForm([
                'tipo_documento' => 'SIN_DOCUMENTO',
                'apellidos' => 'Perez Ruiz',
                'nombres' => 'Jose',
            ])
            ->call('create')
            ->assertHasNoFormErrors()
            ->assertNotified('Posible duplicado');

        $this->assertDatabaseHas('estudiantes', ['nombres' => 'Jose', 'tipo_documento' => 'SIN_DOCUMENTO', 'numero_documento' => null]);
        $this->assertDatabaseCount('estudiantes', 2);
    }

    public function test_busca_estudiantes_por_dni_o_nombre_en_el_listado(): void
    {
        $ana = Estudiante::factory()->create(['numero_documento' => '70112233', 'nombres' => 'Ana', 'apellidos' => 'Quispe Chávez']);
        $luis = Estudiante::factory()->create(['numero_documento' => '70998877', 'nombres' => 'Luis', 'apellidos' => 'Torres']);

        Livewire::test(ListEstudiantes::class)
            ->searchTable('70112233')
            ->assertCanSeeTableRecords([$ana])
            ->assertCanNotSeeTableRecords([$luis])
            ->searchTable('chavez')
            ->assertCanSeeTableRecords([$ana])
            ->assertCanNotSeeTableRecords([$luis]);
    }

    public function test_crea_curso_y_edicion_desde_los_formularios(): void
    {
        Livewire::test(CreateCurso::class)
            ->fillForm(['nombre' => 'Primeros Auxilios', 'activo' => true])
            ->call('create')
            ->assertHasNoFormErrors();

        $curso = Curso::query()->where('nombre', 'Primeros Auxilios')->firstOrFail();

        Livewire::test(CreateEdicion::class)
            ->fillForm(['curso_id' => $curso->id, 'nombre' => '2024', 'estado' => 'FINALIZADA'])
            ->call('create')
            ->assertHasNoFormErrors();

        $this->assertDatabaseHas('ediciones', ['curso_id' => $curso->id, 'nombre' => '2024', 'fecha_inicio' => null]);

        Livewire::test(CreateEdicion::class)
            ->fillForm(['curso_id' => $curso->id, 'nombre' => '2024', 'estado' => 'PLANIFICADA'])
            ->call('create')
            ->assertHasFormErrors(['nombre' => 'unique']);

        Livewire::test(CreateEdicion::class)
            ->fillForm(['curso_id' => $curso->id, 'nombre' => '2025', 'fecha_inicio' => '2025-05-10', 'fecha_fin' => '2025-05-01', 'estado' => 'PLANIFICADA'])
            ->call('create')
            ->assertHasFormErrors(['fecha_fin']);
    }

    public function test_matricula_desde_el_formulario_y_rechaza_el_duplicado(): void
    {
        $estudiante = Estudiante::factory()->create();
        $edicion = Edicion::factory()->create();

        Livewire::test(CreateMatricula::class)
            ->fillForm(['estudiante_id' => $estudiante->id, 'edicion_id' => $edicion->id])
            ->call('create')
            ->assertHasNoFormErrors()
            ->assertNotified('Estudiante matriculado');

        $this->assertDatabaseHas('matriculas', ['estudiante_id' => $estudiante->id, 'edicion_id' => $edicion->id, 'estado' => 'MATRICULADO']);

        Livewire::test(CreateMatricula::class)
            ->fillForm(['estudiante_id' => $estudiante->id, 'edicion_id' => $edicion->id])
            ->call('create')
            ->assertHasFormErrors(['edicion_id']);

        $this->assertDatabaseCount('matriculas', 1);
    }

    public function test_matricula_desde_la_ficha_del_estudiante_y_muestra_su_historial(): void
    {
        $estudiante = Estudiante::factory()->create();
        $edicion = Edicion::factory()->create();
        $yaCursada = Matricula::factory()->create(['estudiante_id' => $estudiante->id]);

        Livewire::test(MatriculasDeEstudiante::class, ['ownerRecord' => $estudiante, 'pageClass' => ViewEstudiante::class])
            ->assertCanSeeTableRecords([$yaCursada])
            ->callAction(TestAction::make('create')->table(), data: ['edicion_id' => $edicion->id])
            ->assertHasNoFormErrors()
            ->assertNotified('Estudiante matriculado');

        $this->assertSame(2, $estudiante->matriculas()->count());

        // La misma edición ya no se puede volver a elegir para este estudiante.
        Livewire::test(MatriculasDeEstudiante::class, ['ownerRecord' => $estudiante, 'pageClass' => ViewEstudiante::class])
            ->callAction(TestAction::make('create')->table(), data: ['edicion_id' => $edicion->id])
            ->assertHasFormErrors(['edicion_id']);

        $this->assertSame(2, $estudiante->matriculas()->count());
    }

    public function test_matricula_desde_la_edicion_y_lista_a_sus_estudiantes(): void
    {
        $edicion = Edicion::factory()->create();
        $inscrito = Matricula::factory()->create(['edicion_id' => $edicion->id]);
        $nuevo = Estudiante::factory()->create();

        Livewire::test(MatriculasDeEdicion::class, ['ownerRecord' => $edicion, 'pageClass' => ViewEdicion::class])
            ->assertCanSeeTableRecords([$inscrito])
            ->callAction(TestAction::make('create')->table(), data: ['estudiante_id' => $nuevo->id])
            ->assertHasNoFormErrors();

        Livewire::test(MatriculasDeEdicion::class, ['ownerRecord' => $edicion, 'pageClass' => ViewEdicion::class])
            ->callAction(TestAction::make('create')->table(), data: ['estudiante_id' => $nuevo->id])
            ->assertHasFormErrors(['estudiante_id']);

        $this->assertSame(2, $edicion->matriculas()->count());
    }

    public function test_cambia_el_estado_de_una_matricula_con_la_accion(): void
    {
        $matricula = Matricula::factory()->create();

        Livewire::test(ListMatriculas::class)
            ->callAction(TestAction::make('cambiarEstado')->table($matricula), data: ['estado' => 'CULMINADO'])
            ->assertHasNoFormErrors()
            ->assertNotified('Estado actualizado a «Culminado»');

        $this->assertSame(EstadoMatricula::Culminado, $matricula->fresh()->estado);

        // Desde «Culminado» solo se puede volver a «Matriculado»: «Retirado» no se ofrece.
        Livewire::test(ListMatriculas::class)
            ->callAction(TestAction::make('cambiarEstado')->table($matricula), data: ['estado' => 'RETIRADO'])
            ->assertHasFormErrors(['estado']);

        $this->assertSame(EstadoMatricula::Culminado, $matricula->fresh()->estado);
    }

    public function test_edita_una_matricula_y_solo_ofrece_estados_permitidos(): void
    {
        $matricula = Matricula::factory()->create();

        Livewire::test(EditMatricula::class, ['record' => $matricula->getRouteKey()])
            ->fillForm(['estado' => 'RETIRADO', 'observaciones' => 'Dejó el curso (dato ficticio).'])
            ->call('save')
            ->assertHasNoFormErrors();

        $this->assertSame(EstadoMatricula::Retirado, $matricula->fresh()->estado);
        $this->assertSame('Dejó el curso (dato ficticio).', $matricula->fresh()->observaciones);

        // Desde «Retirado» no se puede pasar a «Culminado».
        Livewire::test(EditMatricula::class, ['record' => $matricula->getRouteKey()])
            ->fillForm(['estado' => 'CULMINADO'])
            ->call('save')
            ->assertHasFormErrors(['estado']);

        $this->assertSame(EstadoMatricula::Retirado, $matricula->fresh()->estado);
    }

    public function test_las_reglas_del_modelo_se_muestran_junto_al_campo_del_formulario(): void
    {
        // Regla que solo comprueba el modelo: no cancelar una edición con matrículas vigentes.
        $matricula = Matricula::factory()->create();

        Livewire::test(EditEdicion::class, ['record' => $matricula->edicion->getRouteKey()])
            ->fillForm(['estado' => 'CANCELADA'])
            ->call('save')
            ->assertHasFormErrors(['estado'])
            ->assertSee('No se puede cancelar la edición mientras tenga 1 matrícula(s) vigente(s).');

        $this->assertNotSame('CANCELADA', $matricula->edicion->fresh()->estado->value);
    }

    public function test_filtra_matriculas_por_estado_y_por_curso(): void
    {
        $a = Matricula::factory()->create();
        $b = Matricula::factory()->create();
        $b->update(['estado' => EstadoMatricula::Retirado]);

        Livewire::test(ListMatriculas::class)
            ->filterTable('estado', ['RETIRADO'])
            ->assertCanSeeTableRecords([$b])
            ->assertCanNotSeeTableRecords([$a]);

        Livewire::test(ListMatriculas::class)
            ->filterTable('curso', $a->edicion->curso_id)
            ->assertCanSeeTableRecords([$a])
            ->assertCanNotSeeTableRecords([$b]);
    }

    public function test_la_eliminacion_se_oculta_para_estudiantes_con_historial(): void
    {
        $conHistorial = Matricula::factory()->create()->estudiante;
        $sinHistorial = Estudiante::factory()->create();

        Livewire::test(EditEstudiante::class, ['record' => $conHistorial->getRouteKey()])
            ->assertActionHidden('delete');

        Livewire::test(EditEstudiante::class, ['record' => $sinHistorial->getRouteKey()])
            ->callAction('delete');

        $this->assertModelExists($conHistorial);
        $this->assertModelMissing($sinHistorial);
    }

    public function test_las_matriculas_no_tienen_accion_de_eliminar(): void
    {
        $matricula = Matricula::factory()->create();

        Livewire::test(ListMatriculas::class)
            ->assertActionDoesNotExist(TestAction::make('delete')->table($matricula));
    }

    public function test_el_resumen_consulta_datos_reales(): void
    {
        Estudiante::factory()->count(2)->create();
        Curso::factory()->create();
        Curso::factory()->inactivo()->create();
        $matricula = Matricula::factory()->create();
        $matricula->update(['estado' => EstadoMatricula::Retirado]);

        Livewire::test(ResumenAcademico::class)
            ->assertSeeInOrder(['Estudiantes', '3', 'Cursos activos', '2', '3 curso(s) en total', 'Ediciones', '1', 'Matrículas', '1', '0 vigente(s)']);

        Livewire::test(MatriculasPorEstado::class)
            ->assertSeeInOrder(['Matriculado', '0', 'Culminado', '0', 'Retirado', '1', 'Anulado', '0'])
            ->assertDontSee('Sin matrículas');
    }
}
