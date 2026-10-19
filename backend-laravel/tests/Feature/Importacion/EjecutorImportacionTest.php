<?php

namespace Tests\Feature\Importacion;

use App\Enums\EstadoEdicion;
use App\Enums\EstadoMatricula;
use App\Enums\TipoMovimientoMatricula;
use App\Exceptions\RegistroProtegidoException;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\ImportacionAcademica;
use App\Models\ImportacionAcademicaFila;
use App\Models\Matricula;
use App\Models\User;
use App\Support\ImportacionAcademica\AlmacenImportaciones;
use App\Support\ImportacionAcademica\ArchivoNoValidoException;
use App\Support\ImportacionAcademica\ArchivoPreparado;
use App\Support\ImportacionAcademica\EjecutorImportacion;
use App\Support\ImportacionAcademica\ImportacionRechazadaException;
use App\Support\ImportacionAcademica\OpcionesImportacion;
use App\Support\ImportacionAcademica\PlanImportacion;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ArchivosImportacion;
use Tests\TestCase;

/**
 * Confirmación de la importación: todo o nada, sin duplicados y con historial. Datos ficticios.
 */
class EjecutorImportacionTest extends TestCase
{
    use ArchivosImportacion, RefreshDatabase;

    private const CSV = "DNI;Apellidos;Nombres;Celular\n70000001;Prueba Ficticia;Ana;987654321\n70000002;Otra Prueba;Luis;\n;Sin Documento;Rosa;\n";

    private User $admin;

    private Edicion $edicion;

    protected function setUp(): void
    {
        parent::setUp();
        $this->prepararAlmacenFalso();
        $this->admin = User::factory()->administrador()->create();
        $this->actingAs($this->admin);
        $this->edicion = Edicion::factory()->for(Curso::factory()->create(['nombre' => 'Inyectables']))->create(['nombre' => '2024-I']);
    }

    private function opciones(): OpcionesImportacion
    {
        return new OpcionesImportacion(edicionDestinoId: $this->edicion->id);
    }

    /**
     * @return array{ArchivoPreparado, PlanImportacion}
     */
    private function vistaPrevia(string $csv = self::CSV): array
    {
        return $this->analizarRuta($this->archivoCsv($csv), $this->opciones());
    }

    private function confirmar(ArchivoPreparado $archivo, PlanImportacion $plan, ?User $usuario = null): ImportacionAcademica
    {
        return app(EjecutorImportacion::class)->confirmar($usuario ?? $this->admin, $archivo, $this->opciones(), $plan->huella);
    }

    private function esperarRechazo(callable $operacion, string $fragmento): ImportacionRechazadaException
    {
        try {
            $operacion();
        } catch (ImportacionRechazadaException $e) {
            $this->assertStringContainsString($fragmento, $e->getMessage());

            return $e;
        }

        $this->fail('Se esperaba que la importación se rechazara.');
    }

    public function test_importa_las_filas_validas_y_registra_el_resultado_de_cada_fila(): void
    {
        [$archivo, $plan] = $this->vistaPrevia();
        $lote = $this->confirmar($archivo, $plan);

        $this->assertSame(
            ['filas_total' => 3, 'filas_importadas' => 2, 'filas_omitidas' => 0, 'filas_rechazadas' => 1, 'estudiantes_creados' => 2, 'matriculas_creadas' => 2],
            $lote->only(['filas_total', 'filas_importadas', 'filas_omitidas', 'filas_rechazadas', 'estudiantes_creados', 'matriculas_creadas']),
        );
        $this->assertSame($this->admin->id, $lote->user_id);
        $this->assertSame($this->edicion->id, $lote->edicion_id);
        $this->assertSame('matriculas.csv', $lote->nombre_archivo);
        $this->assertSame($archivo->token, $lote->uuid);

        $ana = Estudiante::query()->where('numero_documento', '70000001')->sole();
        $this->assertSame(['Prueba Ficticia', 'Ana', '987654321'], [$ana->apellidos, $ana->nombres, $ana->telefono]);
        $matricula = Matricula::query()->where('estudiante_id', $ana->id)->sole();
        $this->assertSame(EstadoMatricula::Matriculado, $matricula->estado, 'Nunca se confirma ni culmina automáticamente.');
        $this->assertSame($this->edicion->id, $matricula->edicion_id);
        $this->assertNull($matricula->fecha_matricula, 'Sin fecha en el archivo, no se inventa.');
        $this->assertDatabaseMissing('estudiantes', ['nombres' => 'Rosa']);

        $filas = $lote->filas()->orderBy('fila')->get();
        $this->assertSame([2, 3, 4], $filas->pluck('fila')->all());
        $this->assertSame([ImportacionAcademicaFila::IMPORTADA, ImportacionAcademicaFila::IMPORTADA, ImportacionAcademicaFila::RECHAZADA], $filas->pluck('resultado')->all());
        $this->assertSame($matricula->id, $filas[0]->matricula_id);
        $this->assertSame(PlanImportacion::CREAR_Y_MATRICULAR, $filas[0]->operacion);
        $this->assertStringContainsString('Falta el número de documento', $filas[2]->detalle);
        $this->assertNull($filas[2]->estudiante_id);

        // El archivo temporal se borra al terminar.
        $this->assertFalse(app(AlmacenImportaciones::class)->existe($archivo->token, 'csv'));
    }

    public function test_importa_xlsx_con_curso_y_edicion_por_fila(): void
    {
        $otra = Edicion::factory()->for(Curso::factory()->create(['nombre' => 'Salud Mental', 'codigo' => 'SM']))->create(['nombre' => '2024', 'estado' => EstadoEdicion::Finalizada]);
        $ruta = $this->archivoXlsx(['Lista' => [
            ['DNI', 'Apellidos', 'Nombres', 'Curso', 'Edición', 'Fecha de matrícula'],
            [70000001, 'Prueba', 'Ana', 'Inyectables', '2024-I', $this->celdaFecha('2024-02-01')],
            [70000001, 'Prueba', 'Ana', 'SM', '2024', null],
        ]]);
        $archivo = $this->preparar($ruta);
        $opciones = new OpcionesImportacion;
        $plan = $this->analizarPreparado($archivo, $opciones);

        $lote = app(EjecutorImportacion::class)->confirmar($this->admin, $archivo, $opciones, $plan->huella);

        $this->assertSame([1, 2], [$lote->estudiantes_creados, $lote->matriculas_creadas]);
        $this->assertNull($lote->edicion_id);
        $this->assertSame('Lista', $lote->hoja);
        $ana = Estudiante::query()->where('numero_documento', '70000001')->sole();
        $this->assertEqualsCanonicalizing([$this->edicion->id, $otra->id], $ana->matriculas()->pluck('edicion_id')->all());
        $this->assertSame('2024-02-01', $ana->matriculas()->where('edicion_id', $this->edicion->id)->sole()->fecha_matricula->format('Y-m-d'));
        $this->assertNull($ana->matriculas()->where('edicion_id', $otra->id)->sole()->fecha_matricula);
    }

    public function test_no_modifica_estudiantes_ni_matriculas_existentes(): void
    {
        $existente = Estudiante::factory()->create(['numero_documento' => '70000001', 'apellidos' => 'Prueba Ficticia', 'nombres' => 'Ana', 'telefono' => '911111111', 'email' => 'original@ejemplo.test']);
        $otro = Estudiante::factory()->create(['numero_documento' => '70000002', 'apellidos' => 'Otra Prueba', 'nombres' => 'Luis']);
        $anulada = Matricula::factory()->create(['estudiante_id' => $otro->id, 'edicion_id' => $this->edicion->id]);
        $anulada->update(['estado' => EstadoMatricula::Anulado]);
        $antesEstudiante = $existente->fresh()->getAttributes();
        $antesMatricula = $anulada->fresh()->getAttributes();
        $movimientosPrevios = DB::table('matricula_movimientos')->count();

        [$archivo, $plan] = $this->vistaPrevia();
        $lote = $this->confirmar($archivo, $plan);

        $this->assertSame($antesEstudiante, $existente->fresh()->getAttributes(), 'El estudiante existente no se modifica (ni el celular).');
        $this->assertSame($antesMatricula, $anulada->fresh()->getAttributes(), 'La matrícula anulada no se reactiva.');
        $this->assertSame([1, 1, 1, 0], [$lote->filas_importadas, $lote->filas_omitidas, $lote->filas_rechazadas, $lote->estudiantes_creados]);
        $omitida = $lote->filas()->where('resultado', ImportacionAcademicaFila::OMITIDA)->sole();
        $this->assertSame($anulada->id, $omitida->matricula_id);
        $this->assertSame(PlanImportacion::NINGUNA, $omitida->operacion);
        $this->assertSame($movimientosPrevios + 1, DB::table('matricula_movimientos')->count(), 'Solo se registra el alta nueva.');
    }

    public function test_registra_el_historial_de_cada_matricula_con_el_responsable_y_el_lote(): void
    {
        [$archivo, $plan] = $this->vistaPrevia();
        $lote = $this->confirmar($archivo, $plan);

        $movimientos = DB::table('matricula_movimientos')->get();
        $this->assertCount(2, $movimientos);

        foreach ($movimientos as $movimiento) {
            $this->assertSame(TipoMovimientoMatricula::Creacion->value, $movimiento->tipo);
            $this->assertSame(EstadoMatricula::Matriculado->value, $movimiento->estado_nuevo);
            $this->assertSame($this->admin->id, (int) $movimiento->user_id);
            $this->assertSame('Importación académica #'.$lote->id, $movimiento->motivo);
        }
    }

    public function test_el_lote_y_sus_filas_son_de_solo_lectura(): void
    {
        [$archivo, $plan] = $this->vistaPrevia();
        $lote = $this->confirmar($archivo, $plan);
        $fila = $lote->filas()->first();

        foreach ([fn () => $lote->forceFill(['filas_total' => 99])->save(), fn () => $lote->delete(),
            fn () => $fila->forceFill(['detalle' => 'cambiado'])->save(), fn () => $fila->delete()] as $operacion) {
            try {
                $operacion();
                $this->fail('El registro de importación no debe poder modificarse ni eliminarse.');
            } catch (RegistroProtegidoException) {
                $this->addToAssertionCount(1);
            }
        }

        // Las matrículas importadas siguen protegidas como cualquier otra.
        $this->expectException(RegistroProtegidoException::class);
        Matricula::query()->firstOrFail()->delete();
    }

    public function test_integridad_referencial_y_restricciones_de_las_tablas_de_importacion(): void
    {
        [$archivo, $plan] = $this->vistaPrevia();
        $lote = $this->confirmar($archivo, $plan);
        $base = ['importacion_academica_id' => $lote->id, 'created_at' => now()];

        $casos = [
            'matrícula inexistente' => [...$base, 'fila' => 90, 'resultado' => 'IMPORTADA', 'operacion' => PlanImportacion::CREAR_Y_MATRICULAR, 'estudiante_id' => Estudiante::query()->value('id'), 'matricula_id' => 999999],
            'lote inexistente' => [...$base, 'importacion_academica_id' => 999999, 'fila' => 91, 'resultado' => 'OMITIDA', 'operacion' => 'NINGUNA'],
            'importada sin matrícula' => [...$base, 'fila' => 92, 'resultado' => 'IMPORTADA', 'operacion' => PlanImportacion::CREAR_Y_MATRICULAR],
            'resultado desconocido' => [...$base, 'fila' => 93, 'resultado' => 'importada', 'operacion' => 'NINGUNA'],
            'omitida con operación' => [...$base, 'fila' => 94, 'resultado' => 'OMITIDA', 'operacion' => PlanImportacion::CREAR_Y_MATRICULAR],
            'fila repetida' => [...$base, 'fila' => 2, 'resultado' => 'OMITIDA', 'operacion' => 'NINGUNA'],
        ];

        foreach ($casos as $caso => $datos) {
            try {
                DB::table('importacion_academica_filas')->insert($datos);
                $this->fail("La base de datos aceptó: {$caso}.");
            } catch (QueryException) {
                $this->addToAssertionCount(1);
            }
        }

        try {
            DB::table('importaciones_academicas')->insert(array_replace($lote->getAttributes(), ['id' => null, 'uuid' => (string) Str::uuid(), 'huella' => str_repeat('a', 64), 'filas_total' => 50]));
            $this->fail('La base de datos aceptó totales incoherentes.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        // No se puede borrar en cascada nada referenciado por el lote.
        $this->expectException(QueryException::class);
        DB::table('matriculas')->where('id', $lote->filas()->whereNotNull('matricula_id')->value('matricula_id'))->delete();
    }

    public function test_doble_confirmacion_de_la_misma_vista_previa_no_duplica_nada(): void
    {
        [$archivo, $plan] = $this->vistaPrevia();
        $this->confirmar($archivo, $plan);
        $despues = $this->recuentoAcademico();

        // El archivo se borró al confirmar: se restituye para comprobar el bloqueo por ficha.
        Storage::disk('local')->put(AlmacenImportaciones::DIRECTORIO.'/'.$archivo->token.'.csv', self::CSV);
        $this->esperarRechazo(fn () => $this->confirmar($archivo, $plan), 'ya fue confirmada');
        $this->assertSame($despues, $this->recuentoAcademico());
    }

    public function test_el_mismo_archivo_no_se_importa_dos_veces_en_el_mismo_destino(): void
    {
        [$archivo, $plan] = $this->vistaPrevia();
        $this->confirmar($archivo, $plan);
        $despues = $this->recuentoAcademico();

        // Nueva subida del mismo contenido (otra ficha): no hay nada que importar y se informa del lote previo.
        [$otraSubida, $otroPlan] = $this->vistaPrevia();
        $this->assertSame(0, $otroPlan->operaciones());
        $this->esperarRechazo(fn () => $this->confirmar($otraSubida, $otroPlan), 'ya se importó');

        $this->assertSame($despues, $this->recuentoAcademico());
    }

    public function test_reimportar_el_mismo_archivo_se_bloquea_aunque_vuelva_a_tener_filas_validas(): void
    {
        $this->edicion->update(['cupo' => 1]);
        [$archivo, $plan] = $this->vistaPrevia();
        $this->assertSame(1, $this->confirmar($archivo, $plan)->matriculas_creadas, 'La segunda fila no cabía.');

        // Se amplía el cupo y se vuelve a subir el mismo archivo: ahora la segunda fila sería válida...
        $this->edicion->update(['cupo' => 5]);
        [$otraSubida, $otroPlan] = $this->vistaPrevia();
        $this->assertSame(1, $otroPlan->operaciones());
        $antes = $this->recuentoAcademico();

        // ...pero el mismo contenido en el mismo destino no se importa dos veces (huella UNIQUE del lote).
        $this->esperarRechazo(fn () => $this->confirmar($otraSubida, $otroPlan), 'ya se importó');
        $this->assertSame($antes, $this->recuentoAcademico());
        $this->assertSame(1, ImportacionAcademica::query()->count());
    }

    public function test_si_el_estado_academico_cambia_tras_la_vista_previa_no_importa_nada(): void
    {
        $this->edicion->update(['cupo' => 2]);
        [$archivo, $plan] = $this->vistaPrevia();
        $this->assertSame(2, $plan->operaciones());

        // Otra persona ocupa una plaza entre la vista previa y la confirmación.
        Matricula::factory()->create(['edicion_id' => $this->edicion->id]);
        $antes = $this->recuentoAcademico();

        $e = $this->esperarRechazo(fn () => $this->confirmar($archivo, $plan), 'cambiaron desde la vista previa');

        $this->assertSame($antes, $this->recuentoAcademico());
        $this->assertNotNull($e->planActualizado);
        $this->assertSame(1, $e->planActualizado->operaciones(), 'El plan actualizado muestra la nueva situación.');
        $this->assertTrue(app(AlmacenImportaciones::class)->existe($archivo->token, 'csv'), 'El archivo se conserva para revisar y volver a confirmar.');

        $lote = app(EjecutorImportacion::class)->confirmar($this->admin, $archivo, $this->opciones(), $e->planActualizado->huella);
        $this->assertSame(1, $lote->matriculas_creadas);
        $this->assertSame(2, $this->edicion->matriculasQueOcupanCupo());
    }

    public function test_si_la_edicion_se_cancela_tras_la_vista_previa_no_importa_nada(): void
    {
        [$archivo, $plan] = $this->vistaPrevia();
        $this->edicion->update(['estado' => EstadoEdicion::Cancelada]);
        $antes = $this->recuentoAcademico();

        $this->esperarRechazo(fn () => $this->confirmar($archivo, $plan), 'No hay filas válidas');
        $this->assertSame($antes, $this->recuentoAcademico());
    }

    public function test_un_archivo_alterado_tras_la_vista_previa_se_rechaza(): void
    {
        [$archivo, $plan] = $this->vistaPrevia();
        file_put_contents(app(AlmacenImportaciones::class)->ruta($archivo->token, 'csv'), "DNI;Apellidos;Nombres\n70000009;Intruso;Otro\n");

        $this->esperarRechazo(fn () => $this->confirmar($archivo, $plan), 'cambió desde la vista previa');
        $this->assertSame(0, Estudiante::query()->count());

        $falso = new ArchivoPreparado('../../.env', 'csv', 'x.csv', str_repeat('0', 64));
        $this->expectException(ArchivoNoValidoException::class);
        app(EjecutorImportacion::class)->confirmar($this->admin, $falso, $this->opciones(), $plan->huella);
    }

    public function test_un_fallo_a_mitad_de_la_importacion_revierte_todo(): void
    {
        [$archivo, $plan] = $this->vistaPrevia("DNI;Apellidos;Nombres\n70000001;Prueba;Ana\n70000002;Prueba;Luis\n70000003;Prueba;Rosa\n");
        // Fallo simulado de la base de datos al insertar la tercera matrícula (después de dos correctas).
        DB::unprepared("CREATE TRIGGER fallo_simulado BEFORE INSERT ON matriculas WHEN (SELECT numero_documento FROM estudiantes WHERE id = NEW.estudiante_id) = '70000003' BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END;");
        $antes = $this->recuentoAcademico();
        Log::spy();

        $this->esperarRechazo(fn () => $this->confirmar($archivo, $plan), 'No se importó ningún registro');

        $this->assertSame($antes, $this->recuentoAcademico(), 'Ni estudiantes, ni matrículas, ni historial, ni lote.');
        // El registro técnico no incluye SQL, mensajes ni datos de las filas.
        Log::shouldHaveReceived('warning')->once()->withArgs(function (string $mensaje, array $contexto): bool {
            return $mensaje === 'importacion_academica.fallo'
                && array_keys($contexto) === ['importacion', 'fila', 'excepcion', 'sqlstate']
                && ! str_contains(json_encode($contexto), '7000000');
        });
    }

    public static function cuentasSinPermiso(): array
    {
        return [
            'cuenta básica' => [null, true],
            'secretaría' => ['secretaria', true],
            'administrador inactivo' => ['administrador_general', false],
            'coordinador inactivo' => ['coordinador_institucional', false],
        ];
    }

    #[DataProvider('cuentasSinPermiso')]
    public function test_solo_cuentas_academicas_activas_pueden_confirmar(?string $rol, bool $activo): void
    {
        [$archivo, $plan] = $this->vistaPrevia();
        $usuario = User::factory()->create(['rol' => $rol, 'activo' => $activo]);
        $this->actingAs($usuario);
        $antes = $this->recuentoAcademico();

        try {
            $this->confirmar($archivo, $plan, $usuario);
            $this->fail('Una cuenta sin permiso académico no debe importar.');
        } catch (AuthorizationException) {
            $this->assertSame($antes, $this->recuentoAcademico());
        }
    }

    public function test_el_coordinador_activo_puede_importar(): void
    {
        $coordinador = User::factory()->coordinador()->create();
        $this->actingAs($coordinador);
        [$archivo, $plan] = $this->vistaPrevia();

        $this->assertSame($coordinador->id, $this->confirmar($archivo, $plan, $coordinador)->user_id);
    }

    public function test_una_cuenta_desactivada_despues_de_la_vista_previa_ya_no_puede_confirmar(): void
    {
        [$archivo, $plan] = $this->vistaPrevia();
        // Desactivación persistida; el modelo en memoria aún dice «activo».
        User::query()->whereKey($this->admin->id)->update(['activo' => false]);

        $this->expectException(AuthorizationException::class);
        $this->confirmar($archivo, $plan);
    }
}
