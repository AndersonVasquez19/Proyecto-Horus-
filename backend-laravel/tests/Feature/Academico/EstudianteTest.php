<?php

namespace Tests\Feature\Academico;

use App\Enums\TipoDocumento;
use App\Models\Estudiante;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Reglas del estudiante a nivel de modelo y de base de datos (datos ficticios).
 */
class EstudianteTest extends TestCase
{
    use RefreshDatabase;

    public function test_crea_un_estudiante_con_dni_valido(): void
    {
        $estudiante = Estudiante::create([
            'tipo_documento' => 'DNI',
            'numero_documento' => '01234567',
            'nombres' => '  Ana   Lucía ',
            'apellidos' => 'Prueba Ficticia',
            'email' => ' ANA@EXAMPLE.TEST ',
        ]);

        $estudiante->refresh();
        $this->assertSame(TipoDocumento::Dni, $estudiante->tipo_documento);
        // Se guarda como texto: el cero inicial se conserva.
        $this->assertSame('01234567', $estudiante->numero_documento);
        $this->assertSame('Ana Lucía', $estudiante->nombres);
        $this->assertSame('ana@example.test', $estudiante->email);
        $this->assertSame('prueba ficticia ana lucia', $estudiante->nombre_busqueda);
        $this->assertSame('Prueba Ficticia, Ana Lucía', $estudiante->nombre_completo);
    }

    public function test_normaliza_espacios_y_puntos_del_documento(): void
    {
        $estudiante = Estudiante::factory()->create(['numero_documento' => ' 12.345.678 ']);

        $this->assertSame('12345678', $estudiante->fresh()->numero_documento);
    }

    /**
     * @return array<string, array{string}>
     */
    public static function dniInvalidos(): array
    {
        return [
            '7 dígitos' => ['1234567'],
            '9 dígitos' => ['123456789'],
            'con letras' => ['1234567A'],
        ];
    }

    #[DataProvider('dniInvalidos')]
    public function test_rechaza_dni_invalido(string $dni): void
    {
        try {
            Estudiante::factory()->create(['numero_documento' => $dni]);
            $this->fail('Se aceptó un DNI inválido.');
        } catch (ValidationException $e) {
            $this->assertSame(['El DNI debe tener exactamente 8 dígitos.'], $e->errors()['numero_documento']);
        }

        $this->assertSame(0, Estudiante::query()->count());
    }

    public function test_la_base_de_datos_rechaza_un_dni_invalido_aunque_se_salte_el_modelo(): void
    {
        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('estudiantes_documento_valido');

        DB::table('estudiantes')->insert([
            'tipo_documento' => 'DNI',
            'numero_documento' => '123',
            'nombres' => 'Sin',
            'apellidos' => 'Modelo',
            'nombre_busqueda' => 'modelo sin',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_la_base_de_datos_rechaza_dni_sin_numero(): void
    {
        $this->expectException(QueryException::class);

        DB::table('estudiantes')->insert([
            'tipo_documento' => 'DNI',
            'numero_documento' => null,
            'nombres' => 'Sin',
            'apellidos' => 'Numero',
            'nombre_busqueda' => 'numero sin',
        ]);
    }

    public function test_rechaza_documento_duplicado(): void
    {
        Estudiante::factory()->create(['numero_documento' => '44556677']);

        try {
            Estudiante::factory()->create(['numero_documento' => '44556677']);
            $this->fail('Se aceptó un documento duplicado.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('numero_documento', $e->errors());
        }

        $this->assertSame(1, Estudiante::query()->where('numero_documento', '44556677')->count());
    }

    public function test_la_base_de_datos_rechaza_documento_duplicado(): void
    {
        Estudiante::factory()->create(['numero_documento' => '44556677']);

        $this->expectException(UniqueConstraintViolationException::class);

        DB::table('estudiantes')->insert([
            'tipo_documento' => 'DNI',
            'numero_documento' => '44556677',
            'nombres' => 'Otra',
            'apellidos' => 'Persona',
            'nombre_busqueda' => 'persona otra',
        ]);
    }

    public function test_el_mismo_numero_con_otro_tipo_de_documento_es_otro_documento(): void
    {
        Estudiante::factory()->create(['tipo_documento' => 'DNI', 'numero_documento' => '44556677']);
        Estudiante::factory()->create(['tipo_documento' => 'CE', 'numero_documento' => '44556677']);

        $this->assertSame(2, Estudiante::query()->count());
    }

    public function test_permite_estudiantes_sin_documento(): void
    {
        Estudiante::factory()->sinDocumento()->create();
        Estudiante::factory()->sinDocumento()->create();

        $this->assertSame(2, Estudiante::query()->whereNull('numero_documento')->count());
        $this->assertSame('Sin documento registrado', Estudiante::query()->first()->documento);
    }

    public function test_sin_documento_no_admite_un_numero(): void
    {
        $this->expectException(ValidationException::class);

        Estudiante::factory()->create(['tipo_documento' => 'SIN_DOCUMENTO', 'numero_documento' => '12345678']);
    }

    public function test_dni_exige_numero(): void
    {
        $this->expectException(ValidationException::class);

        Estudiante::factory()->create(['tipo_documento' => 'DNI', 'numero_documento' => null]);
    }

    public function test_marca_homonimos_como_posibles_coincidencias_sin_fusionarlos(): void
    {
        $conDni = Estudiante::factory()->create(['nombres' => 'José', 'apellidos' => 'Pérez Ruiz']);
        $sinDni = Estudiante::factory()->sinDocumento()->create(['nombres' => 'JOSE', 'apellidos' => 'perez ruiz']);
        Estudiante::factory()->create(['nombres' => 'Otra', 'apellidos' => 'Persona']);

        // Se crean dos registros distintos: no se asume que sea la misma persona ni se fusionan.
        $this->assertNotSame($conDni->getKey(), $sinDni->getKey());
        $this->assertSame([$conDni->getKey()], $sinDni->posiblesCoincidencias()->pluck('id')->all());
        $this->assertEqualsCanonicalizing(
            [$conDni->getKey(), $sinDni->getKey()],
            Estudiante::query()->conPosiblesCoincidencias()->pluck('id')->all(),
        );
    }

    public function test_busca_por_dni_o_por_nombre_sin_tildes(): void
    {
        $ana = Estudiante::factory()->create(['numero_documento' => '70112233', 'nombres' => 'Ana María', 'apellidos' => 'Quispe Chávez']);
        Estudiante::factory()->create(['numero_documento' => '70998877', 'nombres' => 'Luis', 'apellidos' => 'Torres']);

        $this->assertSame([$ana->getKey()], Estudiante::query()->buscar('70112233')->pluck('id')->all());
        $this->assertSame([$ana->getKey()], Estudiante::query()->buscar('7011')->pluck('id')->all());
        $this->assertSame([$ana->getKey()], Estudiante::query()->buscar('chavez maria')->pluck('id')->all());
        $this->assertSame([$ana->getKey()], Estudiante::query()->buscar('QUISPE')->pluck('id')->all());
        $this->assertSame([], Estudiante::query()->buscar('Inexistente')->pluck('id')->all());
    }
}
