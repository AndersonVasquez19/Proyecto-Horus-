<?php

namespace Tests\Feature\Academico;

use App\Enums\EstadoEdicion;
use App\Enums\EstadoMatricula;
use App\Enums\TipoMovimientoMatricula;
use App\Exceptions\RegistroProtegidoException;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use App\Models\MatriculaMovimiento;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Tests\TestCase;

/**
 * Historial de matrículas: cada alta y cambio de estado deja una única entrada,
 * en la misma transacción que la operación (SQLite :memory:, datos ficticios).
 */
class HistorialMatriculaTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return list<array{0: string, 1: ?string, 2: string, 3: ?int, 4: ?string}>
     */
    private function historial(Matricula $matricula): array
    {
        return MatriculaMovimiento::query()->where('matricula_id', $matricula->id)->orderBy('id')->get()
            ->map(fn (MatriculaMovimiento $m): array => [$m->tipo->value, $m->estado_anterior?->value, $m->estado_nuevo->value, $m->user_id, $m->motivo])
            ->all();
    }

    public function test_una_matricula_nueva_registra_un_unico_movimiento_de_creacion(): void
    {
        $usuario = User::factory()->coordinador()->create();
        $this->actingAs($usuario);
        $edicion = Edicion::factory()->create();

        $matricula = $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]);

        $this->assertSame([['CREACION', null, 'MATRICULADO', $usuario->id, null]], $this->historial($matricula));
        $this->assertNotNull($matricula->movimientos()->first()->created_at);
    }

    public function test_sin_sesion_el_responsable_queda_vacio(): void
    {
        $matricula = Matricula::factory()->create();

        $this->assertSame([['CREACION', null, 'MATRICULADO', null, null]], $this->historial($matricula));
    }

    public function test_cada_transicion_registra_su_tipo_estados_responsable_y_motivo(): void
    {
        $usuario = User::factory()->administrador()->create();
        $this->actingAs($usuario);
        $matricula = Matricula::factory()->create();

        $matricula->update(['estado' => EstadoMatricula::Culminado]);
        $matricula->conMotivo('  Culminación   registrada por error  ')->update(['estado' => EstadoMatricula::Matriculado]);
        $matricula->conMotivo('Dejó el curso')->update(['estado' => EstadoMatricula::Retirado]);
        $matricula->update(['estado' => EstadoMatricula::Matriculado]);
        $matricula->conMotivo('Registro duplicado')->update(['estado' => EstadoMatricula::Anulado]);
        $matricula->conMotivo('   ')->update(['estado' => EstadoMatricula::Matriculado]);
        $matricula->update(['estado' => EstadoMatricula::Retirado]);
        $matricula->update(['estado' => EstadoMatricula::Anulado]);

        $u = $usuario->id;
        $this->assertSame([
            ['CREACION', null, 'MATRICULADO', $u, null],
            ['CAMBIO_ESTADO', 'MATRICULADO', 'CULMINADO', $u, null],
            ['CAMBIO_ESTADO', 'CULMINADO', 'MATRICULADO', $u, 'Culminación registrada por error'],
            ['RETIRO', 'MATRICULADO', 'RETIRADO', $u, 'Dejó el curso'],
            ['REACTIVACION', 'RETIRADO', 'MATRICULADO', $u, null],
            ['ANULACION', 'MATRICULADO', 'ANULADO', $u, 'Registro duplicado'],
            ['REACTIVACION', 'ANULADO', 'MATRICULADO', $u, null],
            ['RETIRO', 'MATRICULADO', 'RETIRADO', $u, null],
            ['ANULACION', 'RETIRADO', 'ANULADO', $u, null],
        ], $this->historial($matricula));
    }

    public function test_el_motivo_no_se_reutiliza_en_un_guardado_posterior(): void
    {
        $matricula = Matricula::factory()->create();

        $matricula->conMotivo('Solo para el retiro')->update(['estado' => EstadoMatricula::Retirado]);
        $matricula->update(['estado' => EstadoMatricula::Matriculado]);

        $this->assertSame([null, 'Solo para el retiro', null], array_column($this->historial($matricula), 4));
    }

    public function test_la_reactivacion_registra_el_cambio_solo_cuando_hay_cupo(): void
    {
        $edicion = Edicion::factory()->create(['cupo' => 1]);
        [$a, $b] = Estudiante::factory()->count(2)->create();
        $primera = $edicion->matriculas()->create(['estudiante_id' => $a->id]);
        $primera->update(['estado' => EstadoMatricula::Anulado]);
        $segunda = $edicion->matriculas()->create(['estudiante_id' => $b->id]);

        try {
            $primera->conMotivo('Sin plaza')->update(['estado' => EstadoMatricula::Matriculado]);
            $this->fail('Se reactivó sin cupo.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('estado', $e->errors());
        }
        $this->assertCount(2, $this->historial($primera));

        $segunda->update(['estado' => EstadoMatricula::Retirado]);
        $primera->conMotivo('Se liberó una plaza')->update(['estado' => EstadoMatricula::Matriculado]);

        $this->assertSame(['REACTIVACION', 'ANULADO', 'MATRICULADO', null, 'Se liberó una plaza'], $this->historial($primera)[2]);
        $this->assertSame(1, $edicion->fresh()->matriculasQueOcupanCupo());
    }

    public function test_los_intentos_invalidos_no_generan_historial(): void
    {
        $edicion = Edicion::factory()->create(['cupo' => 1]);
        $matricula = Matricula::factory()->for($edicion)->create();
        $matricula->update(['estado' => EstadoMatricula::Culminado]);
        $antes = MatriculaMovimiento::query()->count();

        $intentos = [
            'transición no permitida' => fn () => $matricula->conMotivo('No válido')->update(['estado' => EstadoMatricula::Retirado]),
            'matrícula duplicada' => fn () => $edicion->matriculas()->create(['estudiante_id' => $matricula->estudiante_id]),
            'sin cupo' => fn () => $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]),
            'nueva en otro estado' => fn () => Matricula::factory()->create(['estado' => EstadoMatricula::Anulado]),
            'motivo demasiado largo' => fn () => $matricula->conMotivo(str_repeat('a', 501))->update(['estado' => EstadoMatricula::Matriculado]),
            'objeto obsoleto' => function () use ($matricula): void {
                $obsoleta = $matricula->fresh();
                $matricula->update(['estado' => EstadoMatricula::Matriculado]);
                $matricula->update(['estado' => EstadoMatricula::Anulado]);
                $obsoleta->update(['estado' => EstadoMatricula::Retirado]);
            },
        ];

        foreach ($intentos as $caso => $intento) {
            try {
                $intento();
                $this->fail("Se aceptó: {$caso}.");
            } catch (ValidationException) {
            }
        }

        // Solo los dos cambios válidos del caso «objeto obsoleto».
        $this->assertSame($antes + 2, MatriculaMovimiento::query()->count());
        $this->assertSame(['CREACION', 'CAMBIO_ESTADO', 'CAMBIO_ESTADO', 'ANULACION'], array_column($this->historial($matricula), 0));

        $edicion->update(['estado' => EstadoEdicion::Cancelada]);
        try {
            Matricula::factory()->for($edicion)->create();
            $this->fail('Se matriculó en una edición cancelada.');
        } catch (ValidationException) {
        }
        $this->assertSame($antes + 2, MatriculaMovimiento::query()->count());
    }

    public function test_un_fallo_despues_del_insert_no_deja_matricula_ni_historial(): void
    {
        $edicion = Edicion::factory()->create();
        // Se registra después del listener del historial: el movimiento ya se insertó.
        Matricula::saved(fn () => throw new RuntimeException('Fallo de prueba después del historial'));

        try {
            $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]);
            $this->fail('No se propagó el fallo.');
        } catch (RuntimeException) {
        }

        $this->assertDatabaseCount('matriculas', 0);
        $this->assertDatabaseCount('matricula_movimientos', 0);
    }

    public function test_un_fallo_despues_del_cambio_de_estado_revierte_estado_e_historial(): void
    {
        $matricula = Matricula::factory()->create();
        Matricula::updated(fn () => throw new RuntimeException('Fallo de prueba después del UPDATE'));

        try {
            $matricula->conMotivo('No debe quedar')->update(['estado' => EstadoMatricula::Retirado]);
            $this->fail('No se propagó el fallo.');
        } catch (RuntimeException) {
        }

        $this->assertSame(EstadoMatricula::Matriculado, $matricula->fresh()->estado);
        $this->assertSame(['CREACION'], array_column($this->historial($matricula), 0));
    }

    public function test_una_transaccion_externa_revertida_no_deja_historial(): void
    {
        $matricula = Matricula::factory()->create();
        $edicion = Edicion::factory()->create();

        try {
            DB::transaction(function () use ($matricula, $edicion): void {
                $matricula->update(['estado' => EstadoMatricula::Anulado]);
                $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]);
                throw new RuntimeException('Reversión externa');
            });
        } catch (RuntimeException) {
        }

        $this->assertSame(EstadoMatricula::Matriculado, $matricula->fresh()->estado);
        $this->assertDatabaseCount('matriculas', 1);
        $this->assertSame(['CREACION'], array_column($this->historial($matricula), 0));
        $this->assertDatabaseCount('matricula_movimientos', 1);
    }

    public function test_editar_otros_datos_no_crea_ni_altera_el_historial(): void
    {
        $matricula = Matricula::factory()->create();
        $matricula->conMotivo('Motivo original')->update(['estado' => EstadoMatricula::Retirado]);
        $antes = DB::table('matricula_movimientos')->orderBy('id')->get()->all();

        $matricula->conMotivo('Se descarta: no cambia el estado')->update(['observaciones' => 'Nueva observación', 'fecha_matricula' => '2026-03-01']);
        $matricula->update(['estado' => EstadoMatricula::Retirado]);
        $matricula->estudiante->update(['nombres' => 'Nombre corregido']);
        $matricula->edicion->update(['nombre' => 'Edición renombrada']);

        $this->assertEquals($antes, DB::table('matricula_movimientos')->orderBy('id')->get()->all());
        $this->assertSame('Nueva observación', $matricula->fresh()->observaciones);
    }

    public function test_los_movimientos_no_se_editan_ni_eliminan(): void
    {
        $movimiento = Matricula::factory()->create()->movimientos()->sole();
        $antes = (array) DB::table('matricula_movimientos')->find($movimiento->id);

        foreach ([
            fn () => $movimiento->forceFill(['motivo' => 'Alterado'])->save(),
            fn () => $movimiento->delete(),
            fn () => MatriculaMovimiento::destroy($movimiento->id),
        ] as $operacion) {
            try {
                $operacion();
                $this->fail('Se alteró el historial.');
            } catch (RegistroProtegidoException) {
            }
        }

        $this->assertSame($antes, (array) DB::table('matricula_movimientos')->find($movimiento->id));
        // Sin asignación masiva: nadie puede crear movimientos con datos de un formulario.
        $this->assertSame([], (new MatriculaMovimiento)->getFillable());
        $this->assertFalse((new MatriculaMovimiento)->isFillable('motivo'));
    }

    public function test_la_base_rechaza_movimientos_incoherentes_y_borrados_en_cascada(): void
    {
        $matricula = Matricula::factory()->create();
        $base = ['matricula_id' => $matricula->id, 'created_at' => now()];

        foreach ([
            ['tipo' => 'BORRADO', 'estado_anterior' => 'MATRICULADO', 'estado_nuevo' => 'ANULADO'],
            ['tipo' => 'CREACION', 'estado_anterior' => 'ANULADO', 'estado_nuevo' => 'MATRICULADO'],
            ['tipo' => 'CREACION', 'estado_anterior' => null, 'estado_nuevo' => 'ANULADO'],
            ['tipo' => 'RETIRO', 'estado_anterior' => null, 'estado_nuevo' => 'RETIRADO'],
            ['tipo' => 'RETIRO', 'estado_anterior' => 'RETIRADO', 'estado_nuevo' => 'RETIRADO'],
            ['tipo' => 'RETIRO', 'estado_anterior' => 'MATRICULADO', 'estado_nuevo' => 'PAGADO'],
        ] as $fila) {
            try {
                DB::table('matricula_movimientos')->insert($base + $fila);
                $this->fail('La base aceptó un movimiento incoherente: '.json_encode($fila));
            } catch (QueryException) {
            }
        }

        $this->expectException(QueryException::class);
        DB::table('matriculas')->where('id', $matricula->id)->delete();
    }

    public function test_sin_la_tabla_de_historial_la_operacion_se_rechaza_sin_cambios(): void
    {
        $matricula = Matricula::factory()->create();
        $edicion = Edicion::factory()->create();
        // Simula una base sin migrar, solo dentro de SQLite :memory:.
        $migracion = require database_path('migrations/2026_10_17_200000_create_matricula_movimientos_table.php');
        $migracion->down();

        foreach ([
            'edicion_id' => fn () => $edicion->matriculas()->create(['estudiante_id' => Estudiante::factory()->create()->id]),
            'estado' => fn () => $matricula->update(['estado' => EstadoMatricula::Retirado]),
        ] as $campo => $operacion) {
            try {
                $operacion();
                $this->fail('Se guardó una matrícula sin historial.');
            } catch (ValidationException $e) {
                $this->assertStringContainsString('historial de matrículas aún no está activado', $e->errors()[$campo][0]);
            }
        }

        $this->assertDatabaseCount('matriculas', 1);
        $this->assertSame(EstadoMatricula::Matriculado, $matricula->fresh()->estado);
        // La instancia rechazada conserva el estado intentado; se edita una recién cargada.
        $matricula->fresh()->update(['observaciones' => 'Editar otros datos sigue permitido']);
        $this->assertSame('Editar otros datos sigue permitido', $matricula->fresh()->observaciones);
        $migracion->up();
    }

    public function test_la_migracion_es_aditiva_y_no_inventa_historial_de_matriculas_existentes(): void
    {
        $migracion = require database_path('migrations/2026_10_17_200000_create_matricula_movimientos_table.php');
        $migracion->down();
        // Matrículas «antiguas» registradas antes de existir el historial.
        $edicion = Edicion::factory()->create(['cupo' => null]);
        foreach (Estudiante::factory()->count(2)->create() as $i => $estudiante) {
            DB::table('matriculas')->insert([
                'estudiante_id' => $estudiante->id, 'edicion_id' => $edicion->id,
                'estado' => $i === 0 ? 'MATRICULADO' : 'ANULADO', 'observaciones' => 'Antigua',
                'created_at' => '2026-01-10 10:00:00', 'updated_at' => '2026-02-10 10:00:00',
            ]);
        }
        $antes = DB::table('matriculas')->orderBy('id')->get()->all();

        $migracion->up();

        $this->assertEquals($antes, DB::table('matriculas')->orderBy('id')->get()->all());
        $this->assertDatabaseCount('matricula_movimientos', 0);

        // Desde la activación, un cambio sobre una matrícula antigua sí se registra.
        $antigua = Matricula::query()->where('estado', 'ANULADO')->sole();
        $antigua->update(['estado' => EstadoMatricula::Matriculado]);
        $this->assertSame([['REACTIVACION', 'ANULADO', 'MATRICULADO', null, null]], $this->historial($antigua));
    }

    public function test_el_tipo_de_movimiento_se_deduce_de_la_transicion(): void
    {
        $e = EstadoMatricula::class;
        $this->assertSame(TipoMovimientoMatricula::CambioEstado, TipoMovimientoMatricula::paraCambio($e::Matriculado, $e::Culminado));
        $this->assertSame(TipoMovimientoMatricula::CambioEstado, TipoMovimientoMatricula::paraCambio($e::Culminado, $e::Matriculado));
        $this->assertSame(TipoMovimientoMatricula::Retiro, TipoMovimientoMatricula::paraCambio($e::Matriculado, $e::Retirado));
        $this->assertSame(TipoMovimientoMatricula::Anulacion, TipoMovimientoMatricula::paraCambio($e::Retirado, $e::Anulado));
        $this->assertSame(TipoMovimientoMatricula::Reactivacion, TipoMovimientoMatricula::paraCambio($e::Retirado, $e::Matriculado));
        $this->assertSame(TipoMovimientoMatricula::Reactivacion, TipoMovimientoMatricula::paraCambio($e::Anulado, $e::Matriculado));
    }
}
