<?php

use App\Support\RestriccionesBd;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('estudiantes', function (Blueprint $table) {
            $table->id();
            $table->enum('tipo_documento', ['DNI', 'CE', 'PASAPORTE', 'SIN_DOCUMENTO'])->default('DNI');
            // Texto, no número: conserva ceros iniciales. Nulo solo con SIN_DOCUMENTO.
            $table->string('numero_documento', 20)->nullable();
            $table->string('nombres', 120);
            $table->string('apellidos', 120);
            // Clave derivada (minúsculas, sin tildes) para buscar y detectar homónimos.
            $table->string('nombre_busqueda', 250)->index();
            $table->string('telefono', 20)->nullable();
            $table->string('email', 150)->nullable();
            $table->text('observaciones')->nullable();
            $table->timestamps();

            // Varias filas con documento NULL están permitidas (SQLite y MySQL).
            $table->unique(['tipo_documento', 'numero_documento'], 'estudiantes_documento_unique');
        });

        RestriccionesBd::agregar(
            'estudiantes',
            'estudiantes_documento_valido',
            "(NEW.tipo_documento = 'SIN_DOCUMENTO' AND NEW.numero_documento IS NULL)"
            ." OR (NEW.tipo_documento = 'DNI' AND length(NEW.numero_documento) = 8 AND NEW.numero_documento NOT GLOB '*[^0-9]*')"
            ." OR (NEW.tipo_documento IN ('CE', 'PASAPORTE') AND length(NEW.numero_documento) BETWEEN 4 AND 20 AND NEW.numero_documento NOT GLOB '*[^A-Z0-9]*')",
            "(tipo_documento = 'SIN_DOCUMENTO' AND numero_documento IS NULL)"
            ." OR (tipo_documento = 'DNI' AND numero_documento IS NOT NULL AND numero_documento REGEXP '^[0-9]{8}$')"
            ." OR (tipo_documento IN ('CE', 'PASAPORTE') AND numero_documento IS NOT NULL AND numero_documento REGEXP '^[A-Z0-9]{4,20}$')",
        );
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        RestriccionesBd::eliminar('estudiantes', 'estudiantes_documento_valido');
        Schema::dropIfExists('estudiantes');
    }
};
