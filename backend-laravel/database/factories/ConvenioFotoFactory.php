<?php

namespace Database\Factories;

use App\Models\Convenio;
use App\Models\ConvenioFoto;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ConvenioFoto>
 */
class ConvenioFotoFactory extends Factory
{
    public function definition(): array
    {
        return [
            'convenio_id' => Convenio::factory(),
            'imagen_url' => '/api/uploads/'.fake()->uuid().'.webp',
        ];
    }
}
