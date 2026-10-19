# Preparación controlada de MySQL (17/10/2026)

Alcance autorizado: respaldo nativo de SQLite, pruebas y traslado a MySQL desechable,
importador probado con fixtures y documentación. Sin cambios de `.env`, bases habituales,
React, NestJS, dependencias, commits ni activaciones.

Decisión definitiva: la base MySQL para Laravel, Filament y Eloquent ORM se llamará
`horus_group`, independiente de `horus_db` y `horus_local`. Usar `DB_DATABASE=horus_group`
en la configuración futura; crear la base y modificar el `.env` habitual siguen pendientes
de autorización. Las validaciones de destino del traslado y del importador admiten
`horus_group` y rechazan bases mixtas, incluso con tablas ajenas vacías. Se conservan los nombres
históricos de bases desechables de pruebas y los resultados ya registrados.

1. Confirmar Git, CI, configuración y procesos mediante lecturas sin secretos.
2. Añadir respaldo SQLite nativo con origen de solo lectura, verificación de esquema,
   recuentos y firmas; probar WAL, restauración y rechazo de sobrescrituras.
3. Ejecutar el respaldo habitual en carpeta privada externa. Ensayar el traslado de una
   copia en servidor MySQL propio, identificado por UUID, y comprobar rollback y repetición.
4. Ejecutar la suite MySQL existente (incluidas carreras entre procesos), completar
   permisos y contenido donde falte cobertura.
5. Preparar importador de contenido desde intercambio JSON: sin conexión a NestJS,
   listas cerradas de tablas/campos, conservación de identidades/estados/fechas/URL,
   validación de imágenes locales, simulacro transaccional y repetición sin sobrescribir.
   Datos reales y URL remotas no verificables quedan pendientes de autorización/verificación.
6. Documentar activación, privilegios separados de migración/aplicación, recuperación,
   resultados y límites. Ejecutar PHPUnit, Pint, pruebas afectadas y revisión del diff.

Verificación: código de salida explícito; PHPUnit sin `CLAUDECODE`/`AI_AGENT`;
no confundir CI publicada con pruebas locales. El ensayo de datos habituales usará
exclusivamente una copia privada y un servidor desechable sin `horus_db`.

Decisiones: ejecución en la rama limpia solicitada, sin commits ni otro worktree;
la autorización expresa de avance autónomo sustituye pausas de revisión del plan.
Los scripts de habilidades que requieren commits no se ejecutan por la prohibición expresa.
