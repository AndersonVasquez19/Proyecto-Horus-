<?php

namespace Tests\MySql;

use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Process\Process;

/**
 * Las mismas carreras que ConcurrenciaDisponibilidadTest (SQLite), con dos procesos
 * PHP y dos conexiones InnoDB reales: el segundo no puede validar disponibilidad
 * mientras el primero mantiene el bloqueo de la edición.
 */
class ConcurrenciaMysqlTest extends MysqlTestCase
{
    use DatabaseTruncation;

    public static function carreras(): iterable
    {
        yield 'ultima_plaza' => ['crear', 'crear', 1, 'cupo'];
        yield 'reactivar_ultima_plaza' => ['reactivar', 'crear', 1, 'cupo'];
        yield 'matricula_antes_reactivacion' => ['crear', 'reactivar', 1, 'cupo'];
        yield 'cancelacion_antes_reactivacion' => ['cancelar', 'reactivar', 0, 'cancelada'];
        yield 'reactivacion_antes_cancelacion' => ['reactivar', 'cancelar', 1, 'vigente'];
        yield 'cancelacion_primero' => ['cancelar', 'crear', 0, 'cancelada'];
        yield 'matricula_antes_cancelacion' => ['crear', 'cancelar', 1, 'vigente'];
        yield 'reduccion_primero' => ['reducir', 'crear', 1, 'cupo'];
        yield 'matricula_antes_reduccion' => ['crear', 'reducir', 2, 'cupo'];
        yield 'duplicado' => ['crear', 'crear_duplicada', 1, 'ya está matriculado'];
    }

    #[DataProvider('carreras')]
    public function test_serializa_operaciones_entre_procesos_con_innodb(string $primero, string $segundo, int $ocupacion, string $mensaje): void
    {
        $raiz = storage_path('framework/testing');
        if (! is_dir($raiz)) {
            mkdir($raiz, 0777, true);
        }
        $directorio = $raiz.'/carrera-mysql-'.bin2hex(random_bytes(8));
        mkdir($directorio);
        $procesos = [];

        try {
            $edicion = Edicion::factory()->create(['cupo' => $segundo === 'crear_duplicada' ? null : (in_array('reducir', [$primero, $segundo]) ? 2 : 1)]);
            $estudiantes = Estudiante::factory()->count(3)->create();
            if (in_array('reducir', [$primero, $segundo])) {
                $edicion->matriculas()->create(['estudiante_id' => $estudiantes[2]->id]);
            }
            $reactivable = null;
            if (in_array('reactivar', [$primero, $segundo])) {
                $reactivable = $edicion->matriculas()->create(['estudiante_id' => $estudiantes[2]->id]);
                $reactivable->update(['estado' => 'ANULADO']);
            }
            file_put_contents($directorio.'/escenario.json', json_encode([
                'edicion' => $edicion->id,
                'primero' => ['tipo' => $primero, 'estudiante' => $estudiantes[0]->id, 'matricula' => $reactivable?->id],
                'segundo' => ['tipo' => $segundo === 'crear_duplicada' ? 'crear' : $segundo,
                    'matricula' => $reactivable?->id,
                    'estudiante' => $estudiantes[$segundo === 'crear_duplicada' ? 0 : 1]->id],
            ], JSON_THROW_ON_ERROR));

            $conexion = config('database.connections.mysql');
            foreach (['primero', 'segundo'] as $turno) {
                $proceso = new Process([PHP_BINARY, base_path('tests/MySql/Support/disponibilidad-worker-mysql.php'), $directorio, $turno], base_path(), [
                    'APP_ENV' => 'testing', 'APP_KEY' => config('app.key'), 'DB_URL' => '', 'DB_CONNECTION' => 'mysql',
                    'DB_HOST' => $conexion['host'], 'DB_PORT' => (string) $conexion['port'], 'DB_USERNAME' => $conexion['username'],
                    'DB_PASSWORD' => $conexion['password'], 'DB_DATABASE' => $conexion['database'], 'DB_TIMEZONE' => '+00:00',
                    'HORUS_MYSQL_IT_DATABASE' => getenv('HORUS_MYSQL_IT_DATABASE'),
                    'CACHE_STORE' => 'array', 'SESSION_DRIVER' => 'array', 'LOG_CHANNEL' => '"null"',
                    'APP_CONFIG_CACHE' => $directorio.'/sin-config-cache.php',
                ]);
                $proceso->setTimeout(40);
                $proceso->start();
                $procesos[] = $proceso;
            }
            $this->esperar($directorio.'/primero.listo', $procesos);
            $this->esperar($directorio.'/segundo.listo', $procesos);
            touch($directorio.'/primero.iniciar');
            $this->esperar($directorio.'/primero.validado', $procesos);
            touch($directorio.'/segundo.iniciar');
            $this->esperar($directorio.'/segundo.intentando', $procesos);
            // Ventana deliberada de contención: el primero mantiene el bloqueo FOR UPDATE.
            usleep(400000);
            clearstatcache();
            $this->assertFileDoesNotExist($directorio.'/segundo.validado', 'El segundo validó disponibilidad mientras el primero todavía la estaba modificando.');
            touch($directorio.'/liberar');

            foreach ($procesos as $proceso) {
                $this->assertSame(0, $proceso->wait(), $proceso->getErrorOutput().$proceso->getOutput());
            }
            $a = json_decode(file_get_contents($directorio.'/primero.resultado.json'), true, flags: JSON_THROW_ON_ERROR);
            $b = json_decode(file_get_contents($directorio.'/segundo.resultado.json'), true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame('ok', $a['resultado'], json_encode($a));
            $this->assertSame('validacion', $b['resultado'], json_encode($b));
            $this->assertStringContainsString($mensaje, implode(' ', array_merge(...array_values($b['errores']))));

            $actual = $edicion->fresh();
            $this->assertSame($ocupacion, $actual->matriculasQueOcupanCupo());
            $this->assertSame($primero === 'cancelar' ? 'CANCELADA' : 'PLANIFICADA', $actual->estado->value);
            $this->assertSame($primero === 'reducir' ? 1 : $edicion->cupo, $actual->cupo);
            $this->assertSame($ocupacion + ($segundo === 'reactivar' ? 1 : 0), Matricula::query()->count());

            $movimientos = DB::table('matricula_movimientos')->get();
            $matriculas = Matricula::query()->count();
            $reactivada = $primero === 'reactivar' ? 1 : 0;
            $this->assertSame($matriculas, $movimientos->where('tipo', 'CREACION')->unique('matricula_id')->count());
            $this->assertSame($reactivable ? 1 : 0, $movimientos->where('tipo', 'ANULACION')->count());
            $this->assertSame($reactivada, $movimientos->where('tipo', 'REACTIVACION')->count());
            $this->assertSame($matriculas + ($reactivable ? 1 : 0) + $reactivada, $movimientos->count());
        } finally {
            touch($directorio.'/liberar');
            foreach ($procesos as $proceso) {
                if ($proceso->isRunning()) {
                    $proceso->stop(1);
                }
            }
            // Solo archivos de este directorio aleatorio recién creado.
            foreach (glob($directorio.'/*') as $archivo) {
                unlink($archivo);
            }
            rmdir($directorio);
        }
    }

    private function esperar(string $archivo, array $procesos): void
    {
        $limite = microtime(true) + 20;
        while (! is_file($archivo)) {
            foreach ($procesos as $proceso) {
                if (! $proceso->isRunning()) {
                    $this->fail('El proceso terminó antes de la barrera: '.$proceso->getErrorOutput().$proceso->getOutput());
                }
            }
            if (microtime(true) > $limite) {
                $this->fail('Tiempo agotado esperando '.basename($archivo));
            }
            usleep(10000);
            clearstatcache(true, $archivo);
        }
    }
}
