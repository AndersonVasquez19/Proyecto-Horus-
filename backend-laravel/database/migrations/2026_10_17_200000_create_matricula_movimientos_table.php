<?php

use App\Support\RestriccionesBd;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Historial de matrículas. Migración aditiva: solo crea una tabla nueva, no
 * modifica matrículas existentes ni genera historial de operaciones antiguas.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('matricula_movimientos', function (Blueprint $table): void {
            $table->id();
            // RESTRICT: el historial nunca se borra en cascada.
            $table->foreignId('matricula_id')->constrained('matriculas')->restrictOnDelete();
            $table->string('tipo', 20);
            $table->string('estado_anterior', 20)->nullable();
            $table->string('estado_nuevo', 20);
            // Responsable opcional (operaciones sin sesión). RESTRICT: una cuenta con
            // historial se desactiva con «activo», no se elimina.
            $table->foreignId('user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('motivo', 500)->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['matricula_id', 'id']);
        });

        // Valores conocidos y coherencia: la creación no tiene estado anterior y
        // un cambio siempre parte de un estado distinto. $p = prefijo de columna.
        $condicion = function (string $p): string {
            $estados = "'MATRICULADO', 'CULMINADO', 'RETIRADO', 'ANULADO'";
            $tipos = "'CREACION', 'CAMBIO_ESTADO', 'RETIRO', 'ANULACION', 'REACTIVACION'";

            return "{$p}tipo IN ({$tipos}) AND {$p}estado_nuevo IN ({$estados}) AND ("
                ."({$p}tipo = 'CREACION' AND {$p}estado_anterior IS NULL AND {$p}estado_nuevo = 'MATRICULADO')"
                ." OR ({$p}tipo <> 'CREACION' AND {$p}estado_anterior IN ({$estados}) AND {$p}estado_anterior <> {$p}estado_nuevo))";
        };

        RestriccionesBd::agregar(
            'matricula_movimientos',
            'matricula_movimientos_valores_validos',
            $condicion('NEW.'),
            $condicion(''),
        );
    }

    public function down(): void
    {
        // Elimina también los triggers (SQLite) o el CHECK (MySQL) de la tabla.
        Schema::dropIfExists('matricula_movimientos');
    }
};
