# Panel y chatbot

## Panel

Las listas de consultas, reclamaciones, suscripciones, contenido y galería usan búsqueda y paginación en el servidor. La agenda filtra el periodo desde la API. Exportar resultados consulta todas las páginas que coinciden con los filtros; exportar página descarga solo lo visible. El CSV conserva UTF-8 y neutraliza fórmulas.

El seguimiento de consultas y reclamaciones guarda estado, responsable, notas internas, respuesta e historial. La revisión detecta cambios desde otra sesión y responde 409. Guardar no envía automáticamente correo; se envía la respuesta guardada con una acción explícita. Las constancias y notificaciones pueden reenviarse sin crear otro registro. Una reclamación se conserva y puede archivarse mediante el seguimiento.

Las cotizaciones se preparan manualmente o desde una consulta. El backend calcula los importes y controla revisión y transiciones. Se puede editar un borrador, preparar una copia, imprimir/guardar PDF y enviar un correo de texto con la propuesta. Imprimir o enviar un correo no cambia automáticamente el estado comercial.

Cuentas permite cambiar contraseña y activar/desactivar administradores. La desactivación y el cambio de contraseña revocan sesiones. Se conserva el registro abierto y los permisos actuales de todos los administradores. La biblioteca de contenido es interna.

## Chatbot

El widget abre con el saludo de Horus, cuatro preguntas sugeridas y un campo para escribir. Tras una respuesta muestra solo sus sugerencias válidas (hasta cuatro de 160 caracteres, sin duplicados, marcado, enlaces ni indicadores comunes de datos sensibles). El filtro es conservador y no garantiza detectar todo dato personal en texto libre. Cada botón usa el mismo envío que el campo, solo con activación explícita; durante la espera y ante errores no hay sugerencias activas. No muestra menú ni formularios de cotización y atención. «Nueva conversación» vuelve al saludo y descarta sugerencias anteriores. Las respuestas conservan sus fuentes y el reintento explícito si falla una consulta. El historial del asistente no se usa como fuente de hechos.

El endpoint de contacto se conserva en la API, pero el widget ya no lo utiliza. El chat no confirma reservas, pagos ni inscripciones. La IA es opcional; cuando falla, se muestran las fuentes del catálogo.

La API consulta únicamente contenido publicado y claves institucionales públicas conocidas. Antes de enviar la pregunta y el historial a la IA, oculta correos y secuencias que parecen teléfonos o documentos. Esto no garantiza anonimato: no debe escribirse información personal en el chat.

Las cuotas públicas se comparten en MySQL. La IP procede de Express y sus proxies explícitamente confiables; una cabecera enviada por el visitante no permite escoger su identidad.

## Comprobaciones

Ejecutar los checks y build del frontend, `node scripts/smoke-ui.cjs` y los tests de backend. Antes de presentar, probar también SMTP real, imágenes con volumen persistente y el contenido aprobado por la empresa. Market sigue siendo una etapa futura.
