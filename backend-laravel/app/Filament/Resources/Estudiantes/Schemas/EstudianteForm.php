<?php

namespace App\Filament\Resources\Estudiantes\Schemas;

use App\Enums\TipoDocumento;
use App\Models\Estudiante;
use Closure;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Components\Utilities\Get;
use Filament\Schemas\Components\Utilities\Set;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Illuminate\Database\Eloquent\Model;

class EstudianteForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Documento de identidad')
                    ->icon(Heroicon::OutlinedIdentification)
                    ->extraAttributes(['class' => 'horus-tono-azul'])
                    ->columnSpanFull()
                    ->columns(2)
                    ->schema([
                        Select::make('tipo_documento')
                            ->label('Tipo de documento')
                            ->options(TipoDocumento::class)
                            ->default(TipoDocumento::Dni->value)
                            ->selectablePlaceholder(false)
                            ->required()
                            ->live()
                            ->afterStateUpdated(function (Set $set, $state): void {
                                if (self::tipo($state) === TipoDocumento::SinDocumento) {
                                    $set('numero_documento', null);
                                }
                            })
                            ->helperText('Elija «Sin documento registrado» solo si el documento no consta. Nunca invente un número.'),
                        TextInput::make('numero_documento')
                            ->label('Número de documento')
                            ->maxLength(20)
                            ->placeholder(fn (Get $get): string => self::tipo($get('tipo_documento')) === TipoDocumento::Dni ? '8 dígitos' : '')
                            ->hidden(fn (Get $get): bool => self::tipo($get('tipo_documento')) === TipoDocumento::SinDocumento)
                            ->required(fn (Get $get): bool => self::tipo($get('tipo_documento'))?->requiereNumero() ?? true)
                            ->rules([
                                fn (Get $get, ?Model $record): Closure => function (string $attribute, mixed $value, Closure $fail) use ($get, $record): void {
                                    $mensaje = self::errorDocumento($get('tipo_documento'), $value, $record);

                                    if ($mensaje !== null) {
                                        $fail($mensaje);
                                    }
                                },
                            ]),
                    ]),
                Section::make('Datos personales')
                    ->icon(Heroicon::OutlinedUser)
                    ->extraAttributes(['class' => 'horus-tono-turquesa'])
                    ->columnSpanFull()
                    ->columns(2)
                    ->schema([
                        TextInput::make('apellidos')
                            ->label('Apellidos')
                            ->required()
                            ->maxLength(120),
                        TextInput::make('nombres')
                            ->label('Nombres')
                            ->required()
                            ->maxLength(120),
                        TextInput::make('telefono')
                            ->label('Teléfono')
                            // type('tel') en lugar de tel(): tel() añade una regex genérica
                            // cuyo mensaje taparía el de la regla del celular.
                            ->type('tel')
                            ->placeholder('9 dígitos, empieza por 9')
                            ->maxLength(20)
                            ->rules([
                                fn (): Closure => function (string $attribute, mixed $value, Closure $fail): void {
                                    if (! Estudiante::telefonoEsValido($value)) {
                                        $fail(Estudiante::MENSAJE_TELEFONO);
                                    }
                                },
                            ]),
                        TextInput::make('email')
                            ->label('Correo electrónico')
                            ->email()
                            ->maxLength(150),
                        Textarea::make('observaciones')
                            ->label('Observaciones')
                            ->rows(3)
                            ->columnSpanFull(),
                    ]),
            ]);
    }

    /**
     * Si no hay documento, el número se guarda vacío aunque el campo oculto
     * conserve un valor anterior.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public static function prepararDatos(array $data): array
    {
        if (self::tipo($data['tipo_documento'] ?? null) === TipoDocumento::SinDocumento) {
            $data['numero_documento'] = null;
        }

        return $data;
    }

    private static function tipo(mixed $valor): ?TipoDocumento
    {
        if ($valor instanceof TipoDocumento) {
            return $valor;
        }

        return is_string($valor) ? TipoDocumento::tryFrom($valor) : null;
    }

    private static function errorDocumento(mixed $tipo, mixed $valor, ?Model $record): ?string
    {
        $tipo = self::tipo($tipo);
        $numero = Estudiante::normalizarNumeroDocumento(is_string($valor) ? $valor : null);

        if ($tipo === null || ! $tipo->requiereNumero() || $numero === null) {
            return null;
        }

        if (! preg_match($tipo->patron(), $numero)) {
            return $tipo->mensajeFormato();
        }

        $duplicado = Estudiante::query()
            ->where('tipo_documento', $tipo->value)
            ->where('numero_documento', $numero)
            ->when($record?->exists, fn ($q) => $q->whereKeyNot($record->getKey()))
            ->exists();

        return $duplicado ? 'Ya existe un estudiante registrado con este documento.' : null;
    }
}
