<?php

namespace Tests\Feature\Academico;

use App\Enums\EstadoEdicion;
use App\Enums\EstadoMatricula;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class RobustezMatriculaTest extends TestCase
{
    use RefreshDatabase;

    public static function estadosInactivos(): array
    {
        return [['RETIRADO'], ['ANULADO']];
    }

    #[DataProvider('estadosInactivos')]
    public function test_reactivar_en_edicion_cancelada_se_rechaza_sin_alterar_datos(string $estado): void
    {
        $matricula = Matricula::factory()->create(['observaciones' => 'Historial original']);
        $matricula->update(['estado' => $estado]);
        $matricula->edicion->update(['estado' => EstadoEdicion::Cancelada]);
        $antes = $matricula->fresh()->getAttributes();

        try {
            $matricula->update(['estado' => EstadoMatricula::Matriculado, 'observaciones' => 'Cambio rechazado']);
            $this->fail('Se reactivó una matrícula de una edición cancelada.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('estado', $e->errors());
        }

        $this->assertSame($antes, $matricula->fresh()->getAttributes());
        $this->assertSame(EstadoEdicion::Cancelada, $matricula->edicion->fresh()->estado);
    }

    public function test_un_objeto_obsoleto_no_elude_las_transiciones_del_estado_persistido(): void
    {
        $matricula = Matricula::factory()->create();
        $obsoleta = $matricula->fresh();
        $matricula->update(['estado' => EstadoMatricula::Anulado]);

        try {
            $obsoleta->update(['estado' => EstadoMatricula::Culminado]);
            $this->fail('Se aplicó una transición desde un estado obsoleto.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('estado', $e->errors());
        }

        $this->assertSame(EstadoMatricula::Anulado, $matricula->fresh()->estado);
    }

    public function test_rechazar_reduccion_preserva_todos_los_campos_de_la_edicion(): void
    {
        $edicion = Edicion::factory()->create(['cupo' => 2]);
        foreach (Estudiante::factory()->count(2)->create() as $estudiante) {
            $edicion->matriculas()->create(['estudiante_id' => $estudiante->id]);
        }
        $antes = $edicion->fresh()->getAttributes();

        try {
            $edicion->update(['cupo' => 1, 'nombre' => 'No guardar']);
            $this->fail('Se redujo el cupo por debajo de la ocupación.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('cupo', $e->errors());
        }

        $this->assertSame($antes, $edicion->fresh()->getAttributes());
        $this->assertSame(2, Matricula::query()->count());
    }

    public function test_un_error_despues_del_insert_revierte_la_matricula_y_conserva_estudiante_y_edicion(): void
    {
        $estudiante = Estudiante::factory()->create();
        $edicion = Edicion::factory()->create(['cupo' => 1]);
        Matricula::saved(fn () => throw new RuntimeException('Fallo de prueba después del INSERT'));

        try {
            $edicion->matriculas()->create(['estudiante_id' => $estudiante->id]);
            $this->fail('No se propagó el fallo.');
        } catch (RuntimeException $e) {
            $this->assertSame('Fallo de prueba después del INSERT', $e->getMessage());
        }

        $this->assertDatabaseCount('matriculas', 0);
        $this->assertModelExists($estudiante);
        $this->assertSame(1, $edicion->fresh()->cuposDisponibles());
    }

    public function test_una_unicidad_ajena_a_matriculas_no_se_disfraza_de_matricula_duplicada(): void
    {
        $matricula = Matricula::factory()->create();
        $nuevo = Estudiante::factory()->create();
        Matricula::creating(fn () => DB::table('estudiantes')->insert($matricula->estudiante->getAttributes()));

        $this->expectException(UniqueConstraintViolationException::class);
        $matricula->edicion->matriculas()->create(['estudiante_id' => $nuevo->id]);
    }

    public function test_una_edicion_obsoleta_conserva_el_cupo_actual_al_editar_otro_campo(): void
    {
        $edicion = Edicion::factory()->create(['cupo' => 3]);
        $obsoleta = $edicion->fresh();
        $edicion->update(['cupo' => 2]);
        $obsoleta->update(['nombre' => 'Nombre corregido']);

        $this->assertSame(2, $edicion->fresh()->cupo);
        $this->assertSame('Nombre corregido', $edicion->fresh()->nombre);
    }
}
