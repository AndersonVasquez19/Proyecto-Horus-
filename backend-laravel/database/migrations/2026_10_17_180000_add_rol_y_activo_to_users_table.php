<?php

use App\Support\RestriccionesBd;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            // No se promueve ninguna cuenta existente.
            $table->string('rol', 40)->nullable();
            $table->boolean('activo')->default(true);
        });

        RestriccionesBd::agregar(
            'users', 'users_rol_valido',
            "NEW.rol IS NULL OR NEW.rol IN ('administrador_general', 'coordinador_institucional', 'secretaria')",
            "rol IS NULL OR rol IN ('administrador_general', 'coordinador_institucional', 'secretaria')",
        );
        RestriccionesBd::agregar('users', 'users_activo_valido', 'NEW.activo IN (0, 1)', 'activo IN (0, 1)');
    }

    public function down(): void
    {
        RestriccionesBd::eliminar('users', 'users_activo_valido');
        RestriccionesBd::eliminar('users', 'users_rol_valido');
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn(['rol', 'activo']));
    }
};
