<?php

namespace Tests\Unit;

use App\Support\Traslado\RespaldoSqlite;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use SQLite3;

class RespaldoSqliteTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir().'/horus-backup-'.bin2hex(random_bytes(8));
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir.'/*') as $file) {
            unlink($file);
        }
        rmdir($this->dir);
    }

    public function test_respalda_wal_confirmado_y_restaura_sin_cambiar_el_origen(): void
    {
        $source = new SQLite3($this->dir.'/source.sqlite');
        $source->exec('PRAGMA journal_mode=WAL; CREATE TABLE prueba (id INTEGER PRIMARY KEY, valor TEXT);');
        $source->exec("INSERT INTO prueba VALUES (1, 'ñ 🎓'); CREATE INDEX prueba_valor ON prueba(valor)");
        $before = hash_file('sha256', $this->dir.'/source.sqlite');
        $wal = hash_file('sha256', $this->dir.'/source.sqlite-wal');
        $report = (new RespaldoSqlite)->crear($this->dir.'/source.sqlite', $this->dir.'/backup.sqlite');
        $this->assertSame($before, hash_file('sha256', $this->dir.'/source.sqlite'));
        $this->assertSame($wal, hash_file('sha256', $this->dir.'/source.sqlite-wal'));
        $this->assertSame(1, $report['tablas']['prueba']['filas']);
        $restore = (new RespaldoSqlite)->crear($this->dir.'/backup.sqlite', $this->dir.'/restore.sqlite');
        $this->assertSame($report['tablas'], $restore['tablas']);
        $this->assertSame($report['esquema_sha256'], $restore['esquema_sha256']);
        $this->assertSame('ok', $report['integridad']);
        $source->close();
    }

    public function test_no_sobrescribe_un_destino_existente(): void
    {
        file_put_contents($this->dir.'/existing.sqlite', 'no tocar');
        $this->expectException(RuntimeException::class);
        try {
            (new RespaldoSqlite)->crear($this->dir.'/missing.sqlite', $this->dir.'/existing.sqlite');
        } finally {
            $this->assertSame('no tocar', file_get_contents($this->dir.'/existing.sqlite'));
        }
    }

    public function test_rechaza_integridad_referencial_rota(): void
    {
        $source = new SQLite3($this->dir.'/source.sqlite');
        $source->exec('CREATE TABLE padre(id INTEGER PRIMARY KEY); CREATE TABLE hijo(id INTEGER PRIMARY KEY, padre_id INTEGER REFERENCES padre(id)); INSERT INTO hijo VALUES(1,99)');
        $source->close();
        $this->expectExceptionMessage('integridad referencial');
        (new RespaldoSqlite)->crear($this->dir.'/source.sqlite', $this->dir.'/backup.sqlite');
    }
}
