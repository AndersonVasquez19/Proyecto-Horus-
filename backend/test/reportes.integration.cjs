// Reportes académicos: HTTP real (AppModule compilado en backend/dist, AccessGuard global) contra un MySQL 8.4 DESECHABLE.
// Se ejecuta con `node test/run-academic-isolated.cjs reportes`, que crea y retira su propio contenedor; nunca usa .env, Compose,
// horus_db ni contenedores existentes. Todos los datos son ficticios. No envía correo ni accede a la red externa.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { fork } = require('node:child_process');
const { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const zlib = require('node:zlib');
const http = require('node:http');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const backend = join(__dirname, '..');
const versions = JSON.parse(readFileSync(join(backend, 'scripts/migrate.cjs'), 'utf8').match(/const versions = (\[[^\]]*\])/)[1].replaceAll("'", '"'));

// ---------- Lectores independientes de la implementación ----------
function parseCsv(text, sep = ';') {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch; continue; }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else if (ch === '\n' || ch === '\r') throw new Error('Fin de línea sin CRLF');
    else field += ch;
  }
  assert.equal(quoted, false); assert.equal(row.length + field.length, 0);
  return rows;
}
function unzip(buffer) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'ZIP sin directorio central');
  const files = new Map();
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < buffer.readUInt16LE(eocd + 10); i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const crc = buffer.readUInt32LE(offset + 16), compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32), local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buffer.subarray(start, start + compressed));
    assert.equal(data.length, size);
    if (zlib.crc32) assert.equal(zlib.crc32(data), crc, name + ': CRC-32');
    files.set(name, data.toString('utf8'));
    offset += 46 + nameLength + extra + comment;
  }
  return files;
}
const unxml = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function sheetRows(xml) {
  const rows = new Map();
  for (const [, r, body] of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map();
    for (const [, ref, attrs, inner] of body.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (/t="inlineStr"/.test(attrs)) cells.set(ref, { text: unxml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)[1]) });
      else if (inner) cells.set(ref, { number: Number(/<v>(.*?)<\/v>/.exec(inner)[1]) });
    }
    rows.set(Number(r), cells);
  }
  return rows;
}
const col = i => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const fromSerial = (serial, withTime) => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 1440) * 60000).toISOString(); return withTime ? d.slice(0, 10) + ' ' + d.slice(11, 16) : d.slice(0, 10); };
// Texto de un PDF de pdfkit (flujos FlateDecode, operadores TJ con cadenas hex WinAnsi). Solo para comprobar contenido.
const WIN_ANSI_80 = { 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x85: 0x2026, 0x80: 0x20ac };
// El delimitador final es solo `\nendstream`: un `\r?` previo consumiría como terminador el último byte del flujo comprimido
// cuando vale 0x0D (≈1/256 de los flujos), lo truncaría y `inflateSync` fallaría. Si el productor usara CRLF, el `\r` sobrante
// queda al final de los datos y zlib lo ignora tras el fin del flujo. pdfkit comprime todos sus flujos: uno que no se pueda
// descomprimir es un fallo del PDF o del extractor y debe verse, no omitirse en silencio.
function pdfText(pdf) {
  const pages = [];
  let index = 0;
  for (const match of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\nendstream/g)) {
    index++;
    let content;
    try { content = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); }
    catch (error) { throw new Error('PDF: el flujo ' + index + ' (' + match[1].length + ' bytes) no se pudo descomprimir: ' + error.message); }
    const lines = [...content.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ/g)].map(op => [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)]
      .map(part => [...Buffer.from(part[1], 'hex')].map(b => String.fromCodePoint(WIN_ANSI_80[b] ?? b)).join('')).join(''));
    if (lines.length) pages.push(lines.join('\n'));
  }
  return pages;
}
// Regresión determinista del extractor (sin MySQL ni red): un flujo comprimido cuyo último byte es 0x0D no puede truncarse.
// El último byte de un flujo zlib es el byte bajo del Adler-32 del contenido, así que se busca un relleno cuyo contenido lo produzca.
function flateStreamEndingWithCr(text, terminator) {
  for (let i = 0; i < 100000; i++) {
    const content = Buffer.from('BT\n[<' + Buffer.from(text, 'latin1').toString('hex') + '>] TJ\nET\n% ' + i + '\n', 'latin1');
    const compressed = zlib.deflateSync(content);
    if (compressed[compressed.length - 1] === 0x0d) return Buffer.concat([Buffer.from('<< /Length ' + compressed.length + ' /Filter /FlateDecode >>\nstream' + terminator), compressed, Buffer.from(terminator + 'endstream\n')]);
  }
  throw new Error('No se encontró un flujo comprimido que termine en 0x0D');
}
test('pdfText conserva un flujo comprimido cuyo último byte es 0x0D y falla ante uno ilegible', () => {
  for (const terminator of ['\n', '\r\n']) {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.3\n1 0 obj\n'), flateStreamEndingWithCr('Ficticio 0D', terminator), Buffer.from('endobj\n%%EOF\n')]);
    assert.deepEqual(pdfText(pdf), ['Ficticio 0D'], 'terminador ' + JSON.stringify(terminator));
  }
  // Un flujo al que le falta su último byte (lo que hacía la expresión anterior) ya no se omite: la prueba falla con un mensaje claro.
  const truncated = flateStreamEndingWithCr('Ficticio 0D', '\n');
  const broken = Buffer.concat([Buffer.from('%PDF-1.3\n'), truncated.subarray(0, truncated.indexOf(Buffer.from('\nendstream')) - 1), Buffer.from('\nendstream\n%%EOF\n')]);
  assert.throws(() => pdfText(broken), /PDF: el flujo 1 \(\d+ bytes\) no se pudo descomprimir/);
});
// Opcional: guarda los archivos descargados por HTTP (datos ficticios) como ejemplos. Nunca se ejecuta en la CI.
const sample = (name, data) => {
  const dir = process.env.REPORTES_MUESTRAS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), data);
};
const neutral = text => /^\s*[=+\-@＝＋－＠]|^[\t\r\n]/.test(text) ? "'" + text : text;
// Texto esperado de una celda del JSON en CSV (mismas reglas documentadas: fechas ISO, un decimal, vacío para null).
const expectedText = (value, tipo) => value === null || value === undefined ? '' : typeof value === 'string' ? neutral(value) : tipo === 'decimal' ? value.toFixed(1) : String(value);

test('Reportes académicos: HTTP real, permisos, filtros, coherencia entre formatos y solo lectura', { timeout: 300000 }, async t => {
  if (process.env.REPORTES_TEST_DB !== 'true') return t.skip('Requiere MySQL 8.4 desechable y UUID (node test/run-academic-isolated.cjs reportes).');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  assert.match(process.env.REPORTES_TEST_SERVER_UUID || '', /^[0-9a-f-]{36}$/);
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASS, timezone: 'Z', dateStrings: true, multipleStatements: false });
  const name = 'horus_reportes_it_' + randomBytes(12).toString('hex');
  const password = 'Ficticia-reportes-' + randomBytes(10).toString('hex');
  let api, apiDir;
  try {
    const [[server]] = await db.query("SELECT @@server_uuid AS uuid, VERSION() AS version, (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Uptime') AS uptime");
    assert.equal(server.uuid, process.env.REPORTES_TEST_SERVER_UUID); assert.match(server.version, /^8\.4\./); assert.ok(Number(server.uptime) < 3600);
    const [schemas] = await db.query("SELECT DISTINCT TABLE_SCHEMA FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')");
    assert.deepEqual(schemas, [], 'el servidor debe estar recién creado y vacío');
    await db.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); await db.changeUser({ database: name });
    for (const version of ['00000000-initial', ...versions]) for (const sql of readFileSync(join(backend, 'migrations', version + '.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean)) await db.query(sql);
    const hash = await bcrypt.hash(password, 10);
    const accounts = {};
    for (const [key, role] of [['g', 'GERENTE_GENERAL'], ['c', 'COORDINADORA_INSTITUCIONAL'], ['s', 'SECRETARIA'], ['b', null]]) {
      const [row] = await db.execute('INSERT INTO admin_users (nombre,email,password,activo,rol,createdAt,updatedAt) VALUES (?,?,?,1,?,NOW(),NOW())', ['Cuenta ficticia', key + '@reportes.test', hash, role]);
      accounts[key] = row.insertId;
    }

    // ---------- Datos académicos ficticios (fechas explícitas en UTC) ----------
    const course = async (titulo, slug, tipo) => (await db.execute("INSERT INTO cursos (titulo,slug,descripcion,tipo,modalidad,duracion,estado,createdAt,updatedAt) VALUES (?,?,'Curso ficticio',?,'presencial','20 horas','publicado',NOW(),NOW())", [titulo, slug, tipo]))[0].insertId;
    const c1 = await course('Instalación de cámaras y CCTV', 'camaras-reportes', 'curso');
    const c2 = await course('Ofimática básica', 'ofimatica-reportes', 'capacitacion');
    const edition = async (curso, nombre, inicio, fin, capacidad, estado, archivado = null) => (await db.execute('INSERT INTO convocatorias (curso_id,nombre,fecha_inicio,fecha_fin,capacidad,estado,archivado_at) VALUES (?,?,?,?,?,?,?)', [curso, nombre, inicio, fin, capacidad, estado, archivado]))[0].insertId;
    const e1 = await edition(c1, 'Edición 2026-I', '2026-03-01', '2026-04-30', 3, 'abierta');
    const e2 = await edition(c1, 'Edición verano', '2026-01-10', '2026-02-20', 2, 'cerrada');
    const e3 = await edition(c2, 'Edición sin cupos definidos', null, null, null, 'planificada');
    const e4 = await edition(c2, 'Edición cancelada', '2026-05-01', '2026-05-30', 5, 'cancelada', '2026-05-02 10:00:00.000');
    const student = async (apellidos, nombres, dni, createdAt, extra = {}) => (await db.execute(
      'INSERT INTO estudiantes (nombres,apellidos,doc_pais,doc_tipo,doc_numero,email,telefono,archivado_at,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [nombres, apellidos, dni ? 'PE' : null, dni ? 'DNI' : null, dni, extra.email ?? null, extra.telefono ?? null, extra.archivado ?? null, createdAt, createdAt]))[0].insertId;
    const s1 = await student('Peña Ñúñez', 'José Ángel', '01234567', '2026-03-01 04:59:59.999', { email: 'jose@ejemplo.test', telefono: '+51 987 654 321' }); // 28/02 en Lima
    const s2 = await student('Quispe', 'María', '12345678', '2026-03-01 05:00:00.000'); // 01/03 en Lima
    const s3 = await student('=HYPERLINK("http://malicioso.test","clic")', 'Ficticia', null, '2026-03-15 12:00:00.000');
    const s4 = await student('Archivada', 'Ficticia', '87654321', '2026-02-10 10:00:00.000', { archivado: '2026-06-01 10:00:00.000' });
    const s5 = await student('Rodríguez', 'Lucía', null, '2026-04-20 10:00:00.000');
    const enroll = (estudiante, convocatoria, estado, createdAt) => db.execute('INSERT INTO matriculas (estudiante_id,convocatoria_id,estado,createdAt,updatedAt) VALUES (?,?,?,?,?)', [estudiante, convocatoria, estado, createdAt, createdAt]);
    await enroll(s1, e1, 'activa', '2026-03-02 15:00:00.000'); await enroll(s2, e1, 'activa', '2026-03-03 15:00:00.000'); await enroll(s3, e1, 'anulada', '2026-03-04 15:00:00.000');
    await enroll(s1, e2, 'activa', '2026-01-15 15:00:00.000'); await enroll(s2, e2, 'activa', '2026-01-16 15:00:00.000');
    await enroll(s5, e4, 'anulada', '2026-04-25 15:00:00.000'); await enroll(s4, e3, 'activa', '2026-02-11 15:00:00.000');

    // ---------- API real ----------
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const apiPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
    apiDir = mkdtempSync(join(tmpdir(), 'horus-reportes-api-'));
    api = fork(join(__dirname, 'fixtures/access-guard-app.cjs'), [], { cwd: apiDir, windowsHide: true, silent: true,
      execArgv: ['-r', join(__dirname, 'isolate-env.cjs')], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'development',
        DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: process.env.DB_USER, DB_PASS: process.env.DB_PASS, DB_NAME: name,
        JWT_SECRET: randomBytes(32).toString('hex'), PORT: String(apiPort), MAIL_PROVIDER: 'gmail', HORUS_ACCESS_GUARD_FIXTURE: 'e36' } });
    const logs = []; api.stdout.on('data', d => logs.push(String(d))); api.stderr.on('data', d => logs.push(String(d)));
    const ready = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('API no inició')), 30000); api.once('message', m => { clearTimeout(timer); resolve(m); }); api.once('exit', () => { clearTimeout(timer); reject(new Error('API terminó antes de iniciar')); }); });
    const base = 'http://127.0.0.1:' + ready.port + '/api';
    const raw = async (path, token, method = 'GET', body) => {
      const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, headers: r.headers, buffer: Buffer.from(await r.arrayBuffer()) };
    };
    const json = async (path, token) => { const r = await raw(path, token); return { ...r, body: JSON.parse(r.buffer.toString('utf8') || 'null') }; };
    const tokens = {};
    for (const key of ['g', 'c', 's', 'b']) { const r = await raw('/admin/login', null, 'POST', { email: key + '@reportes.test', password }); assert.equal(r.status, 200); tokens[key] = JSON.parse(r.buffer.toString()).token; }

    const TECHNICAL = ['rate_limit_buckets', 'horus_migrations'];
    const snapshot = async () => {
      const [tables] = await db.query('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [name]);
      const list = tables.map(row => row.t).filter(table => !TECHNICAL.includes(table));
      const [sums] = await db.query('CHECKSUM TABLE ' + list.map(table => '`' + name + '`.`' + table + '`').join(', ') + ' EXTENDED');
      return JSON.stringify(sums.map(row => [row.Table, String(row.Checksum)]));
    };
    const before = await snapshot();
    const TYPES = ['estudiantes', 'ediciones', 'ocupacion', 'matriculas', 'matriculas-por-edicion', 'resumen'];
    // El catálogo también lista los reportes comerciales y de atención (mismo motor; datos y permisos cubiertos en reportes-comerciales.test.ts).
    // Este barrido de integración sigue sembrando solo datos académicos, así que el recorrido de formatos usa TYPES.
    const COMMERCIAL_TYPES = ['cotizaciones-por-estado', 'cotizaciones-vencidas', 'cotizaciones-importes', 'consultas-por-estado', 'consultas-abiertas-antiguas', 'actividad-comercial'];

    await t.test('sin sesión 401; cuenta básica y secretaría 403; coordinación consulta pero no exporta', async () => {
      const paths = ['/admin/reportes', '/admin/reportes/matriculas', '/admin/reportes/matriculas/exportar?formato=csv'];
      for (const path of paths) {
        assert.equal((await raw(path)).status, 401, path);
        assert.equal((await raw(path, tokens.b)).status, 403, 'básica ' + path);
        assert.equal((await raw(path, tokens.s)).status, 403, 'secretaría ' + path);
      }
      const catalog = await json('/admin/reportes', tokens.c);
      assert.equal(catalog.status, 200);
      assert.deepEqual(catalog.body.reportes.map(r => [r.tipo, r.puede_consultar, r.puede_exportar]), [...TYPES, ...COMMERCIAL_TYPES].map(tipo => [tipo, true, false]));
      for (const tipo of TYPES) assert.equal((await json('/admin/reportes/' + tipo, tokens.c)).status, 200, tipo);
      for (const formato of ['csv', 'xlsx', 'pdf']) assert.equal((await raw('/admin/reportes/ocupacion/exportar?formato=' + formato, tokens.c)).status, 403);
      const gerente = await json('/admin/reportes', tokens.g);
      assert.ok(gerente.body.reportes.every(r => r.puede_consultar && r.puede_exportar));
    });

    await t.test('filtros inválidos 400, recursos inexistentes 404, sin texto interno', async () => {
      for (const q of ['estudiantes?curso_id=1', 'estudiantes?estado=activa', 'matriculas?estado=abierta', 'resumen?agrupar=curso', 'otro', 'ediciones?desde=2026-02-30',
        'ediciones?desde=2026-05-01&hasta=2026-04-01', 'resumen?desde=2000-01-01&hasta=2026-01-01', 'matriculas?limit=101', 'matriculas?search=x', 'matriculas?estado=activa&estado=anulada',
        'ocupacion/exportar', 'ocupacion/exportar?formato=xls', 'ocupacion/exportar?formato=xlsx&separador=coma', 'ocupacion/exportar?formato=csv&page=1']) {
        const r = await json('/admin/reportes/' + q, tokens.g);
        assert.equal(r.status, 400, q);
        assert.doesNotMatch(r.buffer.toString(), /SELECT|prisma|stack|horus_reportes_it/i, q);
      }
      assert.equal((await json('/admin/reportes/matriculas?curso_id=999999', tokens.g)).status, 404);
      assert.equal((await json('/admin/reportes/ocupacion?convocatoria_id=999999', tokens.g)).status, 404);
    });

    await t.test('días de Lima, estados y valores calculados', async () => {
      const day = await json('/admin/reportes/estudiantes?desde=2026-03-01&hasta=2026-03-01&limit=100', tokens.g);
      assert.deepEqual(day.body.reporte.tabla.filas.map(r => r.id), [s2], 'el registro de las 04:59:59.999 UTC es del 28/02 en Lima');
      const feb = await json('/admin/reportes/estudiantes?desde=2026-02-28&hasta=2026-02-28', tokens.g);
      assert.deepEqual(feb.body.reporte.tabla.filas.map(r => [r.id, r.registrado]), [[s1, '2026-02-28 23:59']]);
      const inactive = await json('/admin/reportes/estudiantes?estado=inactivos', tokens.g);
      assert.deepEqual(inactive.body.reporte.tabla.filas.map(r => [r.id, r.estado]), [[s4, 'Inactivo']]);
      const all = Object.fromEntries((await json('/admin/reportes/estudiantes', tokens.g)).body.reporte.resumen.map(e => [e.clave, e.valor]));
      assert.deepEqual(all, { total: 5, activos: 4, inactivos: 1, con_matricula_vigente: 3, sin_dni: 2 });
      const occupancy = await json('/admin/reportes/ocupacion?limit=100', tokens.g);
      assert.deepEqual(occupancy.body.reporte.tabla.filas.map(r => [r.id, r.capacidad, r.vigentes, r.disponibles, r.ocupacion]), [[e2, 2, 2, 0, 100], [e1, 3, 2, 1, 66.7], [e4, 5, 0, 5, 0], [e3, null, 1, null, null]]);
      assert.deepEqual(Object.fromEntries(occupancy.body.reporte.resumen.map(e => [e.clave, e.valor])), { total: 4, con_capacidad: 3, sin_capacidad: 1, capacidad: 10, ocupados: 4, disponibles: 6, ocupacion: 40, completas: 1, matriculas_vigentes: 5 });
      const overlap = await json('/admin/reportes/ediciones?desde=2026-02-15&hasta=2026-03-05&archivo=activos', tokens.g);
      assert.deepEqual(overlap.body.reporte.tabla.filas.map(r => r.id), [e2, e1], 'superposición de fechas; sin fechas o archivadas quedan fuera');
      const voided = await json('/admin/reportes/matriculas?estado=anulada&curso_id=' + c1, tokens.g);
      assert.deepEqual(voided.body.reporte.tabla.filas.map(r => [r.apellidos, r.estado, r.curso]), [['=HYPERLINK("http://malicioso.test","clic")', 'Anulada', 'Instalación de cámaras y CCTV']]);
      const byCourse = await json('/admin/reportes/matriculas-por-edicion?agrupar=curso', tokens.g);
      assert.deepEqual(byCourse.body.reporte.tabla.filas.map(r => [r.curso, r.ediciones, r.vigentes, r.anuladas, r.total]), [['Instalación de cámaras y CCTV', 2, 4, 1, 5], ['Ofimática básica', 2, 1, 1, 2]]);
      const summary = await json('/admin/reportes/resumen?desde=2026-01-01&hasta=2026-04-30', tokens.g);
      assert.deepEqual(summary.body.reporte.tabla.filas.map(r => [r.mes, r.estudiantes, r.matriculas, r.vigentes, r.anuladas]), [['2026-01', 0, 2, 2, 0], ['2026-02', 2, 1, 1, 0], ['2026-03', 2, 3, 2, 1], ['2026-04', 1, 1, 0, 1]]);
      const kpi = Object.fromEntries(summary.body.reporte.resumen.map(e => [e.clave, e.valor]));
      assert.equal(kpi.estudiantes_registrados, 5); assert.equal(kpi.matriculas_registradas, 7); assert.equal(kpi.ediciones_abiertas, 1); assert.equal(kpi.ocupacion_abiertas, 66.7);
    });

    await t.test('CSV y XLSX: cabeceras HTTP, archivos válidos y mismos datos, filas y totales que la consulta JSON', async () => {
      const cases = [...TYPES.map(tipo => tipo), 'matriculas-por-edicion?agrupar=curso', 'matriculas?estado=activa&desde=2026-03-01&hasta=2026-03-31', 'estudiantes?desde=2030-01-01'];
      for (const entry of cases) {
        const [tipo, filters = ''] = entry.split('?');
        const sampleName = 'reporte-' + tipo + (filters ? '-' + filters.replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '') : '');
        const preview = await json('/admin/reportes/' + tipo + '?limit=100' + (filters ? '&' + filters : ''), tokens.g);
        assert.equal(preview.status, 200, entry);
        const doc = preview.body.reporte;
        assert.ok(doc.tabla.total_filas <= 100);
        const expectedRows = [doc.tabla.columnas.map(c => c.titulo), ...doc.tabla.filas.map(row => doc.tabla.columnas.map(c => expectedText(row[c.clave], c.tipo))),
          ...(doc.tabla.totales ? [doc.tabla.columnas.map(c => expectedText(doc.tabla.totales[c.clave], c.tipo))] : [])];

        const csv = await raw('/admin/reportes/' + tipo + '/exportar?formato=csv' + (filters ? '&' + filters : ''), tokens.g);
        assert.equal(csv.status, 200, entry); sample(sampleName + '.csv', csv.buffer);
        assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
        assert.match(csv.headers.get('content-disposition'), new RegExp('^attachment; filename="horus-reporte-' + tipo + '-\\d{8}-\\d{4}\\.csv"$'));
        assert.equal(csv.headers.get('cache-control'), 'no-store');
        assert.equal(csv.headers.get('x-content-type-options'), 'nosniff');
        assert.deepEqual([...csv.buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
        const csvRows = parseCsv(csv.buffer.subarray(3).toString('utf8'));
        const end = csvRows.findIndex(row => row.every(cell => cell === ''));
        assert.deepEqual(csvRows.slice(0, end).map(row => row.slice(0, doc.tabla.columnas.length)), expectedRows, entry + ': tabla CSV');
        for (const item of doc.resumen) assert.equal(csvRows.find(row => row[0] === item.etiqueta)[1], item.valor === null ? 'No aplica' : item.tipo === 'decimal' ? item.valor.toFixed(1) : String(item.valor), entry + ' ' + item.clave);

        const xlsx = await raw('/admin/reportes/' + tipo + '/exportar?formato=xlsx' + (filters ? '&' + filters : ''), tokens.g);
        assert.equal(xlsx.status, 200, entry); sample(sampleName + '.xlsx', xlsx.buffer);
        assert.equal(xlsx.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        assert.match(xlsx.headers.get('content-disposition'), /^attachment; filename="horus-reporte-[a-z-]+-\d{8}-\d{4}\.xlsx"$/);
        assert.equal(Number(xlsx.headers.get('content-length')), xlsx.buffer.length);
        const files = unzip(xlsx.buffer);
        assert.ok(files.has('xl/workbook.xml') && files.has('[Content_Types].xml'));
        assert.ok(![...files.values()].some(content => /<f[ >]/.test(content)), 'sin fórmulas');
        const sheet = sheetRows(files.get('xl/worksheets/sheet2.xml'));
        const lines = [...Array.from({ length: 1 + doc.tabla.filas.length }, (_, i) => i + 1), ...(doc.tabla.totales ? [doc.tabla.filas.length + 3] : [])];
        const fromXlsx = lines.map((line, r) => doc.tabla.columnas.map((column, c) => {
          const cell = sheet.get(line)?.get(col(c));
          if (!cell) return '';
          if (cell.text !== undefined) return neutral(cell.text);
          if (r > 0 && column.tipo === 'fecha') return fromSerial(cell.number, false);
          if (r > 0 && column.tipo === 'fecha_hora') return fromSerial(cell.number, true);
          return column.tipo === 'decimal' ? cell.number.toFixed(1) : String(cell.number);
        }));
        assert.deepEqual(fromXlsx, expectedRows, entry + ': tabla XLSX');
        // Los indicadores se buscan bajo la cabecera «Indicador»: el título del reporte (fila 2, solo columna A) puede coincidir con una etiqueta,
        // como «Pendientes de certificación».
        const summaryAll = [...sheetRows(files.get('xl/worksheets/sheet1.xml')).values()];
        const summarySheet = summaryAll.slice(summaryAll.findIndex(row => row.get('A')?.text === 'Indicador') + 1);
        for (const item of doc.resumen) {
          const cell = summarySheet.find(row => row.get('A')?.text === item.etiqueta).get('B');
          assert.equal(cell.text ?? (item.tipo === 'decimal' ? cell.number.toFixed(1) : String(cell.number)), item.valor === null ? 'No aplica' : item.tipo === 'decimal' ? item.valor.toFixed(1) : String(item.valor), entry + ' xlsx ' + item.clave);
        }

        const pdf = await raw('/admin/reportes/' + tipo + '/exportar?formato=pdf' + (filters ? '&' + filters : ''), tokens.g);
        assert.equal(pdf.status, 200, entry); sample(sampleName + '.pdf', pdf.buffer);
        assert.equal(pdf.headers.get('content-type'), 'application/pdf');
        assert.match(pdf.headers.get('content-disposition'), /^attachment; filename="horus-reporte-[a-z-]+-\d{8}-\d{4}\.pdf"$/);
        assert.equal(pdf.buffer.subarray(0, 5).toString('latin1'), '%PDF-'); assert.match(pdf.buffer.subarray(-8).toString('latin1'), /%%EOF\s*$/);
        assert.match(pdf.buffer.toString('latin1'), /\/MediaBox \[0 0 (595\.28 841\.89|841\.89 595\.28)\]/, 'A4');
        const pages = pdfText(pdf.buffer);
        // Las celdas y etiquetas largas se reparten en varias líneas (pdfkit consume el espacio del corte): comparación sin espacios.
        const text = pages.join('\n'), flat = text.replace(/\s+/g, ''), squash = value => String(value).replace(/\s+/g, '');
        assert.ok(text.includes('Detalle: ' + doc.tabla.titulo + ' (' + doc.tabla.total_filas + ' filas)'), entry + ': filas en PDF');
        assert.ok(pages.every((page, i) => page.includes('Página ' + (i + 1) + ' de ' + pages.length)), entry + ': paginación');
        for (const item of doc.resumen) assert.ok(flat.includes(squash(item.etiqueta)) && text.includes(item.valor === null ? 'No aplica' : item.tipo === 'decimal' ? item.valor.toFixed(1) : String(item.valor)), entry + ' pdf ' + item.clave);
        const firstText = doc.tabla.columnas.find(c => c.tipo === 'texto');
        for (const row of doc.tabla.filas) if (row[firstText.clave]) assert.ok(flat.includes(squash(row[firstText.clave])),entry + ': fila ' + row[firstText.clave]);
        if (doc.tabla.totales) for (const c of doc.tabla.columnas) if (typeof doc.tabla.totales[c.clave] === 'number') assert.ok(text.includes(expectedText(doc.tabla.totales[c.clave], c.tipo)), entry + ': total ' + c.clave);
        if (!doc.tabla.filas.length) assert.ok(text.includes('No hay registros para los filtros seleccionados.'));
        if (doc.datos_personales) assert.ok(text.includes('Confidencial'), entry + ': aviso de datos personales');
      }
    });

    await t.test('fórmulas neutralizadas en CSV, literales en XLSX, tildes intactas y separador opcional', async () => {
      const csv = await raw('/admin/reportes/estudiantes/exportar?formato=csv', tokens.g);
      const rows = parseCsv(csv.buffer.subarray(3).toString('utf8'));
      assert.ok(rows.some(row => row[1] === '\'=HYPERLINK("http://malicioso.test","clic")'));
      assert.ok(rows.some(row => row[1] === 'Peña Ñúñez' && row[2] === 'José Ángel' && row[5] === "'+51 987 654 321"));
      const comma = await raw('/admin/reportes/estudiantes/exportar?formato=csv&separador=coma', tokens.g);
      assert.deepEqual(parseCsv(comma.buffer.subarray(3).toString('utf8'), ','), rows);
      const xlsx = unzip((await raw('/admin/reportes/estudiantes/exportar?formato=xlsx', tokens.g)).buffer);
      assert.ok(xlsx.get('xl/worksheets/sheet2.xml').includes('=HYPERLINK(&quot;http://malicioso.test&quot;,&quot;clic&quot;)'));
      assert.ok(xlsx.get('xl/worksheets/sheet2.xml').includes('>01234567<'), 'DNI con cero inicial como texto');
    });

    await t.test('solo lectura: consultas y exportaciones no modifican ninguna tabla de negocio', async () => {
      assert.equal(await snapshot(), before);
    });

    await t.test('volumen: por encima del límite del formato responde 422 sin archivo; dentro, se genera completo', async () => {
      const values = Array.from({ length: 3000 }, (_, i) => "('Masivo','Ficticio " + i + "',NULL,NULL,NULL,'2026-07-01 12:00:00.000','2026-07-01 12:00:00.000')").join(',');
      await db.query('INSERT INTO estudiantes (nombres,apellidos,doc_pais,doc_tipo,doc_numero,createdAt,updatedAt) VALUES ' + values);
      const tooMany = await json('/admin/reportes/estudiantes/exportar?formato=pdf', tokens.g);
      assert.equal(tooMany.status, 422); assert.match(tooMany.body.message, /3005 filas.*PDF.*3000/);
      const started = Date.now();
      for (const formato of ['csv', 'xlsx']) {
        const file = await raw('/admin/reportes/estudiantes/exportar?formato=' + formato, tokens.g);
        assert.equal(file.status, 200, formato);
        if (formato === 'csv') assert.equal(parseCsv(file.buffer.subarray(3).toString('utf8')).findIndex(row => row.every(cell => cell === '')), 3006);
        else assert.equal(sheetRows(unzip(file.buffer).get('xl/worksheets/sheet2.xml')).size, 3006);
      }
      t.diagnostic('CSV + XLSX de 3005 estudiantes en ' + (Date.now() - started) + ' ms');
      // En el límite del PDF (3000 filas): se genera completo, con todas sus páginas.
      const startedPdf = Date.now();
      const limitPdf = await raw('/admin/reportes/estudiantes/exportar?formato=pdf&desde=2026-07-01&hasta=2026-07-01', tokens.g);
      assert.equal(limitPdf.status, 200);
      const pages = pdfText(limitPdf.buffer);
      assert.ok(pages[0].includes('Detalle: Estudiantes (3000 filas)'));
      assert.equal((pages.join('\n').match(/^Ficticio \d+$/gm) ?? []).length, 3000, 'cada fila una sola vez');
      t.diagnostic('PDF de 3000 filas: ' + pages.length + ' páginas, ' + Math.round(limitPdf.buffer.length / 1024) + ' KiB, ' + (Date.now() - startedPdf) + ' ms');
      const preview = await json('/admin/reportes/estudiantes?page=31&limit=100', tokens.g);
      assert.equal(preview.body.pagination.total, 3005); assert.equal(preview.body.pagination.pages, 31); assert.equal(preview.body.reporte.tabla.filas.length, 5);
    });

    await t.test('los registros del servidor no contienen datos personales de los reportes', async () => {
      const output = logs.join('');
      for (const secret of ['Peña', 'Quispe', '01234567', 'jose@ejemplo.test', '987 654 321', 'HYPERLINK']) assert.ok(!output.includes(secret), 'log con ' + secret);
    });
  } finally {
    if (api?.connected) { const exited = new Promise(resolve => api.once('exit', resolve)); api.disconnect(); await exited; }
    await db.end();
    if (apiDir) try { rmSync(apiDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { t.diagnostic('No se pudo retirar la carpeta temporal propia: ' + apiDir); }
  }
});
