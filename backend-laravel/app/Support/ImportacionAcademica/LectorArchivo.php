<?php

namespace App\Support\ImportacionAcademica;

use DateInterval;
use DateTimeInterface;
use OpenSpout\Common\Entity\Cell\DateIntervalCell;
use OpenSpout\Common\Entity\Cell\ErrorCell;
use OpenSpout\Common\Entity\Cell\FormulaCell;
use OpenSpout\Reader\XLSX\Options;
use OpenSpout\Reader\XLSX\Reader;
use Throwable;
use ZipArchive;

/**
 * Lee un CSV o XLSX ya subido, con límites de recursos y sin ejecutar nada.
 *
 * - CSV: UTF-8 (con o sin BOM) o Windows-1252 (CSV «ANSI» de Excel); separador
 *   «;», «,» o tabulador detectado en la primera línea.
 * - XLSX: OpenSpout (ya incluido por Filament). Antes de abrirlo se revisa el
 *   ZIP: cifrado, macros (vbaProject.bin), controles ActiveX u objetos
 *   incrustados, tamaño descomprimido y relación de compresión (bombas ZIP).
 *   Las fórmulas no se evalúan: se marcan y su valor calculado se descarta.
 *
 * Solo recibe rutas construidas por el servidor (nunca del usuario).
 */
final class LectorArchivo
{
    public const FORMATOS = ['csv', 'xlsx'];

    public const TAMANO_MAXIMO_KB = 2048;

    /** Filas recorridas por hoja (incluidas vacías) antes de abortar. */
    public const FILAS_RECORRIDAS_MAXIMAS = 20000;

    /** Filas con contenido en todo el archivo. */
    public const FILAS_CON_DATOS_MAXIMAS = 10000;

    public const COLUMNAS_MAXIMAS = 100;

    public const HOJAS_MAXIMAS = 50;

    public const LONGITUD_MAXIMA_CELDA = 1000;

    private const ZIP_ENTRADAS_MAXIMAS = 2000;

    private const ZIP_DESCOMPRIMIDO_MAXIMO = 50 * 1024 * 1024;

    private const ZIP_RELACION_MAXIMA = 200;

    public function leer(string $ruta, string $formato): LecturaArchivo
    {
        if (! in_array($formato, self::FORMATOS, true)) {
            throw new ArchivoNoValidoException('Formato no admitido. Use un archivo CSV o XLSX.');
        }

        if (! is_file($ruta) || ! is_readable($ruta)) {
            throw new ArchivoNoValidoException('El archivo ya no está disponible. Vuelva a subirlo.');
        }

        $tamano = filesize($ruta);

        if ($tamano === false || $tamano === 0) {
            throw new ArchivoNoValidoException('El archivo está vacío.');
        }

        if ($tamano > self::TAMANO_MAXIMO_KB * 1024) {
            throw new ArchivoNoValidoException('El archivo supera el tamaño máximo de '.(self::TAMANO_MAXIMO_KB / 1024).' MB.');
        }

        $lectura = $formato === 'csv' ? $this->leerCsv($ruta) : $this->leerXlsx($ruta);

        if (array_filter($lectura->hojas) === []) {
            throw new ArchivoNoValidoException('El archivo no contiene datos.');
        }

        return $lectura;
    }

    private function leerCsv(string $ruta): LecturaArchivo
    {
        $contenido = (string) file_get_contents($ruta);

        if (str_starts_with($contenido, "PK\x03\x04") || str_contains($contenido, "\0")) {
            throw new ArchivoNoValidoException('El archivo no es un CSV de texto. Si es un libro de Excel, súbalo como XLSX.');
        }

        if (str_starts_with($contenido, "\xEF\xBB\xBF")) {
            $contenido = substr($contenido, 3);
        }

        if (! mb_check_encoding($contenido, 'UTF-8')) {
            // CSV «ANSI» guardado por Excel en Windows.
            $contenido = mb_convert_encoding($contenido, 'UTF-8', 'Windows-1252');
        }

        $separador = $this->detectarSeparador($contenido);
        $flujo = fopen('php://temp', 'r+');
        fwrite($flujo, $contenido);
        rewind($flujo);

        $filas = [];
        $numero = 0;
        $conDatos = 0;

        try {
            while (($registro = fgetcsv($flujo, null, $separador, '"', '')) !== false) {
                $numero++;

                if ($numero > self::FILAS_RECORRIDAS_MAXIMAS) {
                    throw new ArchivoNoValidoException('El archivo tiene demasiadas filas.');
                }

                $celdas = [];

                foreach (array_slice($registro, 0, self::COLUMNAS_MAXIMAS) as $indice => $valor) {
                    $celda = $this->celdaDeTexto($valor);

                    if (! $celda->vacia()) {
                        $celdas[$indice] = $celda;
                    }
                }

                if ($celdas !== []) {
                    if (++$conDatos > self::FILAS_CON_DATOS_MAXIMAS) {
                        throw new ArchivoNoValidoException('El archivo tiene demasiadas filas.');
                    }

                    $filas[$numero] = $celdas;
                }
            }
        } finally {
            fclose($flujo);
        }

        return new LecturaArchivo('csv', ['CSV' => $filas]);
    }

    private function detectarSeparador(string $contenido): string
    {
        $linea = strtok($contenido, "\r\n") ?: '';
        $conteos = [';' => substr_count($linea, ';'), ',' => substr_count($linea, ','), "\t" => substr_count($linea, "\t")];
        arsort($conteos);
        $separador = array_key_first($conteos);

        return $conteos[$separador] > 0 ? $separador : ',';
    }

    private function celdaDeTexto(?string $valor): Celda
    {
        if ($valor === null) {
            return new Celda(null);
        }

        if (mb_strlen($valor) > self::LONGITUD_MAXIMA_CELDA) {
            // Se conserva marcado como error: una celda tan larga no es un dato académico válido.
            return new Celda(null, Celda::ERROR);
        }

        // En un CSV, «=…» es una fórmula para Excel: nunca se interpreta como dato.
        if (str_starts_with(ltrim($valor), '=')) {
            return new Celda(null, Celda::FORMULA);
        }

        return new Celda($valor);
    }

    private function leerXlsx(string $ruta): LecturaArchivo
    {
        $this->revisarZip($ruta);

        $opciones = new Options;
        $opciones->SHOULD_FORMAT_DATES = false;
        $opciones->SHOULD_PRESERVE_EMPTY_ROWS = true;
        $opciones->SHOULD_LOAD_MERGE_CELLS = false;
        $lector = new Reader($opciones);
        $hojas = [];
        $conDatos = 0;

        try {
            $lector->open($ruta);

            foreach ($lector->getSheetIterator() as $hoja) {
                if (count($hojas) >= self::HOJAS_MAXIMAS) {
                    throw new ArchivoNoValidoException('El libro tiene demasiadas hojas.');
                }

                $nombre = $this->nombreDeHoja($hoja->getName(), array_keys($hojas));
                $filas = [];
                $numero = 0;

                foreach ($hoja->getRowIterator() as $fila) {
                    $numero++;

                    if ($numero > self::FILAS_RECORRIDAS_MAXIMAS) {
                        throw new ArchivoNoValidoException('La hoja «'.$nombre.'» tiene demasiadas filas.');
                    }

                    $celdas = [];

                    foreach (array_slice($fila->getCells(), 0, self::COLUMNAS_MAXIMAS, true) as $indice => $celda) {
                        $leida = $this->celdaXlsx($celda);

                        if (! $leida->vacia()) {
                            $celdas[$indice] = $leida;
                        }
                    }

                    if ($celdas !== []) {
                        if (++$conDatos > self::FILAS_CON_DATOS_MAXIMAS) {
                            throw new ArchivoNoValidoException('El archivo tiene demasiadas filas.');
                        }

                        $filas[$numero] = $celdas;
                    }
                }

                $hojas[$nombre] = $filas;
            }
        } catch (ArchivoNoValidoException $e) {
            throw $e;
        } catch (Throwable) {
            // Sin detalles internos: el mensaje de OpenSpout puede incluir rutas.
            throw new ArchivoNoValidoException('El archivo XLSX está dañado o no se puede leer.');
        } finally {
            $lector->close();
        }

        return new LecturaArchivo('xlsx', $hojas);
    }

    private function celdaXlsx(object $celda): Celda
    {
        if ($celda instanceof FormulaCell) {
            return new Celda(null, Celda::FORMULA);
        }

        if ($celda instanceof ErrorCell || $celda instanceof DateIntervalCell) {
            return new Celda(null, Celda::ERROR);
        }

        $valor = $celda->getValue();

        if ($valor instanceof DateInterval) {
            return new Celda(null, Celda::ERROR);
        }

        if (is_string($valor)) {
            return $this->celdaDeTexto($valor);
        }

        return new Celda($valor instanceof DateTimeInterface || is_int($valor) || is_float($valor) || is_bool($valor) || $valor === null ? $valor : null);
    }

    /**
     * @param  list<string|int>  $existentes
     */
    private function nombreDeHoja(string $nombre, array $existentes): string
    {
        $nombre = trim(preg_replace('/[\p{C}]+/u', '', $nombre) ?? '');
        $nombre = mb_substr($nombre === '' ? 'Hoja' : $nombre, 0, 100);
        $base = $nombre;
        $n = 2;

        while (in_array($nombre, array_map('strval', $existentes), true)) {
            $nombre = mb_substr($base, 0, 95).' ('.$n++.')';
        }

        return $nombre;
    }

    private function revisarZip(string $ruta): void
    {
        $cabecera = (string) file_get_contents($ruta, false, null, 0, 4);

        if ($cabecera !== "PK\x03\x04") {
            throw new ArchivoNoValidoException('El archivo no es un XLSX válido. Si lo guardó como «.xls» o está protegido con contraseña, ábralo en Excel y guárdelo como «Libro de Excel (.xlsx)».');
        }

        $zip = new ZipArchive;

        if ($zip->open($ruta, ZipArchive::RDONLY) !== true) {
            throw new ArchivoNoValidoException('El archivo XLSX está dañado o no se puede leer.');
        }

        try {
            if ($zip->numFiles < 1 || $zip->numFiles > self::ZIP_ENTRADAS_MAXIMAS) {
                throw new ArchivoNoValidoException('El archivo XLSX tiene una estructura no admitida.');
            }

            $total = 0;
            $nombres = [];

            for ($i = 0; $i < $zip->numFiles; $i++) {
                $entrada = $zip->statIndex($i);

                if ($entrada === false) {
                    throw new ArchivoNoValidoException('El archivo XLSX está dañado o no se puede leer.');
                }

                if (($entrada['encryption_method'] ?? 0) !== 0) {
                    throw new ArchivoNoValidoException('El archivo está protegido con contraseña. Quite la protección y vuelva a subirlo.');
                }

                $nombre = strtolower((string) $entrada['name']);
                $nombres[] = $nombre;
                $total += (int) $entrada['size'];

                if ($total > self::ZIP_DESCOMPRIMIDO_MAXIMO
                    || ($entrada['size'] > 1024 * 1024 && $entrada['size'] > self::ZIP_RELACION_MAXIMA * max(1, (int) $entrada['comp_size']))) {
                    throw new ArchivoNoValidoException('El archivo XLSX es demasiado grande una vez descomprimido.');
                }

                if ($nombre === 'xl/vbaproject.bin' || str_starts_with($nombre, 'xl/activex/') || str_starts_with($nombre, 'xl/embeddings/')) {
                    throw new ArchivoNoValidoException('El archivo contiene macros, controles u objetos incrustados. Guárdelo como «Libro de Excel (.xlsx)» sin macros y vuelva a subirlo.');
                }
            }

            if (! in_array('[content_types].xml', $nombres, true) || ! in_array('xl/workbook.xml', $nombres, true)) {
                throw new ArchivoNoValidoException('El archivo no es un libro de Excel (.xlsx) válido.');
            }

            $tipos = (string) $zip->getFromName('[Content_Types].xml', 1024 * 1024);

            if (stripos($tipos, 'macroEnabled') !== false) {
                throw new ArchivoNoValidoException('El archivo es un libro con macros (.xlsm). Guárdelo como «Libro de Excel (.xlsx)» y vuelva a subirlo.');
            }
        } finally {
            $zip->close();
        }
    }
}
