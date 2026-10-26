# Frontend Horus

React, TypeScript y Vite. El sitio institucional consulta catálogos publicados, galería activa, FAQ y ajustes públicos. Market no forma parte de este proyecto: la ruta antigua /market redirige al inicio.

## Comandos

Desde esta carpeta: `npm ci`, `npm run dev`, `npm run check`, `npm run lint`, `npm run build`, `npm run preview` y `npm run test:deploy`.

Vite utiliza el proxy local de `/api`. Para otra API, configurar `VITE_API_BASE_URL`, incluida la ruta `/api`. Los secretos permanecen en el backend.

## Panel

Login en `/admin/login` y recuperación en `/admin/forgot-password`. `/admin/register` es el registro público (enlace «Crear cuenta» en el login): la cuenta nace sin rol y, al iniciar sesión, ve «Cuenta pendiente de autorización» hasta que la gerencia le asigne uno. La sesión se valida contra `/api/admin/me`: un error de conexión ofrece reintento sin borrar el token; un HTTP 401 cierra la sesión.

Desde el panel se gestionan estudiantes, ediciones, matrículas, la importación académica CSV, mensajes y su seguimiento, cotizaciones, consultas del chatbot, roles y la propia cuenta. Las cargas se cancelan al cambiar de vista y las listas usan paginación en el servidor.

El contenido institucional (servicios, cursos y capacitaciones públicos, galería, FAQ, convenios e información de empresa) ya no se administra desde el panel: sus direcciones antiguas muestran un aviso y no consultan la API. La web pública lee ese contenido de `src/institutional/catalog.ts` (versionado en código, con imágenes en `public/contenido`, `public/galeria` y `public/site-original`), por lo que se ve sin backend ni base de datos ([guía](../docs/procedimientos/separacion-panel-contenido.md)). Para cambiarlo, edita `catalog.ts` y compila. Solo formularios y chatbot siguen usando la API. Los registros de prueba no se publican.

El guardado comunica cambios a otras pestañas del mismo navegador para volver a consultar la API. Otros navegadores reciben los cambios al cargar o actualizar la sección.

## Revisión con navegador

Compilar primero el backend y después este frontend con `npm run build` en cada carpeta. Ejecutar `node scripts/smoke-ui.cjs`. Usa Edge en modo invisible, un perfil temporal y datos HTTP de prueba; no utiliza la base real ni envía correos. Si Edge no está en su ruta predeterminada de Windows, establecer `SMOKE_BROWSER` con el ejecutable de Chromium/Edge.

`SMOKE_SCREENSHOTS` permite guardar capturas en un directorio elegido. La revisión también comprueba los diseños originales, pestañas con teclado, carrusel, filtros e importación, y guarda un formulario del panel en una segunda pestaña real para comprobar la actualización de la web.

La revisión cubre escritorio, móvil, detalles, asuntos de contacto, FAQ/reintento, foco en diálogos, navegación móvil, cotizaciones, fallos de correo, guardados sucesivos de seguimiento y sesión ante fallos temporales. Los fixtures comprueban interacción; la integración MySQL se prueba por separado en backend.

## Preparación del destino

Consultar [Railway](../RAILWAY.md). Aplicar explícitamente las migraciones del backend, configurar SMTP y un volumen persistente para imágenes. Publicar los registros reales desde el panel; una base vacía se presenta como vacía.
