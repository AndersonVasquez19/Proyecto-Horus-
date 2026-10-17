<?php

namespace Tests\Feature\Academico;

use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class ConcurrenciaDisponibilidadTest extends TestCase
{
    public static function carreras(): iterable
    {
        foreach (['DELETE', 'WAL'] as $journal) {
            foreach ([
                'ultima_plaza' => ['crear', 'crear', 1, 'cupo'],
                'reactivar_ultima_plaza' => ['reactivar', 'crear', 1, 'cupo'],
                'matricula_antes_reactivacion' => ['crear', 'reactivar', 1, 'cupo'],
                'cancelacion_antes_reactivacion' => ['cancelar', 'reactivar', 0, 'cancelada'],
                'reactivacion_antes_cancelacion' => ['reactivar', 'cancelar', 1, 'vigente'],
                'cancelacion_primero' => ['cancelar', 'crear', 0, 'cancelada'],
                'matricula_antes_cancelacion' => ['crear', 'cancelar', 1, 'vigente'],
                'reduccion_primero' => ['reducir', 'crear', 1, 'cupo'],
                'matricula_antes_reduccion' => ['crear', 'reducir', 2, 'cupo'],
                'duplicado' => ['crear', 'crear_duplicada', 1, 'ya está matriculado'],
            ] as $nombre => [$primero, $segundo, $ocupacion, $mensaje]) {
                yield $journal.'_'.$nombre => [$journal, $primero, $segundo, $ocupacion, $mensaje];
            }
        }
    }

    #[DataProvider('carreras')]
    public function test_serializa_operaciones_con_conexiones_y_procesos_independientes(
        string $journal, string $primero, string $segundo, int $ocupacion, string $mensaje,
    ): void {
        // Se mantiene intacta la salvaguarda del TestCase: al arrancar solo :memory:.
        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $raiz = storage_path('framework/testing');
        if (! is_dir($raiz)) {
            mkdir($raiz, 0777, true);
        }
        $directorio = $raiz.'/robustez-'.bin2hex(random_bytes(8));
        mkdir($directorio);
        $base = $directorio.'/prueba.sqlite';
        touch($base);
        $procesos = [];
        $conexionOriginal = DB::getDefaultConnection();

        try {
            config(['database.connections.robustez' => array_replace(config('database.connections.sqlite'), [
                'url' => null, 'database' => $base, 'busy_timeout' => 5000,
            ])]);
            DB::setDefaultConnection('robustez');
            $this->assertSame(realpath($base), realpath(DB::connection()->getDatabaseName()));
            DB::statement('PRAGMA journal_mode='.$journal);
            $this->assertSame(strtolower($journal), DB::selectOne('PRAGMA journal_mode')->journal_mode);
            Artisan::call('migrate', ['--database' => 'robustez', '--force' => true]);
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

            foreach (['primero', 'segundo'] as $turno) {
                $proceso = new Process([PHP_BINARY, base_path('tests/Support/disponibilidad-worker.php'), $directorio, $turno], base_path(), [
                    'APP_ENV' => 'testing', 'DB_URL' => '', 'DB_CONNECTION' => 'sqlite', 'DB_DATABASE' => $base,
                    'APP_CONFIG_CACHE' => $directorio.'/sin-config-cache.php',
                ]);
                $proceso->setTimeout(20);
                $proceso->start();
                $procesos[] = $proceso;
            }
            $this->esperar($directorio.'/primero.listo', $procesos);
            $this->esperar($directorio.'/segundo.listo', $procesos);
            touch($directorio.'/primero.iniciar');
            $this->esperar($directorio.'/primero.validado', $procesos);
            touch($directorio.'/segundo.iniciar');
            $this->esperar($directorio.'/segundo.intentando', $procesos);
            // Ventana deliberada de contención: el primero mantiene el bloqueo.
            usleep(200000);
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
            $this->assertSame(3, Estudiante::query()->count());
        } finally {
            touch($directorio.'/liberar');
            foreach ($procesos as $proceso) {
                if ($proceso->isRunning()) {
                    $proceso->stop(1);
                }
            }
            DB::purge('robustez');
            DB::setDefaultConnection($conexionOriginal);
            // Solo archivos de este directorio aleatorio recién creado, nunca bases habituales.
            foreach (glob($directorio.'/*') as $archivo) {
                unlink($archivo);
            }
            rmdir($directorio);
        }
    }

    private function esperar(string $archivo, array $procesos): void
    {
        $limite = microtime(true) + 10;
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
