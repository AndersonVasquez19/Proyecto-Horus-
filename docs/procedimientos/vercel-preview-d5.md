# Fase D.5 — Preparación de la primera Preview de Vercel

Revisión: 24/10/2026. **No se ha desplegado.** Este documento prepara la decisión y la configuración; no declara que exista una Preview ni un paquete sin backend listo para subir.

## Dictamen

Es viable una Preview visual protegida de la web institucional antes de Azure, pero **no subir el proyecto actual tal cual**: el build alojado exige una API HTTPS y los formularios y el chatbot todavía ofrecen acciones que necesitan esa API. El panel autenticado requiere backend; sin él solo se pueden revisar sus pantallas públicas y la denegación de acceso al dashboard.

La alternativa recomendada para esta primera entrega es **CLI desde una copia aislada y delimitada del frontend**, con destino Preview explícito. La configuración sin backend descrita abajo debe prepararse y comprobarse antes de autorizar el despliegue. La otra alternativa es esperar la URL definitiva de Azure. No usar una URL inventada para superar la validación.

## Evidencia local y límites

| Comprobación | Resultado |
| --- | --- |
| Rama / HEAD | `anderson` / `322acba1ab2aa214688caa8ecc689c23ee5a20d3` |
| Cambios previos | 13 archivos modificados: 10 de backend, un documento de Azure y `frontend/package.json` / `package-lock.json`; además, ocho archivos sin seguimiento de Aiven/proxy. No se tocaron. |
| Cambios D.4 en frontend | Vite fijado a `8.3.5`; lockfile pendiente de commit. HEAD por sí solo no identifica la versión local aprobada. |
| Configuración | Existe `frontend/vercel.json`: framework Vite, build `npm run build`, salida `dist`, reescritura SPA excluyendo `/api` y `/api/*`. No define `installCommand`; fijar `npm ci` en el proyecto. |
| Enlace local | No existen `.vercel/` en raíz ni en frontend. No hay CLI `vercel` en PATH. No se instaló ni vinculó nada. |
| Cuenta conectada | La consulta de equipos devolvió cero resultados; la búsqueda de proyectos `horus` también. No demuestra ausencia en otras cuentas ni permite confirmar plan, Root Directory o variables remotas. |
| Node | `frontend/package.json` exige `22.x`; el Node en PATH durante esta revisión es `v24.19.0`, npm `11.17.0`. No se recompiló con ese runtime. |
| D.4.2 | Build, tipos, lint y 172 pruebas aprobadas, una Edge omitida: evidencia suministrada por el usuario, no repetida en D.5. |
| Build existente | `dist` contiene 168 archivos, sin sourcemaps ni archivos `.env`, claves o SQL detectados. No se regeneró. |
| Linux | Lock incluye bindings opcionales Linux x64 GNU/musl de Rolldown, Oxide y Lightning CSS con integridad. 750 importaciones relativas revisadas sin discrepancias de mayúsculas ni destinos ausentes. No equivale a ejecutar `npm ci` y build en Linux. |
| Seguridad | Búsqueda de patrones en fuente y artefactos, sin imprimir valores sensibles: sin `JWT_SECRET`, referencias Aiven, claves privadas o claves reconocibles de proveedores. En dist tampoco se detectaron JWT completos ni URL de BD con credenciales. Es un escaneo acotado, no una garantía universal. |
| Variables locales | Solo existe `frontend/.env.example`. No hay variables `VITE_*` ni `VERCEL` en el proceso inspeccionado. No se abrió ni modificó `backend/.env`. |
| Comprobación puntual | El resolver alojado rechaza ausencia de URL, `/api` y localhost. `git diff --check` sin errores de espacios. |

Identificación del estado inspeccionado (SHA-256):

```text
frontend/package.json
fcf5da9eac7f8535233bb19d7a19defabb5b296e9474bd284ef9899a98f2ae58
frontend/package-lock.json
9c1ffa40d092d437b4e4876effc1e2fcea3fc4d2d519f591f4096a36036c1447
manifiesto de dist
f910fba777efeb7e4bc8b999a493f353deece4672abb8181147388024e201943
```

El último hash corresponde a las líneas `ruta_relativa hash_sha256`, con `/`, ordenadas y unidas mediante LF, sin LF final. Permite comparar el artefacto; no acredita por sí mismo correspondencia exacta entre fuente y build. La coincidencia `localhost` del JS corresponde al normalizador `src/contentImages.ts`, no a una URL de backend configurada.

## Configuración de Vercel preparada

| Ajuste | Valor previsto |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `frontend`, relativo a una copia que conserve ese directorio |
| Node.js | `22.x` (usar una versión compatible con los engines del lock; no copiar Node 24 del PATH) |
| Install Command | `npm ci`, sin omitir dependencias dev ni opcionales |
| Build Command | `npm run build` |
| Output Directory | `dist` relativo a frontend |
| Entorno | Preview exclusivamente |
| Git automático | Sin conectar para esta primera entrega |
| Acceso | Vercel Authentication + Standard Protection, comprobado antes de desplegar |
| Dominios | URL de Preview; sin dominio institucional, alias de producción ni promoción |
| Variables | Solo valores públicos, limitados al entorno Preview |

Se conserva la reescritura existente:

```json
{
  "source": "/((?!api(?:/|$)).*)",
  "destination": "/index.html"
}
```

Es una regla de navegación SPA, no de autenticación ni un proxy a Azure. Sin una ruta de API adicional, `/api/*` no obtiene respuestas del backend. Vite `server.proxy`, `allowedHosts` y el Caddyfile de Railway no se ejecutan en el hosting estático de Vercel.

[Referencia Vite](https://vercel.com/docs/frameworks/frontend/vite), [Node soportado](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) y [protección de deployments](https://vercel.com/docs/deployment-protection).

## GitHub frente a CLI

| Alternativa | Consecuencia para esta fase |
| --- | --- |
| GitHub → Vercel | Reproduce commits remotos. No incluye los cambios locales de Vite/lock aprobados en D.4. Publicarlos requeriría commit/push, prohibidos en esta fase. Importar el repositorio también puede iniciar un primer despliegue y habilitar automatismos. |
| CLI desde copia aislada | Permite seleccionar el frontend local aprobado sin subir backend, documentos, secretos o cambios ajenos. Necesita un manifiesto de archivos y hashes; el SHA de Git no basta para una copia con cambios locales. |

Para ejecutar más adelante: copiar únicamente archivos frontend necesarios para compilar y servir; excluir `.env*` reales, `.vercel`, `node_modules`, logs, capturas, tests/scripts de navegador, backend y documentación ajena. Conservar `package.json`, lock, configuración, `index.html`, `src` y `public`. No copiar el repositorio completo ni usar una exclusión genérica como único control. Registrar hashes de todos los archivos seleccionados y de cualquier adaptación exclusiva de Preview.

La copia debe conservar `frontend/` si el Root Directory es `frontend`. Confirmar el equipo/proyecto y la resolución de la raíz con la versión concreta de CLI antes de subir; no asumir que ejecutar desde cualquier subcarpeta selecciona el mismo proyecto.

El despliegue futuro deberá indicar `--target=preview`, sin `--prod`, `--temporary`, promoción ni alias de producción, y comprobar entorno/dominios devueltos. La CLI no está instalada: no se ha ejecutado ningún comando de despliegue. `dist` de Vite no es por sí solo un paquete válido para `vercel deploy --prebuilt`: esa modalidad requiere `.vercel/output` conforme a Build Output API. [CLI deploy](https://vercel.com/docs/cli/deploy), [Build Output API](https://vercel.com/docs/build-output-api/configuration).

## Estrategia antes de Azure

No configurar una URL de ejemplo, localhost, ngrok, API temporal o backend de otro entorno. Tampoco forzar `VERCEL=0` para esconder el requisito alojado.

Para una Preview visual sin backend se propone un **paquete estático aislado** con estos criterios de aceptación, todavía no implementado:

1. Mantener el contenido institucional aprobado y la autenticación existente. Añadir un aviso técnico persistente de Preview sin conexión y deshabilitar envíos, chatbot y operaciones dependientes de API antes de que el visitante pueda introducir datos. No simular sesiones, registros, resultados ni éxitos.
2. Mantener las llamadas de API en el mismo origen con `/api`, sin backend remoto, y bloquear las conexiones de API. Puede empaquetarse el dist revisado mediante Build Output API; así no se ejecuta el build alojado que exige URL absoluta. La adaptación y el artefacto final deben tener sus propios hashes y revisión, separados de D.4.2.
3. Añadir defensa de red en la entrega, por ejemplo CSP con `connect-src 'none'` y `form-action 'none'`, y evitar que `/api/*` sirva HTML de la SPA. Comprobar compatibilidad de esa política con mapa/embeds; CSP por sí sola no sustituye deshabilitar operaciones ni mostrar el aviso.
4. Usar protección de Vercel y `X-Robots-Tag: noindex, nofollow`. No habilitar enlaces de bypass públicos ni recursos de pago adicionales.
5. Comprobar en navegador, con red interceptada, navegación, assets, acceso directo a rutas, bloqueo sin sesión y ausencia de envíos/red de API. No escribir datos ni enviar correos reales. No declarar esta revisión como prueba del panel autenticado o de Azure.

La configuración Vite de la tabla anterior corresponde al despliegue **desde fuente con API válida**. El paquete estático anterior es una alternativa deliberada: no puede anunciarse como build alojado Linux aprobado ni como reproducción sin modificaciones de D.4.2.

La opción que conserva fuente y build sin adaptaciones es esperar una URL **real y autorizada de Azure con HTTPS y ruta `/api`**, sin credenciales, query ni fragmento. Ese valor público se asignará a `VITE_API_BASE_URL` de Preview cuando esté autorizado. No existe una URL confirmada en esta revisión. Integrar después exige autorizar en Azure el origen exacto de Preview en CORS y verificar TLS, preflight, 401/403 y salud; esos cambios quedan fuera de D.5.

`VITE_CONTENT_PROVIDER` puede quedar omitida (predeterminado `nestjs`) y `VITE_CONTENT_API_BASE_URL` omitida. La web institucional usa ahora lectores locales; esas variables no reemplazan la API de formularios o del panel. No introducir ninguna otra `VITE_*` sin revisar su valor público. Nunca JWT, OpenAI, correo, Aiven, CA privada o credenciales de BD en frontend/Vercel para este proyecto estático.

## Qué podrá probarse

| Sin Azure | Requiere backend y, según la función, sus proveedores |
| --- | --- |
| Home, navegación, cursos/capacitaciones, servicios, convenios, FAQ, galería, páginas institucionales/políticas e imágenes/fuentes locales | Chatbot conversacional, contacto del chatbot y su menú guiado (este todavía consulta API) |
| Diseño adaptable, teclado, rutas SPA y recarga directa | Contactos, newsletter/aviso de cursos y baja, Libro de Reclamaciones |
| Presentación de login, registro y recuperación, con envíos deshabilitados en la modalidad sin backend | Login real, registro, recuperación/cambio de contraseña y validación `/admin/me` |
| Redirección o estado de denegación del dashboard sin sesión | Gestión del panel, roles, estudiantes, ediciones, horarios, matrículas, CSV, reportes, mensajes, cotizaciones, uploads y cualquier escritura/exportación |
| Enlaces externos visibles, sin dar por probada su entrega o servicio | Oferta de ediciones para preinscripción y envío/conversión de preinscripciones |

El mapa/embeds y los enlaces a redes, WhatsApp o correo pueden depender de terceros aunque no de Azure. No generar mensajes reales ni presentar esos recorridos como integración verificada.

`AdminRoute` no monta el panel sin identidad validada; con token guardado, el contexto valida la sesión con el backend y el fallo no concede acceso. Las pantallas públicas de login/registro/recuperación sí son accesibles por diseño. El backend usa JWT y AccessGuard global para proteger datos y permisos: servir el HTML del panel con HTTP 200 no concede acceso. Se comprobó el código; no se ejecutaron peticiones contra Azure ni pruebas HTTP reales en esta fase. La persistencia existente del token en localStorage conserva su riesgo frente a XSS; no se modificó autenticación.

## Avisos moderados pendientes

`npm audit --json` ejecutado en D.5: **dos paquetes moderados, cero altos y cero críticos**; salida 1 porque hay hallazgos. `react-router` y `react-router-dom` están en `6.30.6`. Los dos avisos originales recaen en React Router; el segundo paquete hereda el riesgo.

| Aviso | Alcance y decisión |
| --- | --- |
| [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) | Redirección externa mediante rutas con barras invertidas controladas por un atacante. `safeAdminReturn` rechaza barras invertidas y limita destinos internos; no es una auditoría exhaustiva de todos los enlaces. Riesgo pendiente. |
| [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) | Inyección en deserialización de errores durante SSR/hidratación manual. La aplicación usa `createRoot` y no se encontró SSR/hidratación manual; la ruta de explotación descrita no se observa. El aviso sigue registrado. |

La corrección publicada es 7.18.0; npm propone 7.18.4 y la marca como salto mayor. No ejecutar `npm audit fix --force` ni migrar React Router en D.5. Los hallazgos deben aceptarse expresamente para la Preview limitada o tratarse en otra fase; esta revisión no los declara resueltos.

## Plan y costes

Para el sitio empresarial de Horus corresponde **Pro o Enterprise**, no Hobby: Hobby se limita al uso personal no comercial, aunque la web aún sea una prueba. Pro es suficiente como punto de partida para esta Preview. [Hobby](https://vercel.com/docs/plans/hobby).

La tarifa publicada de Pro es **USD 20/mes de plataforma**, con un puesto que puede desplegar y USD 20/mes de crédito de consumo; cada puesto adicional de Owner/Member cuesta USD 20/mes. Los Viewer son gratuitos. Aparte pueden cobrarse consumo que exceda cuotas/crédito y complementos. Para una SPA, revisar especialmente transferencia, solicitudes CDN y compilaciones; Azure/Aiven/OpenAI/correo son costes independientes. No hay garantía de coste total fijo de USD 20. [Pro y precios](https://vercel.com/docs/plans/pro-plan).

Usar Vercel Authentication para la protección básica; no contratar Password Protection (la documentación lo enumera como complemento de USD 20/mes por proyecto en Pro). Configurar avisos y pausa de Spend Management antes del despliegue con un límite aprobado; no confundir el aviso predeterminado de USD 200 con un tope ni asumir que una Preview no consume recursos. No se verificó una suscripción propia ni se activó plan, prueba, pago, recurso o proyecto alguno.

## Autorización exacta para una fase posterior

Antes de solicitar la aprobación final del despliegue deben existir el paquete aislado y su manifiesto, la modalidad sin backend verificada o la API real autorizada, y un equipo/proyecto Pro existente identificado con protección y presupuesto comprobados. Para la ruta desde fuente queda pendiente una instalación/build Linux con Node 22, una sola vez en la copia aislada; no copiar `node_modules` de Windows. No repetir toda la suite D.4 sin un cambio que lo justifique.

La autorización final deberá identificar:

> Autorizo un único despliegue Preview del paquete aislado identificado por su manifiesto SHA-256, en el equipo y proyecto Vercel indicados, usando el plan Pro ya contratado, con protección de acceso y el límite de consumo acordado. Modalidad: visual sin backend [o API Azure real expresamente autorizada]. Acepto los dos hallazgos moderados documentados para esta prueba limitada. No autorizo producción, promociones, dominios institucionales, Git automático, commits, pushes, cambios Azure/Aiven ni nuevas suscripciones o complementos.

Si no existe un Pro contratado, **detenerse antes de crear la Preview**: contratarlo y aceptar posibles cargos requiere una decisión económica distinta, expresamente excluida de D.5. Todavía no hay un paquete offline validado, URL de Azure, destino Vercel confirmado ni presupuesto aprobado; no basta una autorización genérica de despliegue para suplirlos.

Único archivo añadido en D.5: este documento. No se modificaron `.env`, secretos, contenido institucional, autenticación, infraestructura, stashes ni los cambios previos. Sin commit, push o despliegue.
