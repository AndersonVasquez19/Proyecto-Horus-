<?php

namespace Database\Factories;

use App\Enums\TipoDocumento;
use App\Models\Estudiante;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Datos ficticios para pruebas. No usar con datos reales.
 *
 * @extends Factory<Estudiante>
 */
class EstudianteFactory extends Factory
{
    public function definition(): array
    {
        return [
            'tipo_documento' => TipoDocumento::Dni,
            'numero_documento' => fake()->unique()->numerify('########'),
            'nombres' => fake()->firstName().' '.fake()->firstName(),
            'apellidos' => fake()->lastName().' '.fake()->lastName(),
            'telefono' => fake()->optional()->numerify('9########'),
            'email' => fake()->optional()->safeEmail(),
            'observaciones' => null,
        ];
    }

    public function sinDocumento(): static
    {
        return $this->state(fn () => [
            'tipo_documento' => TipoDocumento::SinDocumento,
            'numero_documento' => null,
        ]);
    }
}
