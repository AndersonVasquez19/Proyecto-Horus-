<?php

namespace Tests\Unit;

use App\Support\Traslado\TrasladoException;
use App\Support\Traslado\TrasladoSqliteMysql;
use Illuminate\Database\MySqlConnection;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PDO;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class DestinoTrasladoTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    #[DataProvider('destinos')]
    public function test_valida_el_nombre_antes_de_consultar_el_destino(string $base, bool $permitida): void
    {
        $origen = tempnam(sys_get_temp_dir(), 'horus-destino-');
        $pdo = new PDO('sqlite:'.$origen);
        $pdo->exec('CREATE TABLE migrations (migration TEXT)');
        $pdo = null;
        $db = Mockery::mock(MySqlConnection::class);
        $db->shouldReceive('getDriverName')->andReturn('mysql');
        $db->shouldReceive('getDatabaseName')->andReturn($base);
        if ($permitida) {
            $db->shouldReceive('select')->once()->with('SELECT TABLE_NAME AS t, ENGINE AS e FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')->andReturn([]);
        } else {
            $db->shouldNotReceive('select');
        }
        try {
            $this->expectException(TrasladoException::class);
            $this->expectExceptionMessage($permitida ? 'El destino no está migrado' : ($base === 'horus_db' || $base === 'horus_local' ? 'no puede ser destino' : 'nombre de base exclusivo'));
            (new TrasladoSqliteMysql($origen, $db))->ejecutar(false);
        } finally {
            unlink($origen);
        }
    }

    public static function destinos(): array
    {
        return [
            ['horus_group', true], ['horus_laravel_it_0123456789abcdef', true],
            ['horus_laravel', false], ['horus_db', false], ['horus_local', false],
            ['horus_group_it_0123456789abcdef', false], ['horus_group_copia', false],
            ["horus_group\n", false], ['HORUS_GROUP', false],
        ];
    }
}
