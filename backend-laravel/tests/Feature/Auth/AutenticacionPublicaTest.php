<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ExigirCsrf;
use Tests\TestCase;

class AutenticacionPublicaTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app->bind(PreventRequestForgery::class, ExigirCsrf::class);
        $this->withCredentials();
    }

    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        // Nueva petición real: no heredar el guard ni los atributos del Store en memoria.
        // El handler conserva las sesiones persistidas para leerlas desde la cookie.
        Auth::forgetGuards();
        $this->app->make('session')->driver()->flush();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    private function datos(array $cambios = []): array
    {
        return array_replace([
            'name' => 'Persona pública',
            'email' => 'persona@example.test',
            'password' => 'Clave ficticia 123',
            'password_confirmation' => 'Clave ficticia 123',
        ], $cambios);
    }

    private function prepararCsrf(): TestResponse
    {
        $respuesta = $this->getJson('/sanctum/csrf-cookie')->assertNoContent();
        $this->conservarCookies($respuesta);

        return $respuesta;
    }

    private function conservarCookies(TestResponse $respuesta): void
    {
        $cookie = $respuesta->getCookie(config('session.cookie'));
        if ($cookie) {
            $this->withCookie($cookie->getName(), $cookie->getValue());
        }
        $xsrf = $respuesta->getCookie('XSRF-TOKEN', false);
        if ($xsrf) {
            $this->withHeader('X-XSRF-TOKEN', $xsrf->getValue());
        }
        Auth::forgetGuards();
    }

    public function test_registra_cuenta_activa_sin_rol_y_regenera_sesion(): void
    {
        $anterior = $this->prepararCsrf()->getCookie(config('session.cookie'))->getValue();
        $respuesta = $this->postJson('/api/auth/register', $this->datos(['email' => ' Persona@Example.test ']))
            ->assertCreated();
        $usuario = User::query()->sole();
        $respuesta->assertExactJson(['user' => ['id' => $usuario->id, 'name' => 'Persona pública', 'email' => 'persona@example.test']]);
        $this->assertTrue($usuario->activo);
        $this->assertNull($usuario->rol);
        $this->assertTrue(Hash::check('Clave ficticia 123', $usuario->password));
        $this->assertNotSame($anterior, $respuesta->getCookie(config('session.cookie'))->getValue());
        $this->conservarCookies($respuesta);
        $this->getJson('/api/auth/me')->assertOk()->assertExactJson($respuesta->json());
        $this->assertFalse($usuario->canAccessPanel(Filament::getPanel('admin')));
        $this->get('/gestion')->assertForbidden();
        $this->get('/gestion/estudiantes')->assertForbidden();
    }

    public static function registrosInvalidos(): array
    {
        return [
            'nombre vacío' => [['name' => ' '], 'name'],
            'correo inválido' => [['email' => 'incorrecto'], 'email'],
            'correo array' => [['email' => ['persona@example.test']], 'email'],
            'correo omitido' => [['email' => null], 'email'],
            'nombre largo' => [['name' => str_repeat('a', 256)], 'name'],
            'clave corta' => [['password' => 'abc', 'password_confirmation' => 'abc'], 'password'],
            'clave array' => [['password' => ['incorrecta']], 'password'],
            'clave con byte nulo' => [['password' => "Clave\0ficticia 123", 'password_confirmation' => "Clave\0ficticia 123"], 'password'],
            'clave sin confirmar' => [['password_confirmation' => null], 'password'],
            'bcrypt bytes' => [['password' => str_repeat('á', 37), 'password_confirmation' => str_repeat('á', 37)], 'password'],
            'rol' => [['rol' => 'administrador_general'], 'rol'],
            'rol nulo' => [['rol' => null], 'rol'],
            'role' => [['role' => 'admin'], 'role'],
            'permisos' => [['permisos' => ['*']], 'permisos'],
            'permissions vacíos' => [['permissions' => []], 'permissions'],
            'estado' => [['activo' => false], 'activo'],
        ];
    }

    #[DataProvider('registrosInvalidos')]
    public function test_rechaza_registro_invalido_y_campos_no_admitidos(array $datos, string $campo): void
    {
        $this->prepararCsrf();
        $this->postJson('/api/auth/register', $this->datos($datos))->assertUnprocessable()->assertJsonValidationErrors($campo);
        $this->assertDatabaseCount('users', 0);
    }

    public function test_no_duplica_administrador_existente_con_correo_en_mayusculas(): void
    {
        $admin = User::factory()->administrador()->create(['email' => 'ADMIN@Example.test']);
        $antes = $admin->fresh()->getRawOriginal();
        $this->prepararCsrf();
        $this->postJson('/api/auth/register', $this->datos(['email' => 'admin@example.test']))->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->assertDatabaseCount('users', 1);
        $this->assertSame($antes, $admin->fresh()->getRawOriginal());
    }

    public function test_correo_unicode_previo_conserva_unicidad_y_login_sin_distinguir_mayusculas(): void
    {
        $admin = User::factory()->administrador()->create(['email' => 'JOSÉ@example.test', 'password' => 'Clave ficticia 123']);
        $this->prepararCsrf();
        $this->postJson('/api/auth/register', $this->datos(['email' => 'josé@example.test']))->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->assertDatabaseCount('users', 1);
        $this->postJson('/api/auth/login', ['email' => 'josé@example.test', 'password' => 'Clave ficticia 123'])->assertOk()->assertJsonPath('user.id', $admin->id);
    }

    public function test_login_regenera_sesion_y_logout_invalida_acceso_y_csrf(): void
    {
        $usuario = User::factory()->create(['email' => 'Persona@Example.test', 'password' => ' Clave ficticia 123 ']);
        $inicio = $this->prepararCsrf();
        $respuesta = $this->postJson('/api/auth/login', ['email' => ' PERSONA@example.test ', 'password' => ' Clave ficticia 123 '])->assertOk();
        $this->assertNotSame($inicio->getCookie(config('session.cookie'))->getValue(), $respuesta->getCookie(config('session.cookie'))->getValue());
        $this->assertNotSame($inicio->getCookie('XSRF-TOKEN')->getValue(), $respuesta->getCookie('XSRF-TOKEN')->getValue());
        $this->conservarCookies($respuesta);
        $this->getJson('/api/auth/me')->assertExactJson(['user' => ['id' => $usuario->id, 'name' => $usuario->name, 'email' => $usuario->email]]);
        $this->conservarCookies($respuesta);
        $salida = $this->postJson('/api/auth/logout')->assertNoContent();
        $this->assertNotSame($respuesta->getCookie('XSRF-TOKEN')->getValue(), $salida->getCookie('XSRF-TOKEN')->getValue());
        $this->conservarCookies($salida);
        $this->getJson('/api/auth/me')->assertUnauthorized();
        $this->get('/gestion')->assertRedirect('/gestion/login');
        // La sesión anterior también fue destruida en el almacén del servidor.
        $this->withCookie(config('session.cookie'), $respuesta->getCookie(config('session.cookie'))->getValue());
        Auth::forgetGuards();
        $this->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_login_incorrecto_o_inactivo_no_concede_sesion(): void
    {
        User::factory()->create(['email' => 'persona@example.test', 'password' => 'Clave ficticia 123', 'activo' => false]);
        $this->prepararCsrf();
        foreach ([['persona@example.test', 'Otra clave 123'], ['persona@example.test', 'Clave ficticia 123'], ['ausente@example.test', 'Clave ficticia 123']] as [$email, $password]) {
            $this->postJson('/api/auth/login', compact('email', 'password'))->assertUnauthorized()->assertExactJson(['message' => 'Credenciales inválidas.']);
            Auth::forgetGuards();
            $this->getJson('/api/auth/me')->assertUnauthorized();
        }
    }

    public function test_una_cuenta_desactivada_durante_la_sesion_pierde_acceso(): void
    {
        $usuario = User::factory()->create(['password' => 'Clave ficticia 123']);
        $this->prepararCsrf();
        $login = $this->postJson('/api/auth/login', ['email' => $usuario->email, 'password' => 'Clave ficticia 123'])->assertOk();
        $this->conservarCookies($login);
        DB::table('users')->where('id', $usuario->id)->update(['activo' => false]);
        $salida = $this->getJson('/api/auth/me')->assertUnauthorized();
        $this->conservarCookies($salida);
        $this->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_csrf_rechaza_escrituras_sin_token_o_con_token_incorrecto(): void
    {
        $this->prepararCsrf();
        foreach (['/api/auth/register', '/api/auth/login', '/api/auth/logout'] as $ruta) {
            $this->withHeader('X-XSRF-TOKEN', 'invalido')->postJson($ruta, $this->datos())->assertStatus(419);
            $this->withoutHeader('X-XSRF-TOKEN')->postJson($ruta, $this->datos())->assertStatus(419);
        }
        $this->assertDatabaseCount('users', 0);
    }

    public function test_cookie_de_sesion_http_only_y_respuestas_no_cacheables(): void
    {
        config(['session.secure' => true]);
        $respuesta = $this->prepararCsrf();
        $sesion = $respuesta->getCookie(config('session.cookie'), false);
        $this->assertTrue($sesion->isHttpOnly());
        $this->assertTrue($sesion->isSecure());
        $this->assertSame('lax', $sesion->getSameSite());
        $this->assertFalse($respuesta->getCookie('XSRF-TOKEN', false)->isHttpOnly());
        $registro = $this->postJson('/api/auth/register', $this->datos())->assertCreated();
        $this->assertStringContainsString('no-store', $registro->headers->get('Cache-Control'));
        $this->conservarCookies($registro);
        $sesion = $this->getJson('/api/auth/me')->assertOk();
        $this->assertStringContainsString('no-store', $sesion->headers->get('Cache-Control'));
    }

    public function test_limita_login_por_correo_e_ip_y_registro_por_ip(): void
    {
        $this->prepararCsrf();
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/login', ['email' => 'persona@example.test', 'password' => 'Clave ficticia 123'])->assertUnauthorized();
        }
        $this->postJson('/api/auth/login', ['email' => 'PERSONA@example.test', 'password' => 'Clave ficticia 123'])->assertTooManyRequests()->assertHeader('Retry-After');
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/register', [])->assertUnprocessable();
        }
        $this->postJson('/api/auth/register', $this->datos())->assertTooManyRequests();
        $this->assertDatabaseCount('users', 0);
    }

    public function test_sesion_admin_compartida_conserva_privilegios_y_logout_cierra_filament(): void
    {
        $admin = User::factory()->administrador()->create(['password' => 'Clave ficticia 123']);
        $this->prepararCsrf();
        $login = $this->postJson('/api/auth/login', ['email' => $admin->email, 'password' => 'Clave ficticia 123'])->assertOk();
        $this->conservarCookies($login);
        $this->get('/gestion')->assertOk();
        $this->assertTrue($admin->fresh()->puedeGestionarAcademico());
        $this->postJson('/api/auth/register', $this->datos())->assertConflict();
        $this->assertDatabaseCount('users', 1);
        $this->conservarCookies($login);
        $logout = $this->postJson('/api/auth/logout')->assertNoContent();
        $this->conservarCookies($logout);
        $this->get('/gestion')->assertRedirect('/gestion/login');
        $this->assertSame('administrador_general', $admin->fresh()->rol->value);
    }

    public function test_no_acepta_bearer_como_sesion_publica(): void
    {
        $this->withHeader('Authorization', 'Bearer token-ficticio')->getJson('/api/auth/me')->assertUnauthorized();
    }

    public static function rutasConSesionCompartida(): array
    {
        return [['/api/auth/me'], ['/gestion']];
    }

    #[DataProvider('rutasConSesionCompartida')]
    public function test_sesion_compartida_serializa_peticiones_para_evitar_resucitar_logout(string $ruta): void
    {
        $admin = User::factory()->administrador()->create(['password' => 'Clave ficticia 123']);
        $this->prepararCsrf();
        $login = $this->postJson('/api/auth/login', ['email' => $admin->email, 'password' => 'Clave ficticia 123'])->assertOk();
        $this->conservarCookies($login);
        // Representa otra petición que todavía no terminó de guardar esta sesión.
        $lock = Cache::lock('session:'.$login->getCookie(config('session.cookie'))->getValue(), 10);
        $this->assertTrue($lock->get());
        config(['session.block_wait_seconds' => 0]);
        $this->withoutExceptionHandling();
        try {
            $this->getJson($ruta);
            $this->fail('La petición concurrente no debe leer ni sobrescribir la sesión bloqueada.');
        } catch (LockTimeoutException) {
            // El bloqueo ocurre antes de leer el estado de autenticación.
        } finally {
            $lock->release();
        }
        $this->getJson($ruta)->assertOk();
    }

    public function test_fuera_de_local_exige_https_cookies_seguras_y_sesion_en_servidor(): void
    {
        app()->instance('env', 'production');
        config(['session.secure' => false]);
        $this->getJson('/sanctum/csrf-cookie')->assertServiceUnavailable();
        config(['session.secure' => true, 'session.http_only' => true, 'session.same_site' => 'lax', 'session.driver' => 'database']);
        $this->app->make('session')->forgetDrivers();
        $this->getJson('/sanctum/csrf-cookie')->assertServiceUnavailable();
        $this->getJson('https://localhost/sanctum/csrf-cookie')->assertNoContent();
        config(['session.http_only' => false]);
        $this->getJson('https://localhost/sanctum/csrf-cookie')->assertServiceUnavailable();
        config(['session.http_only' => true, 'session.driver' => 'cookie']);
        $this->getJson('https://localhost/sanctum/csrf-cookie')->assertServiceUnavailable();
    }

    public function test_registro_concurrente_no_expone_error_sql_ni_crea_segunda_cuenta(): void
    {
        $this->prepararCsrf();
        User::creating(function (User $usuario): void {
            // Otra solicitud ganó el UNIQUE entre la validación y nuestro INSERT.
            DB::table('users')->insert([
                'name' => 'Cuenta ganadora', 'email' => $usuario->email,
                'password' => Hash::make('Otra clave ficticia'), 'activo' => true,
            ]);
        });
        $this->postJson('/api/auth/register', $this->datos())->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->assertDatabaseCount('users', 1);
        $this->assertSame('Cuenta ganadora', User::query()->sole()->name);
        Auth::forgetGuards();
        $this->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_el_modo_local_heredado_no_abre_filament_a_cuentas_publicas_ya_creadas(): void
    {
        $this->prepararCsrf();
        $registro = $this->postJson('/api/auth/register', $this->datos())->assertCreated();
        $this->conservarCookies($registro);
        app()->instance('env', 'local');
        config(['seguridad.activar_en_local' => false]);
        $this->assertFalse(User::query()->sole()->canAccessPanel(Filament::getPanel('admin')));
        $this->get('/gestion')->assertForbidden();
        $this->get('/gestion/estudiantes')->assertForbidden();
    }

    public function test_los_errores_son_json_aunque_el_cliente_no_envie_accept(): void
    {
        $this->get('/api/auth/me')->assertUnauthorized()->assertHeader('Content-Type', 'application/json');
    }

    public function test_bloquea_a1_en_el_modo_local_heredado(): void
    {
        $this->prepararCsrf();
        app()->instance('env', 'local');
        config(['seguridad.activar_en_local' => false]);
        $this->getJson('/sanctum/csrf-cookie')->assertServiceUnavailable();
        $this->postJson('/api/auth/register', $this->datos())->assertServiceUnavailable();
        $this->assertDatabaseCount('users', 0);
    }

    public function test_las_rutas_nuevas_no_existen_si_a1_no_esta_habilitado(): void
    {
        putenv('HORUS_PUBLIC_AUTH_ENABLED=false');
        $_ENV['HORUS_PUBLIC_AUTH_ENABLED'] = $_SERVER['HORUS_PUBLIC_AUTH_ENABLED'] = 'false';
        try {
            $this->refreshApplication();
            foreach (['/api/auth/me', '/sanctum/csrf-cookie'] as $ruta) {
                $this->getJson($ruta)->assertNotFound();
            }
            foreach (['register', 'login', 'logout'] as $accion) {
                $this->postJson('/api/auth/'.$accion, [])->assertNotFound();
            }
        } finally {
            putenv('HORUS_PUBLIC_AUTH_ENABLED=true');
            $_ENV['HORUS_PUBLIC_AUTH_ENABLED'] = $_SERVER['HORUS_PUBLIC_AUTH_ENABLED'] = 'true';
        }
    }
}
