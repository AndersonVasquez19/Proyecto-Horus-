// D4: el contacto original y su seguimiento son estructuras independientes.
export const contacts = [
  { id: 6, estado: 'atendido', asunto: '[Chatbot] Soporte' },
  { id: 5, estado: 'nuevo', asunto: '[Chatbot] Soporte' },
  { id: 4, estado: 'atendido', asunto: 'Soporte web' },
  { id: 3, estado: 'en_proceso', asunto: 'Soporte web' },
  { id: 2, estado: 'nuevo', asunto: 'Soporte web' },
  { id: 1, estado: 'atendido', asunto: 'Consulta histórica' },
].map(row => ({ ...row, nombre: 'Persona ficticia ' + row.id, email: 'p' + row.id + '@example.test', telefono: '', mensaje: 'Consulta de prueba', createdAt: new Date('2026-01-0' + row.id + 'T10:00:00Z'), updatedAt: new Date('2026-01-01T10:00:00Z') }));

export const attention = [
  { recurso: 'messages', registro_id: 6, estado: 'archivado' },
  { recurso: 'messages', registro_id: 5, estado: 'en_proceso' },
  { recurso: 'messages', registro_id: 4, estado: 'atendido' },
  { recurso: 'messages', registro_id: 3, estado: 'en_proceso' },
  { recurso: 'messages', registro_id: 2, estado: 'nuevo' },
  // Mismo ID que el mensaje histórico: NO debe cambiar su estado.
  { recurso: 'reclamaciones', registro_id: 1, estado: 'archivado' },
].map((row, index) => ({ ...row, id: index + 1, revision: 2, responsable: 'Equipo ficticio', notas: 'Privado', respuesta: 'Respuesta ficticia', historial: [] }));
