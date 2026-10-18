<?php

namespace Tests\Feature\Importacion;

use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\ImportacionAcademica;
use App\Models\Matricula;
use App\Models\User;
use App\Support\ImportacionAcademica\AlmacenImportaciones;
use App\Support\ImportacionAcademica\AnalizadorImportacion;
use App\Support\ImportacionAcademica\LectorArchivo;
use App\Support\ImportacionAcademica\OpcionesImportacion;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Process\Process;
use Tests\TestCase;

/**
 * Carreras reales entre procesos y conexiones independientes sobre una SQLite
 * temporal (nunca la base habitual): la importación respeta el mismo bloqueo de
 * disponibilidad que las matrículas manuales y no se confirma dos veces.
 */
class ConcurrenciaImportacionTest extends TestCase
{
    private const CSV = "DNI;Apellidos;Nombres\n70000001;Prueba Ficticia;Ana\n70000002;Otra Prueba;Luis\n";

    public static function carreras(): iterable
    {
        foreach (['DELETE', 'WAL'] as $journal) {
            yield $journal.'_matricula_manual_durante_la_confirmacion' => [$journal, 'manual_primero'];
            yield $journal.'_matricula_manual_tras_la_importacion' => [$journal, 'importacion_primero'];
            yield $journal.'_doble_confirmacion_simultanea' => [$journal, 'doble_confirmacion'];
        }
    }

    #[DataProvider('carreras')]
    public function test_la_importacion_se_serializa_con_otras_escrituras(string $journal, string $carrera): void
    {
        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $raiz = storage_path('framework/testing');
        if (! is_dir($raiz)) {
            mkdir($raiz, 0777, true);
        }
        $directorio = $raiz.'/importacion-concurrencia-'.bin2hex(random_bytes(8));
        mkdir($directorio);
        mkdir($directorio.'/almacen');
        $base = $directorio.'/prueba.sqlite';
        touch($base);
        $procesos = [];
        $conexionOriginal = DB::getDefaultConnection();

        try {
            config(['database.connections.concurrencia' => array_replace(config('database.connections.sqlite'), [
                'url' => null, 'database' => $base, 'busy_timeout' => 5000,
            ])]);
            config(['filesystems.disks.local.root' => $directorio.'/almacen']);
            Storage::forgetDisk('local');
            DB::setDefaultConnection('concurrencia');
            $this->assertSame(realpath($base), realpath(DB::connection()->getDatabaseName()));
            DB::statement('PRAGMA journal_mode='.$journal);
            Artisan::call('migrate', ['--database' => 'concurrencia', '--force' => true]);

            $usuario = User::factory()->administrador()->create();
            $this->actingAs($usuario);
            $edicion = Edicion::factory()->for(Curso::factory()->create(['nombre' => 'Inmunizaciones']))->create(['nombre' => '2024', 'cupo' => 2]);
            $manual = Estudiante::factory()->create(['numero_documento' => '70000099']);

            // Vista previa en esta conexión: dos plazas libres, dos filas válidas.
            $almacen = app(AlmacenImportaciones::class);
            file_put_contents($directorio.'/lista.csv', self::CSV);
            $archivo = $almacen->guardar($directorio.'/lista.csv', 'lista.csv');
            $plan = app(AnalizadorImportacion::class)->analizar(
                app(LectorArchivo::class)->leer($almacen->ruta($archivo->token, 'csv'), 'csv'),
                new OpcionesImportacion(edicionDestinoId: $edicion->id),
            );
            $this->assertSame(2, $plan->operaciones());

            [$primero, $segundo, $pausa] = match ($carrera) {
                'manual_primero' => ['manual', 'importacion', 'manual'],
                'importacion_primero' => ['importacion', 'manual', 'importacion'],
                'doble_confirmacion' => ['importacion', 'importacion2', 'importacion'],
            };

            file_put_contents($directorio.'/escenario.json', json_encode([
                'usuario' => $usuario->id,
                'edicion' => $edicion->id,
                'estudiante_manual' => $manual->id,
                'token' => $archivo->token,
                'sha256' => $archivo->sha256,
                'huella' => $plan->huella,
                'pausa' => $pausa,
            ], JSON_THROW_ON_ERROR));

            foreach ([$primero, $segundo] as $turno) {
                $proceso = new Process([PHP_BINARY, base_path('tests/Support/importacion-worker.php'), $directorio, $turno], base_path(), [
                    'APP_ENV' => 'testing', 'DB_URL' => '', 'DB_CONNECTION' => 'sqlite', 'DB_DATABASE' => $base,
                    'APP_CONFIG_CACHE' => $directorio.'/sin-config-cache.php',
                ]);
                $proceso->setTimeout(30);
                $proceso->start();
                $procesos[] = $proceso;
            }

            $this->esperar($directorio.'/'.$primero.'.listo', $procesos);
            $this->esperar($directorio.'/'.$segundo.'.listo', $procesos);
            touch($directorio.'/'.$primero.'.iniciar');
            // El primero queda dentro de su transacción, con la escritura reservada.
            $this->esperar($directorio.'/'.$primero.'.validado', $procesos);
            touch($directorio.'/'.$segundo.'.iniciar');
            $this->esperar($directorio.'/'.$segundo.'.intentando', $procesos);
            // Ventana deliberada de contención: el segundo no puede avanzar mientras tanto.
            usleep(300000);
            clearstatcache();
            $this->assertFileDoesNotExist($directorio.'/'.$segundo.'.validado', 'El segundo avanzó mientras el primero mantenía el bloqueo.');
            $this->assertFileDoesNotExist($directorio.'/'.$segundo.'.resultado.json', 'El segundo terminó mientras el primero mantenía el bloqueo.');
            touch($directorio.'/liberar');

            foreach ($procesos as $proceso) {
                $this->assertSame(0, $proceso->wait(), $proceso->getErrorOutput().$proceso->getOutput());
            }

            $resultados = [];
            foreach ([$primero, $segundo] as $turno) {
                $resultados[$turno] = json_decode(file_get_contents($directorio.'/'.$turno.'.resultado.json'), true, flags: JSON_THROW_ON_ERROR);
            }

            $this->assertSame('ok', $resultados[$primero]['resultado'], json_encode($resultados, JSON_UNESCAPED_UNICODE));
            $vigentes = $edicion->fresh()->matriculasQueOcupanCupo();
            $this->assertLessThanOrEqual(2, $vigentes, 'Nunca se supera el cupo.');

            match ($carrera) {
                'manual_primero' => $this->comprobarManualPrimero($resultados['importacion'], $edicion),
                'importacion_primero' => $this->comprobarImportacionPrimero($resultados['manual'], $edicion),
                'doble_confirmacion' => $this->comprobarDobleConfirmacion($resultados['importacion2'], $edicion),
            };

            // Historial: una creación por matrícula y ningún movimiento de la operación rechazada.
            $this->assertSame(Matricula::query()->count(), DB::table('matricula_movimientos')->where('tipo', 'CREACION')->count());
            $this->assertSame(Matricula::query()->count(), DB::table('matricula_movimientos')->count());
        } finally {
            touch($directorio.'/liberar');
            foreach ($procesos as $proceso) {
                if ($proceso->isRunning()) {
                    $proceso->stop(1);
                }
            }
            DB::purge('concurrencia');
            DB::setDefaultConnection($conexionOriginal);
            Storage::forgetDisk('local');
            // Solo archivos de este directorio aleatorio recién creado, nunca bases habituales.
            foreach (array_merge(glob($directorio.'/almacen/*/*') ?: [], glob($directorio.'/almacen/*') ?: [], glob($directorio.'/*') ?: []) as $ruta) {
                is_dir($ruta) ? @rmdir($ruta) : @unlink($ruta);
            }
            @rmdir($directorio.'/almacen');
            rmdir($directorio);
        }
    }

    /**
     * La matrícula manual ocupó una plaza antes: la importación revalida bajo el bloqueo,
     * detecta el cambio y no importa nada.
     *
     * @param  array<string, mixed>  $importacion
     */
    private function comprobarManualPrimero(array $importacion, Edicion $edicion): void
    {
        $this->assertSame('rechazada', $importacion['resultado'], json_encode($importacion, JSON_UNESCAPED_UNICODE));
        $this->assertStringContainsString('No se importó nada', $importacion['mensaje']);
        $this->assertSame(0, ImportacionAcademica::query()->count());
        $this->assertSame(1, Estudiante::query()->count(), 'Ningún estudiante del archivo quedó registrado.');
        $this->assertSame(1, $edicion->fresh()->matriculasQueOcupanCupo());
    }

    /**
     * La importación llenó el cupo y confirmó primero: la matrícula manual espera y se rechaza.
     *
     * @param  array<string, mixed>  $manual
     */
    private function comprobarImportacionPrimero(array $manual, Edicion $edicion): void
    {
        $this->assertSame('validacion', $manual['resultado'], json_encode($manual, JSON_UNESCAPED_UNICODE));
        $this->assertStringContainsString('cupo', $manual['mensaje']);
        $this->assertSame(1, ImportacionAcademica::query()->count());
        $this->assertSame(2, $edicion->fresh()->matriculasQueOcupanCupo());
        $this->assertSame(3, Estudiante::query()->count());
    }

    /**
     * Dos confirmaciones simultáneas de la misma vista previa: solo una importa.
     *
     * @param  array<string, mixed>  $segunda
     */
    private function comprobarDobleConfirmacion(array $segunda, Edicion $edicion): void
    {
        $this->assertSame('rechazada', $segunda['resultado'], json_encode($segunda, JSON_UNESCAPED_UNICODE));
        $this->assertMatchesRegularExpression('/ya fue confirmada|ya no está disponible|ya se importó/', $segunda['mensaje']);
        $this->assertSame(1, ImportacionAcademica::query()->count());
        $this->assertSame(2, $edicion->fresh()->matriculasQueOcupanCupo());
        $this->assertSame(3, Estudiante::query()->count());
    }

    private function esperar(string $archivo, array $procesos): void
    {
        $limite = microtime(true) + 15;
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
