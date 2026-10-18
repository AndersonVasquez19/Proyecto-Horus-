<?php

namespace App\Models;

use App\Enums\RolUsuario;
use App\Support\SeguridadPanel;
// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Filament\Models\Contracts\FilamentUser;
use Filament\Panel;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Schema;

#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable implements FilamentUser
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    public function canAccessPanel(Panel $panel): bool
    {
        return $panel->getId() === 'admin' && $this->puedeGestionarAcademico();
    }

    public function puedeGestionarAcademico(): bool
    {
        if (! $this->exists) {
            return false;
        }

        if (! SeguridadPanel::activa() && ! Schema::hasColumns($this->getTable(), ['rol', 'activo'])) {
            // Compatibilidad temporal del entorno local aún sin migrar.
            return true;
        }

        // Leer el estado persistido evita conservar privilegios de un modelo
        // cargado antes de una revocación o falsificados con forceFill en memoria.
        $actual = $this->newQuery()->whereKey($this->getKey())->first(['rol', 'activo']);
        $rol = $actual?->getRawOriginal('rol');

        return $actual?->activo === true
            && is_string($rol)
            && (RolUsuario::tryFrom($rol)?->gestionaAcademico() ?? false);
    }

    /**
     * Gestión del contenido público de la web desde /gestion. Desactivada mientras
     * no se habilite expresamente (config/contenido-publico.php) y limitada a la
     * administración general (RolUsuario::gestionaContenidoPublico). Sin modo
     * heredado: exige siempre rol y cuenta activa persistidos.
     */
    public function puedeGestionarContenidoPublico(): bool
    {
        if (config('contenido-publico.panel_habilitado') !== true || ! $this->exists
            || ! Schema::hasColumns($this->getTable(), ['rol', 'activo'])) {
            return false;
        }

        $actual = $this->newQuery()->whereKey($this->getKey())->first(['rol', 'activo']);
        $rol = $actual?->getRawOriginal('rol');

        return $actual?->activo === true
            && is_string($rol)
            && (RolUsuario::tryFrom($rol)?->gestionaContenidoPublico() ?? false);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'rol' => RolUsuario::class,
            'activo' => 'boolean',
        ];
    }
}
