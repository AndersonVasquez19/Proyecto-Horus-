<?php

namespace Database\Factories;

use App\Models\PreguntaFrecuente;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PreguntaFrecuente>
 */
class PreguntaFrecuenteFactory extends Factory
{
    public function definition(): array
    {
        return [
            'pregunta' => '¿Pregunta ficticia '.fake()->unique()->numberBetween(1, 999999).'?',
            'respuesta' => 'Respuesta ficticia.',
            'categoria' => 'General',
            'estado' => 'borrador',
        ];
    }

    public function publicado(): static
    {
        return $this->state(fn (): array => ['estado' => 'publicado']);
    }
}
