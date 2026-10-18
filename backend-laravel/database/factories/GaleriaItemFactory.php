<?php

namespace Database\Factories;

use App\Models\GaleriaItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<GaleriaItem>
 */
class GaleriaItemFactory extends Factory
{
    public function definition(): array
    {
        return [
            'titulo' => 'Foto ficticia '.fake()->unique()->numberBetween(1, 999999),
            'categoria' => 'capacitaciones',
            'imagen_url' => '/api/uploads/'.fake()->uuid().'.jpg',
            'activo' => false,
        ];
    }

    public function activo(): static
    {
        return $this->state(fn (): array => ['activo' => true]);
    }
}
