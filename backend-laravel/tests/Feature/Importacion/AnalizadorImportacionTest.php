<?php

namespace Tests\Feature\Importacion;

use App\Enums\EstadoEdicion;
use App\Enums\EstadoMatricula;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use App\Support\ImportacionAcademica\CamposImportacion;
use App\Support\ImportacionAcademica\OpcionesImportacion;
use App\Support\ImportacionAcademica\PlanImportacion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\ArchivosImportacion;
use Tests\TestCase;

/**
 * Vista previa: validaciones, duplicados, destino y cupo. Nunca escribe. Datos ficticios.
 */
class AnalizadorImportacionTest extends TestCase
{
    use ArchivosImportacion, RefreshDatabase;

    private Edicion $edicion;

    protected function setUp(): void
    {
        parent::setUp();
        $this->prepararAlmacenFalso();
        $curso = Curso::factory()->create(['nombre' => 'Primeros Auxilios', 'codigo' => 'PA']);
        $this->edicion = Edicion::factory()->for($curso)->create(['nombre' => '2024-I']);
    }

    private function opciones(?Edicion $edicion = null, string $formato = CamposImportacion::NOMBRE_CON_COMA, ?array $mapeo = null, ?string $hoja = null): OpcionesImportacion
    {
        return new OpcionesImportacion($hoja, ($edicion ?? $this->edicion)->id, $formato, $mapeo);
    }

    private function plan(string $csv, ?OpcionesImportacion $opciones = null): PlanImportacion
    {
        return $this->analizarRuta($this->archivoCsv($csv), $opciones ?? $this->opciones())[1];
    }

    /**
     * @return list<string>
     */
    private function mensajes(PlanImportacion $plan, int $fila): array
    {
        return [...$plan->filas[$fila]['errores'], ...$plan->filas[$fila]['avisos']];
    }

    private function assertMensaje(PlanImportacion $plan, int $fila, string $fragmento): void
    {
        $this->assertStringContainsString($fragmento, implode(' | ', $this->mensajes($plan, $fila)), "Fila {$fila}");
    }

    public function test_csv_valido_propone_registrar_estudiantes_y_matriculas(): void
    {
        $plan = $this->plan("DNI;Apellidos;Nombres;Celular;Correo\n70000001;Prueba Ficticia;Ana María;987 654 321;ANA@EJEMPLO.TEST\n70000002;Otra Prueba;Luis;;\n");

        $this->assertSame([], $plan->erroresEstructura);
        $this->assertTrue($plan->puedeConfirmarse());
        $this->assertSame(2, $plan->resumen()['validas']);
        $this->assertSame(2, $plan->resumen()['estudiantes_nuevos']);
        $fila = $plan->filas[2];
        $this->assertSame(PlanImportacion::CREAR_Y_MATRICULAR, $fila['operacion']);
        $this->assertSame(['70000001', 'Prueba Ficticia', 'Ana María', '987654321', 'ana@ejemplo.test'], [$fila['numero_documento'], $fila['apellidos'], $fila['nombres'], $fila['telefono'], $fila['email']]);
        $this->assertSame($this->edicion->id, $fila['edicion_id']);
        $this->assertSame('Primeros Auxilios — 2024-I', $fila['destino']);
        $this->assertSame([$this->edicion->id => ['etiqueta' => 'Primeros Auxilios — 2024-I', 'matriculas' => 2, 'plazas_libres' => null]], $plan->destinos);
    }

    public function test_xlsx_valido_con_dni_numerico_y_fecha(): void
    {
        $ruta = $this->archivoXlsx(['Lista' => [
            ['DNI', 'Apellidos', 'Nombres', 'Fecha de matrícula'],
            [70000001, 'Prueba Ficticia', 'Ana', $this->celdaFecha('2024-03-15')],
            ['70000002', 'Otra Prueba', 'Luis', '16/03/2024'],
            ['70000003', 'Sin Formato', 'Rosa', 45366],
        ]]);
        $plan = $this->analizarRuta($ruta, $this->opciones())[1];

        $this->assertSame(2, $plan->operaciones());
        // Un número en la columna de fecha no se convierte por deducción.
        $this->assertSame(PlanImportacion::INVALIDA, $plan->filas[4]['estado']);
        $this->assertMensaje($plan, 4, 'aplique el formato de fecha');
        $this->assertSame('70000001', $plan->filas[2]['numero_documento']);
        $this->assertSame('2024-03-15', $plan->filas[2]['fecha_matricula']);
        $this->assertSame('2024-03-16', $plan->filas[3]['fecha_matricula']);
    }

    public function test_la_vista_previa_no_escribe_en_la_base_de_datos(): void
    {
        Estudiante::factory()->create(['numero_documento' => '70000001', 'apellidos' => 'Prueba Ficticia', 'nombres' => 'Ana']);
        $antes = $this->recuentoAcademico();
        $sentencias = [];
        DB::listen(function ($consulta) use (&$sentencias): void {
            $sentencias[] = $consulta->sql;
        });

        $plan = $this->plan("DNI;Apellidos;Nombres\n70000001;Prueba Ficticia;Ana\n70000002;Otra Prueba;Luis\n");

        $this->assertSame(2, $plan->operaciones());
        $this->assertSame($antes, $this->recuentoAcademico());
        $this->assertNotEmpty($sentencias);

        foreach ($sentencias as $sql) {
            $this->assertMatchesRegularExpression('/^\s*select\b/i', $sql, 'La vista previa solo puede leer: '.$sql);
        }
    }

    public function test_detecta_columnas_faltantes_y_no_propone_operaciones(): void
    {
        $sinDni = $this->plan("Apellidos;Nombres;Celular\nPrueba;Ana;987654321\n");
        $this->assertNotEmpty($sinDni->erroresEstructura);
        $this->assertFalse($sinDni->puedeConfirmarse());

        $sinNombres = $this->plan("DNI;Celular;Correo\n70000001;987654321;a@ejemplo.test\n");
        $this->assertStringContainsString('Falta la columna de apellidos y nombres', implode(' ', $sinNombres->erroresEstructura));

        $soloApellidos = $this->plan("DNI;Apellidos\n70000001;Prueba\n");
        $this->assertStringContainsString('«Nombres»', implode(' ', $soloApellidos->erroresEstructura));

        $sinDestino = $this->plan("DNI;Apellidos;Nombres\n70000001;Prueba;Ana\n", new OpcionesImportacion);
        $this->assertStringContainsString('Elija una edición de destino', implode(' ', $sinDestino->erroresEstructura));

        $sinEncabezados = $this->plan("70000001;Prueba;Ana\n");
        $this->assertStringContainsString('No se encontró una fila de encabezados', implode(' ', $sinEncabezados->erroresEstructura));

        $sinFilas = $this->plan("DNI;Apellidos;Nombres\n");
        $this->assertStringContainsString('No hay filas de datos', implode(' ', $sinFilas->erroresEstructura));
    }

    public function test_informa_columnas_desconocidas_y_no_importa_notas_certificados_ni_estados(): void
    {
        $plan = $this->plan("Nro;DNI;Apellidos;Nombres;Nota;Cód. Registro;Estado;Asistencia;Pago;Distrito\n1;70000001;Prueba;Ana;18;HG-PA-24-001;APROBADO;100%;S/ 50;Cajamarca\n");
        $columnas = collect($plan->columnas)->keyBy('encabezado');

        $this->assertSame('ordinal', $columnas['Nro']['estado']);
        $this->assertSame('desconocida', $columnas['Distrito']['estado']);

        foreach (['Nota', 'Cód. Registro', 'Estado', 'Asistencia', 'Pago'] as $encabezado) {
            $this->assertSame('no_importable', $columnas[$encabezado]['estado'], $encabezado);
            $this->assertSame(CamposImportacion::IGNORAR, $columnas[$encabezado]['campo']);
        }

        // Ni siquiera reasignándolas a mano se importan.
        $mapeo = collect($plan->columnas)->mapWithKeys(fn (array $c): array => [$c['indice'] => $c['campo']])->all();
        $mapeo[4] = CamposImportacion::TELEFONO;
        $reasignado = $this->plan("Nro;DNI;Apellidos;Nombres;Nota\n1;70000001;Prueba;Ana;18\n", $this->opciones(mapeo: $mapeo));
        $this->assertSame(CamposImportacion::IGNORAR, collect($reasignado->columnas)->firstWhere('encabezado', 'Nota')['campo']);
        $this->assertSame(1, $plan->operaciones());
    }

    public function test_permite_asignar_a_mano_una_columna_no_reconocida_y_detecta_asignaciones_duplicadas(): void
    {
        $csv = "Doc. Identidad;Apellidos;Nombres\n70000001;Prueba;Ana\n";
        $automatico = $this->plan($csv);
        $this->assertStringContainsString('Falta la columna del número de documento', implode(' ', $automatico->erroresEstructura));

        $manual = $this->plan($csv, $this->opciones(mapeo: [0 => CamposImportacion::DOCUMENTO, 1 => CamposImportacion::APELLIDOS, 2 => CamposImportacion::NOMBRES]));
        $this->assertSame([], $manual->erroresEstructura);
        $this->assertSame(1, $manual->operaciones());

        $duplicado = $this->plan($csv, $this->opciones(mapeo: [0 => CamposImportacion::DOCUMENTO, 1 => CamposImportacion::APELLIDOS, 2 => CamposImportacion::APELLIDOS]));
        $this->assertStringContainsString('Deje solo una', implode(' ', $duplicado->erroresEstructura));
    }

    public function test_valida_cada_fila_con_mensajes_claros(): void
    {
        $plan = $this->plan(implode("\n", [
            'DNI;Apellidos;Nombres;Celular;Correo;Fecha de matrícula',
            '7000001;Corto;Ana;;;',             // 2: DNI corto
            '70000002;Prueba;Luis;12345;;',      // 3: celular
            '70000003;Prueba;Rosa;;no-es-correo;', // 4: correo
            '70000004;Prueba;Eva;;;31/02/2024',  // 5: fecha inexistente
            '70000005;Prueba;Ian;;;15/03/2999',  // 6: fecha futura
            '70000006;@Prueba;Ada;;;',           // 7: signo de fórmula
            '70000007;Prueba;=HYPERLINK("x");;;', // 8: fórmula
            '70000008;Prueba;Noa;987654321;noa@ejemplo.test;15/03/2024', // 9: válida
        ])."\n");

        $this->assertMensaje($plan, 2, 'El DNI debe tener exactamente 8 dígitos.');
        $this->assertMensaje($plan, 3, 'El celular debe tener 9 dígitos y comenzar con 9.');
        $this->assertMensaje($plan, 4, 'El correo electrónico no es válido.');
        $this->assertMensaje($plan, 5, 'La fecha de matrícula no es válida');
        $this->assertMensaje($plan, 6, 'fuera de rango');
        $this->assertMensaje($plan, 7, 'signo de fórmula');
        $this->assertMensaje($plan, 8, 'contiene una fórmula');

        foreach (range(2, 8) as $fila) {
            $this->assertSame(PlanImportacion::INVALIDA, $plan->filas[$fila]['estado'], "Fila {$fila}");
        }

        $this->assertSame(PlanImportacion::VALIDA, $plan->filas[9]['estado']);
        $this->assertSame(['total' => 8, 'validas' => 1, 'invalidas' => 7], array_intersect_key($plan->resumen(), array_flip(['total', 'validas', 'invalidas'])));
    }

    public function test_un_dni_numerico_de_siete_digitos_no_se_completa_por_deduccion(): void
    {
        $ruta = $this->archivoXlsx(['Lista' => [['DNI', 'Apellidos', 'Nombres'], [1234567, 'Prueba', 'Ana']]]);
        $plan = $this->analizarRuta($ruta, $this->opciones())[1];

        $this->assertSame(PlanImportacion::INVALIDA, $plan->filas[2]['estado']);
        $this->assertMensaje($plan, 2, 'Excel pudo quitar el cero inicial');
        $this->assertSame('1234567', $plan->filas[2]['numero_documento']);
    }

    public function test_marca_datos_incompletos_sin_inventarlos(): void
    {
        $plan = $this->plan("DNI;Apellidos;Nombres\n;Prueba;Ana\n70000002;;Luis\n70000003;Prueba;\n");

        foreach ([2 => 'Falta el número de documento.', 3 => 'Faltan los apellidos.', 4 => 'Faltan los nombres.'] as $fila => $mensaje) {
            $this->assertSame(PlanImportacion::INVALIDA, $plan->filas[$fila]['estado']);
            $this->assertTrue($plan->filas[$fila]['incompleta']);
            $this->assertMensaje($plan, $fila, $mensaje);
        }

        $this->assertSame(3, $plan->resumen()['incompletas']);
        $this->assertFalse($plan->puedeConfirmarse());
    }

    public function test_separa_apellidos_y_nombres_solo_con_un_formato_explicito(): void
    {
        $csv = "DNI;Apellidos y nombres\n70000001;Prueba Ficticia, Ana María\n70000002;Prueba Ficticia Luis\n70000003;De la Cruz Prueba Rosa\n70000004;Prueba Eva\n70000005;Prueba Ficticia Milagros del Carmen\n";

        $conComa = $this->plan($csv);
        $this->assertSame(['Prueba Ficticia', 'Ana María'], [$conComa->filas[2]['apellidos'], $conComa->filas[2]['nombres']]);
        $this->assertMensaje($conComa, 3, 'No se pueden separar apellidos y nombres con seguridad');

        $dosApellidos = $this->plan($csv, $this->opciones(formato: CamposImportacion::NOMBRE_DOS_APELLIDOS));
        $this->assertSame(['Prueba Ficticia', 'Luis'], [$dosApellidos->filas[3]['apellidos'], $dosApellidos->filas[3]['nombres']]);
        $this->assertMensaje($dosApellidos, 4, 'partículas');
        $this->assertMensaje($dosApellidos, 5, 'menos de tres palabras');
        $this->assertSame(['Prueba Ficticia', 'Milagros del Carmen'], [$dosApellidos->filas[6]['apellidos'], $dosApellidos->filas[6]['nombres']]);
    }

    public function test_dni_duplicado_en_el_archivo(): void
    {
        $plan = $this->plan("DNI;Apellidos;Nombres\n70000001;Prueba;Ana\n70000001;PRUEBA;ana\n70000001;Otra Persona;Luis\n");

        $this->assertSame(PlanImportacion::VALIDA, $plan->filas[2]['estado']);
        $this->assertSame(PlanImportacion::OMITIDA, $plan->filas[3]['estado']);
        $this->assertMensaje($plan, 3, 'ya figura en la fila 2');
        $this->assertSame(PlanImportacion::INVALIDA, $plan->filas[4]['estado']);
        $this->assertMensaje($plan, 4, 'aparece en la fila 2 con otro nombre');
        $this->assertSame(2, $plan->resumen()['posibles_duplicados']);
        $this->assertSame(1, $plan->operaciones());
    }

    public function test_estudiante_ya_registrado_se_reutiliza_sin_modificarlo(): void
    {
        $existente = Estudiante::factory()->create(['numero_documento' => '70000001', 'apellidos' => 'Prueba Ficticia', 'nombres' => 'Ana', 'telefono' => '911111111', 'email' => null]);
        Estudiante::factory()->create(['numero_documento' => '70000009', 'apellidos' => 'Homónimo', 'nombres' => 'Luis']);

        $plan = $this->plan("DNI;Apellidos;Nombres;Celular\n70000001;PRUEBA FICTICIA;Ána;922222222\n70000002;Homonimo;Luis;\n70000001;Distinta;Persona;\n");

        $this->assertSame(PlanImportacion::MATRICULAR_EXISTENTE, $plan->filas[2]['operacion']);
        $this->assertSame($existente->id, $plan->filas[2]['estudiante_id']);
        $this->assertMensaje($plan, 2, 'no se aplican');
        $this->assertSame(PlanImportacion::CREAR_Y_MATRICULAR, $plan->filas[3]['operacion']);
        $this->assertMensaje($plan, 3, 'Posible homónimo');
        $this->assertSame(PlanImportacion::INVALIDA, $plan->filas[4]['estado']);
        $this->assertMensaje($plan, 4, 'registrado a nombre de otro estudiante');
    }

    public function test_un_estudiante_nuevo_repetido_en_otra_edicion_se_registra_una_sola_vez(): void
    {
        Edicion::factory()->for($this->edicion->curso)->create(['nombre' => '2024-II']);
        $plan = $this->plan("DNI;Apellidos;Nombres;Curso;Edición\n70000001;Prueba;Ana;Primeros Auxilios;2024-I\n70000001;Prueba;Ana;PA;2024-II\n", new OpcionesImportacion);

        $this->assertSame(PlanImportacion::CREAR_Y_MATRICULAR, $plan->filas[2]['operacion']);
        $this->assertSame(PlanImportacion::MATRICULAR_EXISTENTE, $plan->filas[3]['operacion']);
        $this->assertSame(2, $plan->filas[3]['fila_estudiante']);
        $this->assertSame(1, $plan->resumen()['estudiantes_nuevos']);
        $this->assertCount(2, $plan->destinos);
    }

    public function test_matricula_existente_en_cualquier_estado_se_omite_sin_reactivarla(): void
    {
        $ana = Estudiante::factory()->create(['numero_documento' => '70000001', 'apellidos' => 'Prueba', 'nombres' => 'Ana']);
        $luis = Estudiante::factory()->create(['numero_documento' => '70000002', 'apellidos' => 'Prueba', 'nombres' => 'Luis']);
        Matricula::factory()->create(['estudiante_id' => $ana->id, 'edicion_id' => $this->edicion->id]);
        $anulada = Matricula::factory()->create(['estudiante_id' => $luis->id, 'edicion_id' => $this->edicion->id]);
        $anulada->update(['estado' => EstadoMatricula::Anulado]);

        $plan = $this->plan("DNI;Apellidos;Nombres\n70000001;Prueba;Ana\n70000002;Prueba;Luis\n");

        $this->assertSame(PlanImportacion::OMITIDA, $plan->filas[2]['estado']);
        $this->assertMensaje($plan, 2, 'estado «Matriculado»');
        $this->assertSame(PlanImportacion::OMITIDA, $plan->filas[3]['estado']);
        $this->assertMensaje($plan, 3, 'estado «Anulado»');
        $this->assertMensaje($plan, 3, 'reactivarla, hágalo desde la matrícula');
        $this->assertSame($anulada->id, $plan->filas[3]['matricula_id']);
        $this->assertFalse($plan->puedeConfirmarse());
    }

    public function test_curso_o_edicion_inexistentes_o_cancelados_se_rechazan_sin_crearlos(): void
    {
        $cancelada = Edicion::factory()->for($this->edicion->curso)->create(['nombre' => '2023-II', 'estado' => EstadoEdicion::Cancelada]);
        $antes = $this->recuentoAcademico();

        $plan = $this->plan(implode("\n", [
            'DNI;Apellidos;Nombres;Curso;Edición',
            '70000001;Prueba;Ana;Curso Inexistente;2024-I',
            '70000002;Prueba;Luis;Primeros Auxilios;2099-X',
            '70000003;Prueba;Rosa;Primeros Auxilios;2023-II',
            '70000004;Prueba;Eva;;2024-I',
            '70000005;Prueba;Ian;primeros auxilios;2024-i',
        ])."\n", new OpcionesImportacion);

        $this->assertMensaje($plan, 2, 'El curso «Curso Inexistente» no está registrado');
        $this->assertMensaje($plan, 3, 'La edición «2099-X» no existe en el curso «Primeros Auxilios»');
        $this->assertMensaje($plan, 4, 'cancelada');
        $this->assertMensaje($plan, 5, 'Falta el curso.');
        $this->assertSame(PlanImportacion::VALIDA, $plan->filas[6]['estado'], 'Curso y edición se comparan sin distinguir mayúsculas ni tildes.');
        $this->assertSame($antes, $this->recuentoAcademico(), 'No se crean cursos ni ediciones.');

        $destinoCancelado = $this->plan("DNI;Apellidos;Nombres\n70000001;Prueba;Ana\n", $this->opciones($cancelada));
        $this->assertStringContainsString('cancelada', implode(' ', $destinoCancelado->erroresEstructura));

        $destinoInexistente = $this->plan("DNI;Apellidos;Nombres\n70000001;Prueba;Ana\n", new OpcionesImportacion(edicionDestinoId: 999999));
        $this->assertStringContainsString('no existe', implode(' ', $destinoInexistente->erroresEstructura));
    }

    public function test_una_fila_que_contradice_la_edicion_de_destino_se_rechaza(): void
    {
        $plan = $this->plan("DNI;Apellidos;Nombres;Curso;Edición\n70000001;Prueba;Ana;Primeros Auxilios;2024-I\n70000002;Prueba;Luis;Otro Curso;2024-I\n70000003;Prueba;Rosa;;2023-I\n");

        $this->assertSame(PlanImportacion::VALIDA, $plan->filas[2]['estado']);
        $this->assertMensaje($plan, 3, 'no coincide con el de la edición de destino');
        $this->assertMensaje($plan, 4, 'no coincide con la edición de destino');
    }

    public function test_reparte_el_cupo_en_el_orden_del_archivo(): void
    {
        $this->edicion->update(['cupo' => 3]);
        Matricula::factory()->create(['edicion_id' => $this->edicion->id]);
        $retirada = Matricula::factory()->create(['edicion_id' => $this->edicion->id]);
        $retirada->update(['estado' => EstadoMatricula::Retirado]); // no ocupa cupo

        $plan = $this->plan("DNI;Apellidos;Nombres\n70000001;Prueba;Ana\n70000002;Prueba;Luis\n70000003;Prueba;Rosa\n");

        $this->assertSame([PlanImportacion::VALIDA, PlanImportacion::VALIDA, PlanImportacion::INVALIDA], array_column(array_values($plan->filas), 'estado'));
        $this->assertMensaje($plan, 4, 'Sin cupo: la edición tiene 2 plaza(s) libre(s)');
        $this->assertSame(2, $plan->destinos[$this->edicion->id]['plazas_libres']);

        Matricula::factory()->count(2)->create(['edicion_id' => $this->edicion->id]);
        $lleno = $this->plan("DNI;Apellidos;Nombres\n70000001;Prueba;Ana\n");
        $this->assertMensaje($lleno, 2, 'no tiene plazas libres');
    }

    public function test_reconoce_la_estructura_de_la_hoja_original_de_cursos(): void
    {
        // Réplica FICTICIA de la estructura de «CURSOS 2024.xlsx»: menú con fórmulas, título,
        // encabezados en la fila 2, NOTA, CÓD. REGISTRO, zona «// CONSULTA //» y sección PONENTE.
        $ruta = $this->archivoXlsx([
            'INICIO' => [[], [null, null, 'MENÚ'], [null, null, '=HYPERLINK("#\'CURSO\'!A1","CURSO")']],
            'PRIMEROS AUXILIOS-2024' => [
                ['PRIMEROS AUXILIOS'],
                ['NRO', 'APELLIDOS Y NOMBRES', null, null, 'NOTA', 'DNI', 'CÓD. REGISTRO', null, '// CONSULTA //'],
                [1, 'Prueba Ficticia Ana María', null, null, 18, 70000001, 'HG-PA-24-001', null, 'DNI', 'NRO', 'APELLIDOS Y NOMBRES'],
                [2, 'Prueba Ejemplo Luis', null, null, 15, 70000002, 'HG-PA-24-002', null, 70000001, '=INDEX($A$3:$A$9,MATCH(I4,$F$3:$F$9,0))', '='],
                [3, 'Muestra Ficticia Rosa del Carmen', null, null, 16, 1234567, 'HG-PA-24-003'],
                [],
                ['PONENTE'],
                [1, 'Docente Ficticio Carlos', null, null, null, 70000099, null],
            ],
        ], 'CURSOS FICTICIOS.xlsx');

        $plan = $this->analizarRuta($ruta, $this->opciones(formato: CamposImportacion::NOMBRE_DOS_APELLIDOS))[1];

        $this->assertSame('PRIMEROS AUXILIOS-2024', $plan->hoja, 'Se elige la primera hoja con encabezados reconocibles.');
        $this->assertSame(['INICIO', 'PRIMEROS AUXILIOS-2024'], $plan->hojas);
        $this->assertSame(2, $plan->filaEncabezado);
        $columnas = collect($plan->columnas)->keyBy('encabezado');
        $this->assertSame(CamposImportacion::NOMBRE_COMPLETO, $columnas['APELLIDOS Y NOMBRES']['campo']);
        $this->assertSame(CamposImportacion::DOCUMENTO, $columnas['DNI']['campo']);
        $this->assertSame('no_importable', $columnas['NOTA']['estado']);
        $this->assertSame('no_importable', $columnas['CÓD. REGISTRO']['estado']);
        $this->assertSame('desconocida', $columnas['// CONSULTA //']['estado']);

        $this->assertSame(PlanImportacion::VALIDA, $plan->filas[3]['estado']);
        $this->assertSame(['Prueba Ficticia', 'Ana María'], [$plan->filas[3]['apellidos'], $plan->filas[3]['nombres']]);
        $this->assertSame(PlanImportacion::VALIDA, $plan->filas[4]['estado']);
        $this->assertSame(PlanImportacion::INVALIDA, $plan->filas[5]['estado'], 'DNI de 7 dígitos (cero inicial perdido).');
        $this->assertSame(PlanImportacion::OMITIDA, $plan->filas[7]['estado']);
        $this->assertMensaje($plan, 7, 'sección «PONENTE»');
        $this->assertSame(PlanImportacion::OMITIDA, $plan->filas[8]['estado'], 'El ponente no se importa como estudiante.');
        $this->assertStringContainsString('fórmulas', implode(' ', $plan->avisos));
        $this->assertSame(2, $plan->operaciones());
    }

    public function test_cambiar_de_hoja_analiza_solo_esa_hoja(): void
    {
        $ruta = $this->archivoXlsx([
            'Curso A' => [['DNI', 'Apellidos', 'Nombres'], ['70000001', 'Prueba', 'Ana']],
            'Curso B' => [['DNI', 'Apellidos', 'Nombres'], ['70000002', 'Prueba', 'Luis'], ['70000003', 'Prueba', 'Rosa']],
        ]);
        [$archivo, $primera] = $this->analizarRuta($ruta, $this->opciones());
        $segunda = $this->analizarPreparado($archivo, $this->opciones(hoja: 'Curso B'));
        $inexistente = $this->analizarPreparado($archivo, $this->opciones(hoja: 'No existe'));

        $this->assertSame([1, 2], [$primera->operaciones(), $segunda->operaciones()]);
        $this->assertSame('Curso B', $segunda->hoja);
        $this->assertNotSame($primera->huella, $segunda->huella);
        $this->assertSame('Curso A', $inexistente->hoja, 'Una hoja manipulada desde el navegador no se acepta.');
    }

    public function test_la_huella_cambia_si_cambia_el_estado_academico(): void
    {
        $csv = "DNI;Apellidos;Nombres\n70000001;Prueba;Ana\n";
        [$archivo, $antes] = $this->analizarRuta($this->archivoCsv($csv), $this->opciones());
        $this->assertSame($antes->huella, $this->analizarPreparado($archivo, $this->opciones())->huella, 'Mismo archivo y estado: misma huella.');

        Estudiante::factory()->create(['numero_documento' => '70000001', 'apellidos' => 'Prueba', 'nombres' => 'Ana']);

        $this->assertNotSame($antes->huella, $this->analizarPreparado($archivo, $this->opciones())->huella);
    }

    public function test_limita_el_numero_de_filas_por_importacion(): void
    {
        $filas = ['DNI;Apellidos;Nombres'];

        for ($i = 1; $i <= 1001; $i++) {
            $filas[] = sprintf('%08d;Prueba;Persona', 70000000 + $i);
        }

        $plan = $this->plan(implode("\n", $filas)."\n");

        $this->assertStringContainsString('el máximo por importación es 1000', implode(' ', $plan->erroresEstructura));
        $this->assertFalse($plan->puedeConfirmarse());
    }
}
