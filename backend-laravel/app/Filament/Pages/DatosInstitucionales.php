<?php

namespace App\Filament\Pages;

use App\Models\AjustePublico;
use App\Models\User;
use App\Support\Contenido\OpcionesContenido;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Facades\Filament;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Schemas\Components\Actions;
use Filament\Schemas\Components\Component;
use Filament\Schemas\Components\EmbeddedSchema;
use Filament\Schemas\Components\Form;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Illuminate\Validation\ValidationException;
use UnitEnum;

/**
 * Datos de contacto y redes que muestra la web. Solo claves conocidas; un campo
 * vacío deja el dato sin publicar. Se guardan todos juntos en una transacción.
 */
class DatosInstitucionales extends Page
{
    protected static ?string $slug = 'contenido/datos-institucionales';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedBuildingOffice2;

    protected static string|UnitEnum|null $navigationGroup = 'Contenido web';

    protected static ?int $navigationSort = 6;

    protected static ?string $navigationLabel = 'Datos institucionales';

    protected static ?string $title = 'Datos institucionales';

    /** @var array<string, mixed> */
    public ?array $data = [];

    public static function canAccess(): bool
    {
        $user = Filament::auth()->user();

        return $user instanceof User && $user->puedeGestionarContenidoPublico();
    }

    public function mount(): void
    {
        $this->form->fill(AjustePublico::publicos());
    }

    public function getSubheading(): ?string
    {
        return 'Contacto y redes que aparecen en la web. Deje vacío un dato para no publicarlo.';
    }

    public function form(Schema $schema): Schema
    {
        $grupos = ['general' => 'Empresa', 'contacto' => 'Contacto', 'redes' => 'Redes sociales'];

        return $schema
            ->statePath('data')
            ->components(array_map(fn (string $grupo, string $titulo): Section => Section::make($titulo)
                ->columns(2)
                ->columnSpanFull()
                ->schema(array_values(array_map(
                    fn (string $clave): TextInput => TextInput::make($clave)
                        ->label(OpcionesContenido::AJUSTES[$clave]['etiqueta'])
                        ->rules(OpcionesContenido::reglasAjuste($clave))
                        ->maxLength(OpcionesContenido::LONGITUD_AJUSTE),
                    array_keys(array_filter(OpcionesContenido::AJUSTES, fn (array $a): bool => $a['grupo'] === $grupo)),
                ))), array_keys($grupos), $grupos));
    }

    public function content(Schema $schema): Schema
    {
        return $schema->components([$this->getFormContentComponent()]);
    }

    public function getFormContentComponent(): Component
    {
        return Form::make([EmbeddedSchema::make('form')])
            ->id('form')
            ->livewireSubmitHandler('save')
            ->footer([
                Actions::make([
                    Action::make('save')->label('Guardar datos')->submit('save')->keyBindings(['mod+s']),
                ])->key('form-actions'),
            ]);
    }

    public function save(): void
    {
        // Se vuelve a autorizar en cada envío (la sesión o el rol pueden haber cambiado).
        abort_unless(static::canAccess(), 403);
        $datos = $this->form->getState();

        try {
            AjustePublico::guardar($datos);
        } catch (ValidationException $e) {
            throw ValidationException::withMessages(collect($e->errors())->mapWithKeys(fn (array $m, string $campo): array => ['data.'.$campo => $m])->all());
        }

        Notification::make()->success()->title('Datos institucionales guardados')->send();
    }
}
