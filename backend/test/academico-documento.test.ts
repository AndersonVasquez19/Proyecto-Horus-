import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exigirDocumentoCertificable, normalizarDocumento } from '../src/academico/documento';

// Pruebas puras (sin base de datos ni correo). Todos los documentos son ficticios.

function doc(doc_pais: unknown, doc_tipo: unknown, doc_numero: unknown) {
  return { doc_pais, doc_tipo, doc_numero };
}
function aceptado(entrada: unknown) {
  const r = normalizarDocumento(entrada);
  assert.equal(r.ok, true);
  return r.ok ? r.documento : null;
}
function rechazado(entrada: unknown, codigo: string, campo?: string) {
  const r = normalizarDocumento(entrada);
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.error.codigo, codigo);
    assert.equal(r.error.campo, campo);
  }
}

test('DNI: 8 dígitos válidos', () => {
  assert.deepEqual(aceptado(doc('PE', 'DNI', '12345678')), { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '12345678' });
});

test('DNI: 9 dígitos se rechazan sin truncar; 7 dígitos y letras también', () => {
  rechazado(doc('PE', 'DNI', '123456789'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('PE', 'DNI', '1234567'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('PE', 'DNI', '1234567A'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('PE', 'DNI', ''), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
});

test('DNI: los ceros iniciales se conservan como texto', () => {
  assert.equal(aceptado(doc('PE', 'DNI', '00012345'))?.doc_numero, '00012345');
  assert.equal(aceptado(doc('PE', 'DNI', '00000000'))?.doc_numero, '00000000');
  assert.equal(typeof aceptado(doc('PE', 'DNI', '01234567'))?.doc_numero, 'string');
});

test('CE: de 1 a 12 alfanuméricos ASCII', () => {
  assert.equal(aceptado(doc('PE', 'CE', '1'))?.doc_numero, '1');
  assert.equal(aceptado(doc('PE', 'CE', '000A1B2C3D4E'))?.doc_numero, '000A1B2C3D4E'); // 12
  rechazado(doc('PE', 'CE', '000A1B2C3D4E5'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero'); // 13
  rechazado(doc('PE', 'CE', ''), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('PE', 'CE', 'AB_12'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('PE', 'CE', 'AB.12'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
});

test('PASAPORTE: país de dos letras y número de 1 a 20 alfanuméricos ASCII', () => {
  assert.deepEqual(aceptado(doc('ES', 'PASAPORTE', 'X1234567')), { doc_pais: 'ES', doc_tipo: 'PASAPORTE', doc_numero: 'X1234567' });
  assert.deepEqual(aceptado(doc('PE', 'PASAPORTE', '1')), { doc_pais: 'PE', doc_tipo: 'PASAPORTE', doc_numero: '1' });
  assert.equal(aceptado(doc('US', 'PASAPORTE', 'A'.repeat(20)))?.doc_numero.length, 20);
  rechazado(doc('US', 'PASAPORTE', 'A'.repeat(21)), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('US', 'PASAPORTE', ''), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('USA', 'PASAPORTE', 'X1'), 'DOCUMENTO_PAIS_INVALIDO', 'doc_pais');
  rechazado(doc('U', 'PASAPORTE', 'X1'), 'DOCUMENTO_PAIS_INVALIDO', 'doc_pais');
  rechazado(doc('U1', 'PASAPORTE', 'X1'), 'DOCUMENTO_PAIS_INVALIDO', 'doc_pais');
  rechazado(doc('', 'PASAPORTE', 'X1'), 'DOCUMENTO_PAIS_INVALIDO', 'doc_pais');
});

test('el país PE es obligatorio para DNI y CE', () => {
  for (const tipo of ['DNI', 'CE']) {
    const numero = tipo === 'DNI' ? '12345678' : 'AB123';
    rechazado(doc('ES', tipo, numero), 'DOCUMENTO_PAIS_INVALIDO', 'doc_pais');
    rechazado(doc('', tipo, numero), 'DOCUMENTO_PAIS_INVALIDO', 'doc_pais');
    rechazado(doc('PER', tipo, numero), 'DOCUMENTO_PAIS_INVALIDO', 'doc_pais');
    assert.equal(aceptado(doc('PE', tipo, numero))?.doc_pais, 'PE');
  }
});

test('documento completamente ausente se acepta como null', () => {
  for (const entrada of [undefined, null, {}, doc(null, null, null), doc(undefined, undefined, undefined)]) {
    assert.equal(aceptado(entrada), null);
  }
});

test('documento parcialmente rellenado se rechaza', () => {
  const casos = [doc('PE', null, null), doc(null, 'DNI', null), doc(null, null, '12345678'), doc('PE', 'DNI', null), doc('PE', null, '12345678'), doc(null, 'DNI', '12345678'), { doc_tipo: 'DNI' }, { doc_pais: 'PE', doc_numero: '1' }];
  for (const c of casos) rechazado(c, 'DOCUMENTO_INCOMPLETO');
});

test('una cadena vacía cuenta como valor presente: no equivale a ausente', () => {
  rechazado(doc('', '', ''), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo');
  rechazado(doc('PE', 'DNI', ''), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc(null, null, ''), 'DOCUMENTO_INCOMPLETO');
});

test('un número enviado como number (u otro tipo no texto) se rechaza sin conversión', () => {
  rechazado(doc('PE', 'DNI', 12345678), 'DOCUMENTO_CAMPO_NO_TEXTO', 'doc_numero');
  rechazado(doc('PE', 'DNI', 1234), 'DOCUMENTO_CAMPO_NO_TEXTO', 'doc_numero');
  rechazado(doc('PE', 'DNI', BigInt(12345678)), 'DOCUMENTO_CAMPO_NO_TEXTO', 'doc_numero');
  rechazado(doc('PE', 'DNI', ['12345678']), 'DOCUMENTO_CAMPO_NO_TEXTO', 'doc_numero');
  rechazado(doc('PE', 'DNI', { toString: () => '12345678' }), 'DOCUMENTO_CAMPO_NO_TEXTO', 'doc_numero');
  rechazado(doc('PE', 'DNI', true), 'DOCUMENTO_CAMPO_NO_TEXTO', 'doc_numero');
  rechazado(doc(['PE'], 'DNI', '12345678'), 'DOCUMENTO_CAMPO_NO_TEXTO', 'doc_pais');
  rechazado(doc('PE', 1, '12345678'), 'DOCUMENTO_CAMPO_NO_TEXTO', 'doc_tipo');
});

test('tipos desconocidos se rechazan', () => {
  rechazado(doc('PE', 'LIBRETA', '12345678'), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo');
  rechazado(doc('PE', 'DN I', '12345678'), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo'); // solo se recortan los extremos
  rechazado(doc('P E', 'PASAPORTE', 'X1'), 'DOCUMENTO_PAIS_INVALIDO', 'doc_pais');
});

test('entradas que no son objeto', () => {
  for (const entrada of ['12345678', 12345678, true, ['PE', 'DNI', '12345678']]) rechazado(entrada, 'DOCUMENTO_FORMATO_INVALIDO');
});

test('Unicode problemático se rechaza (nunca se transforma en ASCII admitido)', () => {
  const numeros = [
    '１２３４５６７８', // dígitos de ancho completo (NFKC → ASCII)
    '٠١٢٣٤٥٦٧', // dígitos arábigo-índicos
    '1234567 ', // espacio de no separación
    '1234–5678', // guion en «en»
    '1234−5678', // signo menos
    '1234​5678', // espacio de ancho cero
    '12345678́', // marca combinante
    '12345678\n',
    '12345678\t',
    '‮12345678', // control de dirección
  ];
  for (const n of numeros) rechazado(doc('PE', 'DNI', n), 'DOCUMENTO_CARACTERES_INVALIDOS', 'doc_numero');
  // Mayúsculas que mutan al pasar por toUpperCase(): ß → SS, ı → I, ſ → S, ﬁ → FI, ÿ/ñ fuera de ASCII.
  for (const n of ['ßß', 'ı23', 'ſ23', 'ﬁ23', 'ñ23', 'Ａ23']) rechazado(doc('PE', 'CE', n), 'DOCUMENTO_CARACTERES_INVALIDOS', 'doc_numero');
  for (const p of ['ſE', 'ıE', 'ÑE', 'ＵＳ', 'ß']) rechazado(doc(p, 'PASAPORTE', 'X1'), 'DOCUMENTO_CARACTERES_INVALIDOS', 'doc_pais');
  for (const t of ['ＤＮＩ', 'dnı', 'ſ']) rechazado(doc('PE', t, '12345678'), 'DOCUMENTO_CARACTERES_INVALIDOS', 'doc_tipo');
  rechazado(doc('PE', 'DNI', '1234567\u0000'), 'DOCUMENTO_CARACTERES_INVALIDOS', 'doc_numero');
});

test('espacios, guiones y mayúsculas se normalizan de forma controlada', () => {
  assert.deepEqual(aceptado(doc(' pe ', ' dni ', ' 1234 5678 ')), { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '12345678' });
  assert.deepEqual(aceptado(doc('pe', 'ce', 'ab-12 cd')), { doc_pais: 'PE', doc_tipo: 'CE', doc_numero: 'AB12CD' });
  assert.deepEqual(aceptado(doc('es', 'Pasaporte', 'x-123-456')), { doc_pais: 'ES', doc_tipo: 'PASAPORTE', doc_numero: 'X123456' });
  assert.equal(aceptado(doc('PE', 'DNI', '0001-2345'))?.doc_numero, '00012345');
  // Normalizar no relaja los límites: los separadores no cuentan, pero 9 dígitos siguen siendo 9.
  rechazado(doc('PE', 'DNI', '1234-56789'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  // Un número que queda vacío tras quitar separadores se rechaza.
  rechazado(doc('PE', 'CE', ' - - '), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  // Los guiones no se quitan del país ni del tipo.
  rechazado(doc('P-E', 'DNI', '12345678'), 'DOCUMENTO_PAIS_INVALIDO', 'doc_pais');
  rechazado(doc('PE', 'D-NI', '12345678'), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo');
});

test('los errores no exponen los datos recibidos', () => {
  const secreto = '98765432X';
  const r = normalizarDocumento(doc('PE', 'DNI', secreto));
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && !JSON.stringify(r.error).includes(secreto));
  const u = normalizarDocumento(doc('PE', 'DNI', '９８７６５４３２'));
  assert.ok(u.ok === false && !JSON.stringify(u.error).includes('９'));
});

test('no se leen propiedades heredadas ni se modifica la entrada', () => {
  const heredada = Object.create(doc('PE', 'DNI', '12345678'));
  assert.equal(aceptado(heredada), null);
  const entrada = Object.freeze(doc(' pe ', 'dni', '1234-5678'));
  assert.deepEqual(aceptado(entrada), { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '12345678' });
  assert.equal(entrada.doc_numero, '1234-5678');
});

test('exigirDocumentoCertificable: rechaza estudiantes sin documento', () => {
  for (const e of [undefined, null, {}, doc(null, null, null), { nombres: 'Ana', apellidos: 'Ficticia' }]) {
    const r = exigirDocumentoCertificable(e);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error.codigo, 'DOCUMENTO_REQUERIDO');
  }
});

test('exigirDocumentoCertificable: acepta el válido, rechaza parciales o inválidos y propaga el error', () => {
  const ok = exigirDocumentoCertificable({ nombres: 'Ana', ...doc('PE', 'DNI', '00012345') });
  assert.deepEqual(ok, { ok: true, documento: { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '00012345' } });
  const parcial = exigirDocumentoCertificable(doc('PE', 'DNI', null));
  assert.equal(parcial.ok === false && parcial.error.codigo, 'DOCUMENTO_INCOMPLETO');
  const invalido = exigirDocumentoCertificable(doc('PE', 'DNI', '123456789'));
  assert.equal(invalido.ok === false && invalido.error.codigo, 'DOCUMENTO_NUMERO_INVALIDO');
});

// ---------------------------------------------------------------------------------------------------------------------
// Paridad con las restricciones CHECK de la migración E4.2. En lugar de comparar texto, se analiza la expresión SQL con un
// intérprete mínimo (AND/OR, IS [NOT] NULL, =, REGEXP_LIKE con lógica de tres valores como MySQL) y se evalúa sobre un
// corpus amplio de filas, comparando con el resultado de normalizarDocumento. Cualquier construcción SQL no reconocida
// hace fallar la prueba en vez de ignorarse.
//
// Limitaciones del intérprete (no sustituye a MySQL):
//  - REGEXP_LIKE se evalúa con RegExp de JavaScript, mientras que MySQL 8.4 usa ICU. Solo se admite un subconjunto cuyo
//    significado coincide: anclas ^ y $, clases [..] con rangos, cuantificadores {m} y {m,n} y letras/dígitos literales. Todo lo
//    demás (\, ., *, +, ?, |, grupos, etc.) se RECHAZA en vez de interpretarse por aproximación.
//  - Los literales con barra invertida se rechazan. MySQL aplica escapes de cadena (\d vale «d», \\d vale «\d», \n es un salto de
//    línea) y RegExp no: interpretarlos mal aprobaría un SQL distinto del real. Tampoco se admiten comillas dobles ni NO_BACKSLASH_ESCAPES.
//  - Diferencias conocidas sin verificar aquí: en ICU «$» puede coincidir antes de un terminador de línea final (p. ej. «12345678\n»),
//    y RegExp opera por unidades UTF-16 mientras ICU lo hace por puntos de código. El corpus no cubre esos casos; solo la prueba de
//    integración con MySQL 8.4 real puede confirmarlos.
//  - Una sola migración o un SQL concatenado: ante varias definiciones de una restricción o del ENUM, rige la última; si la última
//    operación es un DROP, la restricción no existe y la prueba falla.
// ---------------------------------------------------------------------------------------------------------------------

type Valor = string | boolean | null;
type Nodo =
  | { k: 'col'; nombre: string }
  | { k: 'str'; valor: string }
  | { k: 'esnulo'; col: string; negado: boolean }
  | { k: 'igual'; col: string; valor: string }
  | { k: 'regex'; col: string; patron: string; flags: string }
  | { k: 'y' | 'o'; a: Nodo; b: Nodo };

function tokenizar(sql: string): string[] {
  const tokens: string[] = [];
  const re = /\s*(`[^`]*`|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_]*|[(),=])/gy;
  let pos = 0;
  while (pos < sql.length) {
    re.lastIndex = pos;
    const m = re.exec(sql);
    if (!m) {
      if (sql.slice(pos).trim() === '') break;
      throw new Error('token SQL no reconocido en la expresión CHECK');
    }
    // MySQL interpreta los escapes de cadena (\d → d, \n → salto de línea) y aquí no: se rechaza en lugar de aprobar en falso.
    if (m[1].startsWith("'") && m[1].includes('\\')) throw new Error('literal SQL con barra invertida no soportado por la prueba de paridad');
    tokens.push(m[1]);
    pos = re.lastIndex;
  }
  return tokens;
}

function analizar(expresion: string): Nodo {
  const t = tokenizar(expresion);
  let i = 0;
  const peek = () => t[i];
  const kw = (palabra: string) => t[i]?.toUpperCase() === palabra;
  const esperar = (s: string) => {
    if (t[i]?.toUpperCase() !== s) throw new Error(`se esperaba ${s}`);
    i++;
  };
  const columna = (): string => {
    const x = t[i++];
    if (!x || !x.startsWith('`')) throw new Error('se esperaba una columna');
    return x.slice(1, -1);
  };
  const cadena = (): string => {
    const x = t[i++];
    if (!x || !x.startsWith("'")) throw new Error('se esperaba una cadena');
    return x.slice(1, -1).replace(/''/g, "'");
  };
  const primario = (): Nodo => {
    if (peek() === '(') {
      i++;
      const n = o();
      esperar(')');
      return n;
    }
    if (kw('REGEXP_LIKE')) {
      i++;
      esperar('(');
      const col = columna();
      esperar(',');
      const patron = cadena();
      if (!/^[\^$[\]{},\-A-Za-z0-9]+$/.test(patron)) throw new Error('patrón REGEXP_LIKE fuera del subconjunto soportado por la prueba de paridad');
      esperar(',');
      const flags = cadena();
      esperar(')');
      return { k: 'regex', col, patron, flags };
    }
    const col = columna();
    if (kw('IS')) {
      i++;
      let negado = false;
      if (kw('NOT')) {
        i++;
        negado = true;
      }
      esperar('NULL');
      return { k: 'esnulo', col, negado };
    }
    if (peek() === '=') {
      i++;
      return { k: 'igual', col, valor: cadena() };
    }
    throw new Error('construcción SQL no soportada por la prueba de paridad');
  };
  const y = (): Nodo => {
    let n = primario();
    while (kw('AND')) {
      i++;
      n = { k: 'y', a: n, b: primario() };
    }
    return n;
  };
  const o = (): Nodo => {
    let n = y();
    while (kw('OR')) {
      i++;
      n = { k: 'o', a: n, b: y() };
    }
    return n;
  };
  const raiz = o();
  if (i !== t.length) throw new Error('sobran tokens en la expresión CHECK');
  return raiz;
}

function evaluar(n: Nodo, fila: Record<string, string | null>): Valor {
  switch (n.k) {
    case 'esnulo':
      return (fila[n.col] === null) !== n.negado;
    case 'igual':
      return fila[n.col] === null ? null : fila[n.col] === n.valor; // sensibilidad a mayúsculas: el tipo ya viene validado por el ENUM
    case 'regex': {
      if (n.flags !== 'c') throw new Error('REGEXP_LIKE debe distinguir mayúsculas (bandera c)');
      return fila[n.col] === null ? null : new RegExp(n.patron).test(fila[n.col]);
    }
    case 'y': {
      const a = evaluar(n.a, fila);
      const b = evaluar(n.b, fila);
      return a === false || b === false ? false : a === null || b === null ? null : true;
    }
    case 'o': {
      const a = evaluar(n.a, fila);
      const b = evaluar(n.b, fila);
      return a === true || b === true ? true : a === null || b === null ? null : false;
    }
    default:
      throw new Error('nodo no evaluable');
  }
}

// MySQL acepta la fila si CHECK no da FALSE (NULL cuenta como aprobado).
const cumple = (nodo: Nodo, fila: Record<string, string | null>) => evaluar(nodo, fila) !== false;

// Esquema efectivo: manda la última operación sobre la restricción (CONSTRAINT .. CHECK o DROP CHECK/CONSTRAINT).
function extraerCheck(sql: string, nombre: string): string {
  const definicion = `CONSTRAINT \`${nombre}\` CHECK (`;
  const inicio = sql.lastIndexOf(definicion);
  assert.notEqual(inicio, -1, `no se encontró la restricción ${nombre}`);
  const baja = [...sql.matchAll(new RegExp(`DROP\\s+(?:CHECK|CONSTRAINT)\\s+\`${nombre}\``, 'gi'))].pop();
  assert.ok(!baja || baja.index < inicio, `la restricción ${nombre} se elimina sin redefinirse`);
  let i = sql.indexOf('(', inicio);
  const desde = i + 1;
  let profundidad = 0;
  let enCadena = false;
  for (; i < sql.length; i++) {
    const c = sql[i];
    if (enCadena && c === '\\') throw new Error('literal SQL con barra invertida no soportado por la prueba de paridad');
    if (c === "'") enCadena = !enCadena;
    if (enCadena) continue;
    if (c === '(') profundidad++;
    if (c === ')' && --profundidad === 0) return sql.slice(desde, i);
  }
  throw new Error(`restricción ${nombre} sin cierre`);
}

const MIGRACION = '20261015-academico-estructura.sql';
const sqlOriginal = readFileSync(join(__dirname, '..', 'migrations', MIGRACION), 'utf8');

function enumTipos(sql: string): string[] {
  const m = [...sql.matchAll(/`doc_tipo` ENUM\(([^)]*)\)/g)].pop(); // la última definición (CREATE o MODIFY) es la efectiva
  assert.ok(m, 'no se encontró el ENUM de doc_tipo');
  return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
}

const PAISES: (string | null)[] = [null, 'PE', 'pe', 'Pe', 'ES', 'US', 'ZZ', 'P', 'PER', 'P1', '1E', 'ÑE', 'PE ', ' PE', '', 'P-', 'ＰＥ'];
const TIPOS: (string | null)[] = [null, 'DNI', 'CE', 'PASAPORTE', 'dni', 'LIBRETA', ''];
const NUMEROS: (string | null)[] = (() => {
  const base: (string | null)[] = [null, '', '0', '1', '00000000', '00012345', '12345678', '012345678', '123456789', '1234567', 'A', 'a', 'AB123', 'ab123', 'AB-12', 'AB 12', 'AB_12', 'Ñ1234567', '１２３４５６７８', 'ABCDEFGHIJKL', 'X1234567', '12345678 ', ' 12345678'];
  for (let n = 1; n <= 23; n++) base.push('7'.repeat(n), 'A'.repeat(n), 'a'.repeat(n), '0'.repeat(n));
  return base;
})();

type Fila = { doc_pais: string | null; doc_tipo: string | null; doc_numero: string | null };
function corpus(): Fila[] {
  const filas: Fila[] = [];
  for (const doc_pais of PAISES) for (const doc_tipo of TIPOS) for (const doc_numero of NUMEROS) filas.push({ doc_pais, doc_tipo, doc_numero });
  return filas;
}

// Devuelve las discrepancias entre el SQL dado y normalizarDocumento (vacío = paridad completa).
function discrepancias(sql: string): string[] {
  const tipos = enumTipos(sql);
  const completo = analizar(extraerCheck(sql, 'estudiantes_documento_completo_chk'));
  const formato = analizar(extraerCheck(sql, 'estudiantes_documento_formato_chk'));
  const certificado = analizar(extraerCheck(sql, 'certificados_documento_chk'));
  const problemas: string[] = [];
  let aceptadasSql = 0;
  let rechazadasSql = 0;

  for (const fila of corpus()) {
    const etiqueta = JSON.stringify(fila);
    const enumOk = fila.doc_tipo === null || tipos.includes(fila.doc_tipo);
    const sqlAcepta = enumOk && cumple(completo, fila) && cumple(formato, fila);
    sqlAcepta ? aceptadasSql++ : rechazadasSql++;
    const ts = normalizarDocumento(fila);

    if (sqlAcepta) {
      // Lo que MySQL acepta tal cual, el servicio lo acepta sin cambiarlo.
      const esperado = fila.doc_tipo === null ? null : { doc_pais: fila.doc_pais, doc_tipo: fila.doc_tipo, doc_numero: fila.doc_numero };
      if (!(ts.ok && JSON.stringify(ts.documento) === JSON.stringify(esperado))) problemas.push(`SQL acepta y TS no: ${etiqueta}`);
    }
    if (ts.ok && ts.documento) {
      const n = { doc_pais: ts.documento.doc_pais, doc_tipo: ts.documento.doc_tipo, doc_numero: ts.documento.doc_numero };
      // Lo que el servicio entrega ya normalizado, MySQL lo acepta (en estudiantes y en el snapshot del certificado).
      if (!(tipos.includes(n.doc_tipo) && cumple(completo, n) && cumple(formato, n))) problemas.push(`TS entrega algo que estudiantes rechaza: ${etiqueta}`);
      const snap = { estudiante_doc_pais: n.doc_pais, estudiante_doc_tipo: n.doc_tipo, estudiante_doc_numero: n.doc_numero };
      if (!cumple(certificado, snap)) problemas.push(`TS entrega algo que certificados rechaza: ${etiqueta}`);
      if (JSON.stringify(n) === JSON.stringify(fila) && !sqlAcepta) problemas.push(`TS acepta sin cambios y SQL no: ${etiqueta}`);
    }
    if (ts.ok && ts.documento === null && !(fila.doc_pais === null && fila.doc_tipo === null && fila.doc_numero === null)) problemas.push(`TS toma por ausente una fila con datos: ${etiqueta}`);
  }

  // Certificados: mismas reglas de formato sobre los campos del snapshot (todos obligatorios).
  for (const fila of corpus()) {
    if (fila.doc_pais === null || fila.doc_tipo === null || fila.doc_numero === null) continue;
    const snap = { estudiante_doc_pais: fila.doc_pais, estudiante_doc_tipo: fila.doc_tipo, estudiante_doc_numero: fila.doc_numero };
    const sqlAcepta = tipos.includes(fila.doc_tipo) && cumple(certificado, snap);
    const ts = normalizarDocumento(fila);
    const tsSinCambios = ts.ok && ts.documento !== null && JSON.stringify(ts.documento) === JSON.stringify(fila);
    if (sqlAcepta !== tsSinCambios) problemas.push(`certificados y TS difieren: ${JSON.stringify(fila)}`);
  }

  // Salvaguarda contra una prueba vacía: el corpus debe contener ambos resultados.
  if (aceptadasSql < 50 || rechazadasSql < 500) problemas.push('el corpus no ejerce suficientes casos aceptados y rechazados');
  return problemas;
}

test('paridad: el SQL de la migración E4.2 y normalizarDocumento aceptan y rechazan lo mismo', () => {
  assert.deepEqual(enumTipos(sqlOriginal), ['DNI', 'CE', 'PASAPORTE']);
  assert.deepEqual(discrepancias(sqlOriginal), []);
});

test('paridad: la prueba detecta reglas SQL alteradas incorrectamente', () => {
  const mutar = (de: string, a: string) => {
    const partes = sqlOriginal.split(de);
    assert.ok(partes.length > 1, `la mutación «${de}» no encuentra su objetivo`);
    return partes.join(a); // sustituye todas las apariciones (estudiantes y certificados)
  };
  const mutaciones: [string, string][] = [
    ['^[0-9]{8}$', '^[0-9]{9}$'],
    ['^[0-9]{8}$', '^[0-9]{7,8}$'],
    ['^[A-Z0-9]{1,12}$', '^[A-Z0-9]{1,13}$'],
    ['^[A-Z0-9]{1,12}$', '^[A-Z0-9]{0,12}$'],
    ['^[A-Z0-9]{1,20}$', '^[A-Z0-9]{1,19}$'],
    ['^[A-Z]{2}$', '^[A-Z]{2,3}$'],
    ['^[A-Z]{2}$', '^[A-Za-z]{2}$'],
    ['^PE$', '^[A-Z]{2}$'],
    ['^[0-9]{8}$', '^[0-9]{8}'],
    ["'^PE$', 'c'", "'^PE$', 'i'"],
    ['^[0-9]{8}$', '^\\d{8}$'], // una sola barra invertida (en MySQL «\d» vale «d»): antes se aprobaba en falso
  ];
  for (const [de, a] of mutaciones) {
    let alterado: string;
    try {
      alterado = mutar(de, a);
    } catch (e) {
      assert.fail(String(e));
    }
    let detectado: boolean;
    try {
      detectado = discrepancias(alterado).length > 0;
    } catch {
      detectado = true; // una construcción irreconocible también hace fallar la paridad
    }
    assert.ok(detectado, `la paridad no detectó la alteración ${de} → ${a}`);
  }
  // También se detecta que desaparezca la restricción de «todo o nada».
  const sinCompleto = sqlOriginal.replace('(`doc_pais` IS NOT NULL AND `doc_tipo` IS NOT NULL AND `doc_numero` IS NOT NULL))', '(`doc_pais` IS NOT NULL))');
  assert.notEqual(sinCompleto, sqlOriginal);
  assert.ok(discrepancias(sinCompleto).length > 0);
});

test('paridad: los literales SQL con barra invertida se rechazan de forma explícita', () => {
  const reemplazar = (a: string) => sqlOriginal.split('^[0-9]{8}$').join(a);
  // Una barra (\d), dos barras (\\d), una comilla escapada (\') y un escape de control (\n): ninguno se interpreta ni se ignora.
  for (const a of ['^\\d{8}$', '^\\\\d{8}$', "^\\'{8}$", '^\\n{8}$']) {
    assert.notEqual(reemplazar(a), sqlOriginal);
    assert.throws(() => discrepancias(reemplazar(a)), /barra invertida|fuera del subconjunto/, `se aceptó el literal ${a}`);
  }
});

test('paridad: los patrones fuera del subconjunto soportado se rechazan', () => {
  for (const a of ['^.{8}$', '^[0-9]+$', '^(?:[0-9]{8})$', '^[0-9]{8}|x$']) {
    assert.throws(() => discrepancias(sqlOriginal.split('^[0-9]{8}$').join(a)), /fuera del subconjunto/, `se aceptó el patrón ${a}`);
  }
});

test('paridad: sobre un SQL concatenado rige la última definición; un DROP sin redefinición falla', () => {
  const redefinir = `\nALTER TABLE \`certificados\` DROP CHECK \`certificados_documento_chk\`;\nALTER TABLE \`certificados\` ADD CONSTRAINT \`certificados_documento_chk\` CHECK (\`estudiante_doc_tipo\` = 'DNI' AND REGEXP_LIKE(\`estudiante_doc_pais\`, '^PE$', 'c') AND REGEXP_LIKE(\`estudiante_doc_numero\`, '^[0-9]{9}$', 'c'));\n`;
  assert.ok(discrepancias(sqlOriginal + redefinir).length > 0, 'debe verse la definición posterior, no la original');
  assert.throws(() => discrepancias(`${sqlOriginal}\nALTER TABLE \`certificados\` DROP CHECK \`certificados_documento_chk\`;\n`), /se elimina sin redefinirse/);
  assert.deepEqual(discrepancias(sqlOriginal + '\n-- sin cambios\n'), []);
});
