<?php

namespace Tests\MySql;

use App\Enums\EstadoMatricula;
use App\Enums\RolUsuario;
use App\Models\AjustePublico;
use App\Models\CatalogoCurso;
use App\Models\Convenio;
use App\Models\ConvenioFoto;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

/**
 * Traslado SQLite → MySQL de extremo a extremo. El origen es siempre una SQLite
 * temporal creada aquí (nunca database/database.sqlite) y el destino, la base
 * MySQL temporal de esta ejecución.
 */
class TrasladoSqliteMysqlTest extends MysqlTestCase
{
    use DatabaseMigrations;

    private string $directorio;

    private string $origen;

    protected function setUp(): void
    {
        parent::setUp();
        $raiz = storage_path('framework/testing');
        if (! is_dir($raiz)) {
            mkdir($raiz, 0777, true);
        }
        $this->directorio = $raiz.'/traslado-'.bin2hex(random_bytes(8));
        mkdir($this->directorio);
        $this->origen = $this->directorio.'/origen.sqlite';
        touch($this->origen);

        config(['database.connections.traslado_origen' => [
            'driver' => 'sqlite', 'url' => null, 'database' => $this->origen, 'prefix' => '',
            'foreign_key_constraints' => true, 'busy_timeout' => 5000,
        ]]);
        $this->enOrigen(fn () => Artisan::call('migrate', ['--database' => 'traslado_origen', '--force' => true]));
    }

    protected function tearDown(): void
    {
        DB::purge('traslado_origen');
        DB::setDefaultConnection('mysql');
        // Solo archivos del directorio aleatorio de esta prueba.
        foreach (glob($this->directorio.'/*') as $archivo) {
            unlink($archivo);
        }
        rmdir($this->directorio);
        parent::tearDown();
    }

    public function test_simulacro_y_aplicacion_conservan_ids_relaciones_hashes_e_historial(): void
    {
        $datos = $this->enOrigen(fn (): array => $this->poblarOrigen());
        $huella = hash_file('sha256', $this->origen);

        [$codigo, $salida] = $this->trasladar();
        $this->assertSame(0, $codigo, $salida);
        $this->assertStringContainsString('Simulacro correcto', $salida);
        $this->assertSame(0, DB::table('estudiantes')->count(), 'El simulacro no debe dejar datos.');

        $informe = $this->directorio.'/informe.json';
        [$codigo, $salida] = $this->trasladar(['--aplicar' => true, '--yes' => true, '--informe' => $informe]);
        $this->assertSame(0, $codigo, $salida);
        $this->assertStringContainsString('Traslado aplicado y verificado', $salida);
        $this->assertSame($huella, hash_file('sha256', $this->origen), 'El origen no debe cambiar.');

        foreach (['users' => 3, 'estudiantes' => 4, 'cursos' => 2, 'ediciones' => 2, 'matriculas' => 3, 'matricula_movimientos' => 5,
            'catalogo_cursos' => 1, 'convenios' => 1, 'convenio_fotos' => 1, 'ajustes_publicos' => 1] as $tabla => $filas) {
            $this->assertSame($filas, DB::table($tabla)->count(), $tabla);
        }
        $this->assertSame(0, DB::table('sessions')->count(), 'Las sesiones no se trasladan.');
        $this->assertSame(0, DB::table('cache')->count(), 'La caché no se traslada.');

        // Identidades, contraseñas cifradas y relaciones, leídas con Eloquent sobre MySQL.
        $admin = User::query()->findOrFail($datos['admin']);
        $this->assertSame($datos['hash'], $admin->getAuthPassword());
        $this->assertTrue(Hash::check('clave-ficticia-123', $admin->getAuthPassword()));
        $this->assertSame(RolUsuario::AdministradorGeneral, $admin->rol);
        $this->assertTrue($admin->puedeGestionarAcademico());
        $this->assertNull(User::query()->findOrFail($datos['sin_rol'])->rol);

        $matricula = Matricula::query()->with(['estudiante', 'edicion.curso', 'movimientos'])->findOrFail($datos['matricula']);
        $this->assertSame('Ñúñez Ávila 🎓', $matricula->estudiante->apellidos);
        $this->assertSame('2026-10-01', $matricula->fecha_matricula->toDateString());
        $this->assertSame(EstadoMatricula::Matriculado, $matricula->estado);
        $this->assertSame('Programación básica', $matricula->edicion->curso->nombre);
        $this->assertSame('2026-11-02', $matricula->edicion->fecha_inicio->toDateString());
        $this->assertSame(['CREACION', 'ANULACION', 'REACTIVACION'], $matricula->movimientos->sortBy('id')->pluck('tipo.value')->all());
        $this->assertSame($datos['admin'], $matricula->movimientos->first()->user_id);
        $this->assertSame(1, Estudiante::query()->whereNull('numero_documento')->count());
        $ficha = CatalogoCurso::query()->sole();
        $this->assertSame($matricula->edicion->curso_id, $ficha->curso_id);
        $this->assertSame('2026-11-02', $ficha->fecha_inicio->toDateString());
        $this->assertSame(1, Convenio::query()->sole()->fotos()->count());

        // AUTO_INCREMENT continúa tras el id más alto usado en SQLite, también el de una fila borrada.
        $nuevo = Estudiante::factory()->create();
        $this->assertSame($datos['estudiante_borrado'] + 1, $nuevo->id);

        // Las reglas académicas siguen funcionando sobre los datos trasladados.
        $this->expectExceptionMessage('ya está matriculado');
        try {
            Matricula::create(['estudiante_id' => $matricula->estudiante_id, 'edicion_id' => $matricula->edicion_id]);
        } finally {
            $json = json_decode(file_get_contents($informe), true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame('aplicado', $json['modo']);
            $this->assertSame($huella, $json['origen_sha256']);
            $this->assertSame(3, $json['tablas']['users']['filas']);
            $this->assertSame(64, strlen($json['firma_global']));
            $this->assertSalidaSinDatos(file_get_contents($informe).$salida);

            // Una segunda aplicación nunca sobrescribe.
            [$codigo, $salida] = $this->trasladar(['--aplicar' => true, '--yes' => true]);
            $this->assertSame(1, $codigo);
            $this->assertStringContainsString('ya tiene datos', $salida);
        }
    }

    public function test_aborta_sin_escribir_si_una_fecha_tiene_hora(): void
    {
        $id = $this->enOrigen(function (): int {
            $this->poblarOrigen();

            // SQLite lo admite; MySQL DATE truncaría la hora en silencio.
            return tap(DB::table('matriculas')->max('id'), fn ($id) => DB::table('matriculas')->where('id', $id)->update(['fecha_matricula' => '2026-10-01 10:30:00']));
        });

        [$codigo, $salida] = $this->trasladar(['--aplicar' => true, '--yes' => true]);

        $this->assertSame(1, $codigo);
        $this->assertStringContainsString("matriculas.fecha_matricula (id {$id})", $salida);
        $this->assertStringContainsString('no se escribió nada', $salida);
        $this->assertStringNotContainsString('10:30', $salida);
        $this->assertDestinoVacio();
    }

    public function test_aborta_y_revierte_si_mysql_considera_duplicados_dos_nombres_distintos_en_sqlite(): void
    {
        $this->enOrigen(function (): void {
            $this->poblarOrigen();
            DB::table('cursos')->insert(['nombre' => 'PROGRAMACION BASICA', 'activo' => 1, 'created_at' => '2026-10-17 10:00:00', 'updated_at' => '2026-10-17 10:00:00']);
        });

        [$codigo, $salida] = $this->trasladar(['--aplicar' => true, '--yes' => true]);

        $this->assertSame(1, $codigo);
        $this->assertStringContainsString('duplicado en el índice único cursos.cursos_nombre_unique', $salida);
        $this->assertStringContainsString('Se revirtió todo', $salida);
        $this->assertStringNotContainsStringIgnoringCase('programacion', $salida);
        $this->assertDestinoVacio();
    }

    public function test_aborta_si_un_texto_supera_la_longitud_de_mysql(): void
    {
        $this->enOrigen(function (): void {
            $this->poblarOrigen();
            DB::table('estudiantes')->where('id', 1)->update(['nombres' => str_repeat('a', 121)]);
        });

        [$codigo, $salida] = $this->trasladar();

        $this->assertSame(1, $codigo);
        $this->assertStringContainsString('estudiantes.nombres (id 1): supera la longitud máxima del destino (120)', $salida);
        $this->assertDestinoVacio();
    }

    public function test_rechaza_destinos_no_permitidos(): void
    {
        $this->enOrigen(fn () => $this->poblarOrigen());

        [$codigo, $salida] = $this->trasladar(['--destino' => 'traslado_origen']);
        $this->assertSame(1, $codigo);
        $this->assertStringContainsString('debe ser una conexión MySQL', $salida);

        config(['database.connections.prohibida' => array_replace(config('database.connections.mysql'), ['database' => 'horus_db'])]);
        [$codigo, $salida] = $this->trasladar(['--destino' => 'prohibida', '--aplicar' => true, '--yes' => true]);
        $this->assertSame(1, $codigo);
        $this->assertStringContainsString('«horus_db» no puede ser destino', $salida);

        DB::statement('CREATE TABLE admin_users (id int primary key)');
        [$codigo, $salida] = $this->trasladar(['--aplicar' => true, '--yes' => true]);
        $this->assertSame(1, $codigo);
        $this->assertStringContainsString('tablas de NestJS (admin_users)', $salida);
        DB::statement('DROP TABLE admin_users');

        $migracion = DB::table('migrations')->where('migration', '2026_10_17_200000_create_matricula_movimientos_table')->first();
        DB::table('migrations')->where('id', $migracion->id)->delete();
        [$codigo, $salida] = $this->trasladar(['--aplicar' => true, '--yes' => true]);
        DB::table('migrations')->insert((array) $migracion);
        $this->assertSame(1, $codigo);
        $this->assertStringContainsString('no tiene estas migraciones del origen: 2026_10_17_200000_create_matricula_movimientos_table', $salida);

        [$codigo, $salida] = $this->trasladar(['--origen' => $this->directorio.'/no-existe.sqlite']);
        $this->assertSame(1, $codigo);
        $this->assertStringContainsString('No se encontró la base SQLite', $salida);
        $this->assertDestinoVacio();
    }

    /**
     * @param  array<string, mixed>  $opciones
     * @return array{int, string}
     */
    private function trasladar(array $opciones = []): array
    {
        $codigo = Artisan::call('horus:trasladar-sqlite-mysql', $opciones + ['--origen' => $this->origen, '--destino' => 'mysql', '--no-interaction' => true]);

        return [$codigo, Artisan::output()];
    }

    private function enOrigen(callable $operacion): mixed
    {
        DB::setDefaultConnection('traslado_origen');

        try {
            return $operacion();
        } finally {
            DB::setDefaultConnection('mysql');
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function poblarOrigen(): array
    {
        if (DB::connection()->getDatabaseName() !== $this->origen) {
            throw new RuntimeException('El poblado debe ejecutarse en la SQLite temporal.');
        }

        $hash = Hash::make('clave-ficticia-123');
        $admin = User::factory()->administrador()->create(['name' => 'Admin Ficticio', 'email' => 'admin@example.test', 'password' => $hash]);
        User::factory()->create(['email' => 'secretaria@example.test'])->forceFill(['rol' => RolUsuario::Secretaria, 'activo' => true])->save();
        $sinRol = User::factory()->create(['email' => 'publica@example.test']);
        $this->actingAs($admin);

        $curso = Curso::create(['nombre' => 'Programación básica', 'codigo' => 'prog-1', 'descripcion' => "Línea 1\nLínea 2"]);
        Curso::create(['nombre' => 'Ofimática', 'activo' => false]);
        $edicion = Edicion::create(['curso_id' => $curso->id, 'nombre' => '2026-II', 'fecha_inicio' => '2026-11-02', 'fecha_fin' => '2026-12-15', 'cupo' => 3]);
        Edicion::create(['curso_id' => $curso->id, 'nombre' => 'Histórica']);

        $a = Estudiante::create(['tipo_documento' => 'DNI', 'numero_documento' => '01234567', 'nombres' => 'José', 'apellidos' => 'Ñúñez Ávila 🎓', 'telefono' => '912345678', 'email' => 'jose@example.test']);
        $b = Estudiante::create(['tipo_documento' => 'CE', 'numero_documento' => 'ab1234', 'nombres' => 'Lucía', 'apellidos' => 'Prueba']);
        $c = Estudiante::create(['tipo_documento' => 'SIN_DOCUMENTO', 'nombres' => 'Sin', 'apellidos' => 'Documento']);
        Estudiante::query()->where('id', $c->id)->update(['observaciones' => 'Comillas "dobles" y \'simples\'']);
        Estudiante::create(['tipo_documento' => 'DNI', 'numero_documento' => '11112222', 'nombres' => 'Otro', 'apellidos' => 'Estudiante']);
        // El id más alto queda libre: SQLite AUTOINCREMENT no lo reutiliza y MySQL tampoco debe hacerlo.
        $borrado = Estudiante::create(['tipo_documento' => 'DNI', 'numero_documento' => '76543210', 'nombres' => 'Temporal', 'apellidos' => 'Borrado']);
        $borradoId = $borrado->id;
        $borrado->delete();

        $matricula = Matricula::create(['estudiante_id' => $a->id, 'edicion_id' => $edicion->id, 'fecha_matricula' => '2026-10-01']);
        $matricula->conMotivo('Error de registro')->update(['estado' => EstadoMatricula::Anulado]);
        $matricula->fresh()->update(['estado' => EstadoMatricula::Matriculado]);
        Matricula::create(['estudiante_id' => $b->id, 'edicion_id' => $edicion->id]);
        Matricula::create(['estudiante_id' => $c->id, 'edicion_id' => $edicion->id]);

        // Contenido público: también se traslada, con su enlace al curso académico.
        CatalogoCurso::create(['curso_id' => $curso->id, 'titulo' => 'Programación básica', 'slug' => 'programacion-basica', 'descripcion' => 'Ficha pública',
            'tipo' => 'curso', 'modalidad' => 'hibrida', 'duracion' => '40 horas', 'fecha_inicio' => '2026-11-02', 'estado' => 'publicado']);
        $convenio = Convenio::create(['nombre' => 'Institución ficticia', 'descripcion_corta' => 'Convenio', 'visible' => true]);
        ConvenioFoto::create(['convenio_id' => $convenio->id, 'imagen_url' => '/api/uploads/123e4567-e89b-12d3-a456-426614174000.jpg']);
        AjustePublico::guardar(['email_contacto' => 'contacto@example.test']);

        DB::table('sessions')->insert(['id' => 'sesion-ficticia', 'payload' => 'x', 'last_activity' => 1]);
        DB::table('cache')->insert(['key' => 'clave', 'value' => 'x', 'expiration' => 1]);

        return ['admin' => $admin->id, 'sin_rol' => $sinRol->id, 'hash' => $hash, 'matricula' => $matricula->id, 'estudiante_borrado' => $borradoId];
    }

    private function assertDestinoVacio(): void
    {
        foreach (['users', 'estudiantes', 'cursos', 'ediciones', 'matriculas', 'matricula_movimientos', 'catalogo_cursos', 'convenios', 'convenio_fotos', 'ajustes_publicos'] as $tabla) {
            $this->assertSame(0, DB::table($tabla)->count(), "{$tabla} debía quedar vacía.");
        }
    }

    private function assertSalidaSinDatos(string $salida): void
    {
        foreach (['admin@example.test', 'jose@example.test', 'Ñúñez', '01234567', 'clave-ficticia', '$2y$'] as $dato) {
            $this->assertStringNotContainsString($dato, $salida);
        }
    }
}
