<?php

namespace Tests\Feature\Academico;

use Illuminate\Http\Client\StrayRequestException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class EntornoPruebasTest extends TestCase
{
    public function test_no_lee_el_entorno_ni_la_configuracion_cacheada_del_desarrollo(): void
    {
        $this->assertSame(realpath(__DIR__.'/../..'), realpath(app()->environmentPath()));
        $this->assertSame('.env.phpunit', app()->environmentFile());
        $this->assertFalse(app()->configurationIsCached());
        $this->assertSame('testing', app()->environment());
        $this->assertSame(':memory:', config('database.connections.sqlite.database'));
        $this->assertSame('array', config('mail.default'));
        $this->assertSame('array', config('cache.default'));
        $this->assertSame('array', config('session.driver'));
        $this->assertSame('sync', config('queue.default'));
        $this->assertEmpty(config('services.resend.key'));
    }

    public function test_rechaza_http_no_simulado_antes_de_contactar_la_red(): void
    {
        $this->assertTrue(Http::preventingStrayRequests());

        $this->expectException(StrayRequestException::class);
        Http::get('https://example.invalid/never-contact');
    }

    public function test_permite_respuestas_http_simuladas(): void
    {
        Http::fake(['https://example.invalid/*' => Http::response(['ok' => true])]);

        $this->assertTrue(Http::get('https://example.invalid/fake')->json('ok'));
    }
}
