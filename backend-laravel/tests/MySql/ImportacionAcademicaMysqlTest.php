<?php

namespace Tests\MySql;

use App\Enums\EstadoMatricula;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\ImportacionAcademica;
use App\Models\Matricula;
use App\Models\User;
use App\Support\ImportacionAcademica\EjecutorImportacion;
use App\Support\ImportacionAcademica\ImportacionRechazadaException;
use App\Support\ImportacionAcademica\OpcionesImportacion;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\ArchivosImportacion;

/**
 * Importación académica con InnoDB real (base temporal horus_laravel_it_<hex>).
 * Datos ficticios; los datos se confirman de verdad y una segunda conexión los ve.
 */
class ImportacionAcademicaMysqlTest extends MysqlTestCase
{
    use ArchivosImportacion, DatabaseTruncation;

    private const CSV = "DNI;Apellidos;Nombres;Celular\n70000001;Prueba Ficticia;Ana;987654321\n70000002;Otra Prueba;Luis;\n70000003;Tercera Prueba;Rosa;\n";

    private User $admin;

    private Edicion $edicion;

    protected function setUp(): void
    {
        parent::setUp();
        $this->prepararAlmacenFalso();
        $this->admin = User::factory()->administrador()->create();
        $this->actingAs($this->admin);
        $this->edicion = Edicion::factory()->for(Curso::factory()->create(['nombre' => 'Seguridad y Salud Ocupacional']))->create(['nombre' => '2024', 'cupo' => 3]);
        config(['database.connections.mysql_b' => config('database.connections.mysql')]);
    }

    protected function tearDown(): void
    {
        DB::purge('mysql_b');
        parent::tearDown();
    }

    private function opciones(): OpcionesImportacion
    {
        return new OpcionesImportacion(edicionDestinoId: $this->edicion->id);
    }

    public function test_importacion_completa_con_historial_y_restricciones_en_innodb(): void
    {
        Estudiante::factory()->create(['numero_documento' => '70000002', 'apellidos' => 'Otra Prueba', 'nombres' => 'Luis']);
        [$archivo, $plan] = $this->analizarRuta($this->archivoCsv(self::CSV), $this->opciones());
        $lote = app(EjecutorImportacion::class)->confirmar($this->admin, $archivo, $this->opciones(), $plan->huella);

        $this->assertSame([3, 3, 2], [$lote->filas_total, $lote->matriculas_creadas, $lote->estudiantes_creados]);
        $this->assertSame(3, $this->edicion->fresh()->matriculasQueOcupanCupo());
        $this->assertSame(3, DB::table('matricula_movimientos')->where('tipo', 'CREACION')->where('motivo', 'Importación académica #'.$lote->id)->count());
        $this->assertSame(3, DB::connection('mysql_b')->table('importacion_academica_filas')->where('importacion_academica_id', $lote->id)->count(), 'Confirmado y visible desde otra conexión.');
        $this->assertSame(EstadoMatricula::Matriculado, Matricula::query()->firstOrFail()->estado);

        // CHECK en binario: MySQL no acepta variantes en minúsculas o con espacios finales.
        $base = ['importacion_academica_id' => $lote->id, 'operacion' => 'NINGUNA', 'created_at' => now()];
        foreach (['omitida', 'OMITIDA ', 'OTRA'] as $i => $resultado) {
            $this->assertRechazado(fn () => DB::table('importacion_academica_filas')->insert([...$base, 'fila' => 100 + $i, 'resultado' => $resultado]));
        }
        $this->assertRechazado(fn () => DB::table('importacion_academica_filas')->insert([...$base, 'fila' => 110, 'resultado' => 'IMPORTADA', 'operacion' => 'CREAR_ESTUDIANTE_Y_MATRICULAR']));
        $this->assertRechazado(fn () => DB::table('importaciones_academicas')->insert(array_replace($lote->getAttributes(), [
            'id' => null, 'uuid' => (string) Str::uuid(), 'huella' => str_repeat('b', 64), 'formato' => 'CSV',
        ])));
        // RESTRICT: nada referenciado por el lote se borra en cascada.
        $this->assertRechazado(fn () => DB::table('matriculas')->where('id', $lote->filas()->value('matricula_id'))->delete());
        $this->assertRechazado(fn () => DB::table('importaciones_academicas')->where('id', $lote->id)->delete());
    }

    public function test_un_cambio_confirmado_por_otra_conexion_detiene_la_importacion(): void
    {
        [$archivo, $plan] = $this->analizarRuta($this->archivoCsv(self::CSV), $this->opciones());
        $otro = Estudiante::factory()->create(['numero_documento' => '70000099']);
        DB::connection('mysql_b')->table('matriculas')->insert(['estudiante_id' => $otro->id, 'edicion_id' => $this->edicion->id, 'estado' => 'MATRICULADO']);

        try {
            app(EjecutorImportacion::class)->confirmar($this->admin, $archivo, $this->opciones(), $plan->huella);
            $this->fail('La importación debía detenerse.');
        } catch (ImportacionRechazadaException $e) {
            $this->assertStringContainsString('cambiaron desde la vista previa', $e->getMessage());
            $this->assertSame(2, $e->planActualizado?->operaciones());
        }

        $this->assertSame(0, ImportacionAcademica::query()->count());
        $this->assertSame(1, Estudiante::query()->count());
        $this->assertSame(1, $this->edicion->fresh()->matriculasQueOcupanCupo());
    }

    public function test_una_confirmacion_simultanea_con_la_misma_ficha_se_traduce_y_revierte(): void
    {
        [$archivo, $plan] = $this->analizarRuta($this->archivoCsv(self::CSV), $this->opciones());
        $admin = $this->admin;
        $pendiente = true;

        // Otra conexión registra la misma ficha justo antes del INSERT del lote (doble envío en carrera).
        // Un solo uso: no se borran los oyentes propios del modelo (protección de solo lectura).
        ImportacionAcademica::creating(function () use ($archivo, $admin, &$pendiente): void {
            if (! $pendiente) {
                return;
            }

            $pendiente = false;
            DB::connection('mysql_b')->table('importaciones_academicas')->insert([
                'uuid' => $archivo->token, 'huella' => str_repeat('c', 64), 'user_id' => $admin->id, 'edicion_id' => null,
                'nombre_archivo' => 'otra.csv', 'formato' => 'csv', 'hoja' => null, 'archivo_sha256' => str_repeat('d', 64),
                'filas_total' => 0, 'filas_importadas' => 0, 'filas_omitidas' => 0, 'filas_rechazadas' => 0,
                'estudiantes_creados' => 0, 'matriculas_creadas' => 0, 'created_at' => now(),
            ]);
        });

        try {
            app(EjecutorImportacion::class)->confirmar($this->admin, $archivo, $this->opciones(), $plan->huella);
            $this->fail('La segunda confirmación debía rechazarse.');
        } catch (ImportacionRechazadaException $e) {
            $this->assertStringContainsString('ya fue confirmada', $e->getMessage());
        }

        $this->assertFalse($pendiente);

        $this->assertSame(1, ImportacionAcademica::query()->count(), 'Solo la registrada por la otra conexión.');
        $this->assertSame(0, Estudiante::query()->count());
        $this->assertSame(0, Matricula::query()->count());
    }

    private function assertRechazado(callable $operacion): void
    {
        try {
            $operacion();
            $this->fail('MySQL aceptó una fila que debía rechazar.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
    }
}
