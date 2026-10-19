<?php

namespace Database\Factories;

use App\Enums\EstadoEdicion;
use App\Models\Curso;
use App\Models\Edicion;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Edicion>
 */
class EdicionFactory extends Factory
{
    public function definition(): array
    {
        return [
            'curso_id' => Curso::factory(),
            'nombre' => 'Edición '.fake()->unique()->numberBetween(1, 999999),
            'fecha_inicio' => null,
            'fecha_fin' => null,
            'cupo' => null,
            'estado' => EstadoEdicion::Planificada,
        ];
    }
}
