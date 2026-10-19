<?php

namespace App\Models;

use App\Exceptions\RegistroProtegidoException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Resultado de una fila de una importación académica: importada, omitida o
 * rechazada, con el estudiante y la matrícula afectados. El detalle es un
 * mensaje genérico, sin datos personales. De solo lectura.
 */
class ImportacionAcademicaFila extends Model
{
    public const UPDATED_AT = null;

    public const IMPORTADA = 'IMPORTADA';

    public const OMITIDA = 'OMITIDA';

    public const RECHAZADA = 'RECHAZADA';

    protected $table = 'importacion_academica_filas';

    protected function casts(): array
    {
        return [
            'fila' => 'integer',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (): void {
            throw new RegistroProtegidoException('El resultado de una importación académica no se modifica.');
        });

        static::deleting(function (): void {
            throw new RegistroProtegidoException('El resultado de una importación académica no se elimina.');
        });
    }

    /**
     * @return BelongsTo<ImportacionAcademica, $this>
     */
    public function importacion(): BelongsTo
    {
        return $this->belongsTo(ImportacionAcademica::class, 'importacion_academica_id');
    }

    /**
     * @return BelongsTo<Estudiante, $this>
     */
    public function estudiante(): BelongsTo
    {
        return $this->belongsTo(Estudiante::class);
    }

    /**
     * @return BelongsTo<Matricula, $this>
     */
    public function matricula(): BelongsTo
    {
        return $this->belongsTo(Matricula::class);
    }
}
