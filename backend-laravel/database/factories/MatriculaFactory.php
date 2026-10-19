<?php

namespace Database\Factories;

use App\Enums\EstadoMatricula;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\Matricula;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Matricula>
 */
class MatriculaFactory extends Factory
{
    public function definition(): array
    {
        return [
            'estudiante_id' => Estudiante::factory(),
            'edicion_id' => Edicion::factory(),
            'fecha_matricula' => null,
            'estado' => EstadoMatricula::Matriculado,
            'observaciones' => null,
        ];
    }
}
