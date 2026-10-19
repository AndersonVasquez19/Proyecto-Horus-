import { Prisma, type Contacto } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { ListQueryDto } from '../common/list-query.dto';

// Una sola identidad lógica, igual que GET/PUT seguimiento. No depende de que un FK histórico esté poblado.
export const messageJoin = Prisma.sql`FROM contactos m LEFT JOIN attention_records a ON a.recurso = 'messages' AND a.registro_id = m.id`;
// contactos (utf8mb4_0900_ai_ci en MySQL 8) y attention_records (utf8mb4_unicode_ci) pueden diferir de colación:
// sin COLLATE explícito MySQL responde 1267 (Illegal mix of collations) al comparar el COALESCE. No requiere migración.
export const messageState = Prisma.sql`COALESCE(a.estado COLLATE utf8mb4_unicode_ci, m.estado COLLATE utf8mb4_unicode_ci)`;
export const administrativeState = (fallback: string, attention?: { estado: string } | null) => attention ? attention.estado : fallback;
type Reader = Pick<PrismaService, '$queryRaw'>;

export function messageWhere(q: ListQueryDto = {}, id?: number) {
  const clauses: Prisma.Sql[] = [];
  if (id !== undefined) clauses.push(Prisma.sql`m.id = ${id}`);
  if (q.estado) clauses.push(Prisma.sql`${messageState} = ${q.estado}`);
  if (q.search) {
    const term = '%' + q.search + '%';
    clauses.push(Prisma.sql`(m.nombre LIKE ${term} OR m.email LIKE ${term} OR m.asunto LIKE ${term} OR m.mensaje LIKE ${term})`);
  }
  if (q.channel === 'chatbot') clauses.push(Prisma.sql`m.asunto LIKE ${'[Chatbot]%'}`);
  if (q.channel === 'other') clauses.push(Prisma.sql`m.asunto NOT LIKE ${'[Chatbot]%'}`);
  return clauses.length ? Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}` : Prisma.empty;
}

export function readMessages(db: Reader, q: ListQueryDto = {}, id?: number) {
  const paging = q.page === undefined ? Prisma.empty : Prisma.sql`LIMIT ${q.limit || 20} OFFSET ${(q.page - 1) * (q.limit || 20)}`;
  return db.$queryRaw<Contacto[]>(Prisma.sql`SELECT m.id, m.nombre, m.email, m.telefono, m.asunto, m.mensaje,
    ${messageState} AS estado, m.createdAt, m.updatedAt ${messageJoin} ${messageWhere(q,id)}
    ORDER BY m.createdAt DESC, m.id DESC ${paging}`);
}

export async function countMessages(db: Reader, q: ListQueryDto) {
  const [row] = await db.$queryRaw<{total: bigint | number}[]>(Prisma.sql`SELECT COUNT(*) AS total ${messageJoin} ${messageWhere(q)}`);
  return Number(row.total);
}

export async function messageTotals(db: Reader) {
  const [row] = await db.$queryRaw<Record<string, bigint | number | Prisma.Decimal | null>[]>(Prisma.sql`SELECT COUNT(*) AS total,
    SUM(CASE WHEN ${messageState} = 'nuevo' THEN 1 ELSE 0 END) AS nuevo,
    SUM(CASE WHEN ${messageState} = 'en_proceso' THEN 1 ELSE 0 END) AS en_proceso,
    SUM(CASE WHEN ${messageState} = 'atendido' THEN 1 ELSE 0 END) AS atendido,
    SUM(CASE WHEN ${messageState} = 'archivado' THEN 1 ELSE 0 END) AS archivado ${messageJoin}`);
  return {total:Number(row.total),nuevo:Number(row.nuevo || 0),en_proceso:Number(row.en_proceso || 0),atendido:Number(row.atendido || 0),archivado:Number(row.archivado || 0)};
}

export function recentMessages(db: Reader) {
  return db.$queryRaw<Pick<Contacto,'id'|'nombre'|'email'|'asunto'|'estado'|'createdAt'>[]>(Prisma.sql`SELECT
    m.id, m.nombre, m.email, m.asunto, ${messageState} AS estado, m.createdAt ${messageJoin}
    ORDER BY m.createdAt DESC LIMIT ${5}`);
}

// Ambos escritores de estado toman este bloqueo antes de leer/crear seguimiento.
// El bloqueo de la fila de origen cierra la carrera del PUT heredado con el primer seguimiento.
export function lockMessage(tx: Reader, id: number) {
  return tx.$queryRaw<{id:number}[]>(Prisma.sql`SELECT id FROM contactos WHERE id = ${id} FOR UPDATE`);
}
