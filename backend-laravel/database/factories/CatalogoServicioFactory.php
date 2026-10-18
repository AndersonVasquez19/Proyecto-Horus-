<?php

namespace Database\Factories;

use App\Models\CatalogoServicio;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CatalogoServicio>
 */
class CatalogoServicioFactory extends Factory
{
    public function definition(): array
    {
        $titulo = 'Servicio ficticio '.fake()->unique()->numberBetween(1, 999999);

        return [
            'titulo' => $titulo,
            'slug' => str($titulo)->slug()->toString(),
            'descripcion' => 'Descripción ficticia del servicio.',
            'categoria' => 'soporte',
            'estado' => 'borrador',
        ];
    }

    public function publicado(): static
    {
        return $this->state(fn (): array => ['estado' => 'publicado']);
    }
}
