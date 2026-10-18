<?php

namespace Tests\Feature\Panel;

use App\Enums\EstadoMatricula;
use App\Filament\Pages\ImportarDesdeExcel;
use App\Http\Middleware\EstablecerIdiomaPanel;
use App\Models\Curso;
use App\Models\Edicion;
use App\Models\Estudiante;
use App\Models\ImportacionAcademica;
use App\Models\Matricula;
use App\Models\User;
use App\Support\ImportacionAcademica\AlmacenImportaciones;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Livewire\Features\SupportLockedProperties\CannotUpdateLockedPropertyException;
use Livewire\Features\SupportTesting\Testable;
use Livewire\Livewire;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ArchivosImportacion;
use Tests\TestCase;

/**
 * Página «Importación académica» del panel (datos ficticios, disco local falso).
 */
class ImportacionAcademicaPanelTest extends TestCase
{
    use ArchivosImportacion, RefreshDatabase;

    private const CSV = "DNI;Apellidos;Nombres\n70000001;Prueba Ficticia;Ana\n70000002;Otra Prueba;Luis\n70000003;Sin Nombres;\n";

    private Edicion $edicion;

    protected function setUp(): void
    {
        parent::setUp();
        app()->setLocale(EstablecerIdiomaPanel::IDIOMA);
        $this->prepararAlmacenFalso();
        $this->edicion = Edicion::factory()->for(Curso::factory()->create(['nombre' => 'Salud Mental']))->create(['nombre' => '2024-I']);
    }

    private function subir(string $contenido = self::CSV, string $nombre = 'lista.csv'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($nombre, $contenido);
    }

    private function vistaPrevia(?User $usuario = null): Testable
    {
        $this->actingAs($usuario ?? User::factory()->administrador()->create());

        return Livewire::test(ImportarDesdeExcel::class)
            ->fillForm(['archivo' => $this->subir(), 'edicion_id' => $this->edicion->id])
            ->call('analizar')
            ->assertHasNoFormErrors()
            ->assertSet('etapa', ImportarDesdeExcel::VISTA_PREVIA);
    }

    public static function cuentas(): array
    {
        return [
            'cuenta básica' => [null, true, 403],
            'secretaría' => ['secretaria', true, 403],
            'administrador inactivo' => ['administrador_general', false, 403],
            'coordinador inactivo' => ['coordinador_institucional', false, 403],
            'coordinador' => ['coordinador_institucional', true, 200],
            'administrador' => ['administrador_general', true, 200],
        ];
    }

    #[DataProvider('cuentas')]
    public function test_solo_las_cuentas_academicas_activas_acceden_a_la_pagina(?string $rol, bool $activo, int $estado): void
    {
        $this->actingAs(User::factory()->create(['rol' => $rol, 'activo' => $activo]));

        $respuesta = $this->get('/gestion/importacion-academica')->assertStatus($estado);

        if ($estado === 200) {
            $respuesta->assertSee('Importación académica')->assertSee('Importar desde Excel');
        }
    }

    public function test_un_visitante_sin_sesion_es_redirigido_al_inicio_de_sesion(): void
    {
        $this->get('/gestion/importacion-academica')->assertRedirect('/gestion/login');
    }

    public function test_flujo_completo_analiza_sin_escribir_confirma_y_muestra_el_resultado(): void
    {
        $antes = $this->recuentoAcademico();
        $pagina = $this->vistaPrevia()
            ->assertSee('Se importará')
            ->assertSee('Rechazada')
            ->assertSee('Faltan los nombres.')
            ->assertSee('Salud Mental — 2024-I');

        $this->assertSame($antes, $this->recuentoAcademico(), 'La vista previa no escribe.');
        $this->assertNull($pagina->get('data.archivo'), 'La subida temporal se descarta tras copiarla al almacén privado.');
        $this->assertCount(1, Storage::disk('local')->files(AlmacenImportaciones::DIRECTORIO));

        $pagina->callAction('confirmar', data: ['revisado' => true])
            ->assertHasNoActionErrors()
            ->assertNotified('Importación completada')
            ->assertSet('etapa', ImportarDesdeExcel::RESULTADO)
            ->assertSee('Resultado de la importación')
            ->assertSee('Importada')
            ->assertSee('Prueba Ficticia, Ana');

        $lote = ImportacionAcademica::query()->sole();
        $this->assertSame([2, 1, 2], [$lote->matriculas_creadas, $lote->filas_rechazadas, $lote->estudiantes_creados]);
        $this->assertSame(2, Matricula::query()->where('edicion_id', $this->edicion->id)->where('estado', EstadoMatricula::Matriculado->value)->count());
        $this->assertSame([], Storage::disk('local')->files(AlmacenImportaciones::DIRECTORIO), 'La copia temporal se borró.');

        $pagina->call('nuevaImportacion')->assertSet('etapa', ImportarDesdeExcel::CARGA)->assertSet('loteId', null);
    }

    public function test_sin_marcar_la_confirmacion_no_se_importa_nada(): void
    {
        $pagina = $this->vistaPrevia();
        $antes = $this->recuentoAcademico();

        $pagina->callAction('confirmar', data: ['revisado' => false])->assertHasActionErrors(['revisado']);
        $pagina->call('confirmar', ['revisado' => 'true'])->assertNotified('Confirmación no válida');

        $this->assertSame($antes, $this->recuentoAcademico());
        $pagina->assertSet('etapa', ImportarDesdeExcel::VISTA_PREVIA);
    }

    public function test_la_segunda_confirmacion_no_vuelve_a_importar(): void
    {
        $pagina = $this->vistaPrevia();
        $pagina->callAction('confirmar', data: ['revisado' => true])->assertSet('etapa', ImportarDesdeExcel::RESULTADO);
        $despues = $this->recuentoAcademico();

        // Un segundo envío (doble clic o reenvío) ya no encuentra una vista previa que confirmar.
        $pagina->call('confirmar', ['revisado' => true])->assertNotified('Confirmación no válida');
        $this->assertSame($despues, $this->recuentoAcademico());
    }

    public function test_el_estado_que_decide_la_importacion_no_se_puede_alterar_desde_el_navegador(): void
    {
        $pagina = $this->vistaPrevia();

        foreach (['token' => '../../.env', 'huella' => str_repeat('0', 64), 'etapa' => ImportarDesdeExcel::RESULTADO, 'opciones' => ['edicion_id' => 999], 'loteId' => 1] as $propiedad => $valor) {
            try {
                $pagina->set($propiedad, $valor);
                $this->fail("Se pudo modificar «{$propiedad}» desde el navegador.");
            } catch (CannotUpdateLockedPropertyException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_cambiar_el_destino_vuelve_a_analizar_y_rechaza_ediciones_no_validas(): void
    {
        $pagina = $this->vistaPrevia();
        $huella = $pagina->get('huella');
        $otra = Edicion::factory()->for($this->edicion->curso)->create(['nombre' => '2024-II', 'cupo' => 1]);

        $pagina->fillForm(['edicion_id' => $otra->id])->assertSet('opciones.edicion_id', $otra->id);
        $this->assertNotSame($huella, $pagina->get('huella'));
        $pagina->assertSee('Sin cupo');

        // Una edición inexistente (manipulada) queda como error de estructura y no se puede confirmar.
        $pagina->set('data.edicion_id', 999999)->call('reanalizar')->assertSee('La edición de destino elegida no existe.');
        $pagina->assertActionDisabled('confirmar');
    }

    public function test_rechaza_archivos_no_admitidos_con_un_mensaje_claro(): void
    {
        $this->actingAs(User::factory()->administrador()->create());

        Livewire::test(ImportarDesdeExcel::class)
            ->fillForm(['archivo' => UploadedFile::fake()->createWithContent('lista.csv', "PK\x03\x04binario"), 'edicion_id' => $this->edicion->id])
            ->call('analizar')
            ->assertHasFormErrors(['archivo'])
            ->assertSet('etapa', ImportarDesdeExcel::CARGA);

        $this->assertSame([], Storage::disk('local')->files(AlmacenImportaciones::DIRECTORIO), 'No queda copia de un archivo rechazado.');
        $this->assertSame(0, Estudiante::query()->count());
    }

    public function test_una_cuenta_desactivada_durante_la_sesion_pierde_el_acceso_a_las_acciones(): void
    {
        $admin = User::factory()->administrador()->create();
        $pagina = $this->vistaPrevia($admin);
        User::query()->whereKey($admin->id)->update(['activo' => false]);

        $pagina->call('confirmar', ['revisado' => true])->assertForbidden();
        $this->assertSame(0, Matricula::query()->count());
    }

    public function test_si_otra_persona_ocupa_el_cupo_se_muestra_la_vista_previa_actualizada(): void
    {
        $this->edicion->update(['cupo' => 2]);
        $pagina = $this->vistaPrevia();
        $huella = $pagina->get('huella');
        Matricula::factory()->create(['edicion_id' => $this->edicion->id]);

        $pagina->callAction('confirmar', data: ['revisado' => true])
            ->assertNotified('No se importó nada')
            ->assertSet('etapa', ImportarDesdeExcel::VISTA_PREVIA)
            ->assertSee('Sin cupo');

        $this->assertNotSame($huella, $pagina->get('huella'));
        $this->assertSame(0, ImportacionAcademica::query()->count());
        $this->assertSame(1, Matricula::query()->count());

        // Revisada la nueva vista previa, puede confirmar lo que sí cabe.
        $pagina->callAction('confirmar', data: ['revisado' => true])->assertNotified('Importación completada');
        $this->assertSame(2, $this->edicion->matriculasQueOcupanCupo());
    }

    public function test_la_pagina_aparece_en_la_navegacion_academica_existente(): void
    {
        $this->actingAs(User::factory()->administrador()->create());

        $this->get('/gestion')->assertOk()->assertSee('Importar desde Excel')->assertSee('Gestión académica');
    }
}
