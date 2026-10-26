import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService, type MailOutcome } from '../mail/mail.service';
import { attemptEntry, decideSend, fingerprint, lastAttempt, stateOfOutcome, type SendBlock } from '../mail/mail-attempts';
import { PrismaService } from '../database/prisma.service';
import { isUniqueViolation, serializeQuote } from '../database/serialization';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';


import { CotizacionDto, CotizacionQueryDto, EditCotizacionDto, EstadoCotizacionDto } from './cotizacion.dto';
import { duplicateRequestHash, quoteRequestHash } from './idempotency';
import { lockMessage } from '../attention/message-state';
import { mysqlErrorCode } from '../admin/auth/account-locks';
import { renderQuotePdf } from './cotizaciones.pdf';
import { isExpired, limaToday, mailSummary, quoteNumber, transitions } from './quote-rules';

export { transitions };
// El listado solo trae lo necesario para identificar y gestionar la cotización. Los datos personales del cliente (correo, teléfono, documento, dirección),
// el historial y los textos largos quedan reservados para el detalle (`GET /:id`), que exige el mismo permiso `cotizaciones:leer`.
// `search` sigue buscando por correo en el servidor sin devolverlo.
export const LIST_OMIT = { historial: true, conceptos: true, condiciones: true, datos_emisor: true, email: true, telefono: true, documento: true, direccion: true } as const;
export const CONCURRENCY_MESSAGE = 'Otra operación estaba modificando los mismos datos. No se guardó nada; vuelve a intentarlo.';
// Añade lo derivado que la API ofrece sin guardarlo: `vencida` (enviada con vigencia pasada) y, en el detalle, el resumen de envíos por correo.
const present = <T extends { estado: string; validez: string }>(item: T) => ({ ...item, vencida: isExpired(item.estado, item.validez) });
const presentDetail = <T extends { estado: string; validez: string; historial?: unknown }>(item: T) => ({ ...present(item), correo: mailSummary(item.historial) });
export function calculateQuote(dto: CotizacionDto) {
  const conceptos = dto.conceptos.map(item => {
    const cents = Math.round(item.precio * 100);
    if (!Number.isSafeInteger(cents) || cents < 0 || !Number.isInteger(item.cantidad) || item.cantidad < 1) throw new BadRequestException('Concepto inválido.');
    return { descripcion: item.descripcion, cantidad: item.cantidad, precio: cents / 100, importe: cents * item.cantidad / 100 };
  });
  const subtotal = conceptos.reduce((sum, item) => sum + Math.round(item.importe * 100), 0);
  const discount = Math.round(dto.descuento * 100);
  const rate = Math.round(dto.tasa * 100);
  if (!Number.isSafeInteger(discount) || discount < 0 || discount > subtotal || !Number.isInteger(rate) || rate < 0 || rate > 10000) throw new BadRequestException('Revisa el descuento y la tasa de impuesto.');
  const tax = Math.round((subtotal - discount) * rate / 10000);
  const total = subtotal - discount + tax;
  if (!Number.isSafeInteger(total) || total > 1_000_000_000_000) throw new BadRequestException('El importe supera el límite admitido.');
  return { conceptos, subtotal: subtotal / 100, descuento: discount / 100, tasa: rate / 100, impuesto: tax / 100, total: total / 100 };
}
const QUOTE_BLOCKED: Record<SendBlock, string> = {
  en_curso: 'Hay un envío iniciado de esta cotización que todavía no tiene resultado, así que puede haberse enviado. Revisa el historial antes de enviarla otra vez.',
  ya_aceptado: 'El proveedor ya aceptó esta cotización. Aceptado no significa entregado. Confirma si de verdad quieres enviarla otra vez.',
  incierto: 'No pudimos confirmar si el proveedor aceptó el envío anterior; es posible que el cliente lo reciba. Revisa el historial antes de reenviarla.',
};
@Injectable()
export class CotizacionesService {
  private readonly logger = new Logger(CotizacionesService.name);
  constructor(private readonly prisma: PrismaService, @Optional() private readonly mail?: MailService, @Optional() private readonly config?: ConfigService) {}
  async list(query: CotizacionQueryDto) {
    const where: Prisma.CotizacionWhereInput = {
      ...(query.estado ? { estado: query.estado } : {}),
      ...(query.contacto_id ? { contacto_id: query.contacto_id } : {}),
      ...(query.search ? { OR: ['numero', 'cliente', 'email'].map(field => ({ [field]: { contains: query.search } })) } : {}),
      // validez es un DATE: «vencida» = anterior al día de hoy en Lima (igual que HORUS Assistant).
      ...(query.vencida === 'si' ? { AND: [{ estado: 'enviada' }, { validez: { lt: new Date(limaToday() + 'T00:00:00Z') } }] } : {}),
    };
    const [rows, count] = await Promise.all([
      // createdAt tiene precisión de segundos: el id desempata para que la paginación no repita ni omita filas.
      this.prisma.cotizacion.findMany({ where, take: query.limit, skip: (query.page - 1) * query.limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], omit: LIST_OMIT }),
      this.prisma.cotizacion.count({ where }),
    ]);
    return { ok: true, items: rows.map(row => present(serializeQuote(row))), pagination: { total: count, pages: Math.ceil(count / query.limit), page: query.page } };
  }
  async detail(id: number) {
    const item = await this.prisma.cotizacion.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Cotización no encontrada.');
    return { ok: true, item: presentDetail(serializeQuote(item)) };
  }
  // PDF para el cliente. SOLO LECTURA (un único findUnique, sin transacción ni escritura: no toca estado, revisión ni historial) y con `select` explícito:
  // no se leen el historial, la revisión, las claves de idempotencia, el contacto de origen ni el correo y el teléfono del cliente.
  // Mismo permiso que el detalle (`cotizaciones:leer`); no existe restricción por registro (ninguna cotización pertenece a un usuario concreto).
  async pdf(id: number, now: Date = new Date()) {
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new NotFoundException('Cotización no encontrada.');
    const row = await this.prisma.cotizacion.findUnique({ where: { id }, select: {
      numero: true, estado: true, cliente: true, documento: true, direccion: true, emisor: true, datos_emisor: true, moneda: true, validez: true, condiciones: true,
      conceptos: true, subtotal: true, descuento: true, tasa: true, impuesto: true, total: true, createdAt: true,
    } });
    if (!row) throw new NotFoundException('Cotización no encontrada.');
    // Los DECIMAL salen como texto exacto de dos decimales (nunca por coma flotante) y la vigencia como YYYY-MM-DD.
    const validez = row.validez.toISOString().slice(0, 10);
    const buffer = await renderQuotePdf({ ...row, validez, vencida: isExpired(row.estado, validez),
      subtotal: row.subtotal.toFixed(2), descuento: row.descuento.toFixed(2), tasa: row.tasa.toFixed(2), impuesto: row.impuesto.toFixed(2), total: row.total.toFixed(2) }, { generatedAt: now });
    return { buffer, fileName: 'cotizacion-' + row.numero.replace(/[^A-Za-z0-9._-]/g, '_') + '.pdf' };
  }
  // Conflicto de concurrencia ESTRUCTURADO: P2034 de Prisma («write conflict or deadlock») o el 1213 de MySQL entregado por el adaptador (mysqlErrorCode).
  // No se inspeccionan mensajes. Se responde 409 sin detalle interno y SIN reintentar: la transacción ya se revirtió y repetir la solicitud con la misma
  // Idempotency-Key es seguro (devuelve la misma cotización). Esto traduce el interbloqueo; no lo evita.
  private referenceConflict(error: unknown): never {
    if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') || mysqlErrorCode(error) === '1213') throw new ConflictException(CONCURRENCY_MESSAGE);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new ConflictException('La consulta de origen cambió. Recarga la cotización.');
    throw error;
  }
  private async payload(dto: CotizacionDto) {
    const date = new Date(dto.validez + 'T12:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dto.validez) throw new BadRequestException('La fecha de vigencia no es válida.');
    if (dto.validez < limaToday()) throw new BadRequestException('La vigencia no puede ser anterior a hoy.');
    if (dto.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.email)) throw new BadRequestException('Correo del cliente inválido.');
    if (dto.contacto_id && !await this.prisma.contacto.findUnique({ where: { id: dto.contacto_id } })) throw new BadRequestException('La consulta de origen ya no existe.');
    return { cliente: dto.cliente, email: dto.email, telefono: dto.telefono, documento: dto.documento, direccion: dto.direccion,
      emisor: dto.emisor, datos_emisor: dto.datos_emisor, moneda: dto.moneda, validez: new Date(dto.validez), condiciones: dto.condiciones,
      contacto_id: dto.contacto_id || null, ...calculateQuote(dto) };
  }
  // Con `idempotencyKey` la creación es idempotente: la restricción UNIQUE de `idempotencia_clave` decide la carrera entre solicitudes simultáneas, así que
  // la misma clave y el mismo contenido devuelven SIEMPRE la misma cotización (sin crear otra) y la misma clave con otro contenido responde 422.
  // Crear no envía correo ni notifica: el envío es otro endpoint con su propio control de intentos.
  async create(dto: CotizacionDto, user: number, idempotencyKey?: string) {
    const huella = idempotencyKey ? quoteRequestHash(dto, user) : undefined;
    if (idempotencyKey) {
      const previous = await this.prisma.cotizacion.findUnique({ where: { idempotencia_clave: idempotencyKey } });
      if (previous) return this.replay(previous, huella!);
    }
    const data = await this.payload(dto);
    const saved = await this.persist(data, 'Creada como borrador', {}, user, idempotencyKey, huella);
    if ('replayed' in saved) return saved.replayed;
    return { ok: true, item: present({ ...serializeQuote(saved.item), ...calculateQuote(dto) }), ...(saved.consulta ? { consulta: saved.consulta } : {}) };
  }
  // Duplicar: una copia NUEVA en borrador para preparar otra propuesta (la original, sea cual sea su estado, no se toca: ni lectura con bloqueo ni escritura).
  // Hereda los datos comerciales (cliente, conceptos, importes, condiciones, consulta de origen) y NO hereda: id, número, estado, revisión, historial
  // (ni envíos por correo) ni la clave de idempotencia. La vigencia SIEMPRE se conserva tal cual (no se inventa un plazo: no hay plazo comercial predeterminado). Si la original ya venció, la copia
  // nace con esa fecha pasada, marcada con `requiere_nueva_vigencia`: no se puede enviar ni pasar a «enviada» hasta editar el borrador con una vigencia nueva. Con `Idempotency-Key` repetir la misma solicitud devuelve la misma copia en lugar de crear otra.
  async duplicate(id: number, user: number, idempotencyKey?: string) {
    const huella = idempotencyKey ? duplicateRequestHash(id, user) : undefined;
    if (idempotencyKey) {
      const previous = await this.prisma.cotizacion.findUnique({ where: { idempotencia_clave: idempotencyKey } });
      if (previous) return this.replay(previous, huella!);
    }
    const source = await this.prisma.cotizacion.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('Cotización no encontrada.');
    if (!Array.isArray(source.conceptos)) throw new ConflictException('La cotización original tiene conceptos ilegibles y no se puede duplicar.');
    const validez = source.validez.toISOString().slice(0, 10);
    const vencida = validez < limaToday();
    const calc = calculateQuote({ conceptos: source.conceptos as unknown as CotizacionDto['conceptos'], descuento: Number(source.descuento), tasa: Number(source.tasa) } as CotizacionDto);
    const data = { cliente: source.cliente, email: source.email, telefono: source.telefono, documento: source.documento, direccion: source.direccion,
      emisor: source.emisor, datos_emisor: source.datos_emisor, moneda: source.moneda, validez: new Date(validez), condiciones: source.condiciones,
      contacto_id: source.contacto_id, ...calc };
    const saved = await this.persist(data, 'Creada como borrador (duplicada de ' + source.numero + ')', { duplicada_de: { id: source.id, numero: source.numero }, ...(vencida ? { vigencia_pendiente: true } : {}) }, user, idempotencyKey, huella);
    if ('replayed' in saved) return saved.replayed;
    return { ok: true, item: present({ ...serializeQuote(saved.item), ...calc }), requiere_nueva_vigencia: vencida, ...(saved.consulta ? { consulta: saved.consulta } : {}) };
  }
  // Inserción común a crear y duplicar. El número legible se deriva del id autoincremental (único y sin carreras); mientras se inserta lleva un valor
  // provisional único. Todo va en UNA transacción: la cotización con su número definitivo y, si hay consulta de origen en «nuevo», su paso a «en_proceso»
  // (seguimiento + historial + contacto). Si algo falla, no queda nada: ni cotización sin número ni consulta cambiada sin cotización.
  private async persist(data: Omit<Prisma.CotizacionUncheckedCreateInput, 'numero' | 'estado' | 'revision' | 'historial'>, action: string, trace: Record<string, unknown>, user: number, idempotencyKey?: string, huella?: string) {
    try {
      const year = Number(limaToday().slice(0, 4));
      return await this.prisma.$transaction(async tx => {
        const created = await tx.cotizacion.create({ data: { ...data, numero: 'COT-' + year + '-' + randomUUID(), estado: 'borrador', revision: 1,
          historial: [{ accion: action, usuario: user, fecha: new Date().toISOString(), ...trace }],
          ...(idempotencyKey ? { idempotencia_clave: idempotencyKey, idempotencia_huella: huella } : {}) } });
        const item = await tx.cotizacion.update({ where: { id: created.id }, data: { numero: quoteNumber(year, created.id) } });
        const consulta = data.contacto_id ? await this.startInquiry(tx, data.contacto_id, item.numero, user) : null;
        return { item, consulta };
      });
    } catch (error) {
      if (idempotencyKey && isUniqueViolation(error)) {
        // Otra solicitud con la misma clave ganó la carrera entre la lectura y la inserción (la transacción completa se revirtió, incluido el cambio de estado).
        const winner = await this.prisma.cotizacion.findUnique({ where: { idempotencia_clave: idempotencyKey } });
        if (winner) return { replayed: this.replay(winner, huella!) };
      }
      return this.referenceConflict(error);
    }
  }
  // Atención: una consulta «nuevo» pasa a «en_proceso» al abrirle una cotización. Mismo protocolo que AttentionService.save: bloqueo de la fila de origen,
  // estado efectivo = seguimiento si existe, si no el de la consulta, y revisión/historial del seguimiento. Cualquier otro estado (en_proceso, atendido,
  // archivado) se respeta tal cual: crear una cotización no reabre ni cierra casos. `nuevo → en_proceso` siempre es una transición válida (attention-rules).
  private async startInquiry(tx: Prisma.TransactionClient, contactoId: number, numero: string, user: number) {
    if (!(await lockMessage(tx, contactoId)).length) throw new BadRequestException('La consulta de origen ya no existe.');
    const old = await tx.attentionRecord.findUnique({ where: { recurso_registro_id: { recurso: 'messages', registro_id: contactoId } } });
    const from = old ? old.estado : (await tx.contacto.findUniqueOrThrow({ where: { id: contactoId }, select: { estado: true } })).estado;
    if (from !== 'nuevo') return { id: contactoId, estado: from, actualizada: false };
    const entry = { accion: 'Seguimiento actualizado: en_proceso — cotización ' + numero + ' creada', usuario: user, fecha: new Date().toISOString(),
      estado_anterior: 'nuevo', estado_nuevo: 'en_proceso', cambios: [] as string[], origen: 'cotizacion', cotizacion: numero };
    if (old) {
      const done = await tx.attentionRecord.updateMany({ where: { id: old.id, revision: old.revision }, data: { estado: 'en_proceso', historial: [...(old.historial as Prisma.JsonArray), entry] as Prisma.InputJsonValue, revision: old.revision + 1 } });
      if (done.count !== 1) throw new ConflictException('El seguimiento cambió en otra sesión. Recarga el caso.');
    } else {
      await tx.attentionRecord.create({ data: { recurso: 'messages', registro_id: contactoId, contacto_id: contactoId, estado: 'en_proceso', responsable: '', notas: '', respuesta: '', revision: 2, historial: [entry] as Prisma.InputJsonValue } });
    }
    await tx.contacto.update({ where: { id: contactoId }, data: { estado: 'en_proceso' } });
    return { id: contactoId, estado: 'en_proceso', actualizada: true };
  }
  // Devuelve la cotización tal como está ahora en la base (puede haberse editado desde la creación), nunca importes recalculados con el contenido original.
  // Los importes van como números, igual que en la respuesta de la creación.
  private replay(previous: import('@prisma/client').Cotizacion, huella: string) {
    if (previous.idempotencia_huella !== huella) throw new UnprocessableEntityException('Esta clave de idempotencia ya se usó con otro contenido. Revisa la cotización o genera una solicitud nueva.');
    const item = serializeQuote(previous);
    for (const field of ['subtotal', 'descuento', 'tasa', 'impuesto', 'total']) item[field] = Number(item[field]);
    return { ok: true, reutilizada: true, item: present(item), ...(previous.estado === 'borrador' && String(item.validez) < limaToday() ? { requiere_nueva_vigencia: true } : {}) };
  }
  async edit(id: number, dto: EditCotizacionDto, user: number) {
    const data = await this.payload(dto);
    return this.mutate(id, dto.revision, user, 'Borrador actualizado', item => {
      if (item.estado !== 'borrador') throw new ConflictException('Solo se editan borradores. Duplica la cotización para preparar otra propuesta.');
      return data;
    });
  }
  async status(id: number, dto: EstadoCotizacionDto, user: number) {
    // La nota se ve en el historial que ya muestra el panel (campo `accion`) y también queda estructurada (`nota`).
    // Cambiar el estado es un REGISTRO administrativo: «aceptada» no prueba por sí sola que el cliente aceptó; la nota sirve para dejar la evidencia.
    const nota = dto.nota?.trim() || undefined;
    return this.mutate(id, dto.revision, user, 'Estado: ' + dto.estado + (nota ? ' — ' + nota : ''), item => {
      if (!transitions[item.estado]?.includes(dto.estado)) throw new ConflictException('Ese cambio de estado no está permitido.');
      if (['enviada', 'aceptada'].includes(dto.estado) && item.validez < limaToday()) throw new ConflictException('La cotización está vencida. Prepara una nueva propuesta.');
      return { estado: dto.estado };
    }, item => ({ estado_anterior: item.estado, estado_nuevo: dto.estado, ...(nota ? { nota } : {}) }));
  }
  // Envío manual. Reclama el envío antes de contactar al proveedor (compare-and-swap sobre `revision`, intento en `historial`), envía y registra
  // el desenlace. No cambia `estado` (borrador→enviada sigue siendo una transición manual aparte) ni el contenido o los importes.
  async email(id: number, revision: number, user = 0, confirmed = false) {
    const { item } = await this.detail(id);
    if (item.revision !== revision) throw new ConflictException('La cotización cambió. Recárgala antes de enviar.');
    if (!item.email || !['borrador', 'enviada'].includes(item.estado)) throw new BadRequestException('Solo se envían propuestas vigentes con correo del cliente.');
    if (item.validez < limaToday()) throw new ConflictException('La propuesta está vencida.');
    const lines = Array.isArray(item.conceptos) ? item.conceptos.map(line => line && typeof line === 'object' && !Array.isArray(line) ? [line.descripcion, line.cantidad, line.precio, line.importe].join(' · ') : '').join('\n') : '';
    const text = [item.emisor, item.datos_emisor, 'Cotización: '+item.numero+' · Revisión '+revision, 'Cliente: '+item.cliente, 'Válida hasta: '+item.validez, lines, 'Subtotal: '+item.subtotal, 'Descuento: '+item.descuento, 'Impuesto: '+item.impuesto, 'Total: '+item.total+' '+item.moneda, item.condiciones].join('\n\n');
    if (!this.mail) throw new ServiceUnavailableException('El correo no está disponible. La cotización sigue guardada.');
    // Envío lógico = destinatario + contenido (sin la revisión, que sube con cada intento registrado).
    const huella = fingerprint('cotizacion', String(id), item.email.toLowerCase(), String(item.numero), String(item.emisor ?? ''), String(item.datos_emisor ?? ''), String(item.cliente), String(item.validez), lines, String(item.subtotal), String(item.descuento), String(item.impuesto), String(item.total), String(item.moneda), String(item.condiciones ?? ''));
    const intento = randomUUID();
    const stale = () => new ConflictException('La cotización cambió en otra sesión. Recárgala antes de continuar.');
    await this.prisma.$transaction(async tx => {
      const current = await tx.cotizacion.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Cotización no encontrada.');
      if (current.revision !== revision) throw stale();
      const decision = decideSend(lastAttempt(current.historial, 'cotizacion', huella), confirmed);
      if (!decision.allow) throw new HttpException({ ok: false, envio: 'bloqueado', motivo: decision.motivo, requiere_confirmacion: true, mensaje: QUOTE_BLOCKED[decision.motivo as SendBlock] }, HttpStatus.CONFLICT);
      const claimed = await tx.cotizacion.updateMany({ where: { id, revision }, data: { revision: { increment: 1 }, historial: [...(current.historial as Prisma.JsonArray), attemptEntry('cotizacion', 'iniciado', user, huella, intento)] as unknown as Prisma.InputJsonValue } });
      if (claimed.count !== 1) throw stale();
    });
    let outcome: MailOutcome;
    try { outcome = await this.mail.deliver({ from: this.config?.get<string>('MAIL_USER'), to: item.email, subject: 'Cotización '+item.numero, text }); }
    catch { outcome = { status: 'uncertain', reason: 'error inesperado al enviar' }; }
    let registrado = false;
    for (let attempt = 0; attempt < 3 && !registrado; attempt++) {
      try {
        await this.prisma.$transaction(async tx => {
          const current = await tx.cotizacion.findUnique({ where: { id } });
          if (!current) throw new NotFoundException('Cotización no encontrada.');
          const done = await tx.cotizacion.updateMany({ where: { id, revision: current.revision }, data: { revision: { increment: 1 }, historial: [...(current.historial as Prisma.JsonArray), attemptEntry('cotizacion', stateOfOutcome(outcome), user, huella, intento, outcome.providerId)] as unknown as Prisma.InputJsonValue } });
          if (done.count !== 1) throw stale();
        });
        registrado = true;
      } catch { /* otra sesión guardó entre medias: se vuelve a leer y se reintenta el registro (nunca el envío) */ }
    }
    if (!registrado) this.logger.warn('No se pudo registrar el resultado de un envío de cotización; el intento queda sin resultado.');
    const fresh = await this.detail(id).then(r => r.item).catch(() => undefined);
    const common = { intento, registrado, ...(fresh ? { item: fresh, revision: fresh.revision } : {}) };
    if (outcome.status === 'accepted') return { ok: true, envio: 'aceptado', mensaje: 'El proveedor aceptó el correo con la cotización. Esto no confirma que ya esté en la bandeja del cliente.' + (registrado ? '' : ' El resultado no pudo registrarse en el historial.'), ...common };
    if (outcome.status === 'failed') throw new HttpException({ ok: false, envio: 'fallido', mensaje: 'No se pudo enviar el correo. La cotización sigue guardada y puedes volver a intentarlo.', ...common }, HttpStatus.SERVICE_UNAVAILABLE);
    throw new HttpException({ ok: false, envio: 'incierto', mensaje: 'No pudimos confirmar si el proveedor aceptó el correo. Es posible que el cliente lo reciba. Revisa el historial antes de reenviarlo.', ...common }, HttpStatus.BAD_GATEWAY);
  }
  private async mutate(id: number, revision: number, user: number, action: string,
    changes: (item: ReturnType<typeof serializeQuote<import('@prisma/client').Cotizacion>>) => Prisma.CotizacionUpdateManyMutationInput,
    trace?: (item: ReturnType<typeof serializeQuote<import('@prisma/client').Cotizacion>>) => Record<string, unknown>) {
    return this.prisma.$transaction(async tx => {
      const item = await tx.cotizacion.findUnique({ where: { id } });
      if (!item) throw new NotFoundException('Cotización no encontrada.');
      const conflict = () => new ConflictException('La cotización cambió en otra sesión. Recárgala antes de continuar.');
      if (item.revision !== revision) throw conflict();
      // Compare-and-swap makes concurrent edits mutually exclusive, including the audit history.
      const current = serializeQuote(item);
      const updates = changes(current);
      const result = await tx.cotizacion.updateMany({ where: { id, revision }, data: {
        ...updates, revision: { increment: 1 },
        historial: [...(item.historial as Prisma.JsonArray), { accion: action, usuario: user, fecha: new Date().toISOString(), ...(trace ? trace(current) : {}) }] as Prisma.InputJsonValue,
      } });
      if (result.count !== 1) throw conflict();
      const updated = serializeQuote(await tx.cotizacion.findUniqueOrThrow({ where: { id } }));
      // Sequelize returned numeric values for freshly calculated fields, strings for DB reads.
      for (const field of ['subtotal', 'descuento', 'tasa', 'impuesto', 'total']) {
        if (typeof updates[field] === 'number') updated[field] = updates[field];
      }
      return { ok: true, item: presentDetail(updated) };
    }).catch(error => this.referenceConflict(error));
  }
}
