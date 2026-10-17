<?php

namespace Tests\Feature\Academico;

use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class BloqueoSqliteTest extends TestCase
{
    public function test_un_commit_bloqueado_revierte_y_permite_reutilizar_la_conexion_y_el_modelo(): void
    {
        $this->conBaseTemporal(function (): void {
            $estudiante = Estudiante::factory()->create();
            $edicion = Edicion::factory()->create(['cupo' => 1]);
            $lector = DB::connection('lector_robustez');
            $lector->beginTransaction();
            $lector->table('matriculas')->count();
            $matricula = new Matricula(['estudiante_id' => $estudiante->id, 'edicion_id' => $edicion->id]);

            try {
                $matricula->save();
                $this->fail('El lector debía impedir COMMIT en modo DELETE.');
            } catch (ValidationException $e) {
                $this->assertArrayHasKey('edicion_id', $e->errors());
            }

            $this->assertSame(0, DB::connection()->transactionLevel());
            $this->assertFalse(DB::connection()->getPdo()->inTransaction(), 'Quedó una escritura pendiente después del COMMIT fallido.');
            $lector->rollBack();
            $this->assertSame(0, $lector->table('matriculas')->count());
            $this->assertSame(0, Matricula::query()->count());
            $this->assertFalse($matricula->exists);
            $this->assertTrue($matricula->save());
            $this->assertSame(1, $lector->table('matriculas')->count());
        });
    }

    public function test_un_bloqueo_de_escritura_agotado_es_validacion_sin_datos_parciales(): void
    {
        $this->conBaseTemporal(function (): void {
            $estudiante = Estudiante::factory()->create();
            $edicion = Edicion::factory()->create(['cupo' => 1]);
            $otra = DB::connection('lector_robustez');
            $otra->beginTransaction();
            $otra->table('ediciones')->where('id', $edicion->id)->update(['id' => $edicion->id]);

            try {
                $edicion->matriculas()->create(['estudiante_id' => $estudiante->id]);
                $this->fail('Se ignoró el bloqueo de la otra conexión.');
            } catch (ValidationException $e) {
                $this->assertStringContainsString('Vuelva a intentarlo', $e->errors()['edicion_id'][0]);
            }

            $this->assertFalse(DB::connection()->getPdo()->inTransaction());
            $otra->rollBack();
            $this->assertSame(0, Matricula::query()->count());
            $this->assertSame(1, $edicion->fresh()->cuposDisponibles());
        });
    }

    public function test_una_instantanea_wal_obsoleta_rechaza_el_guardado_y_conserva_la_cancelacion(): void
    {
        $this->conBaseTemporal(function (): void {
            DB::statement('PRAGMA journal_mode=WAL');
            $estudiante = Estudiante::factory()->create();
            $edicion = Edicion::factory()->create(['cupo' => 1]);
            $competidora = $edicion->fresh()->setConnection('lector_robustez');

            DB::beginTransaction();
            $this->assertSame(0, Matricula::query()->count()); // Fija la instantánea externa.
            $competidora->update(['estado' => 'CANCELADA']);

            try {
                $edicion->matriculas()->create(['estudiante_id' => $estudiante->id]);
                $this->fail('Se escribió desde una instantánea WAL obsoleta.');
            } catch (ValidationException $e) {
                $this->assertStringContainsString('Vuelva a intentarlo', $e->errors()['edicion_id'][0]);
            }

            // El helper revierte su savepoint; el dueño de la transacción externa
            // conserva la responsabilidad de terminarla y empezar una lectura nueva.
            $this->assertSame(1, DB::connection()->transactionLevel());
            $this->assertTrue(DB::connection()->getPdo()->inTransaction());
            DB::rollBack();
            $this->assertSame('CANCELADA', $edicion->fresh()->estado->value);
            $this->assertSame(0, Matricula::query()->count());

            try {
                $edicion->matriculas()->create(['estudiante_id' => $estudiante->id]);
                $this->fail('Se ignoró la cancelación persistida.');
            } catch (ValidationException $e) {
                $this->assertStringContainsString('cancelada', $e->errors()['edicion_id'][0]);
            }
        });
    }

    private function conBaseTemporal(callable $prueba): void
    {
        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $raiz = storage_path('framework/testing');
        if (! is_dir($raiz)) {
            mkdir($raiz, 0777, true);
        }
        $directorio = $raiz.'/robustez-'.bin2hex(random_bytes(8));
        mkdir($directorio);
        $base = $directorio.'/prueba.sqlite';
        touch($base);
        $original = DB::getDefaultConnection();

        try {
            $configuracion = array_replace(config('database.connections.sqlite'), [
                'url' => null, 'database' => $base, 'busy_timeout' => 50,
            ]);
            config(['database.connections.robustez' => $configuracion, 'database.connections.lector_robustez' => $configuracion]);
            DB::setDefaultConnection('robustez');
            $this->assertSame(realpath($base), realpath(DB::connection()->getDatabaseName()));
            DB::statement('PRAGMA journal_mode=DELETE');
            Artisan::call('migrate', ['--database' => 'robustez', '--force' => true]);
            $prueba();
        } finally {
            foreach (['robustez', 'lector_robustez'] as $nombre) {
                $conexion = DB::connection($nombre);
                if ($conexion->getPdo()->inTransaction()) {
                    $conexion->getPdo()->rollBack();
                }
                DB::purge($nombre);
            }
            DB::setDefaultConnection($original);
            foreach (glob($directorio.'/*') as $archivo) {
                unlink($archivo);
            }
            rmdir($directorio);
        }
    }
}
