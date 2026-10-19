<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('matriculas', function (Blueprint $table) {
            $table->id();
            // RESTRICT en ambas claves: el historial académico nunca se borra en cascada.
            $table->foreignId('estudiante_id')->constrained('estudiantes')->restrictOnDelete();
            $table->foreignId('edicion_id')->constrained('ediciones')->restrictOnDelete();
            // Opcional: no se inventan fechas para registros históricos.
            $table->date('fecha_matricula')->nullable();
            $table->enum('estado', ['MATRICULADO', 'CULMINADO', 'RETIRADO', 'ANULADO'])->default('MATRICULADO');
            $table->text('observaciones')->nullable();
            $table->timestamps();

            // Un estudiante solo puede tener una matrícula por edición.
            $table->unique(['estudiante_id', 'edicion_id'], 'matriculas_estudiante_edicion_unique');
            $table->index(['edicion_id', 'estado']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('matriculas');
    }
};
