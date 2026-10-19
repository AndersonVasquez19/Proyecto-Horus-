import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import { MessagesService } from '../src/admin/messages/messages.service';
import { StatsService } from '../src/admin/stats/stats.service';
import { AttentionService } from '../src/attention/attention.service';
import type { CatalogoService } from '../src/catalogo/catalogo.service';
import type { MailService } from '../src/mail/mail.service';
import type { ConfigService } from '@nestjs/config';
import { contacts, attention } from './fixtures/message-states';

function fixture() {
  // Solo memoria: ejecuta el SQL de lectura real sobre datos ficticios, sin cliente/conexión MySQL.
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE contactos (id INTEGER, nombre TEXT, email TEXT, telefono TEXT, asunto TEXT, mensaje TEXT, estado TEXT, createdAt TEXT, updatedAt TEXT); CREATE TABLE attention_records (recurso TEXT, registro_id INTEGER, estado TEXT);');
  for (const c of contacts) db.prepare('INSERT INTO contactos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(c.id,c.nombre,c.email,c.telefono,c.asunto,c.mensaje,c.estado,c.createdAt.toISOString(),c.updatedAt.toISOString());
  for (const a of attention) db.prepare('INSERT INTO attention_records VALUES (?, ?, ?)').run(a.recurso,a.registro_id,a.estado);
  const queries: Prisma.Sql[] = [];
  const mock = {
    $queryRaw: async (query: Prisma.Sql) => {
      queries.push(query);
      assert.match(query.sql, /^\s*SELECT/i, 'GET solo ejecuta SELECT');
      // MySQL exige la colación explícita; SQLite (solo pruebas) no la conoce y se ejecuta sin ella.
      return db.prepare(query.sql.replaceAll(' COLLATE utf8mb4_unicode_ci', '')).all(...query.values as SQLInputValue[]);
    },
    reclamacion: { count: async (q?: {where?: {tipo_registro:string}}) => q?.where?.tipo_registro === 'queja' ? 0 : 1, findMany: async () => [] },
    adminItem: { count: async () => 0 }, adminUser: { count: async () => 1 },
    contacto: { findUnique: async ({where}: {where: {id: number}}) => contacts.find(c => c.id === where.id) },
    attentionRecord: { findUnique: async ({where}: {where: {recurso_registro_id: {recurso: string; registro_id: number}}}) => attention.find(a => a.recurso === where.recurso_registro_id.recurso && a.registro_id === where.recurso_registro_id.registro_id) },
  };
  const prisma = mock as unknown as PrismaService;
  return { prisma, queries, db, messages: new MessagesService(prisma) };
}

test('D4: listado, detalle y seguimiento comparten estado; GET no escribe ni expone datos internos', async () => {
  const f = fixture();
  try {
    const list = await f.messages.findAll({page:1,limit:20});
    assert.equal(f.queries.length,3,'página, total filtrado y métricas; sin consultas por fila');
    assert.deepEqual(list.messages.map(m => [m.id,m.estado]), [[6,'archivado'],[5,'en_proceso'],[4,'atendido'],[3,'en_proceso'],[2,'nuevo'],[1,'atendido']]);
    const follow = new AttentionService(f.prisma, {} as MailService, {} as ConfigService);
    for (const row of list.messages) {
      assert.equal((await f.messages.findOne(row.id)).message.estado, row.estado);
      assert.equal((await follow.get('messages',row.id)).item.estado, row.estado);
      for (const key of ['notas','respuesta','historial','seguimientos']) assert.equal(key in row,false);
    }
    assert.equal(contacts.find(c => c.id === 6).estado,'atendido', 'no reescribe Contacto');
    assert.equal(attention.filter(a => a.recurso === 'messages' && a.registro_id === 1).length,0,'no crea seguimiento histórico');
  } finally { f.db.close(); }
});

test('D4: cuatro filtros efectivos antes de paginar y métricas globales', async () => {
  const f = fixture();
  try {
    for (const [estado,ids] of Object.entries({nuevo:[2],en_proceso:[5,3],atendido:[4,1],archivado:[6]})) {
      const result = await f.messages.findAll({page:1,limit:1,estado});
      assert.ok('pagination' in result && result.pagination);
      assert.ok('metrics' in result);
      assert.equal(result.pagination.total,ids.length);
      assert.equal(result.pagination.pages,ids.length);
      assert.deepEqual(result.messages.map(c => c.id),ids.slice(0,1));
      assert.deepEqual(result.metrics,{nuevo:1,en_proceso:2,atendido:2,archivado:1});
      if (ids.length>1) assert.deepEqual((await f.messages.findAll({page:2,limit:1,estado})).messages.map(c => c.id),ids.slice(1));
    }
    const pages = await Promise.all([1,2,3].map(page => f.messages.findAll({page,limit:2})));
    assert.deepEqual(pages.flatMap(p => p.messages.map(c => c.id)),[6,5,4,3,2,1]);
    assert.ok(f.queries.some(q => /WHERE[\s\S]*LIMIT[\s\S]*OFFSET/.test(q.sql)));
  } finally { f.db.close(); }
});

test('D4: búsqueda/origen/estado combinados, parámetros seguros y respuesta heredada', async () => {
  const f = fixture();
  try {
    const result = await f.messages.findAll({page:1,limit:20,search:'Soporte',channel:'chatbot',estado:'archivado'});
    assert.ok('pagination' in result && result.pagination);
    assert.deepEqual(result.messages.map(c => c.id),[6]);
    assert.equal(result.pagination.total,1);
    assert.deepEqual((await f.messages.findAll({page:1,channel:'other',estado:'archivado'})).messages,[]);
    const old = await f.messages.findAll();
    assert.deepEqual(Object.keys(old).sort(),['messages','ok']);
    assert.equal(old.messages.find(c => c.id === 1).estado,'atendido');
    assert.deepEqual((await f.messages.findAll({page:1,search:"' OR 1=1 --"})).messages,[]);
    await assert.rejects(() => f.messages.findOne(999),(e: {getStatus():number}) => e.getStatus() === 404);
    assert.equal(f.queries.filter(q => /LIMIT/.test(q.sql)).every(q => q.values.some(v => typeof v === 'number')),true);
  } finally { f.db.close(); }
});

test('Regresión 1267: el estado efectivo fija la colación de ambos operandos del COALESCE en todas las consultas', async () => {
  const f = fixture();
  try {
    const stats = new StatsService({ stats: async () => ({}) } as unknown as CatalogoService, f.prisma);
    await stats.getDashboardStats();
    await f.messages.findAll({ page: 1, limit: 5, estado: 'nuevo' });
    const effective = f.queries.filter(q => /COALESCE\(/.test(q.sql));
    assert.ok(effective.length >= 4, 'totales, recientes, página filtrada y total filtrado usan el estado efectivo');
    for (const q of effective) {
      assert.match(q.sql, /COALESCE\(a\.estado COLLATE utf8mb4_unicode_ci, m\.estado COLLATE utf8mb4_unicode_ci\)/);
      assert.equal(/COALESCE\(a\.estado, m\.estado\)/.test(q.sql), false, 'sin COALESCE de columnas con colaciones distintas');
    }
  } finally { f.db.close(); }
});

test('D4: estadísticas excluyen archivados de atendidos, mantienen total y actividad reciente', async () => {
  const f = fixture();
  try {
    const service = new StatsService({stats:async()=>({})} as CatalogoService,f.prisma);
    const result = await service.getDashboardStats();
    assert.deepEqual(result.stats.mensajes,{total:6,nuevos:1,enProceso:2,atendidos:2,archivados:1});
    assert.equal(result.actividadReciente.mensajes[0].estado,'archivado');
    assert.equal(result.actividadReciente.mensajes.length,5);
    assert.deepEqual(result.stats.reclamaciones,{total:1,reclamos:1,quejas:0});
    assert.equal('mensaje' in result.actividadReciente.mensajes[0],false);
  } finally { f.db.close(); }
});

test('D4: recurso + ID separa reclamación y mensaje; respaldo virtual no escribe', async () => {
  const f = fixture();
  try {
    const prisma = Object.assign(f.prisma,{reclamacion:{findUnique:async({where}:{where:{id:number}}) => where.id<=2 ? {email:'r@example.test',numero_reclamo:'HG-TEST'} : null}});
    const follow = new AttentionService(prisma, {} as MailService, {} as ConfigService);
    assert.equal((await follow.get('messages',1)).item.estado,'atendido');
    assert.equal((await follow.get('reclamaciones',1)).item.estado,'archivado');
    assert.deepEqual((await follow.get('reclamaciones',2)).item,{estado:'nuevo',responsable:'',notas:'',respuesta:'',revision:1,historial:[],envios:{respuesta:null,constancia:null}}); // `envios` (D5) es un campo aditivo derivado del historial
    await assert.rejects(()=>follow.get('reclamaciones',999),(e:{getStatus():number})=>e.getStatus()===404);
  } finally { f.db.close(); }
});

test('D4: inventario vacío y estado histórico desconocido no se normalizan ni crean escrituras', async () => {
  const f = fixture();
  try {
    f.db.exec("UPDATE contactos SET estado='historico' WHERE id=1");
    assert.equal((await f.messages.findOne(1)).message.estado,'historico');
    f.db.exec('DELETE FROM attention_records; DELETE FROM contactos;');
    const result = await f.messages.findAll({page:1});
    assert.deepEqual(result.messages,[]);
    assert.ok('metrics' in result);
    assert.deepEqual(result.metrics,{nuevo:0,en_proceso:0,atendido:0,archivado:0});
  } finally { f.db.close(); }
});

test('D4: primer seguimiento y PUT heredado se serializan con el mismo bloqueo de origen', async () => {
  for (const first of ['seguimiento','heredado']) {
    let state = 'nuevo';
    let record: Record<string, unknown> | null = null;
    let tail = Promise.resolve();
    let notifyLocked: () => void, releaseFirst: () => void;
    const locked = new Promise<void>(resolve => { notifyLocked = resolve; });
    const proceed = new Promise<void>(resolve => { releaseFirst = resolve; });
    let locks = 0;
    const mock = {
      contacto: {findUnique:async()=>({id:1,email:'p@example.test',asunto:'Prueba',estado:state})},
      $transaction: async <T>(work: (tx: unknown) => Promise<T>) => {
        let release: () => void;
        let hasLock = false;
        const tx = {
          $queryRaw: async (query: Prisma.Sql) => {
            assert.match(query.sql,/SELECT id FROM contactos WHERE id = \? FOR UPDATE/);
            assert.deepEqual(query.values,[1]);
            const previous = tail;
            tail = new Promise<void>(resolve => { release = resolve; });
            await previous; hasLock = true;
            if (++locks === 1) { notifyLocked(); await proceed; }
            return [{id:1}];
          },
          attentionRecord: {
            findUnique: async () => { assert.equal(hasLock,true); return record; },
            findUniqueOrThrow: async () => record,
            create: async ({data}:{data:Record<string,unknown>}) => { record = {id:1,...data}; return record; },
            updateMany: async ({where,data}:{where:{revision:number};data:Record<string,unknown>}) => {
              if (record?.revision !== where.revision) return {count:0};
              record={...record,...data}; return {count:1};
            },
          },
          contacto: {update: async ({data}:{data:{estado:string}}) => { assert.equal(hasLock,true); state=data.estado; return {id:1,estado:state}; }},
        };
        try { return await work(tx); } finally { release?.(); }
      },
    };
    const prisma = mock as unknown as PrismaService;
    const messages = new MessagesService(prisma), follow = new AttentionService(prisma,{} as MailService,{} as ConfigService);
    const save = () => follow.save('messages',1,{revision:1,estado:'archivado',responsable:'',notas:'Conservar',respuesta:''},1);
    const legacy = () => messages.updateStatus(1,{estado:'en_proceso'});
    const a = first === 'seguimiento' ? save() : legacy();
    await locked;
    // Captura el rechazo desde el inicio, sin una promesa rechazada sin observador.
    const b = (first === 'seguimiento' ? legacy() : save()).then(value=>({value}),error=>({error}));
    releaseFirst(); await a;
    const result = await b;
    if (first === 'seguimiento') { assert.ok('error' in result); assert.equal(result.error.getStatus(),409); }
    else assert.ok('value' in result);
    assert.equal(state,'atendido');
    assert.equal(record.estado,'archivado');
    assert.equal(record.revision,2);
    assert.equal(locks,2);
    await assert.rejects(save,(error:{getStatus():number})=>error.getStatus()===409);
  }
});
