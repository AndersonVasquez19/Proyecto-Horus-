# Sesión administrativa (frontend)

Resumen de cómo el panel gestiona la sesión. No describe el backend (JWT de 8 h con `session_version`).

## Modelo
- El token vive en `localStorage` (`horus-admin-token`). `AdminAuthProvider` ([AdminAuthContext.tsx](src/panel/context/AdminAuthContext.tsx)) lo guarda y la identidad (`user`) solo se acepta tras `POST /admin/login` o `GET /admin/me`. Tener un token no autoriza el panel: `isAuthenticated = token && user`.
- `activeToken` (ref) es la sesión activa leída de forma síncrona. Toda respuesta o aviso se compara contra ella.

## Sincronización entre pestañas
- El evento `storage` (y `visibilitychange` como respaldo) compara `localStorage` con la sesión activa:
  - token eliminado → esta pestaña cierra sesión y vuelve al login;
  - token nuevo o distinto → se adopta, se descarta la identidad anterior y se revalida con `/admin/me`.
- Los cambios que vienen de otra pestaña **nunca** escriben en `localStorage` (sin bucles). Cerrar o iniciar sesión sí escribe, de forma síncrona y antes de renderizar.
- **Modo en memoria:** si el navegador bloquea `localStorage` la sesión funciona en esa pestaña, pero **no se sincroniza** con otras; cada pestaña conserva su propia sesión hasta que caduque o se cierre.
- No se guardan contraseñas ni datos personales para sincronizar: solo el token que ya existía.

## 401 de sesiones antiguas
- `panelRequest` e `ImageUpload` avisan con `reportExpiredSession(token)` ([sessionEvents.ts](src/panel/context/sessionEvents.ts)): el aviso lleva el token **de esa petición**.
- El contexto cierra la sesión solo si ese token sigue siendo el activo. Un 401 de un token anterior, o de una petición sin sesión, se ignora. Un aviso sin token se trata como "revalida con `/admin/me`", no como cierre.
- Al cerrar por 401, solo se borra de `localStorage` si allí sigue el mismo token (no se destruye una sesión más nueva iniciada en otra pestaña).
- `/admin/me` se cancela al cambiar de token y su resultado se descarta si la sesión activa ya es otra.

## Timeouts y cancelación
| Flujo | Límite | Al salir de la pantalla |
|---|---|---|
| Login | 20 s | se cancela; un login tardío no autentica |
| Solicitar enlace | 20 s | se cancela |
| Restablecer contraseña | 20 s | se cancela |
| Cambiar contraseña (Ajustes) | 20 s | se cancela |
| `/admin/me` | 15 s | se cancela |

Cada formulario usa un candado síncrono (`useRef`): doble clic, Enter repetido o `requestSubmit` repetido producen como máximo una petición mientras hay una pendiente.

## Operaciones de contraseña con resultado incierto
Un timeout, una red caída o una respuesta ilegible **no** demuestran que el servidor no aplicó el cambio. En restablecer y cambiar contraseña el mensaje recomienda comprobar el estado (iniciar sesión con la nueva contraseña) antes de repetir, no afirma que la contraseña siga igual y **no hay reintentos automáticos**. Los mensajes están en [authErrors.ts](src/panel/services/authErrors.ts); nunca se muestra texto del backend.

## Trabajo no guardado (implementado en la etapa C)
Un aviso común ([UnsavedChangesProvider](src/panel/unsaved/UnsavedChangesProvider.tsx)) protege los formularios del panel. Cada formulario declara si tiene cambios con `useUnsavedChanges(dirty, etiqueta)`; solo se registra un indicador y una etiqueta de texto, **nunca el contenido** (nada se escribe en `localStorage` ni `sessionStorage`).

- **Qué cuenta como cambio:** que el formulario difiera de la foto tomada al abrirlo o del último guardado correcto. Cargar datos no lo marca; un guardado fallido no lo limpia; un guardado correcto sí.
- **Qué avisa:** navegación del panel (menú, enlaces, filtros de la URL y botón Atrás/Adelante, mediante `useBlocker`; por eso `App.tsx` usa un router de datos), acciones internas que sustituyen el formulario (buscar, filtrar, paginar, actualizar, recargar, cambiar de consulta, acciones rápidas de estado, cerrar/cancelar/Escape de un editor) y cerrar sesión a propósito. Recargar o cerrar la pestaña usa `beforeunload` del navegador.
- **Cómo se usa el aviso:** «Seguir editando» (foco inicial, también con Escape) o «Descartar cambios». Nunca bloquea de forma permanente.
- **Formularios protegidos:** seguimiento de consultas y de reclamaciones (`AttentionEditor`), bandeja de Mensajes, cotizaciones (`QuoteForm`), editor de contenido (`ResourceManager`: cursos, servicios, galería, FAQ…), convenios (`ConvenioEditor`), información de la empresa (`PanelSettings`) y cambio de contraseña (`PanelPreferences`, solo avisa; las contraseñas no se guardan).
- **No protegidos / pendientes:** fotografías de convenios (cada subida se guarda al instante), importación de contenido original (no es un formulario), agenda de cursos y las acciones de listas (activar/archivar), que no editan texto.

### Sesión y cambios sin guardar
- **Sesión invalidada por el servidor (401 de la sesión vigente):** el cierre es forzoso y **no pasa por el aviso**: no puede retener una sesión inválida. Los cambios sin guardar **no se conservan** (no se guardan borradores por privacidad); el login lo explica.
- **Misma cuenta, token nuevo desde otra pestaña:** el panel no se desmonta ni recarga; el token nuevo solo se adopta cuando el actual falla con 401. Si `/admin/me` falla de forma pasajera tampoco se desmonta.
- **Otra cuenta:** el panel se desmonta y se vuelve a montar con la identidad nueva (`key` por id de cuenta); no queda ningún formulario ni dato de la cuenta anterior, y no se pide confirmación.
- **Límite:** si el token falla con 401 y el cambio silencioso a un token de la misma cuenta recarga una pantalla que no usa `useLatest` (listas de otros módulos), esa pantalla vuelve a cargar sus datos. Las pantallas con formularios de texto largo ya no dependen del token.

### Ruta tras volver a entrar
`AdminRoute` redirige a `/admin/login` con la ruta actual en el estado del router, **solo** si el cierre no fue voluntario. [returnPath.ts](src/panel/context/returnPath.ts) valida: únicamente `/admin/dashboard` y `/admin/messages`, sin URLs externas ni rutas con `//`, `\` o caracteres de control, y solo con parámetros `section`, `seccion`, `estado`, `vista`, `id` de valores simples (se descartan tokens, correos, `contacto`, `crear`…). Si no es válida se usa `/admin/dashboard`.

### Pendiente para una etapa posterior
- Borradores seguros en `sessionStorage` (solo contenido editorial, con id de cuenta y caducidad corta, nunca contraseñas ni datos de clientes), restaurables al volver a entrar con la misma cuenta.
- Aviso previo a la caducidad del JWT (8 h).
- Que las demás listas del panel tampoco recarguen por un cambio de token de la misma cuenta.
