<?php

namespace App\Models;

use App\Exceptions\RegistroProtegidoException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Lote de una importación académica confirmada (CSV o XLSX).
 *
 * Solo lo escribe App\Support\ImportacionAcademica\EjecutorImportacion, dentro
 * de la misma transacción que los estudiantes y matrículas que crea. Es de
 * solo lectura: no se edita ni se elimina. Sin atributos asignables en bloque.
 */
class ImportacionAcademica extends Model
{
    /** Registro inmutable: solo fecha de creación. */
    public const UPDATED_AT = null;

    protected $table = 'importaciones_academicas';

    protected function casts(): array
    {
        return [
            'filas_total' => 'integer',
            'filas_importadas' => 'integer',
            'filas_omitidas' => 'integer',
            'filas_rechazadas' => 'integer',
            'estudiantes_creados' => 'integer',
            'matriculas_creadas' => 'integer',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (): void {
            throw new RegistroProtegidoException('El registro de una importación académica no se modifica.');
        });

        static::deleting(function (): void {
            throw new RegistroProtegidoException('El registro de una importación académica no se elimina.');
        });
    }

    /**
     * @return HasMany<ImportacionAcademicaFila, $this>
     */
    public function filas(): HasMany
    {
        return $this->hasMany(ImportacionAcademicaFila::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function usuario(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /**
     * @return BelongsTo<Edicion, $this>
     */
    public function edicion(): BelongsTo
    {
        return $this->belongsTo(Edicion::class);
    }
}
