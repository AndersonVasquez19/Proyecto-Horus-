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

    /**
     * Contenido público de la web (crear, editar, publicar, despublicar y archivar).
     * Mínimo privilegio aprobado el 17/10/2026: solo la administración general.
     * Ampliarlo es una decisión de permisos que exige autorización y pruebas nuevas.
     */
    public function gestionaContenidoPublico(): bool
    {
        return match ($this) {
            self::AdministradorGeneral => true,
            self::CoordinadorInstitucional, self::Secretaria => false,
        };
    }
}
