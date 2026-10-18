<?php

namespace Database\Factories;

use App\Models\CatalogoCurso;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CatalogoCurso>
 */
class CatalogoCursoFactory extends Factory
{
    public function definition(): array
    {
        $titulo = 'Curso ficticio '.fake()->unique()->numberBetween(1, 999999);

        return [
            'titulo' => $titulo,
            'slug' => str($titulo)->slug()->toString(),
            'descripcion' => 'Descripción ficticia para pruebas.',
            'tipo' => 'curso',
            'modalidad' => 'presencial',
            'duracion' => '20 horas',
            'estado' => 'borrador',
        ];
    }

    public function publicado(): static
    {
        return $this->state(fn (): array => ['estado' => 'publicado']);
    }

    public function capacitacion(): static
    {
        return $this->state(fn (): array => ['tipo' => 'capacitacion', 'modalidad' => null, 'duracion' => null]);
    }
}
