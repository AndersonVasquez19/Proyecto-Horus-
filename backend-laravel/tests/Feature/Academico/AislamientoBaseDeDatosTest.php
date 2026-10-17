<?php

namespace Tests\Feature\Academico;

use App\Models\Estudiante;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Comprueba que las pruebas nunca usan las bases originales
 * (SQLite de desarrollo, horus_db, horus_local, horus_restore_migtest).
 */
class AislamientoBaseDeDatosTest extends TestCase
{
    use RefreshDatabase;

    public function test_las_pruebas_usan_sqlite_en_memoria(): void
    {
        $conexion = DB::connection();

        $this->assertSame('sqlite', $conexion->getDriverName());
        $this->assertSame(':memory:', $conexion->getDatabaseName());
        $this->assertSame('testing', app()->environment());
    }

    public function test_ninguna_conexion_activa_apunta_a_las_bases_originales(): void
    {
        $prohibidas = ['horus_db', 'horus_local', 'horus_restore_migtest'];
        $archivoDesarrollo = realpath(database_path('database.sqlite')) ?: database_path('database.sqlite');

        foreach (DB::getConnections() as $nombre => $conexion) {
            $base = (string) $conexion->getDatabaseName();

            $this->assertNotContains($base, $prohibidas, "La conexión {$nombre} apunta a una base original.");
            $this->assertNotSame($archivoDesarrollo, realpath($base) ?: $base, "La conexión {$nombre} apunta a la SQLite de desarrollo.");
            $this->assertNotSame('mysql', $conexion->getDriverName(), "La conexión {$nombre} usa MySQL.");
        }
    }

    public function test_los_datos_de_prueba_no_llegan_a_la_sqlite_de_desarrollo(): void
    {
        // Solo se leen metadatos del archivo; nunca se abre la base de desarrollo.
        $archivo = database_path('database.sqlite');
        clearstatcache();
        $antes = is_file($archivo) ? [filesize($archivo), filemtime($archivo)] : null;

        Estudiante::factory()->count(3)->create();

        clearstatcache();
        $despues = is_file($archivo) ? [filesize($archivo), filemtime($archivo)] : null;

        $this->assertSame(3, Estudiante::query()->count());
        $this->assertSame($antes, $despues, 'La SQLite de desarrollo cambió durante la prueba.');
    }
}
