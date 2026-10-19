<?php

namespace Tests\Feature\Importacion;

use App\Support\ImportacionAcademica\AlmacenImportaciones;
use App\Support\ImportacionAcademica\ArchivoNoValidoException;
use App\Support\ImportacionAcademica\Celda;
use App\Support\ImportacionAcademica\LectorArchivo;
use App\Support\ImportacionAcademica\LecturaArchivo;
use Illuminate\Support\Facades\Storage;
use Tests\Support\ArchivosImportacion;
use Tests\TestCase;
use ZipArchive;

/**
 * Lectura segura de CSV y XLSX (sin base de datos). Datos ficticios.
 */
class LectorArchivoTest extends TestCase
{
    use ArchivosImportacion;

    protected function setUp(): void
    {
        parent::setUp();
        $this->prepararAlmacenFalso();
    }

    private function leer(string $ruta, ?string $formato = null): LecturaArchivo
    {
        return app(LectorArchivo::class)->leer($ruta, $formato ?? pathinfo($ruta, PATHINFO_EXTENSION));
    }

    private function esperarRechazo(callable $operacion, string $fragmento): void
    {
        try {
            $operacion();
            $this->fail('Se esperaba un rechazo del archivo.');
        } catch (ArchivoNoValidoException $e) {
            $this->assertStringContainsString($fragmento, $e->getMessage());
        }
    }

    public function test_lee_csv_utf8_con_bom_y_punto_y_coma_conservando_numeros_de_fila(): void
    {
        $ruta = $this->archivoCsv("\xEF\xBB\xBFDNI;Apellidos;Nombres\n70000001;Prueba Ficticia;Ána\n\n70000002;\"Otra; Prueba\";Luis\n");
        $filas = $this->leer($ruta)->filas('CSV');

        $this->assertSame([1, 2, 4], array_keys($filas), 'Las filas vacías se saltan pero la numeración se conserva.');
        $this->assertSame('DNI', $filas[1][0]->texto());
        $this->assertSame('Ána', $filas[2][2]->texto());
        $this->assertSame('Otra; Prueba', $filas[4][1]->texto());
    }

    public function test_convierte_csv_ansi_de_excel_y_detecta_coma_como_separador(): void
    {
        $ruta = $this->archivoCsv(mb_convert_encoding("DNI,Apellidos,Nombres\n70000001,Núñez Prueba,José\n", 'Windows-1252', 'UTF-8'));
        $filas = $this->leer($ruta)->filas('CSV');

        $this->assertSame('Núñez Prueba', $filas[2][1]->texto());
        $this->assertSame('José', $filas[2][2]->texto());
    }

    public function test_marca_formulas_de_csv_sin_interpretarlas(): void
    {
        $ruta = $this->archivoCsv("DNI;Apellidos;Nombres\n70000001;=HYPERLINK(\"http://ejemplo.invalid\");Ana\n");
        $celda = $this->leer($ruta)->filas('CSV')[2][1];

        $this->assertTrue($celda->esFormula());
        $this->assertNull($celda->texto());
    }

    public function test_rechaza_archivo_vacio_o_sin_datos(): void
    {
        $vacio = $this->archivoCsv('', 'vacio.csv');
        $this->esperarRechazo(fn () => $this->leer($vacio), 'vacío');
        $this->esperarRechazo(fn () => app(AlmacenImportaciones::class)->guardar($vacio, 'vacio.csv'), 'vacío');

        $soloSeparadores = $this->archivoCsv(";;;\n;;\n\n", 'blanco.csv');
        $this->esperarRechazo(fn () => $this->leer($soloSeparadores), 'no contiene datos');

        $libroVacio = $this->archivoXlsx(['Hoja1' => []], 'vacio.xlsx');
        $this->esperarRechazo(fn () => $this->leer($libroVacio), 'no contiene datos');
    }

    public function test_rechaza_extensiones_no_admitidas_y_archivos_disfrazados(): void
    {
        $ruta = $this->archivoCsv("DNI;Nombres\n70000001;Ana\n", 'lista.csv');

        foreach (['lista.xls', 'lista.xlsm', 'lista.ods', 'lista.php', 'lista'] as $nombre) {
            $this->esperarRechazo(fn () => app(AlmacenImportaciones::class)->guardar($ruta, $nombre), 'Formato no admitido');
        }

        // Un XLSX renombrado a .csv no se lee como texto.
        $libro = $this->archivoXlsx(['Hoja1' => [['DNI', 'Nombres']]], 'libro.xlsx');
        $this->esperarRechazo(fn () => $this->leer($libro, 'csv'), 'no es un CSV');

        // Un texto renombrado a .xlsx (o un .xls antiguo / libro cifrado, que no son ZIP).
        $this->esperarRechazo(fn () => $this->leer($ruta, 'xlsx'), 'no es un XLSX válido');
    }

    public function test_rechaza_xlsx_danado(): void
    {
        $ruta = $this->archivoCsv("PK\x03\x04".random_bytes(512), 'danado.xlsx');

        $this->esperarRechazo(fn () => $this->leer($ruta, 'xlsx'), 'dañado');
    }

    public function test_rechaza_xlsx_con_macros_u_objetos_incrustados(): void
    {
        foreach (['xl/vbaProject.bin', 'xl/activeX/activeX1.xml', 'xl/embeddings/objeto.bin'] as $entrada) {
            $ruta = $this->archivoXlsx(['Hoja1' => [['DNI', 'Apellidos', 'Nombres']]], 'macro-'.md5($entrada).'.xlsx');
            $zip = new ZipArchive;
            $zip->open($ruta);
            $zip->addFromString($entrada, 'contenido ficticio');
            $zip->close();

            $this->esperarRechazo(fn () => $this->leer($ruta), 'macros');
        }
    }

    public function test_rechaza_bomba_zip_por_tamano_descomprimido(): void
    {
        $ruta = $this->archivoXlsx(['Hoja1' => [['DNI', 'Apellidos', 'Nombres']]], 'bomba.xlsx');
        $zip = new ZipArchive;
        $zip->open($ruta);
        $zip->addFromString('xl/media/relleno.bin', str_repeat("\0", 6 * 1024 * 1024));
        $zip->close();
        $this->assertLessThan(LectorArchivo::TAMANO_MAXIMO_KB * 1024, filesize($ruta));

        $this->esperarRechazo(fn () => $this->leer($ruta), 'descomprimido');
    }

    public function test_rechaza_archivos_que_superan_el_tamano_maximo(): void
    {
        $ruta = $this->archivoCsv(str_repeat("70000001;Prueba;Ana\n", 120000), 'grande.csv');
        $this->assertGreaterThan(LectorArchivo::TAMANO_MAXIMO_KB * 1024, filesize($ruta));

        $this->esperarRechazo(fn () => $this->leer($ruta), 'tamaño máximo');
        $this->esperarRechazo(fn () => app(AlmacenImportaciones::class)->guardar($ruta, 'grande.csv'), 'tamaño máximo');
    }

    public function test_lee_xlsx_con_varias_hojas_numeros_y_formulas_marcadas(): void
    {
        $ruta = $this->archivoXlsx([
            'CURSO A' => [['TÍTULO'], ['NRO', 'DNI', 'APELLIDOS Y NOMBRES'], [1, 70000001, 'Prueba Ficticia, Ana'], [2, '=A3+1', '=B3']],
            'CURSO B' => [['DNI'], [70000002]],
        ]);
        $lectura = $this->leer($ruta);

        $this->assertSame(['CURSO A', 'CURSO B'], $lectura->nombresDeHojas());
        $filas = $lectura->filas('CURSO A');
        $this->assertSame('70000001', $filas[3][1]->texto());
        $this->assertSame(Celda::FORMULA, $filas[4][1]->tipo);
        $this->assertNull($filas[4][1]->texto(), 'El valor calculado de una fórmula nunca se usa.');
    }

    public function test_el_almacen_guarda_en_disco_privado_con_ficha_aleatoria_y_rechaza_rutas_arbitrarias(): void
    {
        // El nombre con «../» solo es el nombre original declarado; el archivo real está en el directorio temporal.
        $ruta = $this->archivoCsv("DNI;Apellidos;Nombres\n70000001;Prueba;Ana\n", 'origen.csv');
        $almacen = app(AlmacenImportaciones::class);
        $preparado = $almacen->guardar($ruta, '../../nombre raro.csv');

        $this->assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', $preparado->token);
        $this->assertSame('nombre raro.csv', $preparado->nombre);
        Storage::disk('local')->assertExists(AlmacenImportaciones::DIRECTORIO.'/'.$preparado->token.'.csv');
        $this->assertFalse(Storage::disk('public')->exists(AlmacenImportaciones::DIRECTORIO));
        $this->assertSame(hash_file('sha256', $ruta), $preparado->sha256);

        $this->esperarRechazo(fn () => $almacen->ruta('../../.env', 'csv'), 'ya no está disponible');
        $this->esperarRechazo(fn () => $almacen->ruta($preparado->token, 'php'), 'ya no está disponible');

        $almacen->eliminar($preparado->token, 'csv');
        Storage::disk('local')->assertMissing(AlmacenImportaciones::DIRECTORIO.'/'.$preparado->token.'.csv');
    }

    public function test_el_almacen_borra_copias_de_mas_de_24_horas(): void
    {
        $almacen = app(AlmacenImportaciones::class);
        $antiguo = $almacen->guardar($this->archivoCsv("DNI;Nombres\n70000001;Ana\n", 'a.csv'), 'a.csv');
        touch($almacen->ruta($antiguo->token, 'csv'), now()->subHours(25)->getTimestamp());

        $reciente = $almacen->guardar($this->archivoCsv("DNI;Nombres\n70000002;Luis\n", 'b.csv'), 'b.csv');

        $this->assertFalse($almacen->existe($antiguo->token, 'csv'));
        $this->assertTrue($almacen->existe($reciente->token, 'csv'));
    }
}
