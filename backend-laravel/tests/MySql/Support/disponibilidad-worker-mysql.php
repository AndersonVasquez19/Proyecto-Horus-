<?php

// Proceso exclusivo de ConcurrenciaMysqlTest. Solo acepta la base temporal local de la ejecución.
use App\Models\Edicion;
use App\Models\Matricula;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Validation\ValidationException;

require __DIR__.'/../../../vendor/autoload.php';

[$script, $directorio, $turno] = $argv;
$raiz = realpath(__DIR__.'/../../../storage/framework/testing');
$directorio = realpath($directorio);
$base = (string) getenv('DB_DATABASE');
if (! $raiz || ! $directorio || dirname($directorio) !== $raiz
    || ! preg_match('/^carrera-mysql-[a-f0-9]{16}$/', basename($directorio))
    || ! in_array($turno, ['primero', 'segundo'], true)
    || getenv('DB_CONNECTION') !== 'mysql'
    || ! preg_match('/^horus_laravel_it_[a-f0-9]{16}$/', $base) || getenv('HORUS_MYSQL_IT_DATABASE') !== $base
    || ! in_array(getenv('DB_HOST'), ['127.0.0.1', 'localhost', '::1'], true)) {
    throw new RuntimeException('Destino de concurrencia no autorizado.');
}

$app = require __DIR__.'/../../../bootstrap/app.php';
$app->useEnvironmentPath(__DIR__.'/../..')->loadEnvironmentFrom('.env.phpunit');
$app->make(Kernel::class)->bootstrap();
$conexion = $app['db']->connection();
if ($conexion->getDriverName() !== 'mysql' || $conexion->getDatabaseName() !== $base) {
    throw new RuntimeException('Conexión secundaria no aislada.');
}

$escenario = json_decode(file_get_contents($directorio.'/escenario.json'), true, flags: JSON_THROW_ON_ERROR);
$operacion = $escenario[$turno];
$modelo = match ($operacion['tipo']) {
    'crear' => new Matricula(['estudiante_id' => $operacion['estudiante'], 'edicion_id' => $escenario['edicion']]),
    'reactivar' => Matricula::findOrFail($operacion['matricula']),
    'cancelar', 'reducir' => Edicion::findOrFail($escenario['edicion']),
};
// Ambos procesos cargan sus objetos antes de competir: también prueba objetos obsoletos.
file_put_contents($directorio.'/'.$turno.'.listo', '1');
$esperar = static function (string $archivo): void {
    $limite = microtime(true) + 20;
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
    $resultado = ['resultado' => 'inesperado', 'clase' => $e::class, 'codigo' => $e->getCode()];
}
file_put_contents($directorio.'/'.$turno.'.resultado.json', json_encode($resultado, JSON_THROW_ON_ERROR));
$conexion->disconnect();
