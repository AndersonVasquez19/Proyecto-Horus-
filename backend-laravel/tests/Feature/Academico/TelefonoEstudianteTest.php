<?php

namespace Tests\Feature\Academico;

use App\Models\Estudiante;
use App\Support\RestriccionesBd;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

/**
 * Celular peruano del estudiante: opcional; si se indica, 9 dígitos y empieza por 9.
 * Datos ficticios.
 */
class TelefonoEstudianteTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return array<string, array{mixed, string}>
     */
    public static function telefonosValidos(): array
    {
        return [
            'nueve dígitos' => ['987654321', '987654321'],
            'con espacios' => [' 987 654 321 ', '987654321'],
            'con guiones' => ['987-654-321', '987654321'],
            'como entero' => [912345678, '912345678'],
        ];
    }

    #[DataProvider('telefonosValidos')]
    public function test_acepta_y_guarda_como_texto_un_celular_valido(mixed $telefono, string $esperado): void
    {
        $estudiante = Estudiante::factory()->create(['telefono' => $telefono]);

        $guardado = DB::table('estudiantes')->where('id', $estudiante->id)->value('telefono');
        $this->assertIsString($guardado);
        $this->assertSame($esperado, $guardado);
    }

    /**
     * @return array<string, array{string}>
     */
    public static function telefonosInvalidos(): array
    {
        return [
            '8 dígitos' => ['98765432'],
            '10 dígitos' => ['9876543210'],
            'no empieza por 9' => ['887654321'],
            'fijo con código de área' => ['076123456'],
            'con letras' => ['98765432a'],
            'con prefijo +51' => ['+51987654321'],
            'con paréntesis' => ['(987)654321'],
            'con punto' => ['987.654.321'],
        ];
    }

    #[DataProvider('telefonosInvalidos')]
    public function test_rechaza_un_celular_invalido_al_crear(string $telefono): void
    {
        try {
            Estudiante::factory()->create(['telefono' => $telefono]);
            $this->fail('Se aceptó un teléfono inválido.');
        } catch (ValidationException $e) {
            $this->assertSame(['El celular debe tener 9 dígitos y comenzar con 9.'], $e->errors()['telefono']);
        }

        $this->assertSame(0, Estudiante::query()->count());
    }

    #[DataProvider('telefonosInvalidos')]
    public function test_rechaza_un_celular_invalido_al_editar_y_conserva_el_anterior(string $telefono): void
    {
        $estudiante = Estudiante::factory()->create(['telefono' => '987654321']);

        try {
            $estudiante->update(['telefono' => $telefono]);
            $this->fail('Se aceptó un teléfono inválido al editar.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('telefono', $e->errors());
        }

        $this->assertSame('987654321', $estudiante->fresh()->telefono);
    }

    /**
     * @return array<string, array{?string}>
     */
    public static function telefonosVacios(): array
    {
        return [
            'null' => [null],
            'cadena vacía' => [''],
            'solo espacios' => ['   '],
        ];
    }

    #[DataProvider('telefonosVacios')]
    public function test_el_telefono_es_opcional(?string $telefono): void
    {
        $estudiante = Estudiante::factory()->create(['telefono' => $telefono]);

        $this->assertNull($estudiante->fresh()->telefono);
    }

    public function test_se_puede_borrar_el_telefono_al_editar(): void
    {
        $estudiante = Estudiante::factory()->create(['telefono' => '987654321']);

        $estudiante->update(['telefono' => '']);

        $this->assertNull($estudiante->fresh()->telefono);
    }

    public function test_la_base_de_datos_rechaza_un_telefono_invalido_aunque_se_salte_el_modelo(): void
    {
        $estudiante = Estudiante::factory()->create(['telefono' => '987654321']);

        try {
            DB::table('estudiantes')->where('id', $estudiante->id)->update(['telefono' => '12345']);
            $this->fail('La base de datos aceptó un teléfono inválido.');
        } catch (QueryException $e) {
            $this->assertStringContainsString('estudiantes_telefono_valido', $e->getMessage());
        }

        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('estudiantes_telefono_valido');

        DB::table('estudiantes')->insert([
            'tipo_documento' => 'SIN_DOCUMENTO',
            'nombres' => 'Sin',
            'apellidos' => 'Modelo',
            'nombre_busqueda' => 'modelo sin',
            'telefono' => '887654321',
        ]);
    }

    public function test_la_base_de_datos_admite_telefono_nulo_o_valido(): void
    {
        DB::table('estudiantes')->insert([
            ['tipo_documento' => 'SIN_DOCUMENTO', 'nombres' => 'Uno', 'apellidos' => 'Prueba', 'nombre_busqueda' => 'prueba uno', 'telefono' => null],
            ['tipo_documento' => 'SIN_DOCUMENTO', 'nombres' => 'Dos', 'apellidos' => 'Prueba', 'nombre_busqueda' => 'prueba dos', 'telefono' => '912345678'],
        ]);

        $this->assertSame(2, Estudiante::query()->count());
    }

    public function test_el_comando_lista_los_telefonos_invalidos_sin_modificarlos(): void
    {
        $valido = Estudiante::factory()->create(['telefono' => '987654321']);
        // Simula datos anteriores a la regla: se retira la restricción solo en esta prueba.
        RestriccionesBd::eliminar('estudiantes', 'estudiantes_telefono_valido');
        $corto = $this->insertarSinValidar('Corto', '98765');
        $fijo = $this->insertarSinValidar('Fijo', '076123456');

        $this->artisan('estudiantes:revisar-telefonos')
            ->expectsOutputToContain('2 estudiante(s) requieren revisión')
            ->expectsOutputToContain('Tiene 5 dígito(s) en lugar de 9')
            ->expectsOutputToContain('No empieza por 9')
            ->doesntExpectOutputToContain('98765')
            ->assertFailed();

        $this->assertSame('98765', DB::table('estudiantes')->where('id', $corto)->value('telefono'));
        $this->assertSame('076123456', DB::table('estudiantes')->where('id', $fijo)->value('telefono'));
        $this->assertSame('987654321', $valido->fresh()->telefono);
    }

    public function test_el_comando_no_reporta_nada_si_todos_son_validos(): void
    {
        Estudiante::factory()->create(['telefono' => '987654321']);
        Estudiante::factory()->create(['telefono' => null]);

        $this->artisan('estudiantes:revisar-telefonos')
            ->expectsOutputToContain('Todos los teléfonos registrados son válidos')
            ->assertSuccessful();
    }

    public function test_la_migracion_se_detiene_sin_modificar_datos_si_hay_telefonos_invalidos(): void
    {
        $migracion = require database_path('migrations/2026_10_17_160000_add_telefono_valido_to_estudiantes_table.php');
        $migracion->down();
        $id = $this->insertarSinValidar('Historico', '12345');

        try {
            $migracion->up();
            $this->fail('La migración se aplicó con teléfonos inválidos.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString("(id: {$id})", $e->getMessage());
        }

        $this->assertSame('12345', DB::table('estudiantes')->where('id', $id)->value('telefono'));
        $this->assertSame(1, DB::table('estudiantes')->count());
    }

    private function insertarSinValidar(string $nombre, string $telefono): int
    {
        return DB::table('estudiantes')->insertGetId([
            'tipo_documento' => 'SIN_DOCUMENTO',
            'nombres' => $nombre,
            'apellidos' => 'Prueba Ficticia',
            'nombre_busqueda' => 'prueba ficticia '.strtolower($nombre),
            'telefono' => $telefono,
        ]);
    }
}
