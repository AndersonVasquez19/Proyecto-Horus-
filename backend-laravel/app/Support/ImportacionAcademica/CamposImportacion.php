<?php

namespace App\Support\ImportacionAcademica;

use Illuminate\Support\Str;

/**
 * Campos que admite la importación académica y encabezados que se reconocen
 * para cada uno. Los encabezados se comparan normalizados (minúsculas, sin
 * tildes ni signos): «CÓD. REGISTRO» → «cod registro».
 *
 * Las columnas de notas, asistencia, pagos, certificados o estados se
 * reconocen solo para ignorarlas con un motivo: la importación no registra ni
 * deduce esos hechos (alcance académico vigente).
 */
final class CamposImportacion
{
    public const IGNORAR = 'ignorar';

    public const TIPO_DOCUMENTO = 'tipo_documento';

    public const DOCUMENTO = 'numero_documento';

    public const APELLIDOS = 'apellidos';

    public const NOMBRES = 'nombres';

    public const NOMBRE_COMPLETO = 'nombre_completo';

    public const TELEFONO = 'telefono';

    public const EMAIL = 'email';

    public const CURSO = 'curso';

    public const EDICION = 'edicion';

    public const FECHA_MATRICULA = 'fecha_matricula';

    /** Formatos de la columna «Apellidos y nombres». */
    public const NOMBRE_CON_COMA = 'coma';

    public const NOMBRE_DOS_APELLIDOS = 'dos_apellidos';

    public const ETIQUETAS = [
        self::DOCUMENTO => 'Número de documento (DNI)',
        self::TIPO_DOCUMENTO => 'Tipo de documento',
        self::APELLIDOS => 'Apellidos',
        self::NOMBRES => 'Nombres',
        self::NOMBRE_COMPLETO => 'Apellidos y nombres (una columna)',
        self::TELEFONO => 'Celular',
        self::EMAIL => 'Correo electrónico',
        self::CURSO => 'Curso',
        self::EDICION => 'Edición o convocatoria',
        self::FECHA_MATRICULA => 'Fecha de matrícula',
    ];

    /** Encabezado normalizado => campo. */
    private const ALIAS = [
        'dni' => self::DOCUMENTO,
        'documento' => self::DOCUMENTO,
        'nro documento' => self::DOCUMENTO,
        'nro de documento' => self::DOCUMENTO,
        'n documento' => self::DOCUMENTO,
        'num documento' => self::DOCUMENTO,
        'numero documento' => self::DOCUMENTO,
        'numero de documento' => self::DOCUMENTO,
        'documento de identidad' => self::DOCUMENTO,
        'tipo documento' => self::TIPO_DOCUMENTO,
        'tipo de documento' => self::TIPO_DOCUMENTO,
        'tipo doc' => self::TIPO_DOCUMENTO,
        'apellidos' => self::APELLIDOS,
        'nombres' => self::NOMBRES,
        'apellidos y nombres' => self::NOMBRE_COMPLETO,
        'apellidos nombres' => self::NOMBRE_COMPLETO,
        'celular' => self::TELEFONO,
        'telefono' => self::TELEFONO,
        'telefono celular' => self::TELEFONO,
        'movil' => self::TELEFONO,
        'nro celular' => self::TELEFONO,
        'correo' => self::EMAIL,
        'email' => self::EMAIL,
        'e mail' => self::EMAIL,
        'correo electronico' => self::EMAIL,
        'curso' => self::CURSO,
        'nombre del curso' => self::CURSO,
        'codigo del curso' => self::CURSO,
        'codigo curso' => self::CURSO,
        'edicion' => self::EDICION,
        'convocatoria' => self::EDICION,
        'fecha matricula' => self::FECHA_MATRICULA,
        'fecha de matricula' => self::FECHA_MATRICULA,
    ];

    /** Numeración de la hoja: se reconoce y no se importa. */
    private const ORDINALES = ['nro', 'n', 'no', 'num', 'numero', 'item', 'orden', 'nro orden'];

    /**
     * Encabezados reconocidos que nunca se importan, con el motivo.
     * Se comparan por prefijo («nota final» → «nota»).
     */
    private const NO_IMPORTABLES = [
        'nota' => 'Las calificaciones están fuera del alcance: no se importan.',
        'notas' => 'Las calificaciones están fuera del alcance: no se importan.',
        'calificacion' => 'Las calificaciones están fuera del alcance: no se importan.',
        'promedio' => 'Las calificaciones están fuera del alcance: no se importan.',
        'asistencia' => 'La asistencia está fuera del alcance: no se importa.',
        'cod registro' => 'Los códigos de registro o de certificado no se importan: la certificación no se deduce del archivo.',
        'codigo registro' => 'Los códigos de registro o de certificado no se importan: la certificación no se deduce del archivo.',
        'codigo de registro' => 'Los códigos de registro o de certificado no se importan: la certificación no se deduce del archivo.',
        'certificado' => 'Los códigos de registro o de certificado no se importan: la certificación no se deduce del archivo.',
        'cod certificado' => 'Los códigos de registro o de certificado no se importan: la certificación no se deduce del archivo.',
        'pago' => 'Los pagos no se registran en la gestión académica.',
        'monto' => 'Los pagos no se registran en la gestión académica.',
        'importe' => 'Los pagos no se registran en la gestión académica.',
        'estado' => 'El estado no se importa: toda matrícula nueva se registra como «Matriculado» y los demás estados se asignan después, a mano.',
        'condicion' => 'El estado no se importa: toda matrícula nueva se registra como «Matriculado» y los demás estados se asignan después, a mano.',
        'aprobado' => 'La aprobación no se deduce del archivo.',
        'culmino' => 'La culminación del curso se confirma manualmente; no se deduce del archivo.',
    ];

    /** Etiquetas de la primera columna que inician filas que no son estudiantes. */
    public const SECCIONES_NO_ESTUDIANTES = ['ponente', 'ponentes', 'docente', 'docentes', 'facilitador', 'facilitadores', 'instructor', 'instructores', 'expositor', 'expositores'];

    public static function normalizarEncabezado(?string $texto): string
    {
        $texto = str_replace(['°', 'º', 'ª'], ' ', (string) $texto);
        $texto = Str::lower(Str::ascii($texto));
        $texto = preg_replace('/[^a-z0-9]+/', ' ', $texto) ?? '';

        return trim($texto);
    }

    public static function campoPara(string $encabezadoNormalizado): ?string
    {
        return self::ALIAS[$encabezadoNormalizado] ?? null;
    }

    public static function esOrdinal(string $encabezadoNormalizado): bool
    {
        return in_array($encabezadoNormalizado, self::ORDINALES, true);
    }

    public static function motivoNoImportable(string $encabezadoNormalizado): ?string
    {
        foreach (self::NO_IMPORTABLES as $prefijo => $motivo) {
            if ($encabezadoNormalizado === $prefijo || str_starts_with($encabezadoNormalizado, $prefijo.' ')) {
                return $motivo;
            }
        }

        return null;
    }

    /**
     * @return array<string, string>
     */
    public static function opcionesDeMapeo(): array
    {
        return [self::IGNORAR => 'No importar'] + self::ETIQUETAS;
    }

    public static function esCampo(string $campo): bool
    {
        return $campo === self::IGNORAR || array_key_exists($campo, self::ETIQUETAS);
    }

    public static function letraColumna(int $indice): string
    {
        $letra = '';

        for ($n = $indice + 1; $n > 0; $n = intdiv($n - 1, 26)) {
            $letra = chr(65 + (($n - 1) % 26)).$letra;
        }

        return $letra;
    }
}
