<?php

use App\Support\RestriccionesBd;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Trazabilidad de la importación académica desde CSV/XLSX.
 *
 * Migración aditiva: solo crea dos tablas nuevas; no modifica estudiantes,
 * cursos, ediciones, matrículas ni su historial. Cada lote se inserta en la
 * misma transacción que sus estudiantes y matrículas: si la importación se
 * revierte, el lote también. Ambas tablas son de solo lectura una vez escritas
 * (los modelos rechazan UPDATE y DELETE) y no guardan copias de datos
 * personales: solo identificadores y mensajes genéricos.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('importaciones_academicas', function (Blueprint $table): void {
            $table->id();
            // Ficha de la vista previa confirmada: impide confirmar dos veces la misma.
            $table->uuid('uuid')->unique();
            // sha256(archivo | hoja | destino): impide importar dos veces el mismo contenido.
            $table->char('huella', 64)->unique();
            // RESTRICT: una cuenta con historial se desactiva, no se elimina.
            $table->foreignId('user_id')->constrained('users')->restrictOnDelete();
            // Destino fijo elegido en el panel; null si cada fila indica su curso y edición.
            $table->foreignId('edicion_id')->nullable()->constrained('ediciones')->restrictOnDelete();
            $table->string('nombre_archivo', 255);
            $table->string('formato', 10);
            $table->string('hoja', 100)->nullable();
            $table->char('archivo_sha256', 64)->index();
            $table->unsignedInteger('filas_total');
            $table->unsignedInteger('filas_importadas');
            $table->unsignedInteger('filas_omitidas');
            $table->unsignedInteger('filas_rechazadas');
            $table->unsignedInteger('estudiantes_creados');
            $table->unsignedInteger('matriculas_creadas');
            $table->timestamp('created_at')->useCurrent();
        });

        Schema::create('importacion_academica_filas', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('importacion_academica_id')->constrained('importaciones_academicas')->restrictOnDelete();
            // Número de fila del archivo (como lo muestra Excel).
            $table->unsignedInteger('fila');
            $table->string('resultado', 20);
            $table->string('operacion', 40);
            $table->foreignId('estudiante_id')->nullable()->constrained('estudiantes')->restrictOnDelete();
            $table->foreignId('matricula_id')->nullable()->constrained('matriculas')->restrictOnDelete();
            // Motivo genérico (sin nombres, documentos ni contactos).
            $table->string('detalle', 500)->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['importacion_academica_id', 'fila'], 'importacion_filas_lote_fila_unique');
        });

        $mysql = DB::connection()->getDriverName() === 'mysql';
        // En MySQL, IN ignora mayúsculas y espacios finales con utf8mb4_unicode_ci (ver
        // 2026_10_18_000000_endurece_restricciones_mysql): se compara en binario.
        $col = fn (string $prefijo, string $columna): string => $mysql
            ? "CAST({$columna} AS BINARY)"
            : $prefijo.$columna;

        $condicion = fn (string $p): string => "{$col($p, 'formato')} IN ('csv', 'xlsx')"
            ." AND {$p}filas_total = {$p}filas_importadas + {$p}filas_omitidas + {$p}filas_rechazadas"
            ." AND {$p}matriculas_creadas = {$p}filas_importadas"
            ." AND {$p}estudiantes_creados <= {$p}matriculas_creadas";

        RestriccionesBd::agregar('importaciones_academicas', 'importaciones_academicas_valores_validos', $condicion('NEW.'), $condicion(''));

        $condicionFila = fn (string $p): string => "{$col($p, 'resultado')} IN ('IMPORTADA', 'OMITIDA', 'RECHAZADA')"
            ." AND {$col($p, 'operacion')} IN ('CREAR_ESTUDIANTE_Y_MATRICULAR', 'MATRICULAR_ESTUDIANTE_EXISTENTE', 'NINGUNA')"
            ." AND (({$col($p, 'resultado')} = 'IMPORTADA' AND {$p}matricula_id IS NOT NULL AND {$p}estudiante_id IS NOT NULL"
            ." AND {$col($p, 'operacion')} <> 'NINGUNA')"
            ." OR ({$col($p, 'resultado')} <> 'IMPORTADA' AND {$col($p, 'operacion')} = 'NINGUNA'))";

        RestriccionesBd::agregar('importacion_academica_filas', 'importacion_filas_valores_validos', $condicionFila('NEW.'), $condicionFila(''));
    }

    public function down(): void
    {
        // Elimina también los triggers (SQLite) o los CHECK (MySQL) de cada tabla.
        Schema::dropIfExists('importacion_academica_filas');
        Schema::dropIfExists('importaciones_academicas');
    }
};
