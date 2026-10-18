<?php

namespace App\Filament\Pages;

use App\Filament\Support\OpcionesAcademicas;
use App\Models\ImportacionAcademica;
use App\Models\ImportacionAcademicaFila;
use App\Support\ImportacionAcademica\AlmacenImportaciones;
use App\Support\ImportacionAcademica\AnalizadorImportacion;
use App\Support\ImportacionAcademica\ArchivoNoValidoException;
use App\Support\ImportacionAcademica\ArchivoPreparado;
use App\Support\ImportacionAcademica\CamposImportacion;
use App\Support\ImportacionAcademica\EjecutorImportacion;
use App\Support\ImportacionAcademica\ImportacionRechazadaException;
use App\Support\ImportacionAcademica\LectorArchivo;
use App\Support\ImportacionAcademica\OpcionesImportacion;
use App\Support\ImportacionAcademica\PermisoImportacion;
use App\Support\ImportacionAcademica\PlanImportacion;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Facades\Filament;
use Filament\Forms\Components\Checkbox;
use Filament\Forms\Components\Field;
use Filament\Forms\Components\FileUpload;
use Filament\Forms\Components\Radio;
use Filament\Forms\Components\Select;
use Filament\Infolists\Components\TextEntry;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Schemas\Components\Actions;
use Filament\Schemas\Components\Callout;
use Filament\Schemas\Components\Component;
use Filament\Schemas\Components\EmbeddedSchema;
use Filament\Schemas\Components\EmbeddedTable;
use Filament\Schemas\Components\Grid;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Enums\FontWeight;
use Filament\Support\Enums\TextSize;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Concerns\InteractsWithTable;
use Filament\Tables\Contracts\HasTable;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Validation\ValidationException;
use Livewire\Attributes\Locked;
use Livewire\Features\SupportFileUploads\TemporaryUploadedFile;
use UnitEnum;

/**
 * Importación académica desde CSV o XLSX: cargar, revisar columnas, vista
 * previa sin escrituras, confirmación explícita e informe de resultados.
 *
 * Las reglas viven en App\Support\ImportacionAcademica; esta página solo
 * guía el flujo. El estado que decide qué se importa (ficha del archivo,
 * huella de la vista previa y opciones analizadas) está bloqueado frente a
 * cambios desde el navegador, y cada acción vuelve a autorizar.
 */
class ImportarDesdeExcel extends Page implements HasTable
{
    use InteractsWithTable;

    public const CARGA = 'carga';

    public const VISTA_PREVIA = 'vista_previa';

    public const RESULTADO = 'resultado';

    protected static ?string $slug = 'importacion-academica';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedArrowUpTray;

    protected static string|UnitEnum|null $navigationGroup = 'Gestión académica';

    protected static ?int $navigationSort = 5;

    protected static ?string $navigationLabel = 'Importar desde Excel';

    protected static ?string $title = 'Importación académica';

    /** @var array<string, mixed> */
    public ?array $data = [];

    #[Locked]
    public string $etapa = self::CARGA;

    #[Locked]
    public ?string $token = null;

    #[Locked]
    public ?string $formato = null;

    #[Locked]
    public ?string $nombreArchivo = null;

    #[Locked]
    public ?string $sha256 = null;

    #[Locked]
    public ?string $huella = null;

    /** Opciones con las que se hizo la vista previa visible (las que se confirman). */
    #[Locked]
    public array $opciones = [];

    #[Locked]
    public ?int $loteId = null;

    /** Plan de esta petición (no se envía al navegador). */
    private ?PlanImportacion $plan = null;

    public static function canAccess(): bool
    {
        return PermisoImportacion::permite(Filament::auth()->user());
    }

    public function mount(): void
    {
        $this->form->fill(['formato_nombre' => CamposImportacion::NOMBRE_CON_COMA]);
    }

    public function getSubheading(): ?string
    {
        return 'Registre estudiantes y matrículas desde un archivo CSV o XLSX. Nada se guarda hasta que confirme la vista previa.';
    }

    public function form(Schema $schema): Schema
    {
        return $schema
            ->statePath('data')
            ->components([
                Section::make('1. Archivo y destino')
                    ->description('Formatos admitidos: CSV (UTF-8 o ANSI, separado por «;» o «,») y XLSX sin macros, hasta '.(LectorArchivo::TAMANO_MAXIMO_KB / 1024).' MB y '.AnalizadorImportacion::FILAS_MAXIMAS.' filas.')
                    ->columns(2)
                    ->columnSpanFull()
                    ->schema([
                        FileUpload::make('archivo')
                            ->label('Archivo')
                            ->helperText('Columnas obligatorias: DNI y apellidos y nombres. Opcionales: celular, correo, fecha de matrícula, curso y edición.')
                            ->storeFiles(false)
                            ->disk('local')
                            ->visibility('private')
                            ->maxSize(LectorArchivo::TAMANO_MAXIMO_KB)
                            ->acceptedFileTypes([
                                'text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel',
                                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip',
                            ])
                            ->required()
                            ->columnSpanFull(),
                        Select::make('edicion_id')
                            ->label('Edición de destino')
                            ->placeholder('Según las columnas «Curso» y «Edición» del archivo')
                            ->helperText('Si la elige, todas las filas se matriculan en ella. Las ediciones canceladas no se ofrecen.')
                            ->options(fn (): array => OpcionesAcademicas::edicionesParaMatricular())
                            ->searchable()
                            ->live()
                            ->afterStateUpdated(fn () => $this->reanalizar()),
                        Radio::make('formato_nombre')
                            ->label('Columna «Apellidos y nombres»')
                            ->options([
                                CamposImportacion::NOMBRE_CON_COMA => 'Separados por coma: «Apellidos, Nombres»',
                                CamposImportacion::NOMBRE_DOS_APELLIDOS => 'Sin coma: dos apellidos seguidos de los nombres',
                            ])
                            ->helperText('Solo se usa si el archivo trae una única columna con el nombre completo. Revise la separación en la vista previa.')
                            ->live()
                            ->afterStateUpdated(fn () => $this->reanalizar()),
                        Actions::make([
                            Action::make('analizar')
                                ->label('Analizar archivo')
                                ->icon(Heroicon::OutlinedMagnifyingGlass)
                                ->action(fn () => $this->analizar()),
                            Action::make('cancelar')
                                ->label('Descartar')
                                ->color('gray')
                                ->visible(fn (): bool => $this->etapa === self::VISTA_PREVIA)
                                ->action(fn () => $this->descartar()),
                        ])->key('acciones-carga')->columnSpanFull(),
                    ])
                    ->visible(fn (): bool => $this->etapa !== self::RESULTADO),
                Section::make('2. Columnas detectadas')
                    ->description(fn (): string => $this->descripcionColumnas())
                    ->columns(3)
                    ->columnSpanFull()
                    ->visible(fn (): bool => $this->etapa === self::VISTA_PREVIA && $this->plan() !== null)
                    ->schema(fn (): array => $this->camposDeColumnas()),
            ]);
    }

    public function content(Schema $schema): Schema
    {
        return $schema->components([
            EmbeddedSchema::make('form'),
            Section::make('3. Vista previa')
                ->description('Ninguna fila se ha guardado todavía. Revise los errores y la operación propuesta para cada fila.')
                ->columnSpanFull()
                ->visible(fn (): bool => $this->etapa === self::VISTA_PREVIA && $this->plan() !== null)
                ->schema(fn (): array => $this->componentesVistaPrevia()),
            Section::make('Resultado de la importación')
                ->columnSpanFull()
                ->visible(fn (): bool => $this->etapa === self::RESULTADO && $this->lote() !== null)
                ->schema(fn (): array => $this->componentesResultado()),
            EmbeddedTable::make()
                ->visible(fn (): bool => ($this->etapa === self::VISTA_PREVIA && ($this->plan()?->filas ?? []) !== [])
                    || $this->etapa === self::RESULTADO),
        ]);
    }

    public function table(Table $table): Table
    {
        return $table
            ->heading(fn (): string => $this->etapa === self::RESULTADO ? 'Resultado por fila' : 'Filas del archivo')
            ->records(fn (array $filters, int $page, int $recordsPerPage): LengthAwarePaginator => $this->registrosTabla($filters, $page, $recordsPerPage))
            ->columns([
                TextColumn::make('fila')->label('Fila'),
                TextColumn::make('estado')
                    ->label('Resultado')
                    ->badge()
                    ->formatStateUsing(fn (string $state): string => self::ETIQUETAS_ESTADO[$state] ?? $state)
                    ->color(fn (string $state): string => match ($state) {
                        PlanImportacion::VALIDA, ImportacionAcademicaFila::IMPORTADA => 'success',
                        PlanImportacion::INVALIDA, ImportacionAcademicaFila::RECHAZADA => 'danger',
                        default => 'gray',
                    }),
                TextColumn::make('operacion')
                    ->label('Operación')
                    ->formatStateUsing(fn (?string $state): ?string => self::ETIQUETAS_OPERACION[$state] ?? null)
                    ->placeholder('—')
                    ->wrap(),
                TextColumn::make('documento')->label('Documento')->placeholder('—'),
                TextColumn::make('estudiante')->label('Apellidos y nombres')->placeholder('—')->wrap(),
                TextColumn::make('destino')->label('Curso y edición')->placeholder('—')->wrap(),
                TextColumn::make('mensajes')
                    ->label('Errores y avisos')
                    ->listWithLineBreaks()
                    ->bulleted()
                    ->placeholder('—')
                    ->wrap(),
            ])
            ->filters([
                SelectFilter::make('estado')
                    ->label('Resultado')
                    ->options(fn (): array => $this->etapa === self::RESULTADO
                        ? [ImportacionAcademicaFila::IMPORTADA => 'Importadas', ImportacionAcademicaFila::OMITIDA => 'Omitidas', ImportacionAcademicaFila::RECHAZADA => 'Rechazadas']
                        : [PlanImportacion::VALIDA => 'Se importarán', PlanImportacion::INVALIDA => 'Rechazadas', PlanImportacion::OMITIDA => 'Omitidas']),
            ])
            ->paginated([10, 25, 50, 100])
            ->defaultPaginationPageOption(25)
            ->emptyStateHeading('Sin filas que mostrar');
    }

    private const ETIQUETAS_ESTADO = [
        PlanImportacion::VALIDA => 'Se importará',
        PlanImportacion::INVALIDA => 'Rechazada',
        PlanImportacion::OMITIDA => 'Omitida',
        ImportacionAcademicaFila::IMPORTADA => 'Importada',
        ImportacionAcademicaFila::OMITIDA => 'Omitida',
        ImportacionAcademicaFila::RECHAZADA => 'Rechazada',
    ];

    private const ETIQUETAS_OPERACION = [
        PlanImportacion::CREAR_Y_MATRICULAR => 'Registrar estudiante y matricular',
        PlanImportacion::MATRICULAR_EXISTENTE => 'Matricular estudiante ya registrado',
    ];

    public function analizar(): void
    {
        $this->autorizar();
        $estado = $this->form->getState();
        $archivo = $estado['archivo'] ?? null;
        $archivo = is_array($archivo) ? (array_values($archivo)[0] ?? null) : $archivo;

        if (! $archivo instanceof TemporaryUploadedFile) {
            throw ValidationException::withMessages(['data.archivo' => 'Seleccione un archivo CSV o XLSX.']);
        }

        $almacen = app(AlmacenImportaciones::class);
        $almacen->eliminar($this->token, $this->formato);
        $this->reiniciar();
        $preparado = null;

        try {
            $preparado = $almacen->guardar($archivo->getRealPath(), $archivo->getClientOriginalName());
            $opciones = new OpcionesImportacion(
                edicionDestinoId: OpcionesImportacion::desdeFormulario($this->data ?? [], false)->edicionDestinoId,
                formatoNombre: OpcionesImportacion::desdeFormulario($this->data ?? [], false)->formatoNombre,
            );
            $plan = app(AnalizadorImportacion::class)->analizar(
                app(LectorArchivo::class)->leer($almacen->ruta($preparado->token, $preparado->formato), $preparado->formato),
                $opciones,
            );
        } catch (ArchivoNoValidoException $e) {
            if ($preparado !== null) {
                $almacen->eliminar($preparado->token, $preparado->formato);
            }

            throw ValidationException::withMessages(['data.archivo' => $e->getMessage()]);
        } finally {
            // La copia de trabajo queda en el almacén privado; la subida temporal de Livewire se borra ya.
            $this->data['archivo'] = null;
            $archivo->delete();
        }

        $this->token = $preparado->token;
        $this->formato = $preparado->formato;
        $this->nombreArchivo = $preparado->nombre;
        $this->sha256 = $preparado->sha256;
        $this->etapa = self::VISTA_PREVIA;
        $this->adoptarPlan($plan, $opciones);
        $this->resetTable();

        $plan->erroresEstructura === []
            ? Notification::make()->success()->title('Archivo analizado')->body('Revise la vista previa antes de confirmar. Todavía no se guardó nada.')->send()
            : Notification::make()->warning()->title('El archivo no se puede importar todavía')->body('Revise los problemas indicados en la vista previa.')->send();
    }

    /**
     * Vuelve a analizar el archivo ya subido con el destino, el formato, la hoja y el mapeo actuales.
     */
    public function reanalizar(): void
    {
        $this->autorizar();

        if ($this->etapa !== self::VISTA_PREVIA || $this->token === null) {
            return;
        }

        $opciones = OpcionesImportacion::desdeFormulario($this->data ?? [], true);

        // Al cambiar de hoja, el mapeo anterior no corresponde: se vuelve a detectar.
        if ($opciones->hoja !== ($this->opciones['hoja'] ?? null)) {
            $opciones = new OpcionesImportacion($opciones->hoja, $opciones->edicionDestinoId, $opciones->formatoNombre, null);
        }

        try {
            $plan = $this->analizarConOpciones($opciones);
        } catch (ArchivoNoValidoException $e) {
            $this->descartar();
            Notification::make()->danger()->title('No se pudo leer el archivo')->body($e->getMessage())->send();

            return;
        }

        $this->adoptarPlan($plan, $opciones);
        $this->resetTable();
    }

    public function confirmarAction(): Action
    {
        return Action::make('confirmar')
            ->label(fn (): string => 'Confirmar importación ('.($this->plan()?->operaciones() ?? 0).')')
            ->icon(Heroicon::OutlinedCheckCircle)
            ->visible(fn (): bool => $this->etapa === self::VISTA_PREVIA)
            ->disabled(fn (): bool => ! ($this->plan()?->puedeConfirmarse() ?? false))
            ->requiresConfirmation()
            ->modalIcon(Heroicon::OutlinedArrowUpTray)
            ->modalHeading('Confirmar importación')
            ->modalDescription(fn (): string => $this->textoConfirmacion())
            ->schema([
                Checkbox::make('revisado')
                    ->label('Revisé la vista previa y autorizo registrar estas matrículas.')
                    ->accepted()
                    ->required(),
            ])
            ->modalSubmitActionLabel('Importar ahora')
            ->action(fn (array $data) => $this->confirmar($data));
    }

    /**
     * @param  array<string, mixed>  $datos
     */
    public function confirmar(array $datos): void
    {
        $this->autorizar();

        if (($datos['revisado'] ?? false) !== true || $this->etapa !== self::VISTA_PREVIA || $this->token === null || $this->huella === null) {
            Notification::make()->danger()->title('Confirmación no válida')->body('Revise la vista previa y marque la confirmación.')->send();

            return;
        }

        $archivo = new ArchivoPreparado($this->token, (string) $this->formato, (string) $this->nombreArchivo, (string) $this->sha256);
        $opciones = $this->opcionesAnalizadas();

        try {
            $lote = app(EjecutorImportacion::class)->confirmar(Filament::auth()->user(), $archivo, $opciones, $this->huella);
        } catch (ImportacionRechazadaException $e) {
            if ($e->planActualizado !== null) {
                $this->adoptarPlan($e->planActualizado, $opciones);
                $this->resetTable();
            }

            Notification::make()->danger()->title('No se importó nada')->body($e->getMessage())->persistent()->send();

            return;
        } catch (ArchivoNoValidoException $e) {
            Notification::make()->danger()->title('No se importó nada')->body($e->getMessage())->persistent()->send();

            return;
        }

        $this->token = null;
        $this->huella = null;
        $this->loteId = $lote->getKey();
        $this->etapa = self::RESULTADO;
        $this->plan = null;
        $this->resetTable();

        Notification::make()
            ->success()
            ->title('Importación completada')
            ->body("Se registraron {$lote->matriculas_creadas} matrícula(s) y {$lote->estudiantes_creados} estudiante(s) nuevo(s).")
            ->send();
    }

    public function descartar(): void
    {
        $this->autorizar();
        app(AlmacenImportaciones::class)->eliminar($this->token, $this->formato);
        $this->reiniciar();
        $this->etapa = self::CARGA;
        $this->form->fill(['formato_nombre' => CamposImportacion::NOMBRE_CON_COMA]);
        $this->resetTable();
    }

    public function nuevaImportacion(): void
    {
        $this->descartar();
    }

    public function plan(): ?PlanImportacion
    {
        if ($this->plan === null && $this->etapa === self::VISTA_PREVIA && $this->token !== null) {
            try {
                $this->plan = $this->analizarConOpciones($this->opcionesAnalizadas());
            } catch (ArchivoNoValidoException) {
                return null;
            }
        }

        return $this->plan;
    }

    private function lote(): ?ImportacionAcademica
    {
        return $this->loteId === null ? null : ImportacionAcademica::query()->with('edicion.curso')->find($this->loteId);
    }

    private function autorizar(): void
    {
        // La sesión, el rol o el estado de la cuenta pueden haber cambiado desde que se abrió la página.
        abort_unless(static::canAccess(), 403);
    }

    private function analizarConOpciones(OpcionesImportacion $opciones): PlanImportacion
    {
        $almacen = app(AlmacenImportaciones::class);
        $ruta = $almacen->ruta((string) $this->token, (string) $this->formato);

        if (! is_file($ruta) || ! hash_equals((string) $this->sha256, (string) hash_file('sha256', $ruta))) {
            throw new ArchivoNoValidoException('El archivo ya no está disponible. Vuelva a subirlo.');
        }

        return app(AnalizadorImportacion::class)->analizar(app(LectorArchivo::class)->leer($ruta, (string) $this->formato), $opciones);
    }

    private function adoptarPlan(PlanImportacion $plan, OpcionesImportacion $opciones): void
    {
        $mapeo = [];

        foreach ($plan->columnas as $columna) {
            $mapeo['c'.$columna['indice']] = $columna['campo'];
        }

        $this->plan = $plan;
        $this->huella = $plan->huella;
        // El mapeo efectivo pasa a ser explícito: los cambios posteriores parten de él.
        $this->opciones = [
            'hoja' => $plan->hoja,
            'edicion_id' => $opciones->edicionDestinoId,
            'formato_nombre' => $opciones->formatoNombre,
            'mapeo' => $plan->columnas === [] ? null : $mapeo,
        ];
        $this->data['hoja'] = $plan->hoja;
        $this->data['mapeo'] = $mapeo;
    }

    private function opcionesAnalizadas(): OpcionesImportacion
    {
        return OpcionesImportacion::desdeFormulario($this->opciones, ($this->opciones['mapeo'] ?? null) !== null);
    }

    private function reiniciar(): void
    {
        $this->token = null;
        $this->formato = null;
        $this->nombreArchivo = null;
        $this->sha256 = null;
        $this->huella = null;
        $this->opciones = [];
        $this->loteId = null;
        $this->plan = null;
        unset($this->data['hoja'], $this->data['mapeo']);
    }

    private function descripcionColumnas(): string
    {
        $plan = $this->plan();

        if ($plan === null) {
            return '';
        }

        $texto = '«'.$this->nombreArchivo.'»';

        if ($plan->filaEncabezado !== null) {
            $texto .= ', encabezados en la fila '.$plan->filaEncabezado;
        }

        return $texto.'. Ajuste la asignación si una columna no se reconoció correctamente; las columnas de notas, asistencia, pagos, estados o certificados nunca se importan.';
    }

    /**
     * @return list<Component|Field>
     */
    private function camposDeColumnas(): array
    {
        $plan = $this->plan();

        if ($plan === null) {
            return [];
        }

        $campos = [];

        if (count($plan->hojas) > 1) {
            $campos[] = Select::make('hoja')
                ->label('Hoja del libro')
                ->options(array_combine($plan->hojas, $plan->hojas))
                ->selectablePlaceholder(false)
                ->helperText('Cada importación procesa una sola hoja.')
                ->live()
                ->afterStateUpdated(fn () => $this->reanalizar())
                ->columnSpanFull();
        }

        foreach ($plan->columnas as $columna) {
            $bloqueada = $columna['estado'] === 'no_importable';
            $campos[] = Select::make('mapeo.c'.$columna['indice'])
                ->label('Columna '.$columna['letra'].($columna['encabezado'] !== '' ? ': «'.mb_substr($columna['encabezado'], 0, 40).'»' : ''))
                ->options(CamposImportacion::opcionesDeMapeo())
                ->selectablePlaceholder(false)
                ->disabled($bloqueada)
                ->dehydrated(! $bloqueada)
                ->helperText($columna['motivo'])
                ->live()
                ->afterStateUpdated(fn () => $this->reanalizar());
        }

        return $campos;
    }

    /**
     * @return list<Component>
     */
    private function componentesVistaPrevia(): array
    {
        $plan = $this->plan();

        if ($plan === null) {
            return [];
        }

        $componentes = [];

        if ($plan->erroresEstructura !== []) {
            $componentes[] = Callout::make('El archivo no se puede importar todavía')
                ->description(implode(' ', $plan->erroresEstructura))
                ->danger();
        }

        foreach ($plan->avisos as $aviso) {
            $componentes[] = Callout::make('Aviso')->description($aviso)->warning();
        }

        if ($plan->erroresEstructura === []) {
            $resumen = $plan->resumen();
            $cifras = [
                'total' => 'Total de filas',
                'validas' => 'Se importarán',
                'invalidas' => 'Rechazadas',
                'omitidas' => 'Omitidas',
                'posibles_duplicados' => 'Posibles duplicados',
                'incompletas' => 'Con datos incompletos',
                'estudiantes_nuevos' => 'Estudiantes nuevos',
                'estudiantes_existentes' => 'Estudiantes ya registrados',
            ];

            $componentes[] = Grid::make(['default' => 2, 'md' => 4])->schema(array_map(
                fn (string $clave, string $etiqueta): TextEntry => TextEntry::make('resumen_'.$clave)
                    ->label($etiqueta)
                    ->state($resumen[$clave])
                    ->size(TextSize::Large)
                    ->weight(FontWeight::Bold),
                array_keys($cifras),
                $cifras,
            ));

            $componentes[] = TextEntry::make('resumen_destinos')
                ->label('Destino de las matrículas nuevas')
                ->state($this->textosDestino($plan))
                ->listWithLineBreaks()
                ->bulleted()
                ->placeholder('Ninguna fila se puede importar.');

            $componentes[] = Callout::make('Qué se registrará')
                ->description('Cada fila válida crea una matrícula en estado «Matriculado» (y, si no existe, el estudiante). No se registran ni se deducen pagos, asistencia, notas, culminación ni certificados. Los estudiantes y matrículas existentes no se modifican.')
                ->info();
        }

        $componentes[] = Actions::make([$this->confirmarAction()])->key('acciones-confirmacion');

        return $componentes;
    }

    /**
     * @return list<Component>
     */
    private function componentesResultado(): array
    {
        $lote = $this->lote();

        if ($lote === null) {
            return [];
        }

        $cifras = [
            'Filas del archivo' => $lote->filas_total,
            'Importadas' => $lote->filas_importadas,
            'Omitidas' => $lote->filas_omitidas,
            'Rechazadas' => $lote->filas_rechazadas,
            'Estudiantes nuevos' => $lote->estudiantes_creados,
            'Matrículas nuevas' => $lote->matriculas_creadas,
        ];

        return [
            TextEntry::make('resultado_lote')
                ->label('Importación')
                ->state('#'.$lote->getKey().' — «'.$lote->nombre_archivo.'»'.($lote->hoja !== null ? ', hoja «'.$lote->hoja.'»' : '').', '.$lote->created_at?->format('d/m/Y H:i')),
            Grid::make(['default' => 2, 'md' => 3])->schema(array_map(
                fn (string $etiqueta, int $valor): TextEntry => TextEntry::make('resultado_'.md5($etiqueta))->label($etiqueta)->state($valor)->size(TextSize::Large)->weight(FontWeight::Bold),
                array_keys($cifras),
                $cifras,
            )),
            Callout::make('Las matrículas importadas quedaron en estado «Matriculado»')
                ->description('Cada alta figura en el historial de su matrícula con el motivo «Importación académica #'.$lote->getKey().'». Las filas rechazadas u omitidas no se guardaron: corríjalas en el archivo e impórtelo de nuevo si corresponde.')
                ->success(),
            Actions::make([
                Action::make('nuevaImportacion')
                    ->label('Nueva importación')
                    ->icon(Heroicon::OutlinedArrowPath)
                    ->action(fn () => $this->nuevaImportacion()),
            ])->key('acciones-resultado'),
        ];
    }

    /**
     * @return list<string>
     */
    private function textosDestino(PlanImportacion $plan): array
    {
        return array_values(array_map(
            fn (array $d): string => $d['etiqueta'].': '.$d['matriculas'].' matrícula(s) nueva(s)'
                .($d['plazas_libres'] === null ? ' (sin límite de cupo)' : ' de '.$d['plazas_libres'].' plaza(s) libre(s)'),
            $plan->destinos,
        ));
    }

    private function textoConfirmacion(): string
    {
        $plan = $this->plan();

        if ($plan === null) {
            return '';
        }

        $r = $plan->resumen();

        return "Se registrarán exactamente {$r['matriculas_nuevas']} matrícula(s) nueva(s): {$r['estudiantes_nuevos']} de estudiantes nuevos y {$r['estudiantes_existentes']} de estudiantes ya registrados. "
            .'Destino: '.implode('; ', $this->textosDestino($plan)).'. '
            ."{$r['invalidas']} fila(s) rechazada(s) y {$r['omitidas']} omitida(s) no se importarán. "
            .'Antes de guardar se vuelve a comprobar el archivo y el estado académico; si algo cambió, no se importará nada.';
    }

    /**
     * @param  array<string, mixed>  $filtros
     */
    private function registrosTabla(array $filtros, int $pagina, int $porPagina): LengthAwarePaginator
    {
        $estado = $filtros['estado']['value'] ?? null;
        $registros = $this->etapa === self::RESULTADO ? $this->registrosResultado() : $this->registrosVistaPrevia();

        if (is_string($estado) && $estado !== '') {
            $registros = array_filter($registros, fn (array $r): bool => $r['estado'] === $estado);
        }

        return new LengthAwarePaginator(
            array_slice($registros, ($pagina - 1) * $porPagina, $porPagina, true),
            total: count($registros),
            perPage: $porPagina,
            currentPage: $pagina,
        );
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function registrosVistaPrevia(): array
    {
        $registros = [];

        foreach ($this->plan()?->filas ?? [] as $numero => $f) {
            $registros[$numero] = [
                'fila' => $numero,
                'estado' => $f['estado'],
                'operacion' => $f['operacion'] === PlanImportacion::NINGUNA ? null : $f['operacion'],
                'documento' => $f['documento'],
                'estudiante' => $f['apellidos'] !== null || $f['nombres'] !== null ? trim(($f['apellidos'] ?? '').', '.($f['nombres'] ?? ''), ', ') : null,
                'destino' => $f['destino'],
                'mensajes' => array_values(array_unique([...$f['errores'], ...$f['avisos']])) ?: null,
            ];
        }

        return $registros;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function registrosResultado(): array
    {
        if ($this->loteId === null) {
            return [];
        }

        $registros = [];

        foreach (ImportacionAcademicaFila::query()
            ->where('importacion_academica_id', $this->loteId)
            ->with(['estudiante', 'matricula.edicion.curso'])
            ->orderBy('fila')
            ->get() as $fila) {
            $registros[$fila->fila] = [
                'fila' => $fila->fila,
                'estado' => $fila->resultado,
                'operacion' => $fila->operacion === PlanImportacion::NINGUNA ? null : $fila->operacion,
                'documento' => $fila->estudiante?->documento,
                'estudiante' => $fila->estudiante?->nombre_completo,
                'destino' => $fila->matricula?->edicion?->etiqueta,
                'mensajes' => $fila->detalle !== null ? [$fila->detalle] : null,
            ];
        }

        return $registros;
    }
}
