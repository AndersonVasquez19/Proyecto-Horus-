# Plan de pendientes del panel, backend, sitio público y chatbot de Horus

**Proyecto:** Horus Group SRL  
**Fecha de referencia:** 10 de septiembre de 2026  
**Propósito:** documentar el estado actual y los trabajos pendientes para completar la plataforma y preparar un chatbot relacionado con la empresa.

> Inventario histórico de septiembre. El alcance actual es sitio institucional y panel; Market queda para otra etapa. Las conexiones públicas, cotizaciones, seguimiento, recuperación de cuentas, imágenes y suscripciones se describen en [README.md](README.md). Los datos institucionales esperan confirmación de la empresa.

## Diagnóstico general

Lo principal que falta es cerrar el circuito entre panel, base de datos y página pública. Ya es posible administrar varios módulos, pero buena parte de la web todavía muestra información escrita directamente en sus componentes.

Este inventario corresponde al código revisado y al alcance conversado. Algunas funciones son necesarias para completar lo existente; otras dependen de lo que se quiera presentar en la sustentación. Los pendientes de este documento no deben interpretarse como funcionalidades ya implementadas.

## 1. Conectar el panel con la página principal

**Prioridad: máxima.**

| Área | Estado actual | Qué falta |
| --- | --- | --- |
| Cursos y capacitaciones | Hay administración y API; las páginas educativas mantienen contenido estático. | Mostrar los registros publicados, separar cursos de capacitaciones y crear páginas de detalle. |
| Servicios tecnológicos | Hay administración y API; cámaras, cableado y soporte conservan información estática. | Alimentar las páginas desde los servicios publicados y asociar sus botones de consulta con el servicio correspondiente. |
| Galería | El panel administra imágenes, pero la página usa `galeriaData`. | Consumir `/api/galeria`, adaptar categorías y mostrar únicamente imágenes activas. |
| Preguntas frecuentes | Existe CRUD; la página pública tiene sus propias preguntas. | Consumir `/api/preguntas-frecuentes` y respetar categoría y orden. |
| Información de empresa | El panel guarda ajustes; contacto y pie de página mantienen datos propios. | Consumir `/api/settings` en la web y reutilizar los datos aprobados en correos. |
| Inicio | Presentación mayormente estática. | Conectar los bloques que deban cambiar: cursos destacados, servicios o proyectos. |
| Newsletter | Existe suscripción con consentimiento y baja firmada; “Notificarme” (Educación) se suscribe con interés `cursos` y el interés por defecto es `novedades`. Market no existe como producto. | Sin trabajo pendiente en este punto; los suscriptores antiguos con interés `market` son datos históricos y se conservan. |
| Biblioteca de contenido | Guarda elementos administrativos genéricos. | Definir su propósito: noticias, anuncios o biblioteca interna. Actualmente no tiene una publicación pública concreta. |

Para cada conexión también se necesitan estados de carga, error, ausencia de registros y actualización de contenido. Si falla el servidor, la página debe indicarlo; no debe sustituir silenciosamente los datos por contenido ficticio.

El flujo esperado es:

1. Un administrador crea o modifica contenido.
2. NestJS valida los datos y permisos.
3. MySQL guarda el cambio.
4. La página pública consulta la API.
5. El visitante ve únicamente el contenido publicado.

## 2. Revisar y centralizar la información real

Este trabajo es especialmente importante antes del chatbot.

- Confirmar RUC, dirección, teléfonos, correo, horarios y redes. Persisten valores predeterminados distintos de los que aparecen en la web.
- Migrar el contenido válido de las páginas a MySQL.
- Revisar nombres, descripciones, imágenes y categorías para evitar duplicados.
- Identificar quién aprueba y actualiza la información.
- Decidir qué es público y qué queda únicamente en administración.
- Revisar políticas, condiciones de los servicios y respuestas frecuentes con la empresa.

**Guardar algo en MySQL no garantiza que sea información real.** Por ejemplo, el backend todavía puede inicializar ajustes con valores predeterminados; es necesario reemplazarlos por datos confirmados.

## 3. Completar los procesos del backend

| Módulo | Pendiente |
| --- | --- |
| Cursos | Definir si se necesitan precio, requisitos, instructor, cupos y varias convocatorias del mismo curso. El modelo actual es un catálogo básico. |
| Inscripciones | Si la web permitirá inscribirse, crear solicitudes vinculadas al curso y su seguimiento. No existe todavía ese proceso. |
| Cotizaciones | Crear solicitudes vinculadas a servicios, con estado, responsable e historial. Actualmente el contacto es genérico. |
| Mensajes | Registrar origen, responsable, notas internas e historial. Actualmente se puede cambiar el estado, pero eso no equivale a responder al cliente. |
| Reclamaciones | Añadir estados, responsable, respuesta, fechas e historial. El backend actual permite consultar y eliminar, pero no gestionar la resolución. |
| Archivos | Implementar subida de imágenes, validación de formato y tamaño, almacenamiento y eliminación controlada. Actualmente se introducen URLs o rutas. |
| Suscripciones | Completar baja de suscripción, registro de consentimiento y gestión administrativa. |
| Configuración | Validar cada ajuste y limitar explícitamente los campos públicos. Actualmente la consulta pública devuelve todas las claves. |
| Consultas de datos | Llevar la paginación y los filtros al servidor en módulos antiguos. Parte del panel descarga el listado completo y lo pagina en el navegador. |
| Edición de campos opcionales | Definir cómo quitar una imagen, fecha o temario existente. Actualmente algunos campos no aceptan vaciarse, lo que limita la edición. |

No todos los módulos deben tener necesariamente los cuatro verbos CRUD. Una reclamación enviada por un cliente, por ejemplo, necesita seguimiento y trazabilidad, no edición libre de su contenido original.

## 4. Seguridad y confiabilidad pendientes

| Área | Trabajo requerido |
| --- | --- |
| Usuarios y roles | Separar administración, edición y atención; hacer cumplir los permisos en el backend. |
| Gestión de cuentas | Crear administradores desde una pantalla protegida, desactivar cuentas y gestionar contraseñas. La pantalla pública de registro quedó incompatible con el registro protegido. |
| Sesiones | Revocar accesos al desactivar una cuenta o cambiar su contraseña. |
| Recuperación por correo | Implementar la recuperación de contraseña, pendiente según lo acordado. |
| Límites de solicitudes | Proteger login y formularios contra intentos masivos y spam. |
| Correos | Controlar fallos, reintentar envíos y distinguir “registro guardado” de “correo entregado”. |
| Identificadores de reclamaciones | Sustituir el código aleatorio corto por un identificador sin colisiones prácticas. |
| Auditoría | Guardar quién creó, modificó, publicó o archivó un registro. |
| Migraciones completas | Existe la del catálogo, pero falta una base reproducible para instalar todo el esquema desde cero. |
| Copias de seguridad | Verificar tanto la generación de respaldos como la restauración. |
| Errores y configuración | Evitar exponer detalles internos y preparar puertos, CORS, proxy y variables por entorno. |

## 5. Perfeccionar el frontend del panel

La estructura actual funciona como base, pero falta especializarla.

| Sección o interacción | Mejora pendiente |
| --- | --- |
| Mensajes | Bandeja con listado y detalle, filtros de atención y seguimiento. |
| Galería | Miniaturas, ampliación, previsualización y, cuando exista el backend, subida de archivos. |
| Cursos y servicios | Formularios por secciones y vista previa de su presentación pública. |
| Reclamaciones y suscriptores | Añadir sus pantallas; actualmente no están en la navegación. |
| Usuarios | Incorporar una pantalla de gestión cuando existan los permisos correspondientes. |
| Formularios | Mostrar errores junto a cada campo, avisar de cambios sin guardar y explicar mejor las restricciones. |
| Navegación | Conservar búsqueda, filtros y página al volver de un detalle. |
| Resumen | Hacer que los indicadores abran el listado filtrado correspondiente. |
| Accesibilidad y móvil | Revisar teclado, foco, contraste y tablas en pantallas pequeñas. |
| Publicación | Mostrar claramente dónde aparecerá un contenido y ofrecer “Ver en la web” cuando su página esté conectada. |

## 6. Verificar el sistema completo con datos persistentes

Ya pasaron compilación y pruebas del panel con respuestas de API aisladas. Falta comprobar de extremo a extremo la combinación navegador, backend y MySQL, usando una base de pruebas.

Las pruebas con respuestas aisladas validan controles e interacciones de la interfaz, pero no demuestran por sí solas la persistencia real en la base de datos.

| Prueba | Resultado esperado |
| --- | --- |
| Crear un borrador | Se guarda, pero no aparece públicamente. |
| Publicar un curso | Aparece en su listado y página de detalle. |
| Editar y recargar | Los cambios permanecen en MySQL y se reflejan en la web. |
| Archivar contenido | Desaparece públicamente y sigue disponible para administración. |
| Enviar contacto | Aparece en mensajes y en los indicadores correspondientes. |
| Cambiar datos de empresa | Se actualizan las ubicaciones públicas conectadas. |
| Acceder sin permiso | El backend rechaza la operación. |
| Detener el backend | La interfaz muestra un error recuperable. |

También falta dejar las pruebas de navegador como parte reproducible del proyecto y corregir la configuración de ESLint para TypeScript.

## 7. Preparar el chatbot

### 7.1. Enfoque recomendado

Para Horus se propone RAG: buscar información aprobada y usarla para elaborar respuestas. Esto permite actualizar el conocimiento sin entrenar un modelo desde cero.

Referencia: [Microsoft — Enhance AI responses with Retrieval Augmented Generation](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/retrieval-augmented-generation).

### 7.2. Componentes y tareas

| Parte | Trabajo |
| --- | --- |
| Alcance | Definir qué responde: servicios, cursos, ubicación, horarios, requisitos y políticas. |
| Base de conocimiento | Reunir contenido aprobado, con fuente, categoría y fecha de actualización. |
| Sincronización | Incorporar cambios publicados y retirar información archivada del índice del chatbot. |
| Datos cambiantes | Consultar fechas, precios o disponibilidad en la API cuando esos datos existan. |
| Backend del chat | Crear el endpoint, búsqueda de información, integración con el modelo y límites de consumo. |
| Widget público | Crear una ventana accesible, con estados de carga, errores, fuentes y opción de contactar con una persona. |
| Administración del chatbot | Revisar preguntas sin respuesta, corregir contenido y consultar métricas. |
| Privacidad | Excluir mensajes privados, reclamaciones, documentos personales, contraseñas y ajustes internos. |
| Protección | Tratar documentos y mensajes como datos, controlar accesos y probar intentos de manipular las instrucciones. |
| Evaluación | Preparar preguntas con respuestas esperadas y medir exactitud, respaldo en fuentes, latencia y reconocimiento de información faltante. |

Para la protección del sistema, consultar [OWASP — RAG Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html).

Para la evaluación, consultar [Microsoft — Retrieval-Augmented Generation Evaluators](https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/rag-evaluators).

### 7.3. Revisión humana del conocimiento

El chatbot no debería aprender automáticamente de cada conversación. Las preguntas nuevas pueden servir para detectar vacíos, pero las respuestas que se incorporen a su conocimiento deben revisarse.

Se puede comenzar a preparar preguntas y documentos desde ahora. No es necesario terminar una tienda, pagos o certificados para tener un chatbot útil. Sí se necesita una fuente de información correcta, pública, actualizada y comprobable.

## 8. Orden recomendado de implementación

| Etapa | Trabajo principal | Resultado esperado |
| --- | --- | --- |
| 1 | Confirmar datos de empresa y migrar contenido válido. | Una fuente de información revisada, sin contradicciones ni datos predeterminados sin confirmar. |
| 2 | Conectar cursos, servicios, galería, FAQ y configuración con la web pública. | Los cambios publicados desde el panel se reflejan en la página. |
| 3 | Completar archivos, permisos y pruebas de extremo a extremo. | Gestión de contenido y acceso verificadas con persistencia real. |
| 4 | Mejorar atención, reclamaciones y suscriptores según el alcance de la sustentación. | Procesos de atención trazables y utilizables por la empresa. |
| 5 | Construir y evaluar el chatbot sobre la información publicada. | Asistente relacionado con Horus, con fuentes y límites definidos. |

## 9. Criterio para comenzar el chatbot

Antes de conectar el chatbot a la información del proyecto, comprobar que:

- Los datos institucionales están confirmados.
- Los cursos y servicios publicados representan la oferta real.
- Las preguntas frecuentes tienen respuestas aprobadas.
- El contenido público se distingue del privado.
- Las actualizaciones y el archivado pueden sincronizarse con su conocimiento.
- Existen preguntas de evaluación y respuestas esperadas.
- Se ha definido qué debe hacer cuando no encuentra información.
- Existe una vía de contacto humano para continuar la atención.

Este documento puede exportarse a Word conservando la jerarquía de títulos, las tablas y los enlaces.
