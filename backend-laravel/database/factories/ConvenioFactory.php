<?php

namespace Database\Factories;

use App\Models\Convenio;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Convenio>
 */
class ConvenioFactory extends Factory
{
    public function definition(): array
    {
        return [
            'nombre' => 'Institución ficticia '.fake()->unique()->numberBetween(1, 999999),
            'descripcion_corta' => 'Convenio ficticio para pruebas.',
            'visible' => false,
        ];
    }

    public function visible(): static
    {
        return $this->state(fn (): array => ['visible' => true]);
    }
}
