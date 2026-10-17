<?php

namespace Tests;

use Illuminate\Contracts\Config\Repository;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Http;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    /**
     * Salvaguarda: RefreshDatabase ejecuta migrate:fresh, que vaciaría la base
     * a la que apunte la conexión. Las pruebas solo pueden usar SQLite en
     * memoria (ver phpunit.xml); cualquier otra configuración aborta antes de
     * tocar una base real.
     */
    public function createApplication()
    {
        // Mismo arranque que Laravel 13, con un entorno vacío antes del bootstrap.
        $app = require __DIR__.'/../bootstrap/app.php';
        $app->useEnvironmentPath(__DIR__)->loadEnvironmentFrom('.env.phpunit');
        $this->traitsUsedByTest = class_uses_recursive(static::class);
        $app->afterBootstrapping(LoadConfiguration::class, function ($app): void {
            $this->assertIsolatedDatabase($app['config']);
        });
        $app->make(Kernel::class)->bootstrap();
        Http::preventStrayRequests();

        return $app;
    }

    private function assertIsolatedDatabase(Repository $config): void
    {
        $conexion = $config->get('database.default');
        $driver = $config->get("database.connections.{$conexion}.driver");
        $base = $config->get("database.connections.{$conexion}.database");

        if ($driver !== 'sqlite' || $base !== ':memory:' || filled($config->get("database.connections.{$conexion}.url"))) {
            throw new RuntimeException(
                'Pruebas abortadas: la conexión de pruebas debe ser SQLite en memoria. Revise phpunit.xml o la caché de configuración (php artisan config:clear).'
            );
        }

    }
}
