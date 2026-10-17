<?php

namespace Tests\Feature\Panel;

use App\Filament\Resources\Cursos\Pages\ListCursos;
use App\Filament\Resources\Ediciones\Pages\ListEdiciones;
use App\Filament\Resources\Estudiantes\Pages\ListEstudiantes;
use App\Filament\Resources\Matriculas\Pages\ListMatriculas;
use App\Models\User;
use Filament\Support\Icons\Heroicon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Tema «Horus Academic» (Fase 2A): solo presentación de tablas, botones y acciones.
 */
class TemaTablasTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return array<string, array{class-string, string}>
     */
    public static function listados(): array
    {
        return [
            'estudiantes' => [ListEstudiantes::class, 'Nuevo estudiante'],
            'cursos' => [ListCursos::class, 'Nuevo curso'],
            'ediciones' => [ListEdiciones::class, 'Nueva edición'],
            'matrículas' => [ListMatriculas::class, 'Nueva matrícula'],
        ];
    }

    /**
     * @param  class-string  $pagina
     */
    #[DataProvider('listados')]
    public function test_el_boton_de_alta_conserva_su_texto_y_lleva_el_icono_mas(string $pagina, string $etiqueta): void
    {
        $this->actingAs(User::factory()->administrador()->create());

        Livewire::test($pagina)
            ->assertActionExists('create')
            ->assertActionHasLabel('create', $etiqueta)
            ->assertActionHasIcon('create', Heroicon::OutlinedPlus);
    }

    public function test_el_css_publicado_incluye_la_fase_2(): void
    {
        $css = (string) file_get_contents(public_path('css/app/horus-academic.css'));

        foreach (['FASE 2A', '.fi-ta-ctn', '.fi-ta-header-cell', '.fi-ta-actions-header-cell', '.horus-accion-pdf', '.horus-accion-excel', '.fi-pagination-item.fi-active'] as $regla) {
            $this->assertStringContainsString($regla, $css, "Falta {$regla}: ejecute php artisan filament:assets");
        }

        // Sin recursos externos en el tema.
        $this->assertDoesNotMatchRegularExpression('#url\(\s*["\']?https?://#i', $css);
        $this->assertStringNotContainsString('@import', $css);
    }
}
