<?php

namespace Tests\MySql;

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;

/**
 * Esquema y restricciones en MySQL real. DatabaseMigrations (sin transacción
 * envolvente) porque varios casos ejecutan DDL, que en MySQL confirma implícitamente.
 */
class RestriccionesMysqlTest extends MysqlTestCase
{
    use DatabaseMigrations;

    public function test_todas_las_tablas_son_innodb_utf8mb4_y_la_sesion_usa_utc(): void
    {
        $tablas = DB::select("SELECT TABLE_NAME AS t, ENGINE AS e, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");

        $this->assertNotEmpty($tablas);

        foreach ($tablas as $tabla) {
            $this->assertSame('InnoDB', $tabla->e, $tabla->t);
            $this->assertSame('utf8mb4_unicode_ci', $tabla->c, $tabla->t);
        }

        $this->assertSame('+00:00', DB::selectOne('SELECT @@session.time_zone AS z')->z);
        $this->assertStringContainsString('STRICT_TRANS_TABLES', DB::selectOne('SELECT @@session.sql_mode AS m')->m);
    }

    public function test_las_restricciones_check_estrictas_estan_instaladas(): void
    {
        $checks = collect(DB::select('SELECT CONSTRAINT_NAME AS n, CHECK_CLAUSE AS c FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()'))
            ->pluck('c', 'n');

        foreach (['estudiantes_documento_valido', 'estudiantes_telefono_valido', 'users_rol_valido', 'matricula_movimientos_valores_validos'] as $nombre) {
            $this->assertArrayHasKey($nombre, $checks->all());
        }

        $this->assertStringContainsString('regexp_like', strtolower($checks['estudiantes_documento_valido']));
        $this->assertStringContainsString('charset binary', strtolower($checks['users_rol_valido']));
        $this->assertArrayHasKey('ediciones_fechas_validas', $checks->all());
        $this->assertArrayHasKey('ediciones_cupo_positivo', $checks->all());
        $this->assertArrayHasKey('users_activo_valido', $checks->all());
    }

    public static function estudiantesInvalidos(): iterable
    {
        yield 'DNI con salto de línea final' => ['DNI', "12345678\n", null];
        yield 'DNI de 7 dígitos' => ['DNI', '1234567', null];
        yield 'DNI con letra' => ['DNI', '1234567A', null];
        yield 'CE en minúsculas' => ['CE', 'abcd1234', null];
        yield 'pasaporte con salto final' => ['PASAPORTE', "AB1234\n", null];
        yield 'pasaporte con Ñ' => ['PASAPORTE', 'ÑA1234', null];
        yield 'sin documento con número' => ['SIN_DOCUMENTO', '12345678', null];
        yield 'DNI sin número' => ['DNI', null, null];
        yield 'teléfono con salto final' => ['DNI', '12345678', "912345678\n"];
        yield 'teléfono que no empieza por 9' => ['DNI', '12345678', '812345678'];
        yield 'teléfono de 10 dígitos' => ['DNI', '12345678', '9123456789'];
    }

    #[DataProvider('estudiantesInvalidos')]
    public function test_mysql_rechaza_documentos_y_telefonos_que_sqlite_rechaza(string $tipo, ?string $numero, ?string $telefono): void
    {
        $this->expectException(QueryException::class);
        $this->expectExceptionMessageMatches('/3819|Check constraint/');

        DB::table('estudiantes')->insert($this->estudiante($tipo, $numero, $telefono));
    }

    public function test_mysql_acepta_los_valores_validos(): void
    {
        DB::table('estudiantes')->insert([
            $this->estudiante('DNI', '01234567', '912345678'),
            $this->estudiante('CE', 'AB1234', null),
            $this->estudiante('PASAPORTE', 'X12345678901234567Z', null),
            $this->estudiante('SIN_DOCUMENTO', null, null),
            $this->estudiante('SIN_DOCUMENTO', null, null),
        ]);

        $this->assertSame(5, DB::table('estudiantes')->count());
        $this->assertSame('01234567', DB::table('estudiantes')->where('tipo_documento', 'DNI')->value('numero_documento'));
    }

    public static function rolesInvalidos(): iterable
    {
        yield 'mayúsculas' => ['SECRETARIA'];
        yield 'espacio final' => ['secretaria '];
        yield 'desconocido' => ['gerente'];
    }

    #[DataProvider('rolesInvalidos')]
    public function test_mysql_rechaza_roles_que_no_coinciden_exactamente(string $rol): void
    {
        $this->expectException(QueryException::class);
        $this->expectExceptionMessageMatches('/3819|Check constraint/');

        DB::table('users')->insert(['name' => 'Cuenta ficticia', 'email' => 'cuenta@example.test', 'password' => 'x', 'rol' => $rol]);
    }

    public function test_mysql_rechaza_movimientos_con_valores_no_exactos(): void
    {
        $matricula = $this->matriculaBasica();

        foreach ([
            ['tipo' => 'creacion', 'estado_anterior' => null, 'estado_nuevo' => 'MATRICULADO'],
            ['tipo' => 'RETIRO', 'estado_anterior' => 'matriculado', 'estado_nuevo' => 'RETIRADO'],
            ['tipo' => 'RETIRO', 'estado_anterior' => 'RETIRADO', 'estado_nuevo' => 'RETIRADO'],
            ['tipo' => 'CREACION', 'estado_anterior' => 'MATRICULADO', 'estado_nuevo' => 'MATRICULADO'],
        ] as $movimiento) {
            try {
                DB::table('matricula_movimientos')->insert(['matricula_id' => $matricula] + $movimiento);
                $this->fail('MySQL aceptó un movimiento inválido: '.json_encode($movimiento));
            } catch (QueryException $e) {
                $this->assertSame(3819, $e->errorInfo[1]);
            }
        }

        DB::table('matricula_movimientos')->insert(['matricula_id' => $matricula, 'tipo' => 'CREACION', 'estado_nuevo' => 'MATRICULADO']);
        $this->assertSame(1, DB::table('matricula_movimientos')->count());
    }

    public function test_claves_foraneas_restringen_el_borrado_del_historial(): void
    {
        $matricula = $this->matriculaBasica();

        foreach (['estudiantes', 'ediciones'] as $tabla) {
            try {
                DB::table($tabla)->delete();
                $this->fail("Se borró {$tabla} con matrículas.");
            } catch (QueryException $e) {
                $this->assertSame(1451, $e->errorInfo[1]);
            }
        }

        $this->assertSame(1, DB::table('matriculas')->where('id', $matricula)->count());
    }

    public function test_los_indices_unicos_comparan_sin_mayusculas_ni_tildes(): void
    {
        // Diferencia documentada respecto de SQLite: el traslado la detecta antes de escribir.
        DB::table('cursos')->insert(['nombre' => 'Programación', 'activo' => true]);

        $this->expectException(QueryException::class);
        DB::table('cursos')->insert(['nombre' => 'PROGRAMACION', 'activo' => true]);
    }

    public function test_la_migracion_se_detiene_sin_cambios_si_hay_filas_que_no_cumplen(): void
    {
        Artisan::call('migrate:rollback', ['--path' => 'database/migrations/2026_10_18_000000_endurece_restricciones_mysql.php', '--force' => true]);
        // Con la restricción original (débil) MySQL acepta este CE en minúsculas.
        DB::table('estudiantes')->insert($this->estudiante('CE', 'abcd1234', null));
        $antes = $this->checks();

        try {
            Artisan::call('migrate', ['--force' => true]);
            $this->fail('La migración debía detenerse.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('estudiantes_documento_valido', $e->getMessage());
            $this->assertStringNotContainsString('abcd1234', $e->getMessage());
        }

        $this->assertSame($antes, $this->checks());
        $this->assertSame(1, DB::table('estudiantes')->count());

        DB::table('estudiantes')->delete();
        Artisan::call('migrate', ['--force' => true]);
        $this->assertStringContainsString('regexp_like', strtolower($this->checks()['estudiantes_documento_valido']));
    }

    public function test_todas_las_migraciones_se_revierten_y_reaplican_en_mysql(): void
    {
        $this->assertSame(0, Artisan::call('migrate:rollback', ['--force' => true, '--step' => 1000]));
        $this->assertSame(['migrations'], array_column(DB::select('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'), 't'));
        $this->assertSame(0, Artisan::call('migrate', ['--force' => true]));
        $this->assertArrayHasKey('users_rol_valido', $this->checks());
    }

    /**
     * @return array<string, string>
     */
    private function checks(): array
    {
        return collect(DB::select('SELECT CONSTRAINT_NAME AS n, CHECK_CLAUSE AS c FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY n'))
            ->pluck('c', 'n')->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function estudiante(string $tipo, ?string $numero, ?string $telefono): array
    {
        return [
            'tipo_documento' => $tipo, 'numero_documento' => $numero, 'nombres' => 'Ana', 'apellidos' => 'Prueba',
            'nombre_busqueda' => 'ana prueba', 'telefono' => $telefono,
        ];
    }

    private function matriculaBasica(): int
    {
        $estudiante = DB::table('estudiantes')->insertGetId($this->estudiante('DNI', '87654321', null));
        $curso = DB::table('cursos')->insertGetId(['nombre' => 'Curso ficticio', 'activo' => true]);
        $edicion = DB::table('ediciones')->insertGetId(['curso_id' => $curso, 'nombre' => '2026-I']);

        return DB::table('matriculas')->insertGetId(['estudiante_id' => $estudiante, 'edicion_id' => $edicion]);
    }
}
