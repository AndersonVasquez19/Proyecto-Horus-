<?php

namespace Tests\Feature\Contenido;

use App\Support\Contenido\ImportarContenido;
use Illuminate\Database\MySqlConnection;
use Illuminate\Support\Facades\DB;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class DestinoImportacionTest extends TestCase
{
    public function test_servicio_admite_horus_group_y_continua_con_la_validacion_del_archivo(): void
    {
        $db = Mockery::mock(MySqlConnection::class);
        $db->shouldReceive('getDriverName')->andReturn('mysql');
        $db->shouldReceive('getDatabaseName')->andReturn('horus_group');
        $db->shouldReceive('selectOne')->with('SELECT @@session.time_zone AS zona')->once()->andReturn((object) ['zona' => '+00:00']);
        DB::shouldReceive('connection')->andReturn($db);

        $this->expectExceptionMessage('Intercambio ausente');
        (new ImportarContenido)->ejecutar(__DIR__.'/no-existe.json', false, '', '');
    }

    public function test_comando_admite_horus_group_solo_con_base_y_uuid_confirmados(): void
    {
        $uuid = '00000000-0000-4000-8000-000000000001';
        $db = Mockery::mock(MySqlConnection::class);
        $db->shouldReceive('getDriverName')->andReturn('mysql');
        $db->shouldReceive('getDatabaseName')->andReturn('horus_group');
        $db->shouldReceive('selectOne')->with('SELECT @@server_uuid AS uuid')->once()->andReturn((object) ['uuid' => $uuid]);
        $db->shouldReceive('selectOne')->with('SELECT @@session.time_zone AS zona')->once()->andReturn((object) ['zona' => '+00:00']);
        DB::shouldReceive('connection')->andReturn($db);

        $this->artisan('horus:importar-contenido-nestjs', ['--base-esperada' => 'horus_group', '--servidor-uuid' => $uuid])
            ->expectsOutput('Intercambio ausente o demasiado grande (máximo 32 MiB).')
            ->assertExitCode(1);
    }

    #[DataProvider('basesRechazadas')]
    public function test_rechaza_nombres_ajenos_antes_de_consultar_mysql(string $base): void
    {
        $db = Mockery::mock(MySqlConnection::class);
        $db->shouldReceive('getDriverName')->andReturn('mysql');
        $db->shouldReceive('getDatabaseName')->andReturn($base);
        $db->shouldNotReceive('selectOne');
        DB::shouldReceive('connection')->andReturn($db);

        $this->artisan('horus:importar-contenido-nestjs', ['--base-esperada' => $base, '--servidor-uuid' => 'uuid-ficticio'])
            ->expectsOutput('Destino no confirmado: se requiere MySQL, la base exacta y su server_uuid.')
            ->assertExitCode(1);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Destino rechazado');
        (new ImportarContenido)->ejecutar('', true, '', '');
    }

    public static function basesRechazadas(): array
    {
        return array_map(fn ($base) => [$base], ['horus_db', 'horus_local', 'horus_laravel', 'mysql', 'contabilidad',
            'horus_group_it_0123456789abcdef', 'horus_group_copia', 'HORUS_GROUP', "horus_group\n", 'horus_laravel_it_0123']);
    }

    public function test_comando_rechaza_base_o_uuid_sin_confirmar(): void
    {
        $uuid = '00000000-0000-4000-8000-000000000001';
        $db = Mockery::mock(MySqlConnection::class);
        $db->shouldReceive('getDriverName')->andReturn('mysql');
        $db->shouldReceive('getDatabaseName')->andReturn('horus_group');
        $db->shouldReceive('selectOne')->with('SELECT @@server_uuid AS uuid')->once()->andReturn((object) ['uuid' => $uuid]);
        DB::shouldReceive('connection')->andReturn($db);
        foreach ([[], ['--base-esperada' => 'otra'], ['--base-esperada' => 'horus_group'],
            ['--base-esperada' => 'horus_group', '--servidor-uuid' => '00000000-0000-4000-8000-000000000002']] as $options) {
            $this->artisan('horus:importar-contenido-nestjs', $options)
                ->expectsOutput('Destino no confirmado: se requiere MySQL, la base exacta y su server_uuid.')
                ->assertExitCode(1);
        }
    }
}
