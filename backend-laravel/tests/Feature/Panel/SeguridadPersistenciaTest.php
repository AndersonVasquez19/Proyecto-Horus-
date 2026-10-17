<?php

namespace Tests\Feature\Panel;

use App\Enums\RolUsuario;
use App\Models\User;
use App\Support\SeguridadPanel;
use Filament\Facades\Filament;
use Filament\Panel;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class SeguridadPersistenciaTest extends TestCase
{
    use RefreshDatabase;

    public function test_las_cuentas_nuevas_son_basicas_activas_sin_privilegios(): void
    {
        $usuario = User::query()->create(['name' => 'Cuenta básica', 'email' => 'basica@example.test', 'password' => 'password-ficticio']);
        $this->assertNull($usuario->fresh()->rol);
        $this->assertTrue($usuario->fresh()->activo);
        $this->assertFalse($usuario->puedeGestionarAcademico());
    }

    public function test_la_asignacion_masiva_no_permite_elevar_rol_ni_reactivar(): void
    {
        $usuario = User::factory()->create(['activo' => false]);
        $usuario->fill(['name' => 'Nombre editado', 'rol' => 'administrador_general', 'activo' => true])->save();
        $this->assertNull($usuario->fresh()->rol);
        $this->assertFalse($usuario->fresh()->activo);
        $this->assertSame('Nombre editado', $usuario->fresh()->name);
    }

    public function test_crear_con_datos_publicos_no_acepta_rol_ni_activo(): void
    {
        $usuario = User::query()->create(['name' => 'Prueba', 'email' => 'ficticio@example.test', 'password' => 'password-ficticio', 'rol' => 'administrador_general', 'activo' => false]);
        $this->assertNull($usuario->fresh()->rol);
        $this->assertTrue($usuario->fresh()->activo);
    }

    public function test_la_migracion_es_aditiva_y_no_promueve_usuarios_existentes(): void
    {
        $migracion = require database_path('migrations/2026_10_17_180000_add_rol_y_activo_to_users_table.php');
        $migracion->down();
        $usuario = User::factory()->create();
        $antes = DB::table('users')->where('id', $usuario->id)->first();
        $migracion->up();
        $despues = DB::table('users')->where('id', $usuario->id)->first();
        foreach (get_object_vars($antes) as $columna => $valor) {
            $this->assertSame($valor, $despues->{$columna});
        }
        $this->assertNull($despues->rol);
        $this->assertSame(1, $despues->activo);
    }

    public static function valoresInvalidos(): array
    {
        return [['rol', 'gerente'], ['rol', ''], ['activo', 2], ['activo', null]];
    }

    #[DataProvider('valoresInvalidos')]
    public function test_la_base_rechaza_roles_o_estados_invalidos(string $campo, mixed $valor): void
    {
        $usuario = User::factory()->create();
        $this->expectException(QueryException::class);
        DB::table('users')->where('id', $usuario->id)->update([$campo => $valor]);
    }

    public function test_el_estado_en_memoria_no_sustituye_el_estado_persistido(): void
    {
        $usuario = User::factory()->create();
        $usuario->forceFill(['rol' => RolUsuario::AdministradorGeneral, 'activo' => true]);
        $this->assertFalse($usuario->puedeGestionarAcademico());
        $this->assertFalse(User::factory()->administrador()->make()->canAccessPanel(Filament::getPanel('admin')));
    }

    public function test_solo_el_panel_admin_esta_autorizado(): void
    {
        $this->assertFalse(User::factory()->administrador()->create()->canAccessPanel(Panel::make()->id('otro')));
    }

    public function test_la_transicion_solo_puede_posponerse_en_local(): void
    {
        config(['seguridad.activar_en_local' => false]);
        foreach (['production', 'staging', 'testing'] as $entorno) {
            app()->instance('env', $entorno);
            $this->assertTrue(SeguridadPanel::activa());
            $this->assertSame('gestion', SeguridadPanel::ruta());
        }
        app()->instance('env', 'local');
        $this->assertFalse(SeguridadPanel::activa());
        $this->assertSame('admin', SeguridadPanel::ruta());
        // Simula el esquema previo solo dentro de SQLite :memory:.
        $migracion = require database_path('migrations/2026_10_17_180000_add_rol_y_activo_to_users_table.php');
        $migracion->down();
        $usuario = User::factory()->create();
        $this->assertTrue($usuario->canAccessPanel(Filament::getPanel('admin')));
        $migracion->up();
        config(['seguridad.activar_en_local' => true]);
        $this->assertTrue(SeguridadPanel::activa());
        $this->assertFalse($usuario->canAccessPanel(Filament::getPanel('admin')));
    }
}
