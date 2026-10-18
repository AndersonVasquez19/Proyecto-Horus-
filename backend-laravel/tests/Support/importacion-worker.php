<?php

// Proceso exclusivo de las pruebas de concurrencia de la importación. Solo acepta
// una base SQLite temporal y un almacén dentro de su directorio aleatorio.
use App\Models\ImportacionAcademica;
use App\Models\Matricula;
use App\Models\User;
use App\Support\ImportacionAcademica\ArchivoPreparado;
use App\Support\ImportacionAcademica\EjecutorImportacion;
use App\Support\ImportacionAcademica\ImportacionRechazadaException;
use App\Support\ImportacionAcademica\OpcionesImportacion;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Validation\ValidationException;

require __DIR__.'/../../vendor/autoload.php';

[$script, $directorio, $turno] = $argv;
$raiz = realpath(__DIR__.'/../../storage/framework/testing');
$directorio = realpath($directorio);
if (! $raiz || ! $directorio || dirname($directorio) !== $raiz
    || ! preg_match('/^importacion-concurrencia-[a-f0-9]{16}$/', basename($directorio))
    || ! in_array($turno, ['importacion', 'importacion2', 'manual'], true)) {
    throw new RuntimeException('Destino de concurrencia no autorizado.');
}
$base = $directorio.'/prueba.sqlite';
if (! is_file($base)) {
    throw new RuntimeException('La base temporal debe existir.');
}

$app = require __DIR__.'/../../bootstrap/app.php';
$app->useEnvironmentPath(__DIR__.'/..')->loadEnvironmentFrom('.env.phpunit');
$app->afterBootstrapping(LoadConfiguration::class, function ($app) use ($base, $directorio): void {
    $app['config']->set('database.default', 'sqlite');
    $app['config']->set('database.connections.sqlite.url', null);
    $app['config']->set('database.connections.sqlite.database', $base);
    $app['config']->set('database.connections.sqlite.busy_timeout', 5000);
    $app['config']->set('filesystems.disks.local.root', $directorio.'/almacen');
    $app['config']->set('cache.default', 'array');
    $app['config']->set('session.driver', 'array');
    $app['config']->set('logging.default', 'null');
});
$app->make(Kernel::class)->bootstrap();
$conexion = $app['db']->connection();
if ($conexion->getDriverName() !== 'sqlite' || realpath($conexion->getDatabaseName()) !== realpath($base)) {
    throw new RuntimeException('Conexión secundaria no aislada.');
}

$escenario = json_decode(file_get_contents($directorio.'/escenario.json'), true, flags: JSON_THROW_ON_ERROR);
$usuario = User::query()->findOrFail($escenario['usuario']);
$app['auth']->guard()->setUser($usuario);

$esperar = static function (string $archivo): void {
    $limite = microtime(true) + 12;
    while (! is_file($archivo)) {
        if (microtime(true) > $limite) {
            throw new RuntimeException('No se liberó la barrera de prueba.');
        }
        usleep(10000);
        clearstatcache(true, $archivo);
    }
};
$marcarYPausar = static function () use ($directorio, $turno, $escenario, $esperar): void {
    file_put_contents($directorio.'/'.$turno.'.validado', '1');
    if (($escenario['pausa'] ?? null) === $turno) {
        // Mantiene la transacción (y el bloqueo de escritura) abierta hasta la señal.
        $esperar($directorio.'/liberar');
    }
};

if ($turno === 'manual') {
    // creating se ejecuta dentro de la transacción de DisponibilidadAcademica, con la edición reservada.
    Matricula::creating($marcarYPausar);
} else {
    // created del lote: primera escritura de la transacción de importación.
    ImportacionAcademica::created($marcarYPausar);
}

file_put_contents($directorio.'/'.$turno.'.listo', '1');
$esperar($directorio.'/'.$turno.'.iniciar');
file_put_contents($directorio.'/'.$turno.'.intentando', '1');

try {
    if ($turno === 'manual') {
        (new Matricula(['estudiante_id' => $escenario['estudiante_manual'], 'edicion_id' => $escenario['edicion']]))->save();
        $resultado = ['resultado' => 'ok'];
    } else {
        $lote = app(EjecutorImportacion::class)->confirmar(
            $usuario,
            new ArchivoPreparado($escenario['token'], 'csv', 'lista.csv', $escenario['sha256']),
            new OpcionesImportacion(edicionDestinoId: $escenario['edicion']),
            $escenario['huella'],
        );
        $resultado = ['resultado' => 'ok', 'lote' => $lote->id];
    }
} catch (ImportacionRechazadaException $e) {
    $resultado = ['resultado' => 'rechazada', 'mensaje' => $e->getMessage()];
} catch (ValidationException $e) {
    $resultado = ['resultado' => 'validacion', 'mensaje' => implode(' ', array_merge(...array_values($e->errors())))];
} catch (Throwable $e) {
    $resultado = ['resultado' => 'inesperado', 'clase' => $e::class, 'mensaje' => $e->getMessage()];
}
file_put_contents($directorio.'/'.$turno.'.resultado.json', json_encode($resultado, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
$conexion->disconnect();
