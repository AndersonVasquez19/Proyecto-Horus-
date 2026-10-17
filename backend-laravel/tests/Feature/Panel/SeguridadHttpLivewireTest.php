<?php

namespace Tests\Feature\Panel;

use App\Models\User;
use Filament\Auth\Pages\Login;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Livewire\Livewire;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Peticiones al endpoint real de Livewire con snapshots firmados del GET. */
class SeguridadHttpLivewireTest extends TestCase
{
    use RefreshDatabase;

    public static function revocaciones(): array
    {
        return [
            'quitar rol con formulario abierto' => ['/gestion/estudiantes/create', ['rol' => null]],
            'secretaría con formulario abierto' => ['/gestion/estudiantes/create', ['rol' => 'secretaria']],
            'desactivar con escritorio abierto' => ['/gestion', ['activo' => false]],
        ];
    }

    #[DataProvider('revocaciones')]
    public function test_el_post_http_livewire_revalida_la_sesion_abierta(string $ruta, array $cambio): void
    {
        $user = User::factory()->coordinador()->create();
        $this->actingAs($user);
        $snapshot = $this->snapshotDe($ruta);
        // Control positivo: este mismo POST, guard, ruta y snapshot sí funcionan.
        $this->postJson(Livewire::getUpdateUri(), $this->payload($snapshot), ['X-Livewire' => 'true'])->assertOk();
        // El cliente HTTP de Laravel reutiliza la aplicación en esta prueba.
        // Una nueva petición PHP reinicia estos cachés internos de Livewire.
        Livewire::flushState();
        DB::table('users')->where('id', $user->id)->update($cambio);
        $this->postJson(Livewire::getUpdateUri(), $this->payload($snapshot), ['X-Livewire' => 'true'])->assertForbidden();
        $this->assertDatabaseCount('estudiantes', 0);
    }

    public function test_un_snapshot_abierto_no_permite_operar_tras_cerrar_sesion(): void
    {
        $this->actingAs(User::factory()->administrador()->create());
        $snapshot = $this->snapshotDe('/gestion/estudiantes/create');
        /** @var \Illuminate\Contracts\Auth\StatefulGuard $guard */
        $guard = auth()->guard('web');
        $guard->logout();
        $this->postJson(Livewire::getUpdateUri(), $this->payload($snapshot), ['X-Livewire' => 'true'])->assertUnauthorized();
        $this->assertDatabaseCount('estudiantes', 0);
    }

    #[DataProvider('cuentas')]
    public function test_el_login_filament_comprueba_rol_y_estado(?string $rol, bool $activo, bool $permitido): void
    {
        $user = User::factory()->create(['rol' => $rol, 'activo' => $activo]);
        $login = Livewire::test(Login::class)->fillForm(['email' => $user->email, 'password' => 'password'])->call('authenticate');
        if ($permitido) {
            $login->assertHasNoFormErrors();
            $this->assertAuthenticatedAs($user);
        } else {
            $login->assertHasFormErrors(['email']);
            $this->assertGuest();
        }
    }

    public static function cuentas(): array
    {
        return SeguridadRolesTest::cuentas();
    }

    public function test_laravel_no_registra_el_alta_publica_ni_las_rutas_react(): void
    {
        foreach (['/gestion/register', '/admin/login', '/admin/register', '/admin/dashboard'] as $ruta) {
            $this->get($ruta)->assertNotFound();
        }
    }

    private function snapshotDe(string $ruta): string
    {
        $html = $this->get($ruta)->assertOk()->getContent();
        preg_match('/wire:snapshot="([^"]+)"/', $html, $coincidencias);
        $this->assertArrayHasKey(1, $coincidencias, 'La página debe entregar un snapshot firmado.');

        return html_entity_decode($coincidencias[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    private function payload(string $snapshot): array
    {
        return ['components' => [[
            'snapshot' => $snapshot,
            'updates' => [],
            'calls' => [['path' => '', 'method' => '$refresh', 'params' => []]],
        ]]];
    }
}
