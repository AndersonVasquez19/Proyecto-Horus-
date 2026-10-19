<?php

namespace App\Models;

use App\Enums\TipoDocumento;
use App\Exceptions\RegistroProtegidoException;
use Database\Factories\EstudianteFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

#[Fillable(['tipo_documento', 'numero_documento', 'nombres', 'apellidos', 'telefono', 'email', 'observaciones'])]
class Estudiante extends Model
{
    /** @use HasFactory<EstudianteFactory> */
    use HasFactory;

    /**
     * Celular peruano: 9 dígitos y empieza por 9 (ya normalizado).
     */
    public const PATRON_TELEFONO = '/^9\d{8}$/';

    public const MENSAJE_TELEFONO = 'El celular debe tener 9 dígitos y comenzar con 9.';

    protected $attributes = [
        'tipo_documento' => 'DNI',
    ];

    protected function casts(): array
    {
        return [
            'tipo_documento' => TipoDocumento::class,
        ];
    }

    protected static function booted(): void
    {
        static::saving(function (Estudiante $estudiante): void {
            $estudiante->normalizar();
            $estudiante->validarDatos();
        });

        static::deleting(function (Estudiante $estudiante): void {
            if ($estudiante->matriculas()->exists()) {
                throw new RegistroProtegidoException(
                    'No se puede eliminar al estudiante porque tiene matrículas registradas. El historial académico se conserva.'
                );
            }
        });
    }

    /**
     * @return HasMany<Matricula, $this>
     */
    public function matriculas(): HasMany
    {
        return $this->hasMany(Matricula::class);
    }

    /**
     * Historial de ediciones en las que se matriculó, con los datos de la matrícula.
     *
     * @return BelongsToMany<Edicion, $this>
     */
    public function ediciones(): BelongsToMany
    {
        return $this->belongsToMany(Edicion::class, 'matriculas')
            ->withPivot(['id', 'estado', 'fecha_matricula'])
            ->withTimestamps();
    }

    /**
     * «Apellidos, Nombres», como en los listados de la empresa.
     */
    protected function nombreCompleto(): Attribute
    {
        return Attribute::get(fn (): string => trim($this->apellidos.', '.$this->nombres, ', '));
    }

    /**
     * Documento legible: «DNI 12345678» o «Sin documento registrado».
     */
    protected function documento(): Attribute
    {
        return Attribute::get(function (): string {
            $tipo = $this->tipo_documento;

            if (! $tipo instanceof TipoDocumento || ! $tipo->requiereNumero()) {
                return TipoDocumento::SinDocumento->getLabel();
            }

            return $tipo->getLabel().' '.$this->numero_documento;
        });
    }

    /**
     * Busca por número de documento o por nombre (sin distinguir mayúsculas ni tildes).
     * Cada palabra del término debe aparecer en «apellidos nombres».
     *
     * @param  Builder<Estudiante>  $query
     * @return Builder<Estudiante>
     */
    public function scopeBuscar(Builder $query, ?string $termino): Builder
    {
        $termino = trim((string) $termino);

        if ($termino === '') {
            return $query;
        }

        $documento = self::normalizarNumeroDocumento($termino);
        $palabras = array_filter(explode(' ', self::claveBusqueda($termino)));

        // claveBusqueda() solo deja [a-z0-9 ], así que no hay comodines LIKE que escapar.
        return $query->where(function (Builder $q) use ($documento, $palabras): void {
            if ($documento !== null && preg_match('/^[A-Z0-9]+$/', $documento)) {
                $q->orWhere('numero_documento', 'like', $documento.'%');
            }

            if ($palabras !== []) {
                $q->orWhere(function (Builder $q) use ($palabras): void {
                    foreach ($palabras as $palabra) {
                        $q->where('nombre_busqueda', 'like', '%'.$palabra.'%');
                    }
                });
            }
        });
    }

    /**
     * Estudiantes con el mismo nombre normalizado y distinto id.
     * Sirve para revisar manualmente posibles duplicados: no se fusionan solos.
     *
     * @param  Builder<Estudiante>  $query
     * @return Builder<Estudiante>
     */
    public function scopeConPosiblesCoincidencias(Builder $query): Builder
    {
        return $query->whereExists(function ($sub): void {
            $sub->selectRaw('1')
                ->from('estudiantes as otros')
                ->whereColumn('otros.nombre_busqueda', 'estudiantes.nombre_busqueda')
                ->whereColumn('otros.id', '<>', 'estudiantes.id');
        });
    }

    /**
     * @return Builder<Estudiante>
     */
    public function posiblesCoincidencias(): Builder
    {
        return static::query()
            ->where('nombre_busqueda', self::claveBusqueda($this->apellidos.' '.$this->nombres))
            ->when($this->exists, fn (Builder $q) => $q->whereKeyNot($this->getKey()));
    }

    public static function claveBusqueda(?string $texto): string
    {
        $texto = Str::lower(Str::ascii((string) $texto));
        $texto = preg_replace('/[^a-z0-9 ]+/', ' ', $texto) ?? '';

        return trim(preg_replace('/\s+/', ' ', $texto) ?? '');
    }

    public static function normalizarNumeroDocumento(?string $numero): ?string
    {
        if ($numero === null) {
            return null;
        }

        $numero = Str::upper(preg_replace('/[\s.\-]+/', '', $numero) ?? '');

        return $numero === '' ? null : $numero;
    }

    /**
     * Quita espacios y guiones («987 654 321» → «987654321»). Vacío → null.
     * No convierte a número: el teléfono se guarda como texto.
     */
    public static function normalizarTelefono(mixed $telefono): ?string
    {
        if ($telefono === null) {
            return null;
        }

        $telefono = preg_replace('/[\s\-]+/u', '', (string) $telefono) ?? '';

        return $telefono === '' ? null : $telefono;
    }

    /**
     * El teléfono es opcional: vacío es válido; si hay valor, debe ser un celular peruano.
     */
    public static function telefonoEsValido(mixed $telefono): bool
    {
        $telefono = self::normalizarTelefono($telefono);

        return $telefono === null || preg_match(self::PATRON_TELEFONO, $telefono) === 1;
    }

    private static function limpiarTexto(?string $valor): ?string
    {
        if ($valor === null) {
            return null;
        }

        $valor = trim(preg_replace('/\s+/u', ' ', $valor) ?? '');

        return $valor === '' ? null : $valor;
    }

    private function normalizar(): void
    {
        $this->nombres = self::limpiarTexto($this->nombres);
        $this->apellidos = self::limpiarTexto($this->apellidos);
        $this->numero_documento = self::normalizarNumeroDocumento($this->numero_documento);
        $this->telefono = self::normalizarTelefono($this->telefono);
        $this->observaciones = $this->observaciones === null ? null : (trim($this->observaciones) ?: null);
        $email = self::limpiarTexto($this->email);
        $this->email = $email === null ? null : Str::lower($email);
        $this->nombre_busqueda = self::claveBusqueda($this->apellidos.' '.$this->nombres);
    }

    /**
     * Última barrera antes de la base de datos (que además tiene CHECK y UNIQUE).
     *
     * @throws ValidationException
     */
    private function validarDatos(): void
    {
        $errores = [];

        // Se valida en cada guardado (alta o edición) y desde cualquier punto de entrada.
        if (! self::telefonoEsValido($this->telefono)) {
            $errores['telefono'] = self::MENSAJE_TELEFONO;
        }

        if ($this->nombres === null) {
            $errores['nombres'] = 'Ingrese los nombres del estudiante.';
        }

        if ($this->apellidos === null) {
            $errores['apellidos'] = 'Ingrese los apellidos del estudiante.';
        }

        $tipo = $this->tipo_documento;

        if (! $tipo instanceof TipoDocumento) {
            $errores['tipo_documento'] = 'Seleccione un tipo de documento válido.';
        } elseif (! $tipo->requiereNumero()) {
            if ($this->numero_documento !== null) {
                $errores['numero_documento'] = $tipo->mensajeFormato();
            }
        } elseif ($this->numero_documento === null) {
            $errores['numero_documento'] = 'Ingrese el número de documento o elija «Sin documento registrado».';
        } elseif (! preg_match($tipo->patron(), $this->numero_documento)) {
            $errores['numero_documento'] = $tipo->mensajeFormato();
        } else {
            $duplicado = static::query()
                ->where('tipo_documento', $tipo->value)
                ->where('numero_documento', $this->numero_documento)
                ->when($this->exists, fn (Builder $q) => $q->whereKeyNot($this->getKey()))
                ->exists();

            if ($duplicado) {
                $errores['numero_documento'] = 'Ya existe un estudiante registrado con este documento.';
            }
        }

        if ($errores !== []) {
            throw ValidationException::withMessages($errores);
        }
    }
}
