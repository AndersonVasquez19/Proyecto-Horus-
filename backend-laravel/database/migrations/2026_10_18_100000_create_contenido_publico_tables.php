<?php

use App\Support\RestriccionesBd;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Contenido institucional que hoy administra NestJS y consume la web React:
 * catálogo de Educación, servicios, preguntas frecuentes, galería, convenios
 * con fotos y datos institucionales públicos.
 *
 * Aditiva: solo crea tablas nuevas, vacías; no importa ni inventa contenido.
 * Separada del ámbito académico: catalogo_cursos es la ficha pública y solo
 * enlaza (opcionalmente) el curso académico, sin duplicar ediciones ni matrículas.
 */
return new class extends Migration
{
    private const ESTADOS = ['borrador', 'publicado', 'archivado'];

    public function up(): void
    {
        Schema::create('catalogo_cursos', function (Blueprint $table): void {
            $table->id();
            // Curso académico que describe la ficha. Si el curso se elimina, la ficha queda sin enlace.
            $table->foreignId('curso_id')->nullable()->unique()->constrained('cursos')->nullOnDelete();
            $table->string('titulo', 160);
            $table->string('slug', 180)->unique();
            $table->text('descripcion');
            $table->enum('tipo', ['curso', 'capacitacion']);
            $table->enum('modalidad', ['presencial', 'virtual', 'hibrida'])->nullable();
            $table->string('duracion', 120)->nullable();
            $table->string('area', 80)->nullable();
            $table->string('certificacion', 150)->nullable();
            $table->string('icono', 30)->nullable();
            $table->string('color', 20)->default('indigo');
            $table->unsignedInteger('orden')->default(0);
            $table->text('temario')->nullable();
            $table->string('imagen_url', 2048)->nullable();
            $table->date('fecha_inicio')->nullable();
            $table->enum('estado', self::ESTADOS)->default('borrador');
            $table->timestamps();

            $table->index(['estado', 'tipo', 'orden'], 'catalogo_cursos_publicos_idx');
        });

        // Un curso (no una capacitación) siempre informa modalidad y duración.
        RestriccionesBd::agregar(
            'catalogo_cursos',
            'catalogo_cursos_curso_completo',
            "NEW.tipo <> 'curso' OR (NEW.modalidad IS NOT NULL AND NEW.duracion IS NOT NULL)",
            "tipo <> 'curso' OR (modalidad IS NOT NULL AND duracion IS NOT NULL)",
        );

        Schema::create('catalogo_servicios', function (Blueprint $table): void {
            $table->id();
            $table->string('titulo', 160);
            $table->string('slug', 180)->unique();
            $table->text('descripcion');
            $table->enum('categoria', ['cableado', 'camaras', 'soporte', 'asesoramiento']);
            $table->string('presentacion', 30)->default('normal');
            $table->string('nombre_corto', 80)->nullable();
            $table->string('destacado', 100)->nullable();
            $table->string('dato_principal', 40)->nullable();
            $table->string('dato_secundario', 100)->nullable();
            $table->text('etiquetas')->nullable();
            $table->string('icono', 30)->nullable();
            $table->string('color', 20)->default('indigo');
            $table->unsignedInteger('orden')->default(0);
            $table->text('alcance')->nullable();
            $table->string('imagen_url', 2048)->nullable();
            $table->enum('estado', self::ESTADOS)->default('borrador');
            $table->timestamps();

            $table->index(['estado', 'categoria', 'orden'], 'catalogo_servicios_publicos_idx');
        });

        Schema::create('preguntas_frecuentes', function (Blueprint $table): void {
            $table->id();
            $table->string('pregunta', 300);
            $table->text('respuesta');
            $table->string('categoria', 100);
            $table->unsignedInteger('orden')->default(0);
            $table->enum('estado', self::ESTADOS)->default('borrador');
            $table->timestamps();

            $table->index(['estado', 'orden'], 'preguntas_frecuentes_publicas_idx');
        });

        Schema::create('galeria_items', function (Blueprint $table): void {
            $table->id();
            $table->string('titulo', 150);
            $table->text('descripcion')->nullable();
            $table->string('categoria', 50)->default('general');
            $table->string('imagen_url', 500);
            $table->unsignedInteger('orden')->default(0);
            // Oculto por defecto: se muestra solo cuando se activa expresamente.
            $table->boolean('activo')->default(false);
            $table->timestamps();

            $table->index(['activo', 'categoria', 'orden'], 'galeria_items_publicos_idx');
        });

        Schema::create('convenios', function (Blueprint $table): void {
            $table->id();
            $table->string('nombre', 160);
            $table->string('sigla', 50)->nullable();
            $table->string('logo_url', 2048)->nullable();
            $table->text('descripcion_corta');
            $table->text('descripcion_completa')->nullable();
            $table->text('informacion_adicional')->nullable();
            $table->unsignedInteger('orden')->default(0);
            $table->boolean('visible')->default(false);
            $table->timestamps();

            $table->index(['visible', 'orden'], 'convenios_visibles_idx');
        });

        Schema::create('convenio_fotos', function (Blueprint $table): void {
            $table->id();
            // Las fotos son parte del convenio: se eliminan con él (los archivos no se tocan).
            $table->foreignId('convenio_id')->constrained('convenios')->cascadeOnDelete();
            $table->string('imagen_url', 2048);
            $table->unsignedInteger('orden')->default(0);
            $table->timestamps();

            $table->index(['convenio_id', 'orden']);
        });

        Schema::create('ajustes_publicos', function (Blueprint $table): void {
            $table->id();
            $table->string('clave', 50)->unique();
            $table->text('valor');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ajustes_publicos');
        Schema::dropIfExists('convenio_fotos');
        Schema::dropIfExists('convenios');
        Schema::dropIfExists('galeria_items');
        Schema::dropIfExists('preguntas_frecuentes');
        Schema::dropIfExists('catalogo_servicios');
        // Elimina también los triggers (SQLite) o el CHECK (MySQL) de la tabla.
        Schema::dropIfExists('catalogo_cursos');
    }
};
