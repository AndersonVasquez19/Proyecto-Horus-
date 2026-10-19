# Panel y chatbot

## Panel

Las listas de consultas, reclamaciones, suscripciones, contenido y galería usan búsqueda y paginación en el servidor. La agenda filtra el periodo desde la API. Exportar resultados consulta todas las páginas que coinciden con los filtros; exportar página descarga solo lo visible. El CSV conserva UTF-8 y neutraliza fórmulas.

El seguimiento de consultas y reclamaciones guarda estado, responsable, notas internas, respuesta e historial. La revisión detecta cambios desde otra sesión y responde 409. Guardar no envía automáticamente correo; se envía la respuesta guardada con una acción explícita. Las constancias y notificaciones pueden reenviarse sin crear otro registro. Una reclamación se conserva y puede archivarse mediante el seguimiento.

Las cotizaciones se preparan manualmente o desde una consulta. El backend calcula los importes y controla revisión y transiciones. Se puede editar un borrador, preparar una copia, imprimir/guardar PDF y enviar un correo de texto con la propuesta. Imprimir o enviar un correo no cambia automáticamente el estado comercial.

Cuentas permite cambiar contraseña y activar/desactivar administradores. La desactivación y el cambio de contraseña revocan sesiones. Se conserva el registro abierto y los permisos actuales de todos los administradores. La biblioteca de contenido es interna.

## Chatbot

El menú consulta páginas de veinte registros y permite buscar por nombre y modalidad. Cada respuesta vuelve a consultar el detalle para comprobar la publicación. El historial del asistente no se usa como fuente de hechos.

Solicitar atención requiere consentimiento y registra una consulta con prefijo [Chatbot]. El chat no confirma reservas, pagos ni inscripciones. La IA es opcional; cuando falla, se muestran las fuentes del catálogo.

La API consulta únicamente contenido publicado y claves institucionales públicas conocidas. Antes de enviar la pregunta y el historial a la IA, oculta correos y secuencias que parecen teléfonos o documentos. Esto no garantiza anonimato: no debe escribirse información personal en el chat.

Las cuotas públicas se comparten en MySQL. La IP procede de Express y sus proxies explícitamente confiables; una cabecera enviada por el visitante no permite escoger su identidad.

## Comprobaciones

Ejecutar los checks y build del frontend, `node scripts/smoke-ui.cjs` y los tests de backend. Antes de presentar, probar también SMTP real, imágenes con volumen persistente y el contenido aprobado por la empresa. Market sigue siendo una etapa futura.
