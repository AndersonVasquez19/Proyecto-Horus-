<?php

namespace Tests\Feature\Academico;

use App\Exceptions\RegistroProtegidoException;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * El historial académico no se borra por accidente: ni desde el modelo ni en
 * cascada desde la base de datos.
 */
class ProteccionHistorialTest extends TestCase
{
    use RefreshDatabase;

    public function test_no_elimina_un_estudiante_con_matriculas(): void
    {
        $matricula = Matricula::factory()->create();

        try {
            $matricula->estudiante->delete();
            $this->fail('Se eliminó un estudiante con matrículas.');
        } catch (RegistroProtegidoException $e) {
            $this->assertStringContainsString('tiene matrículas registradas', $e->getMessage());
        }

        $this->assertModelExists($matricula->estudiante);
        $this->assertModelExists($matricula);
    }

    public function test_la_base_de_datos_impide_borrar_en_cascada_un_estudiante_con_matriculas(): void
    {
        $matricula = Matricula::factory()->create();

        try {
            DB::table('estudiantes')->where('id', $matricula->estudiante_id)->delete();
            $this->fail('La base de datos permitió borrar un estudiante con matrículas.');
        } catch (QueryException) {
            // RESTRICT en la clave foránea.
        }

        $this->assertModelExists($matricula);
    }

    public function test_no_elimina_una_edicion_con_matriculas(): void
    {
        $matricula = Matricula::factory()->create();

        $this->expectException(RegistroProtegidoException::class);

        $matricula->edicion->delete();
    }

    public function test_la_base_de_datos_impide_borrar_una_edicion_con_matriculas(): void
    {
        $matricula = Matricula::factory()->create();

        $this->expectException(QueryException::class);

        DB::table('ediciones')->where('id', $matricula->edicion_id)->delete();
    }

    public function test_no_elimina_un_curso_con_ediciones(): void
    {
        $edicion = Edicion::factory()->create();

        try {
            $edicion->curso->delete();
            $this->fail('Se eliminó un curso con ediciones.');
        } catch (RegistroProtegidoException) {
        }

        $this->assertModelExists($edicion->curso);

        $this->expectException(QueryException::class);
        DB::table('cursos')->where('id', $edicion->curso_id)->delete();
    }

    public function test_las_matriculas_no_se_eliminan(): void
    {
        $matricula = Matricula::factory()->create();

        $this->expectException(RegistroProtegidoException::class);

        $matricula->delete();
    }

    public function test_permite_eliminar_registros_sin_historial(): void
    {
        $estudiante = Estudiante::factory()->create();
        $curso = Curso::factory()->create();
        $edicion = Edicion::factory()->create();

        $this->assertTrue($estudiante->delete());
        $this->assertTrue($edicion->delete());
        $this->assertTrue($curso->delete());

        $this->assertModelMissing($estudiante);
        $this->assertModelMissing($edicion);
        $this->assertModelMissing($curso);
    }
}
