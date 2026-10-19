<?php

namespace Tests\MySql;

use App\Filament\Resources\Contenido\CatalogoCursos\Pages\ListCatalogoCursos;
use App\Models\CatalogoCurso;
use App\Models\User;
use App\Support\Contenido\ImportarContenido;
use Filament\Actions\Testing\TestAction;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Support\Facades\DB;
use Livewire\Livewire;
use RuntimeException;

class ImportacionContenidoMysqlTest extends MysqlTestCase
{
    use DatabaseTruncation;

    public function test_importacion_mysql_con_simulacro_repeticion_y_conflicto(): void
    {
        $dir = sys_get_temp_dir().'/horus-import-mysql-'.bin2hex(random_bytes(8));
        mkdir($dir);
        $file = $dir.'/fixture.json';
        try {
            $model = CatalogoCurso::factory()->make(['estado' => 'publicado']);
            $row = array_replace(array_fill_keys($model->getFillable(), null), $model->getAttributes());
            unset($row['curso_id']);
            $row += ['id' => 37, 'createdAt' => '2026-10-01 12:00:00', 'updatedAt' => '2026-10-02 12:00:00'];
            $tables = array_fill_keys([...array_keys(ImportarContenido::MODELOS), 'empresa_settings'], []);
            $tables['cursos'] = [$row];
            file_put_contents($file, json_encode(['version' => 1, 'tablas' => $tables], JSON_THROW_ON_ERROR));
            $service = new ImportarContenido;
            $this->assertSame('simulacro', $service->ejecutar($file, false, $dir, $dir)['modo']);
            $this->assertSame(0, CatalogoCurso::count());
            $this->assertSame('aplicado', $service->ejecutar($file, true, $dir, $dir)['modo']);
            $this->assertSame('reutilizado', $service->ejecutar($file, true, $dir, $dir)['modo']);
            $this->assertSame(37, CatalogoCurso::sole()->id);
            $this->assertSame('2026-10-01 12:00:00', CatalogoCurso::sole()->getRawOriginal('created_at'));
            CatalogoCurso::sole()->update(['titulo' => 'Edición local']);
            try {
                $service->ejecutar($file, true, $dir, $dir);
                $this->fail('Sobrescribió contenido editado.');
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('contenido diferente', $e->getMessage());
                $this->assertSame('Edición local', CatalogoCurso::sole()->titulo);
            }
        } finally {
            if (is_file($file)) {
                unlink($file);
            }
            rmdir($dir);
        }
    }

    public function test_mysql_rechaza_cuentas_basicas_y_reautoriza_publicacion(): void
    {
        config(['contenido-publico.panel_habilitado' => true]);
        $basic = User::factory()->create(['rol' => null, 'activo' => true]);
        $this->actingAs($basic)->get('/gestion')->assertForbidden();
        $this->get('/gestion/contenido/catalogo-educacion')->assertForbidden();
        foreach (['secretaria', 'coordinador_institucional'] as $rol) {
            $this->actingAs(User::factory()->create(['rol' => $rol, 'activo' => true]));
            $this->get('/gestion/contenido/catalogo-educacion')->assertForbidden();
        }
        $admin = User::factory()->administrador()->create();
        $this->actingAs($admin);
        $ficha = CatalogoCurso::factory()->create();
        $this->get('/gestion/contenido/catalogo-educacion')->assertOk();
        $this->assertTrue($admin->puedeGestionarContenidoPublico());
        $page = Livewire::test(ListCatalogoCursos::class);
        $action = TestAction::make('publicar')->table($ficha);
        $page->callAction($action);
        $this->assertSame('publicado', $ficha->fresh()->estado->value);
        Livewire::test(ListCatalogoCursos::class)->callAction(TestAction::make('despublicar')->table($ficha));
        $this->assertSame('borrador', $ficha->fresh()->estado->value);
        $pendiente = Livewire::test(ListCatalogoCursos::class)->mountAction($action);
        DB::table('users')->where('id', $admin->id)->update(['rol' => null]);
        $pendiente->callMountedAction()->assertForbidden();
        $this->assertSame('borrador', $ficha->fresh()->estado->value);
    }

    public function test_importacion_exige_utc_para_no_desplazar_timestamp(): void
    {
        $file = tempnam(sys_get_temp_dir(), 'horus-tz-');
        file_put_contents($file, json_encode(['version' => 1,
            'tablas' => array_fill_keys([...array_keys(ImportarContenido::MODELOS), 'empresa_settings'], [])], JSON_THROW_ON_ERROR));
        DB::statement("SET time_zone = '+02:00'");
        $this->expectExceptionMessage('zona horaria');
        try {
            (new ImportarContenido)->ejecutar($file, true, sys_get_temp_dir(), sys_get_temp_dir());
        } finally {
            DB::statement("SET time_zone = '+00:00'");
            unlink($file);
        }
    }

    public function test_importacion_rechaza_tablas_ajenas_incluso_vacias(): void
    {
        $file = tempnam(sys_get_temp_dir(), 'horus-ajena-');
        file_put_contents($file, json_encode(['version' => 1,
            'tablas' => array_fill_keys([...array_keys(ImportarContenido::MODELOS), 'empresa_settings'], [])], JSON_THROW_ON_ERROR));
        DB::statement('CREATE TABLE contabilidad_externa (id int primary key) ENGINE=InnoDB');
        try {
            $this->expectExceptionMessage('tablas ajenas a Laravel');
            (new ImportarContenido)->ejecutar($file, true, sys_get_temp_dir(), sys_get_temp_dir());
        } finally {
            DB::statement('DROP TABLE contabilidad_externa');
            unlink($file);
        }
    }

    public function test_importacion_concurrente_se_rechaza_sin_escrituras(): void
    {
        $file = tempnam(sys_get_temp_dir(), 'horus-lock-');
        file_put_contents($file, json_encode(['version' => 1,
            'tablas' => array_fill_keys([...array_keys(ImportarContenido::MODELOS), 'empresa_settings'], [])], JSON_THROW_ON_ERROR));
        config(['database.connections.content_lock' => config('database.connections.mysql')]);
        $otra = DB::connection('content_lock');
        $lock = 'horus-content-'.substr(hash('sha256', $otra->getDatabaseName()), 0, 40);
        try {
            $this->assertSame(1, (int) $otra->selectOne('SELECT GET_LOCK(?, 0) AS adquirido', [$lock])->adquirido);
            try {
                (new ImportarContenido)->ejecutar($file, true, sys_get_temp_dir(), sys_get_temp_dir());
                $this->fail('Permitió importar mientras otra conexión mantiene el bloqueo.');
            } catch (RuntimeException $e) {
                $this->assertSame('Otra importación está en curso.', $e->getMessage());
                $this->assertSame(0, CatalogoCurso::count());
            }
            $otra->select('SELECT RELEASE_LOCK(?)', [$lock]);
            $this->assertSame('aplicado', (new ImportarContenido)->ejecutar($file, true, sys_get_temp_dir(), sys_get_temp_dir())['modo']);
        } finally {
            $otra->select('SELECT RELEASE_LOCK(?)', [$lock]);
            DB::purge('content_lock');
            unlink($file);
        }
    }
}
