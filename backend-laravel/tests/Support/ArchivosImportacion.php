<?php

namespace Tests\Support;

use App\Support\ImportacionAcademica\AlmacenImportaciones;
use App\Support\ImportacionAcademica\AnalizadorImportacion;
use App\Support\ImportacionAcademica\ArchivoPreparado;
use App\Support\ImportacionAcademica\LectorArchivo;
use App\Support\ImportacionAcademica\OpcionesImportacion;
use App\Support\ImportacionAcademica\PlanImportacion;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Writer;

/**
 * Archivos de importación FICTICIOS para las pruebas: se crean en un directorio
 * aleatorio de storage/framework/testing y se borran al terminar cada prueba.
 * El almacén de importaciones usa un disco «local» falso (Storage::fake).
 */
trait ArchivosImportacion
{
    private ?string $directorioArchivos = null;

    protected function prepararAlmacenFalso(): void
    {
        Storage::fake('local');
    }

    protected function tearDownArchivosImportacion(): void
    {
        if ($this->directorioArchivos !== null && is_dir($this->directorioArchivos)) {
            foreach (glob($this->directorioArchivos.'/*') ?: [] as $archivo) {
                unlink($archivo);
            }

            rmdir($this->directorioArchivos);
        }

        $this->directorioArchivos = null;
    }

    protected function directorioArchivos(): string
    {
        if ($this->directorioArchivos === null) {
            $raiz = storage_path('framework/testing');

            if (! is_dir($raiz)) {
                mkdir($raiz, 0777, true);
            }

            $this->directorioArchivos = $raiz.'/importacion-'.bin2hex(random_bytes(8));
            mkdir($this->directorioArchivos);
        }

        return $this->directorioArchivos;
    }

    protected function archivoCsv(string $contenido, string $nombre = 'matriculas.csv'): string
    {
        $ruta = $this->directorioArchivos().'/'.$nombre;
        file_put_contents($ruta, $contenido);

        return $ruta;
    }

    /**
     * @param  array<string, list<list<mixed>>>  $hojas  nombre => filas
     */
    protected function archivoXlsx(array $hojas, string $nombre = 'matriculas.xlsx'): string
    {
        $ruta = $this->directorioArchivos().'/'.$nombre;
        $escritor = new Writer;
        $escritor->openToFile($ruta);
        $primera = true;

        foreach ($hojas as $titulo => $filas) {
            if (! $primera) {
                $escritor->addNewSheetAndMakeItCurrent();
            }

            $primera = false;
            $escritor->getCurrentSheet()->setName((string) $titulo);

            foreach ($filas as $fila) {
                // Admite valores simples o celdas ya construidas (p. ej. una fecha con formato).
                $escritor->addRow(new Row(array_map(fn (mixed $v): Cell => $v instanceof Cell ? $v : Cell::fromValue($v), $fila)));
            }
        }

        $escritor->close();

        return $ruta;
    }

    protected function celdaFecha(string $fecha): Cell
    {
        return Cell::fromValue(new \DateTimeImmutable($fecha), (new Style)->setFormat('dd/mm/yyyy'));
    }

    protected function preparar(string $ruta, ?string $nombre = null): ArchivoPreparado
    {
        return app(AlmacenImportaciones::class)->guardar($ruta, $nombre ?? basename($ruta));
    }

    protected function analizarPreparado(ArchivoPreparado $archivo, ?OpcionesImportacion $opciones = null): PlanImportacion
    {
        $ruta = app(AlmacenImportaciones::class)->ruta($archivo->token, $archivo->formato);

        return app(AnalizadorImportacion::class)->analizar(app(LectorArchivo::class)->leer($ruta, $archivo->formato), $opciones ?? new OpcionesImportacion);
    }

    /**
     * Prepara y analiza en un paso.
     *
     * @return array{ArchivoPreparado, PlanImportacion}
     */
    protected function analizarRuta(string $ruta, ?OpcionesImportacion $opciones = null): array
    {
        $archivo = $this->preparar($ruta);

        return [$archivo, $this->analizarPreparado($archivo, $opciones)];
    }

    /**
     * Recuento de filas de las tablas académicas, para comprobar que nada se escribió.
     *
     * @return array<string, int>
     */
    protected function recuentoAcademico(): array
    {
        $tablas = ['estudiantes', 'cursos', 'ediciones', 'matriculas', 'matricula_movimientos', 'importaciones_academicas', 'importacion_academica_filas'];

        return array_combine($tablas, array_map(fn (string $t): int => DB::table($t)->count(), $tablas));
    }
}
