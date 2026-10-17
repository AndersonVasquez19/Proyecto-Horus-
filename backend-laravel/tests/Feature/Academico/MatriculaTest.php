<?php

namespace Tests\Feature\Academico;

use App\Enums\EstadoEdicion;
use App\Enums\EstadoMatricula;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * Cursos, ediciones y matrículas (datos ficticios).
 */
class MatriculaTest extends TestCase
{
    use RefreshDatabase;

    public function test_crea_curso_y_edicion_sin_fechas_ni_cupo(): void
    {
        $curso = Curso::create(['nombre' => 'Primeros Auxilios']);
        $edicion = $curso->ediciones()->create(['nombre' => '2024']);

        $edicion->refresh();
        $this->assertTrue($curso->fresh()->activo);
        $this->assertSame(EstadoEdicion::Planificada, $edicion->estado);
        $this->assertNull($edicion->fecha_inicio);
        $this->assertNull($edicion->cupo);
        $this->assertSame('Primeros Auxilios — 2024', $edicion->etiqueta);
    }

    public function test_rechaza_edicion_con_fecha_fin_anterior_al_inicio(): void
    {
        $this->expectException(ValidationException::class);

        Edicion::factory()->create(['fecha_inicio' => '2025-03-10', 'fecha_fin' => '2025-03-01']);
    }

    public function test_un_curso_no_repite_el_nombre_de_edicion(): void
    {
        $curso = Curso::factory()->create();
        $curso->ediciones()->create(['nombre' => 'Grupo A']);

        $this->expectException(UniqueConstraintViolationException::class);

        $curso->ediciones()->create(['nombre' => 'Grupo A']);
    }

    public function test_matricula_a_un_estudiante_como_matriculado(): void
    {
        $estudiante = Estudiante::factory()->create();
        $edicion = Edicion::factory()->create();

        $matricula = Matricula::create(['estudiante_id' => $estudiante->id, 'edicion_id' => $edicion->id]);

        $matricula->refresh();
        $this->assertSame(EstadoMatricula::Matriculado, $matricula->estado);
        // No se inventa la fecha de matrícula.
        $this->assertNull($matricula->fecha_matricula);
    }

    public function test_rechaza_matricula_duplicada_en_la_misma_edicion(): void
    {
        $estudiante = Estudiante::factory()->create();
        $edicion = Edicion::factory()->create();
        Matricula::create(['estudiante_id' => $estudiante->id, 'edicion_id' => $edicion->id]);

        try {
            Matricula::create(['estudiante_id' => $estudiante->id, 'edicion_id' => $edicion->id]);
            $this->fail('Se aceptó una matrícula duplicada.');
        } catch (ValidationException $e) {
            $this->assertSame(['El estudiante ya está matriculado en esta edición.'], $e->errors()['edicion_id']);
        }

        $this->assertSame(1, Matricula::query()->count());
    }

    public function test_la_base_de_datos_rechaza_matricula_duplicada(): void
    {
        $matricula = Matricula::factory()->create();

        $this->expectException(UniqueConstraintViolationException::class);

        DB::table('matriculas')->insert([
            'estudiante_id' => $matricula->estudiante_id,
            'edicion_id' => $matricula->edicion_id,
            'estado' => 'MATRICULADO',
        ]);
    }

    public function test_la_base_de_datos_rechaza_un_estado_inexistente(): void
    {
        $this->expectException(QueryException::class);

        DB::table('matriculas')->insert([
            'estudiante_id' => Estudiante::factory()->create()->id,
            'edicion_id' => Edicion::factory()->create()->id,
            'estado' => 'PAGADO',
        ]);
    }

    public function test_permite_al_mismo_estudiante_en_ediciones_diferentes_del_mismo_curso(): void
    {
        $estudiante = Estudiante::factory()->create();
        $curso = Curso::factory()->create();
        $edicion2024 = $curso->ediciones()->create(['nombre' => '2024']);
        $edicion2025 = $curso->ediciones()->create(['nombre' => '2025']);

        $estudiante->matriculas()->create(['edicion_id' => $edicion2024->id]);
        $estudiante->matriculas()->create(['edicion_id' => $edicion2025->id]);

        $this->assertSame(2, $estudiante->matriculas()->count());
    }

    public function test_consulta_el_historial_de_matriculas_de_un_estudiante(): void
    {
        $estudiante = Estudiante::factory()->create();
        $otro = Estudiante::factory()->create();
        $auxilios = Curso::factory()->create(['nombre' => 'Primeros Auxilios']);
        $inyectables = Curso::factory()->create(['nombre' => 'Inyectables']);
        $e1 = $auxilios->ediciones()->create(['nombre' => '2024']);
        $e2 = $inyectables->ediciones()->create(['nombre' => '2024']);

        $estudiante->matriculas()->create(['edicion_id' => $e1->id]);
        $estudiante->matriculas()->create(['edicion_id' => $e2->id]);
        $otro->matriculas()->create(['edicion_id' => $e1->id]);

        $cursos = $estudiante->matriculas()->with('edicion.curso')->get()->map(fn (Matricula $m) => $m->edicion->etiqueta)->sort()->values()->all();
        $this->assertSame(['Inyectables — 2024', 'Primeros Auxilios — 2024'], $cursos);
        $this->assertSame([$e1->id, $e2->id], $estudiante->ediciones()->orderBy('ediciones.id')->pluck('ediciones.id')->all());
        $this->assertSame('MATRICULADO', $estudiante->ediciones()->first()->pivot->estado);
    }

    public function test_consulta_los_estudiantes_matriculados_por_edicion(): void
    {
        $edicion = Edicion::factory()->create();
        $otraEdicion = Edicion::factory()->create();
        $a = Estudiante::factory()->create();
        $b = Estudiante::factory()->create();
        $c = Estudiante::factory()->create();

        $edicion->matriculas()->create(['estudiante_id' => $a->id]);
        $edicion->matriculas()->create(['estudiante_id' => $b->id]);
        $otraEdicion->matriculas()->create(['estudiante_id' => $c->id]);

        $this->assertEqualsCanonicalizing([$a->id, $b->id], $edicion->estudiantes()->pluck('estudiantes.id')->all());
        $this->assertSame([$c->id], $otraEdicion->estudiantes()->pluck('estudiantes.id')->all());
        $this->assertSame(2, $edicion->curso->matriculas()->count());
    }

    public function test_cambia_el_estado_por_transiciones_permitidas(): void
    {
        $matricula = Matricula::factory()->create();

        $matricula->update(['estado' => EstadoMatricula::Retirado]);
        $matricula->update(['estado' => EstadoMatricula::Matriculado]);
        $matricula->update(['estado' => EstadoMatricula::Culminado]);

        $this->assertSame(EstadoMatricula::Culminado, $matricula->fresh()->estado);
    }

    public function test_rechaza_transiciones_no_permitidas(): void
    {
        $matricula = Matricula::factory()->create();
        $matricula->update(['estado' => EstadoMatricula::Anulado]);

        try {
            // Una matrícula anulada no puede pasar directamente a culminada.
            $matricula->update(['estado' => EstadoMatricula::Culminado]);
            $this->fail('Se aceptó una transición no permitida.');
        } catch (ValidationException $e) {
            $this->assertSame(['No se puede pasar de «Anulado» a «Culminado».'], $e->errors()['estado']);
        }

        $this->assertSame(EstadoMatricula::Anulado, $matricula->fresh()->estado);
    }

    public function test_una_matricula_nueva_solo_puede_empezar_como_matriculado(): void
    {
        $this->expectException(ValidationException::class);

        Matricula::factory()->create(['estado' => EstadoMatricula::Culminado]);
    }

    public function test_no_permite_cambiar_estudiante_ni_edicion_de_una_matricula(): void
    {
        $matricula = Matricula::factory()->create();
        $otraEdicion = Edicion::factory()->create();

        $this->expectException(ValidationException::class);

        $matricula->update(['edicion_id' => $otraEdicion->id]);
    }

    public function test_respeta_el_cupo_de_la_edicion(): void
    {
        $edicion = Edicion::factory()->create(['cupo' => 2]);
        $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]);
        $retirada = $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]);

        try {
            $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]);
            $this->fail('Se superó el cupo.');
        } catch (ValidationException $e) {
            $this->assertSame(['La edición alcanzó su cupo de 2 estudiantes.'], $e->errors()['edicion_id']);
        }

        // Un retiro libera la plaza...
        $retirada->update(['estado' => EstadoMatricula::Retirado]);
        $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]);

        // ...y la reincorporación ya no cabe.
        $this->expectException(ValidationException::class);
        $retirada->update(['estado' => EstadoMatricula::Matriculado]);
    }

    public function test_no_permite_reducir_el_cupo_por_debajo_de_las_matriculas_vigentes(): void
    {
        $edicion = Edicion::factory()->create(['cupo' => 5]);
        $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]);
        $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]);

        $this->expectException(ValidationException::class);

        $edicion->update(['cupo' => 1]);
    }

    public function test_una_edicion_cancelada_no_admite_matriculas(): void
    {
        $edicion = Edicion::factory()->create(['estado' => EstadoEdicion::Cancelada]);

        $this->expectException(ValidationException::class);

        $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]);
    }

    public function test_no_cancela_una_edicion_con_matriculas_vigentes(): void
    {
        $matricula = Matricula::factory()->create();
        $edicion = $matricula->edicion;

        try {
            $edicion->update(['estado' => EstadoEdicion::Cancelada]);
            $this->fail('Se canceló una edición con matrículas vigentes.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('estado', $e->errors());
        }

        $matricula->update(['estado' => EstadoMatricula::Anulado]);
        $edicion->update(['estado' => EstadoEdicion::Cancelada]);

        $this->assertSame(EstadoEdicion::Cancelada, $edicion->fresh()->estado);
    }
}
