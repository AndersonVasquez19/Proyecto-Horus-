<?php

// Proceso exclusivo de las pruebas de concurrencia. Nunca acepta una base habitual.
use App\Models\Edicion;
use App\Models\Matricula;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Validation\ValidationException;

require __DIR__.'/../../vendor/autoload.php';

[$script, $directorio, $turno] = $argv;
$raiz = realpath(__DIR__.'/../../storage/framework/testing');
$directorio = realpath($directorio);
if (! $raiz || ! $directorio || dirname($directorio) !== $raiz
    || ! preg_match('/^robustez-[a-f0-9]{16}$/', basename($directorio))
    || ! in_array($turno, ['primero', 'segundo'], true)) {
    throw new RuntimeException('Destino de concurrencia no autorizado.');
}
$base = $directorio.'/prueba.sqlite';
if (! is_file($base)) {
    throw new RuntimeException('La base temporal debe existir.');
}

$app = require __DIR__.'/../../bootstrap/app.php';
$app->afterBootstrapping(LoadConfiguration::class, function ($app) use ($base): void {
    $app['config']->set('database.default', 'sqlite');
    $app['config']->set('database.connections.sqlite.url', null);
    $app['config']->set('database.connections.sqlite.database', $base);
    $app['config']->set('database.connections.sqlite.busy_timeout', 5000);
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
$operacion = $escenario[$turno];
$modelo = match ($operacion['tipo']) {
    'crear' => new Matricula(['estudiante_id' => $operacion['estudiante'], 'edicion_id' => $escenario['edicion']]),
    'reactivar' => Matricula::findOrFail($operacion['matricula']),
    'cancelar', 'reducir' => Edicion::findOrFail($escenario['edicion']),
};
// Los dos procesos cargan sus objetos antes de competir: también prueba objetos obsoletos.
file_put_contents($directorio.'/'.$turno.'.listo', '1');
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
$esperar($directorio.'/'.$turno.'.iniciar');
$validado = static function () use ($directorio, $turno, $esperar): void {
    file_put_contents($directorio.'/'.$turno.'.validado', '1');
    if ($turno === 'primero') {
        $esperar($directorio.'/liberar');
    }
};
// saving valida primero; creating/updating se ejecutan antes del INSERT/UPDATE real.
$modelo::creating($validado);
$modelo::updating($validado);
file_put_contents($directorio.'/'.$turno.'.intentando', '1');

try {
    match ($operacion['tipo']) {
        'crear' => $modelo->save(),
        'reactivar' => $modelo->update(['estado' => 'MATRICULADO']),
        'cancelar' => $modelo->update(['estado' => 'CANCELADA']),
        'reducir' => $modelo->update(['cupo' => 1]),
    };
    $resultado = ['resultado' => 'ok'];
} catch (ValidationException $e) {
    $resultado = ['resultado' => 'validacion', 'errores' => $e->errors()];
} catch (Throwable $e) {
    $resultado = ['resultado' => 'inesperado', 'clase' => $e::class, 'mensaje' => $e->getMessage()];
}
file_put_contents($directorio.'/'.$turno.'.resultado.json', json_encode($resultado, JSON_THROW_ON_ERROR));
$conexion->disconnect();
