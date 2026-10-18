# Importación académica desde Excel y CSV

Estado: **implementada y probada en SQLite temporal y en MySQL 8.4 desechable**. Requiere
aplicar una migración aditiva antes de usarla en una base real (ver «Activación»).

Página del panel: **Gestión académica → Importar desde Excel** (`/gestion/importacion-academica`).
Sustituye progresivamente el registro manual de estudiantes y matrículas a partir de hojas como
`CURSOS 2024.xlsx`, sin crear un sistema paralelo: cada alta pasa por los modelos Eloquent
`Estudiante` y `Matricula`, con sus validaciones, el bloqueo de disponibilidad
(`DisponibilidadAcademica`) y el historial (`HistorialMatriculas`).

## Flujo

1. **Archivo y destino.** Se sube un CSV o XLSX y, opcionalmente, se elige la edición de destino
   (las canceladas no se ofrecen). Sin destino, cada fila debe indicar su curso y su edición, que
   deben existir: la importación nunca crea cursos ni ediciones.
2. **Columnas detectadas.** Se localiza la fila de encabezados (entre las 20 primeras), se
   reconocen los campos y se informa de las columnas desconocidas o fuera de alcance. Cada
   columna puede reasignarse a mano; en un libro con varias hojas se elige la hoja (una por
   importación).
3. **Vista previa.** Totales (filas, válidas, rechazadas, omitidas, posibles duplicados,
   incompletas, estudiantes nuevos y existentes), destino con plazas libres y una tabla por fila
   con la operación propuesta, los errores y los avisos. **No escribe nada** en la base
   (lo comprueba una prueba que solo admite sentencias `SELECT`).
4. **Confirmación.** Un modal indica el número exacto de matrículas, estudiantes nuevos y
   existentes, el destino y las filas que no se importarán, y exige marcar «Revisé la vista
   previa y autorizo…».
5. **Importación.** Todo o nada (ver «Concurrencia y transacciones»).
6. **Resultado.** Recuentos del lote y tabla por fila (importada, omitida o rechazada, con el
   motivo). Cada alta figura en el historial de su matrícula con el motivo
   «Importación académica #N».

## Formatos admitidos

| Formato | Detalle |
| --- | --- |
| CSV | UTF-8 (con o sin BOM) o Windows-1252 (CSV «ANSI» de Excel); separador `;`, `,` o tabulador, detectado en la primera línea |
| XLSX | Leído con OpenSpout 4.32 (ya instalado como dependencia de Filament; no se añadió ningún paquete) |

No se admiten `.xls`, `.xlsm`, `.ods` ni libros protegidos con contraseña. Límites: 2 MB por
archivo, 1000 filas de datos por importación, 100 columnas, 50 hojas, celdas de hasta 1000
caracteres y 50 MB descomprimidos (con control de la relación de compresión).

## Columnas

| Campo | Encabezados reconocidos (sin distinguir mayúsculas ni tildes) | Obligatorio |
| --- | --- | --- |
| Número de documento | `DNI`, `Documento`, `Nro. de documento`… | Sí |
| Tipo de documento | `Tipo de documento` (`DNI`, `CE`, `PASAPORTE`); sin columna = DNI | No |
| Apellidos y nombres | `Apellidos` + `Nombres`, o una columna `Apellidos y nombres` | Sí |
| Celular / correo | `Celular`, `Teléfono`, `Correo`, `Email`… | No |
| Fecha de matrícula | `Fecha de matrícula` (celda de fecha o `dd/mm/aaaa`) | No; no se inventa |
| Curso y edición | `Curso` (nombre o código) y `Edición`/`Convocatoria` | Solo sin destino elegido |

Se reconocen e **ignoran siempre**, aunque se intente reasignarlas: `NRO`/numeración, `NOTA`,
`Calificación`, `Asistencia`, `Cód. registro`/`Certificado`, `Pago`/`Monto`, `Estado`,
`Aprobado`, `Culminó`. La importación no registra ni deduce pagos, asistencia, notas,
culminación ni certificados.

Una sola columna `Apellidos y nombres` se separa solo con un formato explícito:

- **Con coma** (predeterminado): `Apellidos, Nombres`. Sin coma, la fila se rechaza.
- **Dos apellidos seguidos de los nombres** (formato de `CURSOS 2024.xlsx`): se exige un mínimo
  de tres palabras y se rechazan los nombres con partículas (`de`, `del`, `la`…) entre los tres
  primeros términos. La separación resultante se muestra en la vista previa antes de confirmar.

## Estructura de `CURSOS 2024.xlsx`

Inspección de solo lectura (sin copiar datos): 10 hojas, una por curso y sin columna de edición;
una hoja `INICIO` con hipervínculos (fórmulas); título en la fila 1 y encabezados en la fila 2
(`NRO | APELLIDOS Y NOMBRES | [NOTA] | DNI | [CELULAR] | CÓD. REGISTRO`); una zona
`// CONSULTA //` con fórmulas de búsqueda a la derecha; DNI guardado como número (al menos un
caso con 7 dígitos, cero inicial perdido); y al final de cada lista una fila `PONENTE`/`PONENTES`
seguida de los docentes. Por eso el importador:

- elige la primera hoja con encabezados reconocibles y permite cambiarla;
- trata `PONENTE(S)`, `DOCENTE(S)`, `FACILITADOR(ES)`… como inicio de una sección que no son
  estudiantes: esas filas se **omiten**;
- ignora la zona de consulta y cuenta las fórmulas ignoradas;
- rechaza un DNI numérico de menos de 8 dígitos con un aviso sobre el cero inicial, en lugar de
  completarlo;
- no interpreta `CÓD. REGISTRO` como certificación ni `NOTA` como aprobación;
- necesita que se elija la edición de destino (las hojas no la indican). Una inscripción en la
  hoja se registra como matrícula «Matriculado», que no implica pago, asistencia ni aprobación.

## Política de duplicados y de datos existentes

- **Mismo documento en el archivo y la misma edición:** la primera fila se importa; las
  siguientes se omiten («repetida»). Con otro nombre, se rechazan.
- **Mismo estudiante nuevo en varias ediciones (modo por fila):** se registra una vez y se
  matricula en cada edición.
- **Estudiante ya registrado** (mismo tipo y número de documento): se reutiliza **sin
  modificarlo**; si el nombre no coincide, la fila se rechaza. El contacto del archivo no se
  aplica (aviso).
- **Matrícula existente** en esa edición, en cualquier estado: la fila se omite. No se reactiva
  ni cambia de estado; la reactivación se hace a mano desde la matrícula.
- **Posible homónimo** (mismo nombre, otro documento): aviso; se importa como otra persona.
- **Sin documento:** la fila se rechaza (no se crean estudiantes «Sin documento» por importación).
- **Mismo archivo, misma hoja y mismo destino:** no se importa dos veces (huella `UNIQUE` del
  lote). Para añadir filas olvidadas, use un archivo nuevo.

## Concurrencia y transacciones

- La vista previa queda identificada por una **huella** de los datos, las operaciones y el estado
  académico observado. Al confirmar se vuelve a autorizar, se comprueba el SHA-256 del archivo y
  se vuelve a analizar: si la huella difiere, no se importa nada y se muestra la vista previa
  actualizada.
- La importación es **una sola transacción**. Su primera escritura es el lote, cuya ficha (UUID)
  y huella son `UNIQUE`: impiden la doble confirmación y, en SQLite, reservan la base. En MySQL
  se bloquean además las ediciones afectadas en orden de id. Bajo ese bloqueo se vuelve a
  analizar y se exige la misma huella. Después, cada alta pasa por `Estudiante::save()` y
  `Matricula::save()` (bloqueo de disponibilidad, cupo, edición cancelada, unicidad e historial).
- Cualquier rechazo o error a mitad revierte todo: estudiantes, matrículas, historial y lote.
- El cupo se reparte en el orden del archivo; las filas que no caben se rechazan.
- Probado con procesos y conexiones independientes (SQLite DELETE y WAL): matrícula manual
  durante la confirmación, importación antes que una matrícula manual y doble confirmación
  simultánea. En MySQL: cambio confirmado por otra conexión y doble confirmación en carrera.

## Seguridad

- Acceso: `PermisoImportacion` exige las políticas **existentes** `create` de `Estudiante` y
  `Matricula` (administración general o coordinación institucional, cuenta activa, leídas de la
  base). Secretaría, cuentas básicas, inactivas y visitantes no acceden. No se creó ningún
  permiso ni se amplió ningún rol. Cada acción de la página vuelve a autorizar.
- El estado que decide qué se importa (ficha, huella, opciones analizadas, etapa, lote) está
  bloqueado con `#[Locked]` frente a cambios desde el navegador; la hoja, el mapeo y el destino
  se validan en el servidor.
- Archivos: copia temporal en el disco privado `local` (`storage/app/private/importaciones-academicas/<uuid>.<ext>`),
  nunca en almacenamiento público; la ruta se construye solo desde un UUID generado por el
  servidor. Se borra al confirmar, al descartar o a las 24 horas; la subida temporal de Livewire
  se borra al copiarla.
- XLSX: se rechazan macros (`vbaProject.bin`, `macroEnabled`), ActiveX, objetos incrustados,
  cifrado y bombas ZIP; XML con `LIBXML_NONET`. Las fórmulas no se evalúan: una fórmula en un
  campo importado rechaza la fila; también los textos que empiezan por `=`, `+`, `-` o `@`.
- Registros: ante un error interno solo se registra la clase, el código SQLSTATE, la ficha y el
  número de fila; nunca SQL, mensajes ni datos de las filas.
- Trazabilidad sin copias de datos personales: `importaciones_academicas` (lote, usuario,
  archivo, SHA-256, recuentos) e `importacion_academica_filas` (resultado por fila con
  identificadores y un mensaje genérico). Ambas son de solo lectura (los modelos rechazan
  `UPDATE`/`DELETE`), con claves foráneas `RESTRICT` y `CHECK` de valores y totales (en MySQL,
  comparados en binario).

## Activación cuando MySQL esté funcionando

1. Respaldo previo de la base de destino (procedimiento de `docs/mysql-traslado.md`).
2. Con autorización explícita y el destino comprobado, aplicar la migración pendiente
   `2026_10_18_200000_create_importaciones_academicas_tables` (`php artisan migrate`), que solo
   crea dos tablas nuevas.
3. Comprobar con `php artisan migrate:status` que está aplicada.
4. Probar con un archivo **ficticio** pequeño contra la edición de una base de pruebas antes de
   usar listas reales.
5. Para `CURSOS 2024.xlsx`: registrar antes los cursos y las ediciones 2024 en el panel, revisar
   cada hoja en la vista previa con el formato «dos apellidos seguidos de los nombres» y corregir
   en el archivo los DNI de 7 dígitos y los nombres que no se puedan separar.

## Pruebas

`tests/Feature/Importacion/` (lector, analizador, ejecutor y concurrencia entre procesos),
`tests/Feature/Panel/ImportacionAcademicaPanelTest.php` y
`tests/MySql/ImportacionAcademicaMysqlTest.php` (opcional, `scripts/test-mysql.ps1`).

## Limitaciones conocidas

- Un archivo procesa una hoja por importación.
- Las celdas combinadas no se expanden: el valor está en la primera celda.
- Un número en la columna de fecha (fecha sin formato) se rechaza en lugar de convertirse.
- La reimportación del mismo archivo en el mismo destino se bloquea siempre, aunque hayan
  cambiado las plazas libres; hay que usar un archivo nuevo con las filas pendientes.
- Un fallo del proceso entre la confirmación y el borrado del archivo temporal puede dejar la
  copia hasta la limpieza de 24 horas (no afecta a los datos: la transacción ya terminó).
