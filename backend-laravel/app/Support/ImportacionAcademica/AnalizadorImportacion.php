<?php

namespace App\Support\ImportacionAcademica;

use App\Enums\EstadoEdicion;
use App\Enums\EstadoMatricula;
use App\Enums\TipoDocumento;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use DateTimeInterface;
use Illuminate\Support\Collection;

/**
 * Analiza un archivo leído y propone una operación por fila. Solo lee la base
 * de datos: nunca crea, modifica ni bloquea registros académicos (el bloqueo
 * de las ediciones lo hace el ejecutor antes de volver a analizar).
 *
 * Política de datos:
 * - El documento es obligatorio: sin él no se puede detectar duplicados y no
 *   se inventa. Un DNI numérico de 7 dígitos se rechaza (Excel suele quitar el
 *   cero inicial) en lugar de completarlo por deducción.
 * - Un estudiante existente (mismo tipo y número de documento) se reutiliza y
 *   no se modifica; si el nombre del archivo no coincide, la fila se rechaza.
 * - Una matrícula existente en la misma edición, en cualquier estado, se omite:
 *   no se reactiva ni se cambia su estado.
 * - Toda matrícula nueva queda en «Matriculado». No se registra ni se deduce
 *   pago, asistencia, nota, culminación ni certificación.
 * - El cupo se reparte en el orden de las filas; las que no caben se rechazan.
 */
final class AnalizadorImportacion
{
    public const FILAS_MAXIMAS = 1000;

    private const FILAS_BUSQUEDA_ENCABEZADO = 20;

    private const CAMPOS_TEXTO = [
        CamposImportacion::TIPO_DOCUMENTO, CamposImportacion::APELLIDOS, CamposImportacion::NOMBRES,
        CamposImportacion::NOMBRE_COMPLETO, CamposImportacion::EMAIL, CamposImportacion::CURSO, CamposImportacion::EDICION,
    ];

    private const PARTICULAS = ['de', 'del', 'la', 'las', 'los', 'y', 'da', 'das', 'di', 'do', 'dos', 'van', 'von', 'san', 'santa', 'mc', 'mac'];

    private const LONGITUD_NOMBRE = 120;

    private const LONGITUD_EMAIL = 150;

    public function analizar(LecturaArchivo $lectura, OpcionesImportacion $opciones): PlanImportacion
    {
        $hojas = $lectura->nombresDeHojas();
        $hoja = null;
        $deteccion = null;

        if ($opciones->hoja !== null && in_array($opciones->hoja, $hojas, true)) {
            $hoja = $opciones->hoja;
            $deteccion = $this->detectarEncabezado($lectura->filas($hoja));
        } else {
            foreach ($hojas as $candidata) {
                if (($deteccion = $this->detectarEncabezado($lectura->filas($candidata))) !== null) {
                    $hoja = $candidata;
                    break;
                }
            }
        }

        $hoja ??= $hojas[0] ?? null;

        if ($deteccion === null) {
            return $this->planVacio($hojas, $hoja, $opciones, [
                'No se encontró una fila de encabezados reconocible en la hoja (por ejemplo «DNI» y «Apellidos y nombres»). Revise que la hoja tenga una fila de títulos.',
            ]);
        }

        [$filaEncabezado, $encabezados] = $deteccion;
        $todas = $lectura->filas($hoja);
        $datos = array_filter($todas, fn (int $numero): bool => $numero > $filaEncabezado, ARRAY_FILTER_USE_KEY);
        $columnas = $this->columnas($encabezados, $datos, $opciones->mapeo);
        $mapeo = [];

        foreach ($columnas as $columna) {
            if ($columna['campo'] !== CamposImportacion::IGNORAR) {
                $mapeo[$columna['indice']] = $columna['campo'];
            }
        }

        $errores = $this->erroresDeMapeo($columnas, $mapeo, $opciones);
        $destino = null;

        if ($opciones->edicionDestinoId !== null) {
            $destino = Edicion::query()->with('curso')->find($opciones->edicionDestinoId);

            if ($destino === null) {
                $errores[] = 'La edición de destino elegida no existe.';
            } elseif (! $destino->estado->admiteMatriculas()) {
                $errores[] = 'La edición de destino está cancelada y no admite matrículas.';
            }
        }

        if ($datos === []) {
            $errores[] = 'No hay filas de datos debajo de los encabezados.';
        } elseif (count($datos) > self::FILAS_MAXIMAS) {
            $errores[] = 'El archivo tiene '.count($datos).' filas de datos; el máximo por importación es '.self::FILAS_MAXIMAS.'. Divídalo en varios archivos.';
        }

        if ($errores !== []) {
            return $this->planVacio($hojas, $hoja, $opciones, $errores, $filaEncabezado, $columnas, $destino);
        }

        $avisos = [];
        $formulasIgnoradas = 0;

        foreach ($datos as $celdas) {
            foreach ($celdas as $indice => $celda) {
                if (($celda->esFormula() || $celda->esError()) && ! isset($mapeo[$indice])) {
                    $formulasIgnoradas++;
                }
            }
        }

        if ($formulasIgnoradas > 0) {
            $avisos[] = "Se ignoraron {$formulasIgnoradas} celda(s) con fórmulas o valores no válidos en columnas que no se importan.";
        }

        $filas = $this->extraer($datos, $columnas, $mapeo, $opciones);
        [$filas, $destinos] = $this->resolverEstado($filas, $destino);

        $huella = $this->huella($hoja, $opciones, $mapeo, $filas);

        return new PlanImportacion(
            hojas: $hojas,
            hoja: $hoja,
            filaEncabezado: $filaEncabezado,
            columnas: $columnas,
            erroresEstructura: [],
            avisos: $avisos,
            filas: $filas,
            destinos: $destinos,
            edicionDestinoId: $destino?->getKey(),
            etiquetaDestino: $destino?->etiqueta,
            filasVacias: max(0, ($datos === [] ? 0 : max(array_keys($datos)) - $filaEncabezado) - count($datos)),
            huella: $huella,
        );
    }

    /**
     * Primera fila (de las 20 primeras) con al menos dos encabezados de campos
     * reconocidos, uno de ellos el documento o el nombre.
     *
     * @param  array<int, array<int, Celda>>  $filas
     * @return array{int, array<int, string>}|null
     */
    private function detectarEncabezado(array $filas): ?array
    {
        foreach (array_slice($filas, 0, self::FILAS_BUSQUEDA_ENCABEZADO, true) as $numero => $celdas) {
            $campos = [];
            $encabezados = [];

            foreach ($celdas as $indice => $celda) {
                $texto = $celda->texto();

                if ($texto === null) {
                    continue;
                }

                $encabezados[$indice] = mb_substr($texto, 0, 120);
                $campo = CamposImportacion::campoPara(CamposImportacion::normalizarEncabezado($texto));

                if ($campo !== null) {
                    $campos[$campo] = true;
                }
            }

            $identifica = isset($campos[CamposImportacion::DOCUMENTO]) || isset($campos[CamposImportacion::NOMBRE_COMPLETO])
                || isset($campos[CamposImportacion::APELLIDOS]);

            if (count($campos) >= 2 && $identifica) {
                return [$numero, $encabezados];
            }
        }

        return null;
    }

    /**
     * @param  array<int, string>  $encabezados
     * @param  array<int, array<int, Celda>>  $datos
     * @param  array<int, string>|null  $mapeoElegido
     * @return list<array<string, mixed>>
     */
    private function columnas(array $encabezados, array $datos, ?array $mapeoElegido): array
    {
        $indices = array_keys($encabezados);

        foreach ($datos as $celdas) {
            foreach ($celdas as $indice => $celda) {
                if (! $celda->vacia()) {
                    $indices[] = $indice;
                }
            }
        }

        $indices = array_values(array_unique($indices));
        sort($indices);
        $columnas = [];

        foreach ($indices as $indice) {
            $texto = $encabezados[$indice] ?? '';
            $normal = CamposImportacion::normalizarEncabezado($texto);
            $sugerido = CamposImportacion::IGNORAR;
            $motivo = null;

            if ($normal === '') {
                $estado = 'sin_encabezado';
                $motivo = 'Columna sin encabezado: no se importa.';
            } elseif (CamposImportacion::esOrdinal($normal)) {
                $estado = 'ordinal';
                $motivo = 'Numeración de la hoja: no se importa.';
            } elseif (($noImportable = CamposImportacion::motivoNoImportable($normal)) !== null) {
                $estado = 'no_importable';
                $motivo = $noImportable;
            } elseif (($campo = CamposImportacion::campoPara($normal)) !== null) {
                $estado = 'reconocida';
                $sugerido = $campo;
            } else {
                $estado = 'desconocida';
                $motivo = 'Columna no reconocida: no se importa salvo que la asigne a un campo.';
            }

            $campo = $sugerido;

            // Las columnas fuera del alcance (notas, certificados, pagos…) no se pueden reasignar.
            if ($mapeoElegido !== null && $estado !== 'no_importable') {
                $campo = $mapeoElegido[$indice] ?? CamposImportacion::IGNORAR;
            }

            $columnas[] = [
                'indice' => $indice,
                'letra' => CamposImportacion::letraColumna($indice),
                'encabezado' => $texto,
                'estado' => $estado,
                'sugerido' => $sugerido,
                'campo' => $campo,
                'motivo' => $campo === CamposImportacion::IGNORAR ? $motivo : null,
            ];
        }

        return $columnas;
    }

    /**
     * @param  list<array<string, mixed>>  $columnas
     * @param  array<int, string>  $mapeo
     * @return list<string>
     */
    private function erroresDeMapeo(array $columnas, array $mapeo, OpcionesImportacion $opciones): array
    {
        $errores = [];
        $porCampo = [];

        foreach ($columnas as $columna) {
            if ($columna['campo'] !== CamposImportacion::IGNORAR) {
                $porCampo[$columna['campo']][] = $this->nombreColumna($columna);
            }
        }

        foreach ($porCampo as $campo => $nombres) {
            if (count($nombres) > 1) {
                $errores[] = 'Las columnas '.implode(' y ', $nombres).' están asignadas a «'.CamposImportacion::ETIQUETAS[$campo].'». Deje solo una.';
            }
        }

        $tiene = fn (string $campo): bool => isset($porCampo[$campo]);

        if (! $tiene(CamposImportacion::DOCUMENTO)) {
            $errores[] = 'Falta la columna del número de documento (DNI). El documento es obligatorio para evitar duplicados.';
        }

        $separados = $tiene(CamposImportacion::APELLIDOS) || $tiene(CamposImportacion::NOMBRES);

        if ($separados && $tiene(CamposImportacion::NOMBRE_COMPLETO)) {
            $errores[] = 'Use columnas separadas de «Apellidos» y «Nombres» o una sola columna «Apellidos y nombres», no ambas.';
        } elseif ($separados && ! ($tiene(CamposImportacion::APELLIDOS) && $tiene(CamposImportacion::NOMBRES))) {
            $errores[] = 'Asigne tanto la columna «Apellidos» como la columna «Nombres».';
        } elseif (! $separados && ! $tiene(CamposImportacion::NOMBRE_COMPLETO)) {
            $errores[] = 'Falta la columna de apellidos y nombres.';
        }

        if ($opciones->edicionDestinoId === null && ! ($tiene(CamposImportacion::CURSO) && $tiene(CamposImportacion::EDICION))) {
            $errores[] = 'Elija una edición de destino o incluya en el archivo las columnas «Curso» y «Edición».';
        }

        return $errores;
    }

    /**
     * Primera pasada: formato de cada celda, sin consultar la base de datos.
     *
     * @param  array<int, array<int, Celda>>  $datos
     * @param  list<array<string, mixed>>  $columnas
     * @param  array<int, string>  $mapeo
     * @return array<int, array<string, mixed>>
     */
    private function extraer(array $datos, array $columnas, array $mapeo, OpcionesImportacion $opciones): array
    {
        $nombres = [];

        foreach ($columnas as $columna) {
            $nombres[$columna['indice']] = $this->nombreColumna($columna);
        }

        $indicePorCampo = array_flip($mapeo);
        $filas = [];
        $seccion = null;

        foreach ($datos as $numero => $celdas) {
            $fila = $this->filaBase($numero);

            // Inicio de la sección de ponentes (en CURSOS 2024, «PONENTE» en la columna NRO):
            // una sola celda con esa etiqueta. Las filas siguientes no son estudiantes.
            if (count($celdas) === 1) {
                $unica = reset($celdas)->texto();

                if ($unica !== null && in_array(CamposImportacion::normalizarEncabezado($unica), CamposImportacion::SECCIONES_NO_ESTUDIANTES, true)) {
                    $seccion = mb_substr($unica, 0, 40);
                    $filas[$numero] = $this->omitir($fila, 'Inicio de la sección «'.$seccion.'»: las filas siguientes no son estudiantes y no se importan.');

                    continue;
                }
            }

            if ($seccion !== null) {
                $filas[$numero] = $this->omitir($fila, 'Fila de la sección «'.$seccion.'»: no corresponde a un estudiante y no se importa.');

                continue;
            }

            if (array_intersect_key($celdas, $mapeo) === []) {
                $filas[$numero] = $this->omitir($fila, 'Fila de título, separador o sin datos en las columnas que se importan.');

                continue;
            }

            $errores = [];
            $incompleta = false;
            $celda = fn (string $campo): ?Celda => isset($indicePorCampo[$campo]) ? ($celdas[$indicePorCampo[$campo]] ?? null) : null;
            $texto = function (string $campo) use ($celda, $nombres, $indicePorCampo, &$errores): ?string {
                $valor = $celda($campo);

                if ($valor === null) {
                    return null;
                }

                $columna = '«'.$nombres[$indicePorCampo[$campo]].'»';

                if ($valor->esFormula()) {
                    $errores[] = "La columna {$columna} contiene una fórmula: reemplácela por su valor.";

                    return null;
                }

                if ($valor->esError()) {
                    $errores[] = "La columna {$columna} contiene un valor no válido o demasiado largo.";

                    return null;
                }

                $resultado = $valor->texto();

                if ($resultado !== null && in_array($campo, self::CAMPOS_TEXTO, true) && preg_match('/^[=+\-@]/', $resultado)) {
                    $errores[] = "La columna {$columna} empieza por un signo de fórmula (=, +, -, @) y no se acepta.";

                    return null;
                }

                return $resultado;
            };

            // Fila de encabezados repetida (p. ej. al pegar dos listas).
            $documentoTexto = $texto(CamposImportacion::DOCUMENTO);

            if ($documentoTexto !== null && CamposImportacion::campoPara(CamposImportacion::normalizarEncabezado($documentoTexto)) === CamposImportacion::DOCUMENTO) {
                $filas[$numero] = $this->omitir($fila, 'Fila de encabezados repetida.');

                continue;
            }

            // Documento.
            $tipo = TipoDocumento::Dni;
            $tipoTexto = $texto(CamposImportacion::TIPO_DOCUMENTO);

            if ($tipoTexto !== null) {
                $tipo = $this->tipoDocumento($tipoTexto);

                if ($tipo === null) {
                    $errores[] = 'Tipo de documento no admitido: use DNI, CE (carné de extranjería) o PASAPORTE.';
                }
            }

            $numeroDocumento = Estudiante::normalizarNumeroDocumento($documentoTexto);
            $documentoNumerico = in_array(gettype($celda(CamposImportacion::DOCUMENTO)?->valor), ['integer', 'double'], true);

            if ($numeroDocumento === null) {
                if ($celda(CamposImportacion::DOCUMENTO) === null) {
                    $errores[] = 'Falta el número de documento.';
                    $incompleta = true;
                }
            } elseif ($tipo !== null && ! preg_match($tipo->patron(), $numeroDocumento)) {
                $errores[] = $tipo === TipoDocumento::Dni && $documentoNumerico && ctype_digit($numeroDocumento) && strlen($numeroDocumento) < 8
                    ? 'El DNI tiene '.strlen($numeroDocumento).' dígitos. Si empezaba por 0, Excel pudo quitar el cero inicial: escríbalo como texto con sus 8 dígitos.'
                    : $tipo->mensajeFormato();
            }

            // Apellidos y nombres.
            if (isset($indicePorCampo[CamposImportacion::NOMBRE_COMPLETO])) {
                $completo = $texto(CamposImportacion::NOMBRE_COMPLETO);
                [$apellidos, $nombresEstudiante, $errorNombre] = $completo === null
                    ? [null, null, null]
                    : $this->separarNombre($completo, $opciones->formatoNombre);

                if ($errorNombre !== null) {
                    $errores[] = $errorNombre;
                } elseif ($completo === null && $celda(CamposImportacion::NOMBRE_COMPLETO) === null) {
                    $errores[] = 'Faltan los apellidos y nombres.';
                    $incompleta = true;
                }
            } else {
                $apellidos = $this->limpiar($texto(CamposImportacion::APELLIDOS));
                $nombresEstudiante = $this->limpiar($texto(CamposImportacion::NOMBRES));

                if ($apellidos === null && $celda(CamposImportacion::APELLIDOS) === null) {
                    $errores[] = 'Faltan los apellidos.';
                    $incompleta = true;
                }

                if ($nombresEstudiante === null && $celda(CamposImportacion::NOMBRES) === null) {
                    $errores[] = 'Faltan los nombres.';
                    $incompleta = true;
                }
            }

            foreach (['apellidos' => $apellidos, 'nombres' => $nombresEstudiante] as $parte => $valor) {
                if ($valor !== null && mb_strlen($valor) > self::LONGITUD_NOMBRE) {
                    $errores[] = 'Los '.$parte.' superan los '.self::LONGITUD_NOMBRE.' caracteres.';
                }
            }

            // Contacto (opcional): su validez solo importa si se crea el estudiante.
            $telefono = Estudiante::normalizarTelefono($texto(CamposImportacion::TELEFONO));
            $email = $texto(CamposImportacion::EMAIL);
            $email = $email === null ? null : mb_strtolower($email);

            // Fecha de matrícula (opcional; nunca se inventa).
            $fecha = null;
            $celdaFecha = $celda(CamposImportacion::FECHA_MATRICULA);

            if ($celdaFecha !== null && ! $celdaFecha->vacia()) {
                if (is_int($celdaFecha->valor) || is_float($celdaFecha->valor)) {
                    // Un número de serie de Excel sin formato de fecha no se convierte por deducción.
                    $errores[] = 'La fecha de matrícula es un número: aplique el formato de fecha a la celda en Excel o escríbala como día/mes/año.';
                } else {
                    $fecha = $this->fecha($celdaFecha->valor instanceof DateTimeInterface ? $celdaFecha->valor : $texto(CamposImportacion::FECHA_MATRICULA), $errores);
                }
            }

            $fila = array_replace($fila, [
                'tipo_documento' => $tipo?->value,
                'numero_documento' => $numeroDocumento,
                'documento' => $numeroDocumento === null ? null : ($tipo?->getLabel() ?? '?').' '.$numeroDocumento,
                'apellidos' => $apellidos,
                'nombres' => $nombresEstudiante,
                'telefono' => $telefono,
                'email' => $email,
                'fecha_matricula' => $fecha,
                'curso_texto' => $texto(CamposImportacion::CURSO),
                'edicion_texto' => $texto(CamposImportacion::EDICION),
                'errores' => $errores,
                'incompleta' => $incompleta,
            ]);

            $filas[$numero] = $fila;
        }

        return $filas;
    }

    /**
     * Segunda pasada: destino, estudiantes y matrículas existentes, duplicados y cupo.
     *
     * @param  array<int, array<string, mixed>>  $filas
     * @return array{array<int, array<string, mixed>>, array<int, array{etiqueta: string, matriculas: int, plazas_libres: int|null}>}
     */
    private function resolverEstado(array $filas, ?Edicion $destino): array
    {
        $pendientes = array_filter($filas, fn (array $f): bool => $f['estado'] !== PlanImportacion::OMITIDA);
        $cursos = Curso::query()->get(['id', 'nombre', 'codigo']);
        $cursosPorClave = $cursos->keyBy(fn (Curso $c): string => Estudiante::claveBusqueda($c->nombre));
        $cursosPorCodigo = $cursos->filter(fn (Curso $c): bool => $c->codigo !== null)->keyBy(fn (Curso $c): string => (string) $c->codigo);
        $buscarCurso = fn (string $texto): ?Curso => $cursosPorCodigo->get(mb_strtoupper($texto)) ?? $cursosPorClave->get(Estudiante::claveBusqueda($texto));

        // Ediciones de los cursos mencionados (una consulta).
        $idsCurso = [];

        foreach ($pendientes as $f) {
            if ($destino === null && $f['curso_texto'] !== null && ($curso = $buscarCurso($f['curso_texto'])) !== null) {
                $idsCurso[$curso->id] = true;
            }
        }

        $edicionesPorCurso = Edicion::query()->with('curso')->whereIn('curso_id', array_keys($idsCurso))->get()
            ->groupBy('curso_id')
            ->map(fn (Collection $ediciones): Collection => $ediciones->keyBy(fn (Edicion $e): string => Estudiante::claveBusqueda($e->nombre)));

        $ediciones = [];

        foreach ($pendientes as $numero => $f) {
            $edicion = null;
            $errores = $f['errores'];
            $incompleta = $f['incompleta'];

            if ($destino !== null) {
                if ($f['curso_texto'] !== null && $buscarCurso($f['curso_texto'])?->id !== $destino->curso_id) {
                    $errores[] = 'El curso indicado en la fila no coincide con el de la edición de destino.';
                } elseif ($f['edicion_texto'] !== null && Estudiante::claveBusqueda($f['edicion_texto']) !== Estudiante::claveBusqueda($destino->nombre)) {
                    $errores[] = 'La edición indicada en la fila no coincide con la edición de destino.';
                } else {
                    $edicion = $destino;
                }
            } elseif ($f['curso_texto'] === null) {
                $errores[] = 'Falta el curso.';
                $incompleta = true;
            } elseif (($curso = $buscarCurso($f['curso_texto'])) === null) {
                $errores[] = 'El curso «'.$this->recortar($f['curso_texto']).'» no está registrado. Regístrelo en «Cursos» antes de importar.';
            } elseif ($f['edicion_texto'] === null) {
                $errores[] = 'Falta la edición.';
                $incompleta = true;
            } elseif (($edicion = $edicionesPorCurso->get($curso->id)?->get(Estudiante::claveBusqueda($f['edicion_texto']))) === null) {
                $errores[] = 'La edición «'.$this->recortar($f['edicion_texto']).'» no existe en el curso «'.$this->recortar($curso->nombre).'». Regístrela en «Ediciones» antes de importar.';
            }

            if ($edicion !== null && ! $edicion->estado->admiteMatriculas()) {
                $errores[] = 'La edición está cancelada y no admite matrículas.';
                $edicion = null;
            }

            if ($edicion !== null) {
                $ediciones[$edicion->getKey()] = $edicion;
                $filas[$numero]['edicion_id'] = $edicion->getKey();
                $filas[$numero]['destino'] = $edicion->etiqueta;
            }

            $filas[$numero]['errores'] = $errores;
            $filas[$numero]['incompleta'] = $incompleta;
        }

        // Estudiantes existentes por documento y posibles homónimos (consultas por lotes).
        $documentos = [];
        $clavesNombre = [];

        foreach ($pendientes as $numero => $f) {
            if ($f['numero_documento'] !== null) {
                $documentos[$f['numero_documento']] = true;
            }

            if ($f['apellidos'] !== null && $f['nombres'] !== null) {
                $clavesNombre[Estudiante::claveBusqueda($f['apellidos'].' '.$f['nombres'])] = true;
            }
        }

        $existentes = collect();

        foreach (array_chunk(array_keys($documentos), 500) as $lote) {
            $existentes = $existentes->merge(Estudiante::query()->whereIn('numero_documento', $lote)->get());
        }

        $existentes = $existentes->keyBy(fn (Estudiante $e): string => $e->tipo_documento->value.'|'.$e->numero_documento);
        $homonimos = collect();

        foreach (array_chunk(array_keys($clavesNombre), 500) as $lote) {
            $homonimos = $homonimos->merge(Estudiante::query()->whereIn('nombre_busqueda', $lote)->get(['id', 'tipo_documento', 'numero_documento', 'nombre_busqueda']));
        }

        $homonimos = $homonimos->groupBy('nombre_busqueda');
        $idsEdicion = array_keys($ediciones);
        $matriculasExistentes = $existentes->isEmpty() || $idsEdicion === [] ? collect() : Matricula::query()
            ->whereIn('estudiante_id', $existentes->pluck('id')->all())
            ->whereIn('edicion_id', $idsEdicion)
            ->get(['id', 'estudiante_id', 'edicion_id', 'estado'])
            ->keyBy(fn (Matricula $m): string => $m->estudiante_id.'|'.$m->edicion_id);

        $ocupanCupo = array_map(fn (EstadoMatricula $e): string => $e->value, EstadoMatricula::ocupanCupo());
        $vigentes = $idsEdicion === [] ? collect() : Matricula::query()
            ->whereIn('edicion_id', $idsEdicion)
            ->whereIn('estado', $ocupanCupo)
            ->selectRaw('edicion_id, count(*) as total')
            ->groupBy('edicion_id')
            ->pluck('total', 'edicion_id');

        $libres = [];

        foreach ($ediciones as $id => $edicion) {
            $libres[$id] = $edicion->cupo === null ? null : max(0, $edicion->cupo - (int) ($vigentes[$id] ?? 0));
        }

        // Asignación en el orden del archivo.
        $primeraAparicion = [];
        $estudiantesPlanificados = [];
        $matriculasPlanificadas = [];
        $usadas = [];

        foreach (array_keys($pendientes) as $numero) {
            $f = $filas[$numero];
            $errores = $f['errores'];
            $avisos = $f['avisos'];
            $claveDocumento = $f['tipo_documento'] !== null && $f['numero_documento'] !== null ? $f['tipo_documento'].'|'.$f['numero_documento'] : null;
            $claveNombre = $f['apellidos'] !== null && $f['nombres'] !== null ? Estudiante::claveBusqueda($f['apellidos'].' '.$f['nombres']) : null;
            $existente = $claveDocumento !== null ? $existentes->get($claveDocumento) : null;

            if ($claveDocumento !== null && $claveNombre !== null && ! $this->documentoInvalido($f)) {
                $anterior = $primeraAparicion[$claveDocumento] ?? null;

                if ($anterior !== null && $anterior['nombre'] !== $claveNombre) {
                    $errores[] = "El mismo documento aparece en la fila {$anterior['fila']} con otro nombre. Revise cuál es el correcto.";
                    $f['posible_duplicado'] = true;
                }

                $primeraAparicion[$claveDocumento] ??= ['fila' => $numero, 'nombre' => $claveNombre];

                if ($existente !== null && $existente->nombre_busqueda !== $claveNombre) {
                    $errores[] = 'El documento ya está registrado a nombre de otro estudiante. Revise el archivo o la ficha del estudiante: la importación no modifica estudiantes existentes.';
                    $f['posible_duplicado'] = true;
                }
            }

            // El contacto solo se valida si hay que crear al estudiante; uno existente no se modifica.
            if ($existente === null) {
                if (! Estudiante::telefonoEsValido($f['telefono'])) {
                    $errores[] = Estudiante::MENSAJE_TELEFONO;
                }

                if ($f['email'] !== null && (mb_strlen($f['email']) > self::LONGITUD_EMAIL || filter_var($f['email'], FILTER_VALIDATE_EMAIL) === false)) {
                    $errores[] = 'El correo electrónico no es válido.';
                }
            } elseif (($f['telefono'] !== null && $f['telefono'] !== $existente->telefono) || ($f['email'] !== null && $f['email'] !== $existente->email)) {
                $avisos[] = 'Los datos de contacto del archivo no se aplican: el estudiante ya está registrado y la importación no modifica sus datos.';
            }

            $f['errores'] = $errores;
            $f['avisos'] = $avisos;

            if ($errores !== []) {
                $filas[$numero] = $this->rechazar($f);

                continue;
            }

            $edicionId = $f['edicion_id'];
            $edicion = $ediciones[$edicionId];
            $claveMatricula = $claveDocumento.'|'.$edicionId;

            if (isset($matriculasPlanificadas[$claveMatricula])) {
                $f['posible_duplicado'] = true;
                $filas[$numero] = $this->omitir($f, "Repetida: el estudiante ya figura en la fila {$matriculasPlanificadas[$claveMatricula]} para la misma edición.");

                continue;
            }

            $matriculaExistente = $existente !== null ? $matriculasExistentes->get($existente->id.'|'.$edicionId) : null;

            if ($matriculaExistente !== null) {
                $f['posible_duplicado'] = true;
                $f['estudiante_id'] = $existente->id;
                $f['matricula_id'] = $matriculaExistente->id;
                $filas[$numero] = $this->omitir($f, 'El estudiante ya tiene una matrícula en esta edición (estado «'.$matriculaExistente->estado->getLabel().'»). No se modifica; si corresponde reactivarla, hágalo desde la matrícula.');

                continue;
            }

            $usadas[$edicionId] ??= 0;

            if ($libres[$edicionId] !== null && $usadas[$edicionId] >= $libres[$edicionId]) {
                $f['errores'][] = $libres[$edicionId] === 0
                    ? 'Sin cupo: la edición no tiene plazas libres.'
                    : "Sin cupo: la edición tiene {$libres[$edicionId]} plaza(s) libre(s) y ya se asignaron a filas anteriores del archivo.";
                $filas[$numero] = $this->rechazar($f);

                continue;
            }

            $usadas[$edicionId]++;
            $matriculasPlanificadas[$claveMatricula] = $numero;

            if ($edicion->estado === EstadoEdicion::Finalizada) {
                $f['avisos'][] = 'La edición está finalizada: se registra como matrícula histórica en estado «Matriculado».';
            }

            if ($existente !== null) {
                $f['operacion'] = PlanImportacion::MATRICULAR_EXISTENTE;
                $f['estudiante_id'] = $existente->id;
                $f['avisos'][] = 'El estudiante ya está registrado: se reutiliza sin modificar sus datos.';
            } elseif (isset($estudiantesPlanificados[$claveDocumento])) {
                $f['operacion'] = PlanImportacion::MATRICULAR_EXISTENTE;
                $f['fila_estudiante'] = $estudiantesPlanificados[$claveDocumento];
                $f['avisos'][] = "El estudiante se registra en la fila {$estudiantesPlanificados[$claveDocumento]} de este archivo.";
            } else {
                $f['operacion'] = PlanImportacion::CREAR_Y_MATRICULAR;
                $estudiantesPlanificados[$claveDocumento] = $numero;

                $otros = ($homonimos->get($claveNombre) ?? collect())->reject(
                    fn (Estudiante $e): bool => $e->tipo_documento->value.'|'.$e->numero_documento === $claveDocumento,
                );

                if ($otros->isNotEmpty()) {
                    $f['posible_duplicado'] = true;
                    $f['avisos'][] = 'Posible homónimo: ya existe un estudiante con el mismo nombre y otro documento. Revíselo antes de confirmar.';
                }
            }

            $f['estado'] = PlanImportacion::VALIDA;
            $filas[$numero] = $f;
        }

        $destinos = [];

        foreach ($filas as $f) {
            if ($f['estado'] === PlanImportacion::VALIDA) {
                $id = $f['edicion_id'];
                $destinos[$id] ??= ['etiqueta' => $ediciones[$id]->etiqueta, 'matriculas' => 0, 'plazas_libres' => $libres[$id]];
                $destinos[$id]['matriculas']++;
            }
        }

        return [$filas, $destinos];
    }

    /**
     * @param  array<int, string>  $mapeo
     * @param  array<int, array<string, mixed>>  $filas
     */
    private function huella(?string $hoja, OpcionesImportacion $opciones, array $mapeo, array $filas): string
    {
        $campos = ['fila', 'estado', 'operacion', 'edicion_id', 'estudiante_id', 'matricula_id', 'fila_estudiante',
            'tipo_documento', 'numero_documento', 'apellidos', 'nombres', 'telefono', 'email', 'fecha_matricula', 'errores'];

        return hash('sha256', json_encode([
            'hoja' => $hoja,
            'destino' => $opciones->claveDestino(),
            'formato_nombre' => $opciones->formatoNombre,
            'mapeo' => $mapeo,
            'filas' => array_map(fn (array $f): array => array_intersect_key($f, array_flip($campos)), array_values($filas)),
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    }

    /**
     * @return array<string, mixed>
     */
    private function filaBase(int $numero): array
    {
        return [
            'fila' => $numero,
            'estado' => PlanImportacion::INVALIDA,
            'operacion' => PlanImportacion::NINGUNA,
            'tipo_documento' => null,
            'numero_documento' => null,
            'documento' => null,
            'apellidos' => null,
            'nombres' => null,
            'telefono' => null,
            'email' => null,
            'fecha_matricula' => null,
            'curso_texto' => null,
            'edicion_texto' => null,
            'edicion_id' => null,
            'destino' => null,
            'estudiante_id' => null,
            'matricula_id' => null,
            'fila_estudiante' => null,
            'errores' => [],
            'avisos' => [],
            'posible_duplicado' => false,
            'incompleta' => false,
        ];
    }

    /**
     * @param  array<string, mixed>  $fila
     * @return array<string, mixed>
     */
    private function omitir(array $fila, string $motivo): array
    {
        $fila['estado'] = PlanImportacion::OMITIDA;
        $fila['operacion'] = PlanImportacion::NINGUNA;
        $fila['avisos'][] = $motivo;

        return $fila;
    }

    /**
     * @param  array<string, mixed>  $fila
     * @return array<string, mixed>
     */
    private function rechazar(array $fila): array
    {
        $fila['estado'] = PlanImportacion::INVALIDA;
        $fila['operacion'] = PlanImportacion::NINGUNA;

        return $fila;
    }

    /**
     * @param  array<string, mixed>  $f
     */
    private function documentoInvalido(array $f): bool
    {
        $tipo = TipoDocumento::tryFrom((string) $f['tipo_documento']);

        return $tipo === null || ! preg_match((string) $tipo->patron(), (string) $f['numero_documento']);
    }

    /**
     * @return array{?string, ?string, ?string} apellidos, nombres, error
     */
    private function separarNombre(string $completo, string $formato): array
    {
        if (str_contains($completo, ',')) {
            [$apellidos, $nombres] = array_map(fn (string $p): ?string => $this->limpiar($p), explode(',', $completo, 2));

            if ($apellidos === null || $nombres === null || str_contains((string) $nombres, ',')) {
                return [null, null, 'No se pudo separar «Apellidos, Nombres»: falta una de las partes o hay más de una coma.'];
            }

            return [$apellidos, $nombres, null];
        }

        if ($formato !== CamposImportacion::NOMBRE_DOS_APELLIDOS) {
            return [null, null, 'No se pueden separar apellidos y nombres con seguridad: escriba «Apellidos, Nombres» con coma, use columnas separadas o elija el formato «dos apellidos seguidos de los nombres».'];
        }

        $palabras = preg_split('/\s+/u', trim($completo)) ?: [];

        if (count($palabras) < 3) {
            return [null, null, 'El nombre tiene menos de tres palabras: no se distinguen apellidos y nombres con seguridad. Sepárelos con una coma.'];
        }

        foreach (array_slice($palabras, 0, 3) as $palabra) {
            if (in_array(Estudiante::claveBusqueda($palabra), self::PARTICULAS, true)) {
                return [null, null, 'El nombre tiene partículas («de», «del», «la»…) entre los primeros términos: sepárelo con una coma para no confundir apellidos y nombres.'];
            }
        }

        return [$palabras[0].' '.$palabras[1], implode(' ', array_slice($palabras, 2)), null];
    }

    private function tipoDocumento(string $texto): ?TipoDocumento
    {
        return match (CamposImportacion::normalizarEncabezado($texto)) {
            'dni' => TipoDocumento::Dni,
            'ce', 'carne de extranjeria', 'carnet de extranjeria', 'carne extranjeria' => TipoDocumento::CarneExtranjeria,
            'pasaporte', 'pas' => TipoDocumento::Pasaporte,
            default => null,
        };
    }

    /**
     * @param  list<string>  $errores
     */
    private function fecha(DateTimeInterface|string|null $valor, array &$errores): ?string
    {
        if ($valor === null) {
            return null;
        }

        $fecha = null;

        if ($valor instanceof DateTimeInterface) {
            $fecha = CarbonImmutable::instance($valor)->startOfDay();
        } else {
            foreach (['!d/m/Y', '!j/n/Y', '!d-m-Y', '!Y-m-d', '!d.m.Y'] as $formato) {
                $intento = DateTimeImmutable::createFromFormat($formato, $valor);

                // Sin desbordes (31/02 → 03/03): la fecha debe volver a escribirse igual.
                if ($intento !== false && $intento->format(substr($formato, 1)) === $valor) {
                    $fecha = CarbonImmutable::instance($intento);
                    break;
                }
            }
        }

        if ($fecha === null) {
            $errores[] = 'La fecha de matrícula no es válida: use el formato día/mes/año (por ejemplo 15/03/2024).';

            return null;
        }

        if ($fecha->year < 1990 || $fecha->isAfter(CarbonImmutable::today())) {
            $errores[] = 'La fecha de matrícula está fuera de rango (no puede ser futura ni anterior a 1990).';

            return null;
        }

        return $fecha->format('Y-m-d');
    }

    private function limpiar(?string $valor): ?string
    {
        $valor = trim(preg_replace('/\s+/u', ' ', (string) $valor) ?? '');

        return $valor === '' ? null : $valor;
    }

    private function recortar(string $texto): string
    {
        return mb_strlen($texto) > 80 ? mb_substr($texto, 0, 77).'…' : $texto;
    }

    /**
     * @param  array<string, mixed>  $columna
     */
    private function nombreColumna(array $columna): string
    {
        return $columna['encabezado'] !== '' ? $columna['encabezado'] : 'columna '.$columna['letra'];
    }

    /**
     * @param  list<string>  $hojas
     * @param  list<string>  $errores
     * @param  list<array<string, mixed>>  $columnas
     */
    private function planVacio(array $hojas, ?string $hoja, OpcionesImportacion $opciones, array $errores, ?int $filaEncabezado = null, array $columnas = [], ?Edicion $destino = null): PlanImportacion
    {
        return new PlanImportacion(
            hojas: $hojas,
            hoja: $hoja,
            filaEncabezado: $filaEncabezado,
            columnas: $columnas,
            erroresEstructura: $errores,
            avisos: [],
            filas: [],
            destinos: [],
            edicionDestinoId: $destino?->getKey(),
            etiquetaDestino: $destino?->etiqueta,
            filasVacias: 0,
            huella: hash('sha256', json_encode([$hoja, $opciones->claveDestino(), $errores], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)),
        );
    }
}
