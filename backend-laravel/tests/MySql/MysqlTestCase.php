<?php

namespace Tests\MySql;

use Illuminate\Contracts\Config\Repository;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Base de las pruebas MySQL opcionales. Igual que Tests\TestCase, aborta antes de
 * tocar nada si la conexión no es exactamente la base temporal creada por
 * tests/MySql/bootstrap.php en un servidor local.
 */
abstract class MysqlTestCase extends BaseTestCase
{
    public function createApplication()
    {
        $app = require __DIR__.'/../../bootstrap/app.php';
        $app->useEnvironmentPath(__DIR__.'/..')->loadEnvironmentFrom('.env.phpunit');
        $this->traitsUsedByTest = class_uses_recursive(static::class);
        $app->afterBootstrapping(LoadConfiguration::class, function ($app): void {
            self::exigirBaseTemporal($app['config']);
        });
        $app->make(Kernel::class)->bootstrap();
        Http::preventStrayRequests();

        return $app;
    }

    public static function exigirBaseTemporal(Repository $config): void
    {
        $conexion = $config->get('database.default');
        $ajustes = $config->get("database.connections.{$conexion}");
        $esperada = (string) getenv('HORUS_MYSQL_IT_DATABASE');

        if (($ajustes['driver'] ?? null) !== 'mysql'
            || preg_match('/^horus_laravel_it_[a-f0-9]{16}$/', $esperada) !== 1
            || ($ajustes['database'] ?? null) !== $esperada
            || ! in_array($ajustes['host'] ?? null, ['127.0.0.1', 'localhost', '::1'], true)
            || filled($ajustes['url'] ?? null)) {
            throw new RuntimeException('Pruebas MySQL abortadas: la conexión no es la base temporal local de esta ejecución.');
        }
    }

    /**
     * Ajustes de una conexión adicional a otra base temporal derivada de esta ejecución.
     *
     * @return array<string, mixed>
     */
    protected function conexionDerivada(string $sufijo): array
    {
        if (preg_match('/^[a-z0-9]{1,16}$/', $sufijo) !== 1) {
            throw new RuntimeException('Sufijo no válido.');
        }

        return array_replace(config('database.connections.mysql'), ['database' => getenv('HORUS_MYSQL_IT_DATABASE').'_'.$sufijo]);
    }
}
