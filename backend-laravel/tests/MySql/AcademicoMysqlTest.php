<?php

namespace Tests\MySql;

use App\Enums\EstadoMatricula;
use App\Exceptions\RegistroProtegidoException;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Reglas académicas (cupos, historial, transiciones y protecciones) ejecutadas
 * con InnoDB real. DatabaseTruncation: los datos se confirman de verdad, como en
 * producción, y una segunda conexión puede verlos.
 */
class AcademicoMysqlTest extends MysqlTestCase
{
    use DatabaseTruncation;

    protected function tearDown(): void
    {
        DB::purge('mysql_b');
        parent::tearDown();
    }

    public function test_cupo_historial_y_transiciones_en_innodb(): void
    {
        $edicion = Edicion::factory()->create(['cupo' => 1]);
        [$a, $b] = Estudiante::factory()->count(2)->create();

        $matricula = Matricula::create(['estudiante_id' => $a->id, 'edicion_id' => $edicion->id]);
        $this->assertDatabaseHas('matricula_movimientos', ['matricula_id' => $matricula->id, 'tipo' => 'CREACION', 'estado_nuevo' => 'MATRICULADO']);

        $this->assertValidacion(fn () => Matricula::create(['estudiante_id' => $b->id, 'edicion_id' => $edicion->id]), 'alcanzó su cupo');
        $this->assertValidacion(fn () => Matricula::create(['estudiante_id' => $a->id, 'edicion_id' => $edicion->id]), 'ya está matriculado');

        $matricula->conMotivo('Registro duplicado')->update(['estado' => EstadoMatricula::Anulado]);
        $this->assertDatabaseHas('matricula_movimientos', ['matricula_id' => $matricula->id, 'tipo' => 'ANULACION', 'motivo' => 'Registro duplicado']);

        // La plaza liberada la ocupa otro estudiante: la reactivación ya no cabe.
        $otra = Matricula::create(['estudiante_id' => $b->id, 'edicion_id' => $edicion->id]);
        $this->assertValidacion(fn () => $matricula->fresh()->update(['estado' => EstadoMatricula::Matriculado]), 'alcanzó su cupo');

        $otra->update(['estado' => EstadoMatricula::Retirado]);
        $this->assertValidacion(fn () => $otra->fresh()->update(['estado' => EstadoMatricula::Culminado]), 'No se puede pasar');

        $this->assertSame(0, $edicion->fresh()->matriculasQueOcupanCupo());
        $this->assertSame(['CREACION', 'ANULACION', 'CREACION', 'RETIRO'], DB::table('matricula_movimientos')->orderBy('id')->pluck('tipo')->all());
    }

    public function test_una_transaccion_externa_con_instantanea_antigua_no_supera_el_cupo(): void
    {
        $edicion = Edicion::factory()->create(['cupo' => 1]);
        [$a, $b] = Estudiante::factory()->count(2)->create();
        config(['database.connections.mysql_b' => config('database.connections.mysql')]);

        try {
            DB::transaction(function () use ($edicion, $a, $b): void {
                // Primera lectura consistente: fija la instantánea REPEATABLE READ.
                $this->assertSame(0, Matricula::query()->count());
                DB::connection('mysql_b')->table('matriculas')->insert(['estudiante_id' => $a->id, 'edicion_id' => $edicion->id, 'estado' => 'MATRICULADO']);
                $this->assertSame(0, Matricula::query()->count(), 'La instantánea debía ser antigua para que la prueba tenga sentido.');

                Matricula::create(['estudiante_id' => $b->id, 'edicion_id' => $edicion->id]);
            });
            $this->fail('Se superó el cupo con una instantánea antigua.');
        } catch (ValidationException $e) {
            $this->assertStringContainsString('alcanzó su cupo', implode(' ', $e->validator->errors()->all()));
        }

        $this->assertSame(1, Matricula::query()->count());
    }

    public function test_el_duplicado_detectado_por_el_indice_unico_se_traduce_al_mensaje_de_dominio(): void
    {
        $edicion = Edicion::factory()->create();
        $estudiante = Estudiante::factory()->create();
        config(['database.connections.mysql_b' => config('database.connections.mysql')]);

        try {
            DB::transaction(function () use ($edicion, $estudiante): void {
                $this->assertFalse(Matricula::query()->where('estudiante_id', $estudiante->id)->exists());
                DB::connection('mysql_b')->table('matriculas')->insert(['estudiante_id' => $estudiante->id, 'edicion_id' => $edicion->id, 'estado' => 'MATRICULADO']);
                // La comprobación previa no lo ve (instantánea antigua): debe responder el índice UNIQUE.
                Matricula::create(['estudiante_id' => $estudiante->id, 'edicion_id' => $edicion->id]);
            });
            $this->fail('Se registró una matrícula duplicada.');
        } catch (ValidationException $e) {
            $this->assertSame(['edicion_id' => ['El estudiante ya está matriculado en esta edición.']], $e->errors());
        }

        $this->assertSame(1, Matricula::query()->count());
        $this->assertSame(0, DB::table('matricula_movimientos')->count());
    }

    public function test_reglas_de_ediciones_y_protecciones_del_historial(): void
    {
        $edicion = Edicion::factory()->create(['cupo' => 3, 'fecha_inicio' => '2026-11-02', 'fecha_fin' => '2026-12-15']);
        $matriculas = Estudiante::factory()->count(2)->create()
            ->map(fn (Estudiante $e) => Matricula::create(['estudiante_id' => $e->id, 'edicion_id' => $edicion->id]));

        $this->assertValidacion(fn () => $edicion->fresh()->update(['cupo' => 1]), 'no puede ser menor');
        $this->assertValidacion(fn () => $edicion->fresh()->update(['estado' => 'CANCELADA']), 'No se puede cancelar');
        $this->assertValidacion(fn () => $edicion->fresh()->update(['fecha_fin' => '2026-10-01']), 'fecha de fin');

        foreach ([fn () => $edicion->curso->delete(), fn () => $matriculas->first()->delete()] as $borrar) {
            try {
                $borrar();
                $this->fail('Se eliminó un registro protegido.');
            } catch (RegistroProtegidoException) {
                // Esperado: el historial se conserva.
            }
        }

        $this->assertSame(1, Curso::query()->count());
        $this->assertSame(2, Matricula::query()->count());

        try {
            DB::table('ediciones')->where('id', $edicion->id)->update(['fecha_fin' => '2026-01-01']);
            $this->fail('El CHECK de fechas no actuó.');
        } catch (QueryException $e) {
            $this->assertSame(3819, $e->errorInfo[1]);
        }

        $this->assertSame('2026-11-02', $edicion->fresh()->fecha_inicio->toDateString());
    }

    public function test_fechas_y_marcas_de_tiempo_se_guardan_en_utc(): void
    {
        $this->travelTo(now()->setTime(10, 15, 30));
        $usuario = User::factory()->administrador()->create();
        $this->actingAs($usuario);
        $matricula = Matricula::create(['estudiante_id' => Estudiante::factory()->create()->id, 'edicion_id' => Edicion::factory()->create()->id, 'fecha_matricula' => '2026-10-18']);

        $fila = DB::table('matriculas')->where('id', $matricula->id)->first();
        $this->assertSame('2026-10-18', $fila->fecha_matricula);
        $this->assertSame(now()->format('Y-m-d H:i:s'), $fila->created_at);

        $movimiento = DB::table('matricula_movimientos')->where('matricula_id', $matricula->id)->first();
        $this->assertSame($usuario->id, $movimiento->user_id);
        $this->assertSame(now()->format('Y-m-d H:i:s'), $movimiento->created_at);
        $this->travelBack();

        // El valor por defecto CURRENT_TIMESTAMP (escrituras sin Eloquent) también queda en UTC.
        $this->assertEqualsWithDelta(time(), strtotime(DB::selectOne('SELECT CURRENT_TIMESTAMP AS t')->t.' UTC'), 120);
    }

    private function assertValidacion(callable $operacion, string $fragmento): void
    {
        try {
            $operacion();
            $this->fail("Se esperaba un rechazo: {$fragmento}");
        } catch (ValidationException $e) {
            $this->assertStringContainsString($fragmento, implode(' ', $e->validator->errors()->all()));
        }
    }
}
