<?php

use App\Support\RestriccionesBd;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ediciones', function (Blueprint $table) {
            $table->id();
            // RESTRICT: no se puede borrar un curso que tenga ediciones.
            $table->foreignId('curso_id')->constrained('cursos')->restrictOnDelete();
            $table->string('nombre', 150);
            // Opcionales: la información histórica puede no tener fechas.
            $table->date('fecha_inicio')->nullable();
            $table->date('fecha_fin')->nullable();
            $table->unsignedSmallInteger('cupo')->nullable();
            $table->enum('estado', ['PLANIFICADA', 'EN_CURSO', 'FINALIZADA', 'CANCELADA'])->default('PLANIFICADA')->index();
            $table->timestamps();

            $table->unique(['curso_id', 'nombre'], 'ediciones_curso_nombre_unique');
        });

        RestriccionesBd::agregar(
            'ediciones',
            'ediciones_fechas_validas',
            'NEW.fecha_inicio IS NULL OR NEW.fecha_fin IS NULL OR NEW.fecha_fin >= NEW.fecha_inicio',
            'fecha_inicio IS NULL OR fecha_fin IS NULL OR fecha_fin >= fecha_inicio',
        );

        RestriccionesBd::agregar(
            'ediciones',
            'ediciones_cupo_positivo',
            'NEW.cupo IS NULL OR NEW.cupo > 0',
            'cupo IS NULL OR cupo > 0',
        );
    }

    public function down(): void
    {
        RestriccionesBd::eliminar('ediciones', 'ediciones_cupo_positivo');
        RestriccionesBd::eliminar('ediciones', 'ediciones_fechas_validas');
        Schema::dropIfExists('ediciones');
    }
};
