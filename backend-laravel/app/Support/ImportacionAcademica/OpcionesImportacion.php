<?php

namespace App\Support\ImportacionAcademica;

/**
 * Elecciones del usuario para analizar un archivo. Se construyen siempre desde
 * el estado del formulario saneado: el estado de Livewire se puede manipular
 * desde el navegador, así que nada se da por válido sin revisarlo aquí y en el
 * analizador (hoja existente, edición existente y no cancelada, mapeo conocido).
 */
final class OpcionesImportacion
{
    /**
     * @param  array<int, string>|null  $mapeo  índice de columna => campo; null = detección automática
     */
    public function __construct(
        public readonly ?string $hoja = null,
        public readonly ?int $edicionDestinoId = null,
        public readonly string $formatoNombre = CamposImportacion::NOMBRE_CON_COMA,
        public readonly ?array $mapeo = null,
    ) {}

    /**
     * @param  array<string, mixed>  $datos
     */
    public static function desdeFormulario(array $datos, bool $conMapeo): self
    {
        $hoja = $datos['hoja'] ?? null;
        $edicion = $datos['edicion_id'] ?? null;
        $formato = $datos['formato_nombre'] ?? null;
        $mapeo = null;

        if ($conMapeo && is_array($datos['mapeo'] ?? null)) {
            $mapeo = [];

            foreach ($datos['mapeo'] as $indice => $campo) {
                $indice = is_int($indice) ? $indice : (is_string($indice) && preg_match('/^c?(\d{1,3})$/', $indice, $m) ? (int) $m[1] : null);

                if ($indice !== null && is_string($campo) && CamposImportacion::esCampo($campo)) {
                    $mapeo[$indice] = $campo;
                }
            }
        }

        return new self(
            hoja: is_string($hoja) && $hoja !== '' ? mb_substr($hoja, 0, 100) : null,
            edicionDestinoId: is_numeric($edicion) && (int) $edicion > 0 ? (int) $edicion : null,
            formatoNombre: $formato === CamposImportacion::NOMBRE_DOS_APELLIDOS ? CamposImportacion::NOMBRE_DOS_APELLIDOS : CamposImportacion::NOMBRE_CON_COMA,
            mapeo: $mapeo,
        );
    }

    public function claveDestino(): string
    {
        return $this->edicionDestinoId !== null ? 'edicion:'.$this->edicionDestinoId : 'por-fila';
    }
}
