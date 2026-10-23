import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, PreinscripcionCanal } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { isSchemaOutdated, isUniqueViolation } from '../database/serialization';
import { RegistroPreinscripcionDto } from './preinscripciones.dto';
import { recordHistory } from './preinscripciones.history';
import { AVISO_VERSION, ESTADOS_VIGENTES, receivesPreinscripciones, TOPE_VIGENTES_POR_EDICION } from './preinscripciones.rules';

const calendar = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const MAX_PUBLIC_EDITIONS = 50;

// Respuesta ÚNICA del registro: la misma cuando se guarda y cuando la persona ya tenía una preinscripción vigente (así no se revela
// si un correo ya estaba inscrito), la misma para el formulario y para el chatbot, y sin ningún identificador ni dato personal.
export const REGISTRO_RESPUESTA = Object.freeze({ ok: true, mensaje: 'Recibimos tu preinscripción. El equipo de Horus la revisará.' });

type EditionRow = { id: number; curso_id: number; estado: string; archivado_at: Date | null; preinscripcion_estado: string; capacidad: number | null };

// SERVICIO PÚBLICO. Es el único camino por el que un visitante crea una preinscripción, para el formulario y para el chatbot: ambos
// llaman a register() con el canal fijado por el SERVIDOR. No importa ni conoce a ChatbotService ni a OpenAI, y no expone listados,
// estados ni datos de otras personas. El servicio administrativo (preinscripciones.service.ts) es otra clase y otro controlador.
@Injectable()
export class PreinscripcionesPublicService {
  constructor(private readonly prisma: PrismaService) {}

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      // Dos solicitudes simultáneas del mismo correo: la base impide la segunda y el visitante recibe la misma respuesta de siempre.
      if (isUniqueViolation(error)) return REGISTRO_RESPUESTA as T;
      if (isSchemaOutdated(error)) throw new ServiceUnavailableException('Las preinscripciones no están disponibles en este momento.');
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028'].includes(error.code)) throw new ConflictException('No pudimos registrar tu preinscripción. Vuelve a intentarlo.');
      throw error;
    }
  }

  // Ediciones que reciben preinscripciones AHORA (las mismas reglas que register()). Identifica cada una con un código opaco; no
  // devuelve ids secuenciales, cupos, cantidad de preinscritos ni datos personales.
  editions() {
    return this.execute(async () => {
      const batch = (cursor?: number) => this.prisma.convocatoria.findMany({
        where: { preinscripcion_estado: 'abierta', archivado_at: null, estado: { in: ['planificada', 'abierta'] }, codigo_publico: { not: null }, capacidad: { not: null }, curso: { estado: 'publicado' } },
        select: { id: true, codigo_publico: true, nombre: true, estado: true, fecha_inicio: true, fecha_fin: true, capacidad: true,
          curso: { select: { titulo: true, tipo: true, modalidad: true, duracion: true } }, _count: { select: { matriculas: { where: { estado: 'activa' } } } } },
        orderBy: [{ fecha_inicio: 'asc' }, { id: 'asc' }], take: MAX_PUBLIC_EDITIONS,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      });
      const available: Awaited<ReturnType<typeof batch>> = [];
      let cursor: number | undefined;
      // El límite se aplica a las disponibles. Cada lectura y la memoria están acotadas a 50;
      // el cursor conserva el orden fecha/id y evita offsets crecientes y consultas por edición.
      while (available.length < MAX_PUBLIC_EDITIONS) {
        const rows = await batch(cursor);
        available.push(...rows.filter(row => row.estado !== 'abierta' || row._count.matriculas < (row.capacidad as number)).slice(0, MAX_PUBLIC_EDITIONS - available.length));
        if (rows.length < MAX_PUBLIC_EDITIONS) break;
        cursor = rows[rows.length - 1].id;
      }
      const items = available.map(row => ({
        codigo: row.codigo_publico, nombre: row.nombre, apertura_confirmada: row.estado === 'abierta',
        fecha_inicio: calendar(row.fecha_inicio), fecha_fin: calendar(row.fecha_fin),
        curso: { titulo: row.curso.titulo, tipo: row.curso.tipo, modalidad: row.curso.modalidad, duracion: row.curso.duracion },
      }));
      return { ok: true, items };
    });
  }

  register(dto: RegistroPreinscripcionDto, canal: PreinscripcionCanal) {
    // Campo trampa: un robot lo rellena. Se responde igual que un éxito, sin guardar nada.
    if (dto.website && dto.website.trim()) return Promise.resolve(REGISTRO_RESPUESTA);
    return this.execute(() => this.prisma.$transaction(async tx => {
      // Bloqueo SOLO de la edición (nunca del curso): serializa las altas de la misma edición para que el tope se cumpla con exactitud.
      // Orden global de bloqueos: curso → edición → preinscripción; aquí se toma edición → preinscripción, sin esperar nunca al curso.
      const rows = await tx.$queryRaw<EditionRow[]>`SELECT id, curso_id, estado, archivado_at, preinscripcion_estado, capacidad FROM convocatorias WHERE codigo_publico = ${dto.convocatoria} FOR UPDATE`;
      const edition = rows[0];
      if (!edition || !receivesPreinscripciones(edition)) throw new NotFoundException('La edición indicada no recibe preinscripciones.');
      const course = await tx.curso.findUnique({ where: { id: edition.curso_id }, select: { estado: true } });
      if (!course || course.estado !== 'publicado') throw new NotFoundException('La edición indicada no recibe preinscripciones.');
      const full = new ConflictException('En este momento no recibimos más preinscripciones para esta edición.');
      if (edition.estado === 'abierta') {
        // Ya abierta: solo mientras queden cupos reales (misma regla de capacidad que Matrículas). Sin capacidad definida no se recibe.
        if (edition.capacidad === null) throw full;
        if (await tx.matricula.count({ where: { convocatoria_id: edition.id, estado: 'activa' } }) >= edition.capacidad) throw full;
      }
      if (await tx.preinscripcion.count({ where: { convocatoria_id: edition.id, estado: { in: [...ESTADOS_VIGENTES] } } }) >= TOPE_VIGENTES_POR_EDICION) throw full;
      // Ya hay una preinscripción vigente con ese correo en la edición: no se crea otra y se responde exactamente igual.
      if (await tx.preinscripcion.findFirst({ where: { convocatoria_id: edition.id, email: dto.email, estado: { in: [...ESTADOS_VIGENTES] } }, select: { id: true } })) return REGISTRO_RESPUESTA;
      const item = await tx.preinscripcion.create({ data: {
        convocatoria_id: edition.id, nombres: dto.nombres, apellidos: dto.apellidos, email: dto.email, telefono: dto.telefono,
        canal, estado: 'recibida', consentimiento_at: new Date(), aviso_version: AVISO_VERSION,
      }, select: { id: true } });
      await recordHistory(tx, item.id, { operacion: 'creacion', revision: 1, canal, estado_nuevo: 'recibida', campos: ['convocatoria_id', 'nombres', 'apellidos', 'email', 'telefono', 'consentimiento'] });
      return REGISTRO_RESPUESTA;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }
}
