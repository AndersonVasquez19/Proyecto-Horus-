<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Process\Process;

class BootstrapPruebasTest extends TestCase
{
    public function test_el_bootstrap_reemplaza_destinos_y_credenciales_heredados(): void
    {
        $process = new Process([PHP_BINARY, '-r', <<<'PHP'
            require 'tests/bootstrap.php';
            echo json_encode([
                'testing' => getenv('APP_ENV') === 'testing',
                'memory' => getenv('DB_CONNECTION') === 'sqlite' && getenv('DB_DATABASE') === ':memory:',
                'no_url' => getenv('DB_URL') === '',
                'no_credentials' => getenv('RESEND_API_KEY') === '' && getenv('AWS_SECRET_ACCESS_KEY') === '',
                'no_cached_config' => !is_file(getenv('APP_CONFIG_CACHE')),
                'temporary_key' => str_starts_with(getenv('APP_KEY'), 'base64:') && strlen(base64_decode(substr(getenv('APP_KEY'), 7))) === 32,
            ], JSON_THROW_ON_ERROR);
            PHP,
        ], dirname(__DIR__, 2), [
            'APP_ENV' => 'production',
            'DB_CONNECTION' => 'mysql',
            'DB_DATABASE' => 'do_not_connect',
            'DB_URL' => 'not-a-real-connection',
            'APP_CONFIG_CACHE' => __FILE__,
            'RESEND_API_KEY' => 'fictitious-test-value',
            'AWS_SECRET_ACCESS_KEY' => 'fictitious-test-value',
        ]);
        $process->setTimeout(30);
        $process->mustRun();

        $checks = json_decode($process->getOutput(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertCount(6, $checks);
        foreach ($checks as $check) {
            $this->assertTrue($check);
        }
    }
}
