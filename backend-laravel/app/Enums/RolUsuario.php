<?php

namespace App\Enums;

enum RolUsuario: string
{
    case AdministradorGeneral = 'administrador_general';
    case CoordinadorInstitucional = 'coordinador_institucional';
    case Secretaria = 'secretaria';

    public function gestionaAcademico(): bool
    {
        return match ($this) {
            self::AdministradorGeneral, self::CoordinadorInstitucional => true,
            self::Secretaria => false,
        };
    }
}
