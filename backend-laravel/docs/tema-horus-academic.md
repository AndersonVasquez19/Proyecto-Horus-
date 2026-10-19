# Tema «Horus Academic» — guía de uso

Tema visual del panel Filament de gestión académica. Es CSS estático, sin Node ni compilación.

- Fuente: `resources/css/horus-academic.css`.
- Publicado en: `public/css/app/horus-academic.css`. Lo registra `AdminPanelProvider::assets()`.
- Tras editar la fuente, ejecute `php artisan filament:assets`. Una prueba (`EscritorioTemaTest`) falla si la copia publicada no coincide.
- El tema solo cambia la presentación. No contiene reglas de negocio, permisos ni validaciones.

Fases aplicadas: 1 (escritorio, menú, barra superior y tarjetas), 2A (tablas, barra de herramientas, insignias, paginación, botones, acciones de fila, menús y modales) y 2B (formularios y fichas de detalle).

## Formularios y fichas (Fase 2B)

Ámbito del CSS: las secciones de las páginas Crear, Editar y Ver; los campos de Crear, Editar y de los formularios dentro de modales; las entradas de las fichas Ver. El escritorio, los listados y los filtros de tabla no cambian.

- **Campos**: borde gris azulado, hover más oscuro, foco azul con halo, error en rojo con halo rojo al enfocarlo, deshabilitado con fondo gris y cursor de no permitido. Asterisco de obligatorio en coral oscuro. Ayudas en gris; mensajes de error con una marca «!» decorativa (oculta a lectores de pantalla).
- **Secciones**: tarjeta con icono en burbuja. Declare el icono con `->icon(Heroicon::Outlined…)` y el tono con `->extraAttributes(['class' => 'horus-tono-turquesa'])` (`azul` por defecto, `turquesa`, `coral`, `verde`, `gris`, `intenso`). `extraAttributes()` de una sección se aplica al contenedor externo (`.fi-sc-section`), no a `.fi-section`.
- **Variantes de sección**: `horus-seccion-secundaria` (fondo suave, sin sombra: datos de registro) y `horus-seccion-aviso` (ámbar: advertencias como posibles duplicados).
- **Fichas**: etiquetas en gris y versalitas; el valor principal con `->size(TextSize::Large)->weight(FontWeight::Bold)`; insignias de estado con punto. `horus-estado-destacado` en una sección agranda su insignia; `horus-insignia-simple` en una entrada quita el punto (códigos y otros valores que no son estados). Los enlaces creados con `->url()` se muestran en azul con subrayado suave.
- **Distribución de las fichas**: en escritorio, datos a la izquierda (2/3) y registro (y estado, en matrículas) a la derecha (1/3) con `Grid::make(['default' => 1, 'lg' => 3])` y dos `Group`. En móvil, una columna.
- Las tablas de relación de Editar y Ver se cargan de forma diferida (al entrar en pantalla): es el comportamiento de Filament, no un error.

La reorganización de los formularios es solo visual: los campos conservan su nombre, obligatoriedad, reglas y mensajes. `TemaFormulariosFichasTest` lo comprueba.

## Jerarquía de botones

| Tipo | Cómo se declara en PHP | Aspecto | Uso |
| --- | --- | --- | --- |
| Principal | `->color('primary')` (por defecto en Crear/Guardar) | Degradado azul con sombra | Una por pantalla: «Nuevo…», «Crear», «Guardar» |
| Secundaria | `->color('gray')` o sin color | Blanca con borde | «Cancelar», «Crear y crear otro», «Anterior/Siguiente» |
| Destructiva | `->color('danger')` | Roja | «Eliminar». Siempre con confirmación |
| Informativa / éxito / aviso | `info` / `success` / `warning` | Paleta Horus, mismo tamaño y radio | Avisos o estados |

Todas las acciones de alta (`CreateAction`) reciben el icono «+» desde `AppServiceProvider`. Un `->icon()` explícito tiene prioridad.

## Acciones de fila

Las acciones de las tablas se muestran como pastillas. El tono sale del `->color()` de la acción:

- sin color o `gray`: neutra (gris);
- `primary` o `info`: principal (azul);
- `danger`: destructiva (rojo);
- `success`: éxito (verde);
- `warning`: aviso (ámbar).

Reglas:

1. **Toda acción de fila debe tener `->icon()`.** Por debajo de 1536 px (en filas con 3 o más acciones) y por debajo de 1024 px (en todas), las pastillas muestran solo el icono. El texto aparece como tooltip al pasar el ratón o al enfocar con el teclado. Sin icono, la pastilla quedaría vacía.
2. La columna de acciones queda fija a la derecha cuando la tabla se desplaza en horizontal.
3. Máximo tres acciones visibles por fila. A partir de la cuarta, agrúpelas en un menú, por ejemplo `ActionGroup::make([...])->label('Más')->icon(Heroicon::OutlinedEllipsisVertical)`.
4. No mueva a un menú una acción que ya existe sin revisar las pruebas que la ejecutan como acción de fila (por ejemplo, `cambiarEstado`).

## Tonos reservados para funciones futuras

Clases ya definidas en el CSS. Se aplican con `->extraAttributes(['class' => '…'])` a una acción de fila, a un botón o a un elemento de un menú desplegable:

| Clase | Tono | Pensada para |
| --- | --- | --- |
| `horus-accion-pdf` | Rojo suave | Exportar a PDF |
| `horus-accion-word` | Azul | Exportar a Word |
| `horus-accion-excel` | Verde | Exportar a Excel o CSV |
| `horus-accion-certificado` | Ámbar | Emitir o ver certificados |
| `horus-accion-seguimiento` | Turquesa | Seguimiento académico |

Patrón recomendado para exportar un listado: un único menú en la cabecera del listado, junto al botón principal, en lugar de varios botones sueltos.

```php
use Filament\Actions\Action;
use Filament\Actions\ActionGroup;
use Filament\Support\Icons\Heroicon;

ActionGroup::make([
    Action::make('exportarPdf')->label('PDF')->icon(Heroicon::OutlinedDocumentText)
        ->extraAttributes(['class' => 'horus-accion-pdf']) /* ->action(...) */,
    Action::make('exportarWord')->label('Word')->icon(Heroicon::OutlinedDocument)
        ->extraAttributes(['class' => 'horus-accion-word']) /* ->action(...) */,
    Action::make('exportarExcel')->label('Excel / CSV')->icon(Heroicon::OutlinedTableCells)
        ->extraAttributes(['class' => 'horus-accion-excel']) /* ->action(...) */,
])
    ->label('Exportar')
    ->icon(Heroicon::OutlinedArrowDownTray)
    ->button()
    ->color('gray');
```

Antes de implementarlo:

- defina la autorización de cada exportación en su política;
- decida qué datos personales salen del sistema;
- confirme si hace falta una dependencia nueva (PDF/Word), que requiere autorización.

No publique botones de funciones que todavía no existen.

## Tokens principales

| Uso | Valor |
| --- | --- |
| Fondo general | `#F4F6FB` |
| Superficie | `#FFFFFF` |
| Cabecera de tabla | `#F8FAFD` |
| Azul principal | `#2554EB` |
| Azul intenso | `#1D3FCC` |
| Texto principal | `#19243A` |
| Texto secundario | `#64748B` |
| Bordes | `#E5EAF2` |
| Bordes de control | `#D5DCE8` |
| Radio de tarjeta | 16 px |
| Radio de control y botón | 10 px |
| Radio de pastilla e insignia | 999 px |
