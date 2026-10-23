import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIPOS_DOCUMENTO, exigirDocumentoCertificable, normalizarDocumento } from '../src/academico/documento';

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

test('solo se admite el tipo DNI', () => {
  assert.deepEqual([...TIPOS_DOCUMENTO], ['DNI']);
});

test('DNI: 8 dígitos válidos', () => {
  assert.deepEqual(aceptado(doc('PE', 'DNI', '12345678')), { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '12345678' });
});

test('DNI: 9 dígitos se rechazan sin truncar; 7 dígitos, letras y vacío también', () => {
  rechazado(doc('PE', 'DNI', '123456789'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('PE', 'DNI', '1234567'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('PE', 'DNI', '1234567A'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('PE', 'DNI', 'ABCDEFGH'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('PE', 'DNI', ''), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  rechazado(doc('PE', 'DNI', '1'.repeat(20)), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
});

test('DNI: los ceros iniciales se conservan como texto', () => {
  assert.equal(aceptado(doc('PE', 'DNI', '00012345'))?.doc_numero, '00012345');
  assert.equal(aceptado(doc('PE', 'DNI', '00000000'))?.doc_numero, '00000000');
  assert.equal(typeof aceptado(doc('PE', 'DNI', '01234567'))?.doc_numero, 'string');
});

test('CE y PASAPORTE se rechazan aunque su formato fuera válido antes (E4.2)', () => {
  rechazado(doc('PE', 'CE', 'AB123'), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo');
  rechazado(doc('PE', 'CE', '12345678'), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo'); // con un número que sería un DNI válido
  rechazado(doc('PE', 'CE', '000A1B2C3D4E'), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo');
  rechazado(doc('ES', 'PASAPORTE', 'X1234567'), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo');
  rechazado(doc('PE', 'PASAPORTE', '12345678'), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo');
  // También en minúsculas o con espacios en los extremos (la normalización no los convierte en DNI).
  rechazado(doc('pe', 'ce', 'ab123'), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo');
  rechazado(doc(' es ', ' Pasaporte ', 'x-123'), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo');
  const r = exigirDocumentoCertificable(doc('PE', 'CE', '12345678'));
  assert.equal(r.ok === false && r.error.codigo, 'DOCUMENTO_TIPO_INVALIDO');
  assert.equal(r.ok === false && r.error.mensaje, 'El único tipo de documento admitido es DNI.');
});

test('el país PE es obligatorio para un documento presente', () => {
  for (const pais of ['ES', 'US', '', 'PER', 'P', 'P1', 'PE1']) rechazado(doc(pais, 'DNI', '12345678'), 'DOCUMENTO_PAIS_INVALIDO', 'doc_pais');
  rechazado(doc(null, 'DNI', '12345678'), 'DOCUMENTO_INCOMPLETO');
  assert.equal(aceptado(doc('PE', 'DNI', '12345678'))?.doc_pais, 'PE');
  assert.equal(aceptado(doc('pe', 'DNI', '12345678'))?.doc_pais, 'PE');
});

test('documento completamente ausente se acepta como null', () => {
  for (const entrada of [undefined, null, {}, doc(null, null, null), doc(undefined, undefined, undefined)]) {
    assert.equal(aceptado(entrada), null);
  }
});

test('documento parcialmente rellenado se rechaza', () => {
  const casos = [doc('PE', null, null), doc(null, 'DNI', null), doc(null, null, '12345678'), doc('PE', 'DNI', null), doc('PE', null, '12345678'), doc(null, 'DNI', '12345678'), { doc_tipo: 'DNI' }, { doc_pais: 'PE', doc_numero: '1' }, doc(null, 'CE', 'AB123')];
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
  rechazado(doc('PE', 'DNI', 1234567), 'DOCUMENTO_CAMPO_NO_TEXTO', 'doc_numero'); // un DNI con cero inicial perdido al pasarlo a number
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
  rechazado(doc('PE', 'DNIE', '12345678'), 'DOCUMENTO_TIPO_INVALIDO', 'doc_tipo');
  rechazado(doc('P E', 'DNI', '12345678'), 'DOCUMENTO_PAIS_INVALIDO', 'doc_pais');
});

test('entradas que no son objeto', () => {
  for (const entrada of ['12345678', 12345678, true, ['PE', 'DNI', '12345678']]) rechazado(entrada, 'DOCUMENTO_FORMATO_INVALIDO');
});

test('Unicode problemático y terminadores de línea se rechazan (nunca se transforman en ASCII admitido)', () => {
  const numeros = [
    '１２３４５６７８', // dígitos de ancho completo (NFKC → ASCII)
    '٠١٢٣٤٥٦٧', // dígitos arábigo-índicos
    '1234567 ', // espacio de no separación
    '1234–5678', // guion en «en»
    '1234−5678', // signo menos
    '1234​5678', // espacio de ancho cero
    '12345678́', // marca combinante
    '‮12345678', // control de dirección
    // Terminadores que el «$» de MySQL (ICU) deja pasar al final de '^[0-9]{8}$' (comprobado en MySQL 8.4).
    '12345678\n', '12345678\r', '12345678\r\n', '12345678\u0085', '12345678\u2028', '12345678\u2029', '12345678\v', '12345678\f',
    '1234567\n', '\n12345678', '12345678\t',
  ];
  for (const n of numeros) rechazado(doc('PE', 'DNI', n), 'DOCUMENTO_CARACTERES_INVALIDOS', 'doc_numero');
  // Mayúsculas que mutan al pasar por toUpperCase(): ß → SS, ı → I, ſ → S, ﬁ → FI; ñ/Ａ fuera de ASCII.
  for (const p of ['ſE', 'ıE', 'ÑE', 'ＰＥ', 'ß', 'PE\n']) rechazado(doc(p, 'DNI', '12345678'), 'DOCUMENTO_CARACTERES_INVALIDOS', 'doc_pais');
  for (const t of ['ＤＮＩ', 'dnı', 'ſ', 'DNI\n']) rechazado(doc('PE', t, '12345678'), 'DOCUMENTO_CARACTERES_INVALIDOS', 'doc_tipo');
  rechazado(doc('PE', 'DNI', '1234567\u0000'), 'DOCUMENTO_CARACTERES_INVALIDOS', 'doc_numero');
});

test('espacios, guiones y mayúsculas se normalizan de forma controlada', () => {
  assert.deepEqual(aceptado(doc(' pe ', ' dni ', ' 1234 5678 ')), { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '12345678' });
  assert.deepEqual(aceptado(doc('pe', 'Dni', '0001-2345')), { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '00012345' });
  // Normalizar no relaja los límites: los separadores no cuentan, pero 9 dígitos siguen siendo 9.
  rechazado(doc('PE', 'DNI', '1234-56789'), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
  // Un número que queda vacío tras quitar separadores se rechaza.
  rechazado(doc('PE', 'DNI', ' - - '), 'DOCUMENTO_NUMERO_INVALIDO', 'doc_numero');
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
  const ce = normalizarDocumento(doc('PE', 'CE', 'ZX98765'));
  assert.ok(ce.ok === false && !JSON.stringify(ce.error).includes('ZX98765'));
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

test('exigirDocumentoCertificable: acepta el DNI completo, rechaza parciales, otros tipos o inválidos y propaga el error', () => {
  const ok = exigirDocumentoCertificable({ nombres: 'Ana', ...doc('PE', 'DNI', '00012345') });
  assert.deepEqual(ok, { ok: true, documento: { doc_pais: 'PE', doc_tipo: 'DNI', doc_numero: '00012345' } });
  const parcial = exigirDocumentoCertificable(doc('PE', 'DNI', null));
  assert.equal(parcial.ok === false && parcial.error.codigo, 'DOCUMENTO_INCOMPLETO');
  const invalido = exigirDocumentoCertificable(doc('PE', 'DNI', '123456789'));
  assert.equal(invalido.ok === false && invalido.error.codigo, 'DOCUMENTO_NUMERO_INVALIDO');
  const pasaporte = exigirDocumentoCertificable(doc('FR', 'PASAPORTE', '24AB12345'));
  assert.equal(pasaporte.ok === false && pasaporte.error.codigo, 'DOCUMENTO_TIPO_INVALIDO');
});

// ---------------------------------------------------------------------------------------------------------------------
// Paridad con el esquema EFECTIVO de MySQL. Se recorre la sucesión real de migraciones (lista `versions` de migrate.cjs desde
// 20261015-academico-estructura) sentencia a sentencia, como migrate.cjs, y se construye el modelo de las tablas con documento
// (estudiantes y certificados): ENUM de tipo y restricciones CHECK vigentes. Cada sentencia que afecte a esas tablas debe tener
// una forma reconocida (CREATE TABLE IF NOT EXISTS; ALTER TABLE con DROP CHECK, ADD CONSTRAINT .. CHECK o MODIFY .. ENUM); una
// sintaxis desconocida hace fallar la prueba en vez de ignorarse. Las expresiones CHECK que leen columnas de documento se analizan
// con un intérprete mínimo (AND/OR, IS [NOT] NULL, =, REGEXP_LIKE y CHAR_LENGTH con la lógica de tres valores de MySQL) y se
// evalúan sobre un corpus amplio, comparando con normalizarDocumento.
//
// Limitaciones del intérprete (no sustituye a MySQL):
//  - REGEXP_LIKE se evalúa con RegExp de JavaScript, mientras que MySQL 8.4 usa ICU. Solo se admite un subconjunto cuyo
//    significado coincide: anclas ^ y $, clases [..] con rangos, cuantificadores {m} y {m,n} y letras/dígitos literales. Todo lo
//    demás (\, ., *, +, ?, |, grupos, etc.) se RECHAZA en vez de interpretarse por aproximación.
//  - Diferencia de «$» emulada: en ICU «$» coincide también antes de un terminador de línea final (\n, \r, \r\n, \v, \f, U+0085,
//    U+2028, U+2029), y así lo hace aquí el evaluador. Se comprobó en MySQL 8.4.11 real (el CHECK de E4.2 aceptaba «12345678\n»);
//    test/academico-schema.integration.cjs lo verifica contra MySQL. RegExp opera por unidades UTF-16 e ICU por puntos de código:
//    con el subconjunto admitido (solo ASCII) no cambia el resultado.
//  - Los literales con barra invertida se rechazan. MySQL aplica escapes de cadena (\d vale «d», \\d vale «\d», \n es un salto de
//    línea) y RegExp no: interpretarlos mal aprobaría un SQL distinto del real. Tampoco se admiten comillas dobles ni NO_BACKSLASH_ESCAPES.
//  - El ENUM se compara de forma exacta (MySQL lo compara con la colación de la columna: 'dni' se guarda como 'DNI'); en modo no
//    estricto un valor fuera del ENUM se guarda como '' y los CHECK deben rechazarlo, lo que también se evalúa.
// ---------------------------------------------------------------------------------------------------------------------

type Valor = string | boolean | null;
type Nodo =
  | { k: 'esnulo'; col: string; negado: boolean }
  | { k: 'igual'; col: string; valor: string }
  | { k: 'regex'; col: string; patron: string; flags: string }
  | { k: 'longitud'; col: string; n: number }
  | { k: 'y' | 'o'; a: Nodo; b: Nodo };

const BARRA = 'literal SQL con barra invertida no soportado por la prueba de paridad';

function tokenizar(sql: string): string[] {
  const tokens: string[] = [];
  const re = /\s*(`[^`]*`|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[(),=])/gy;
  let pos = 0;
  while (pos < sql.length) {
    re.lastIndex = pos;
    const m = re.exec(sql);
    if (!m) {
      if (sql.slice(pos).trim() === '') break;
      throw new Error('token SQL no reconocido en la expresión CHECK');
    }
    // MySQL interpreta los escapes de cadena (\d → d, \n → salto de línea) y aquí no: se rechaza en lugar de aprobar en falso.
    if (m[1].startsWith("'") && m[1].includes('\\')) throw new Error(BARRA);
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
    if (kw('CHAR_LENGTH')) {
      i++;
      esperar('(');
      const col = columna();
      esperar(')');
      esperar('=');
      const x = t[i++];
      if (!x || !/^[0-9]+$/.test(x)) throw new Error('CHAR_LENGTH debe compararse con un entero');
      return { k: 'longitud', col, n: Number(x) };
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

// Terminador de línea final ante el que «$» de ICU también coincide.
const TERMINADOR_FINAL = /(?:\r\n|[\n\v\f\r\u0085\u2028\u2029])$/;

function evaluar(n: Nodo, fila: Record<string, string | null>): Valor {
  switch (n.k) {
    case 'esnulo':
      return (fila[n.col] === null) !== n.negado;
    case 'igual':
      return fila[n.col] === null ? null : fila[n.col] === n.valor; // el tipo llega ya filtrado por el ENUM (o como '' en modo no estricto)
    case 'regex': {
      // Solo se interpretan 'c' (distingue mayúsculas) e 'i' (no las distingue); cualquier otra bandera se rechaza.
      if (n.flags !== 'c' && n.flags !== 'i') throw new Error('bandera de REGEXP_LIKE no soportada por la prueba de paridad');
      const v = fila[n.col];
      if (v === null) return null;
      const re = new RegExp(n.patron, n.flags === 'i' ? 'i' : '');
      return re.test(v) || (n.patron.endsWith('$') && TERMINADOR_FINAL.test(v) && re.test(v.replace(TERMINADOR_FINAL, '')));
    }
    case 'longitud': {
      const v = fila[n.col];
      return v === null ? null : [...v].length === n.n; // CHAR_LENGTH cuenta caracteres (puntos de código en utf8mb4)
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

// MySQL acepta la fila si ningún CHECK da FALSE (NULL cuenta como aprobado).
const cumplen = (nodos: Nodo[], fila: Record<string, string | null>) => nodos.every(nodo => evaluar(nodo, fila) !== false);
// Modo estricto: cada valor cabe en su columna (en modo no estricto MySQL lo truncaría; eso no se modela).
const caben = (tabla: Tabla, fila: Record<string, string | null>) =>
  Object.entries(fila).every(([col, v]) => v === null || tabla.columnas[col] == null || [...v].length <= (tabla.columnas[col] as number));

// --- Modelo del esquema efectivo a partir de la sucesión de migraciones -------------------------------------------------
// columnas: longitud máxima de CHAR(n)/VARCHAR(n) (null en las demás). En modo estricto MySQL rechaza un valor más largo (1406).
type Tabla = { enums: Record<string, { valores: string[]; nulo: boolean }>; columnas: Record<string, number | null>; checks: Record<string, string> };
type Modelo = Record<string, Tabla>;
// docentes (20261020) guarda el mismo documento opcional que estudiantes: se modela para exigir que su regla sea idéntica.
const TABLAS_DOCUMENTO = ['estudiantes', 'certificados', 'docentes'];

// Contenido entre el paréntesis de apertura en `desde` y su cierre; devuelve también la posición del cierre.
function parentesis(texto: string, desde: number): { dentro: string; fin: number } {
  if (texto[desde] !== '(') throw new Error('se esperaba un paréntesis');
  let profundidad = 0;
  let comilla: string | null = null;
  for (let i = desde; i < texto.length; i++) {
    const c = texto[i];
    if (comilla) {
      if (c === '\\') throw new Error(BARRA);
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === "'" || c === '`') comilla = c;
    else if (c === '(') profundidad++;
    else if (c === ')' && --profundidad === 0) return { dentro: texto.slice(desde + 1, i), fin: i };
  }
  throw new Error('paréntesis sin cerrar');
}

// Divide por las comas de primer nivel (fuera de paréntesis, cadenas e identificadores).
function partir(texto: string): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let desde = 0;
  let comilla: string | null = null;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comilla) {
      if (c === '\\') throw new Error(BARRA);
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === "'" || c === '`') comilla = c;
    else if (c === '(') profundidad++;
    else if (c === ')' && --profundidad < 0) throw new Error('paréntesis sin abrir');
    else if (c === ',' && profundidad === 0) {
      partes.push(texto.slice(desde, i).trim());
      desde = i + 1;
    }
  }
  if (comilla || profundidad) throw new Error('paréntesis o comillas sin cerrar');
  partes.push(texto.slice(desde).trim());
  return partes;
}

const valoresEnum = (lista: string) => {
  if (!/^'[^'\\]*'(?:,\s*'[^'\\]*')*$/.test(lista.trim())) throw new Error('ENUM con una forma no reconocida');
  return [...lista.matchAll(/'([^']*)'/g)].map(m => m[1]);
};

function definirCheck(tabla: Tabla, nombre: string, clausula: string, inicio: number) {
  const { dentro, fin } = parentesis(clausula, inicio);
  if (clausula.slice(fin + 1).trim() !== '') throw new Error(`texto no reconocido tras el CHECK ${nombre}`);
  if (nombre in tabla.checks) throw new Error(`la restricción ${nombre} ya existe (MySQL rechazaría el duplicado)`);
  tabla.checks[nombre] = dentro;
}

function crearTabla(cuerpo: string): Tabla {
  const tabla: Tabla = { enums: {}, columnas: {}, checks: {} };
  for (const parte of partir(cuerpo)) {
    let m: RegExpMatchArray | null;
    if ((m = parte.match(/^`(\w+)` ENUM\(([^)]*)\)( NOT NULL| NULL)?(?: DEFAULT '[^']*')?$/))) {
      tabla.columnas[m[1]] = null;
      tabla.enums[m[1]] = { valores: valoresEnum(m[2]), nulo: m[3] !== ' NOT NULL' };
    } else if ((m = parte.match(/^`(\w+)` (?!ENUM)(?:(?:VAR)?CHAR\((\d+)\))?[A-Z ]/))) tabla.columnas[m[1]] = m[2] ? Number(m[2]) : null;
    else if ((m = parte.match(/^CONSTRAINT `(\w+)` CHECK \(/))) definirCheck(tabla, m[1], parte, m[0].length - 1);
    else if (/^(?:PRIMARY KEY|UNIQUE KEY `\w+`|KEY `\w+`|CONSTRAINT `\w+` FOREIGN KEY) \(/.test(parte)) continue;
    else throw new Error('definición no reconocida en CREATE TABLE: ' + parte.slice(0, 40));
  }
  return tabla;
}

function alterarTabla(tabla: Tabla, clausulas: string): void {
  for (const clausula of partir(clausulas)) {
    let m: RegExpMatchArray | null;
    if ((m = clausula.match(/^DROP CHECK `(\w+)`$/))) {
      if (!(m[1] in tabla.checks)) throw new Error(`DROP CHECK de una restricción inexistente: ${m[1]}`);
      delete tabla.checks[m[1]];
    } else if ((m = clausula.match(/^ADD CONSTRAINT `(\w+)` CHECK \(/))) definirCheck(tabla, m[1], clausula, m[0].length - 1);
    else if ((m = clausula.match(/^MODIFY (?:COLUMN )?`(\w+)` ENUM\(([^)]*)\) (NOT NULL|NULL)$/))) {
      if (!(m[1] in tabla.columnas)) throw new Error(`MODIFY de una columna inexistente: ${m[1]}`);
      tabla.enums[m[1]] = { valores: valoresEnum(m[2]), nulo: m[3] === 'NULL' };
    } else throw new Error('cláusula ALTER TABLE no reconocida por la prueba de paridad: ' + clausula.slice(0, 40));
  }
}

// Aplica en orden las sentencias de cada migración (separadas por «;», el mismo criterio que migrate.cjs).
function modelo(migraciones: string[]): Modelo {
  const m: Modelo = {};
  for (const sql of migraciones) {
    for (const sentencia of sql.split(';').map(s => s.trim()).filter(Boolean)) {
      const crear = sentencia.match(/^CREATE TABLE IF NOT EXISTS `(\w+)` \(/);
      const alterar = sentencia.match(/^ALTER TABLE `(\w+)`\s+/);
      const nombre = (crear ?? alterar)?.[1];
      if (!nombre) throw new Error('sentencia no reconocida por la prueba de paridad: ' + sentencia.slice(0, 40));
      if (!TABLAS_DOCUMENTO.includes(nombre)) {
        if (/doc_/.test(sentencia)) throw new Error(`sentencia sobre ${nombre} con columnas de documento no reconocida`);
        continue; // otra tabla académica sin documento
      }
      if (crear) {
        const { dentro, fin } = parentesis(sentencia, crear[0].length - 1);
        if (!/^\s*(?:ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci)?\s*$/.test(sentencia.slice(fin + 1))) throw new Error('opciones de tabla no reconocidas');
        if (!m[nombre]) m[nombre] = crearTabla(dentro); // IF NOT EXISTS: si ya existe, no cambia nada
      } else {
        if (!m[nombre]) throw new Error(`ALTER TABLE de una tabla inexistente: ${nombre}`);
        alterarTabla(m[nombre], sentencia.slice(alterar![0].length));
      }
    }
  }
  return m;
}

// Sucesión real: la lista `versions` de migrate.cjs a partir de la migración académica E4.2.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { versions } = require('../scripts/migrate.cjs') as { versions: string[] };
const E42 = '20261015-academico-estructura';
const SOLO_DNI = '20261016-academico-solo-dni';
// Un checkout de Windows con core.autocrlf materializa las migraciones con CRLF: se normaliza solo en memoria.
const normalizarSaltos = (sql: string) => sql.replace(/\r\n?/g, '\n');
const leer = (nombre: string) => normalizarSaltos(readFileSync(join(__dirname, '..', 'migrations', nombre + '.sql'), 'utf8'));
const ACADEMICAS = versions.slice(versions.indexOf(E42));
const SQL = ACADEMICAS.map(leer);
const sqlE42 = leer(E42);
const sqlDni = leer(SOLO_DNI);

// Restricciones CHECK que leen columnas de documento (las demás, p. ej. nombres o revisión, no intervienen aquí).
const checksDocumento = (tabla: Tabla) => Object.values(tabla.checks).filter(e => /`(?:estudiante_)?doc_/.test(e)).map(analizar);

const PAISES: (string | null)[] = [null, 'PE', 'pe', 'Pe', 'ES', 'US', 'ZZ', 'P', 'PER', 'P1', '1E', 'ÑE', 'PE ', ' PE', '', 'P-', 'ＰＥ', 'PE\n', 'P\n'];
const TIPOS: (string | null)[] = [null, 'DNI', 'CE', 'PASAPORTE', 'dni', 'LIBRETA', ''];
const NUMEROS: (string | null)[] = (() => {
  const base: (string | null)[] = [null, '', '0', '1', '00000000', '00012345', '12345678', '012345678', '123456789', '1234567', 'A', 'a', 'AB123', 'ab123', 'AB-12', 'AB 12', 'AB_12', 'Ñ1234567', '１２３４５６７８', 'ABCDEFGHIJKL', 'X1234567', '24AB12345', '12345678 ', ' 12345678'];
  // Terminadores finales que el «$» de ICU deja pasar, y casos de longitud cercanos.
  for (const t of ['\n', '\r', '\r\n', '\v', '\f', '\u0085', '\u2028', '\u2029']) base.push('12345678' + t, '00012345' + t, '1234567' + t, t + '12345678');
  for (let n = 1; n <= 23; n++) base.push('7'.repeat(n), 'A'.repeat(n), 'a'.repeat(n), '0'.repeat(n));
  return base;
})();

type Fila = { doc_pais: string | null; doc_tipo: string | null; doc_numero: string | null };
function corpus(): Fila[] {
  const filas: Fila[] = [];
  for (const doc_pais of PAISES) for (const doc_tipo of TIPOS) for (const doc_numero of NUMEROS) filas.push({ doc_pais, doc_tipo, doc_numero });
  return filas;
}

// Devuelve las discrepancias entre el esquema efectivo de las migraciones dadas y normalizarDocumento (vacío = paridad completa).
function discrepancias(migraciones: string[]): string[] {
  const m = modelo(migraciones);
  const problemas: string[] = [];
  const est = m.estudiantes;
  const cert = m.certificados;
  if (!est || !cert) return ['faltan las tablas estudiantes o certificados'];
  const tiposEst = est.enums.doc_tipo;
  const tiposCert = cert.enums.estudiante_doc_tipo;
  if (!tiposEst || !tiposCert) return ['el tipo de documento no es un ENUM'];
  // El ENUM de ambas tablas debe ser exactamente el de normalizarDocumento: reintroducir CE o PASAPORTE se detecta aunque un CHECK los rechace.
  if (JSON.stringify(tiposEst.valores) !== JSON.stringify(TIPOS_DOCUMENTO)) problemas.push(`ENUM de estudiantes.doc_tipo: ${tiposEst.valores.join(',')}`);
  if (JSON.stringify(tiposCert.valores) !== JSON.stringify(TIPOS_DOCUMENTO)) problemas.push(`ENUM de certificados.estudiante_doc_tipo: ${tiposCert.valores.join(',')}`);
  if (!tiposEst.nulo) problemas.push('estudiantes.doc_tipo debe admitir NULL (documento opcional)');
  if (tiposCert.nulo) problemas.push('certificados.estudiante_doc_tipo debe ser NOT NULL (DNI obligatorio)');
  const reglasEst = checksDocumento(est);
  const reglasCert = checksDocumento(cert);
  let aceptadasSql = 0;
  let rechazadasSql = 0;

  for (const fila of corpus()) {
    const etiqueta = JSON.stringify(fila);
    const enumOk = fila.doc_tipo === null || tiposEst.valores.includes(fila.doc_tipo);
    const sqlAcepta = enumOk && caben(est, fila) && cumplen(reglasEst, fila);
    sqlAcepta ? aceptadasSql++ : rechazadasSql++;
    // Modo no estricto: un valor fuera del ENUM se guarda como '' y solo los CHECK pueden impedirlo.
    if (!enumOk && cumplen(reglasEst, { ...fila, doc_tipo: '' })) problemas.push(`estudiantes acepta '' en modo no estricto: ${etiqueta}`);
    const ts = normalizarDocumento(fila);

    if (sqlAcepta) {
      // Lo que MySQL acepta tal cual, el servicio lo acepta sin cambiarlo.
      const esperado = fila.doc_tipo === null ? null : { doc_pais: fila.doc_pais, doc_tipo: fila.doc_tipo, doc_numero: fila.doc_numero };
      if (!(ts.ok && JSON.stringify(ts.documento) === JSON.stringify(esperado))) problemas.push(`SQL acepta y TS no: ${etiqueta}`);
    }
    if (ts.ok && ts.documento) {
      const n = { doc_pais: ts.documento.doc_pais, doc_tipo: ts.documento.doc_tipo, doc_numero: ts.documento.doc_numero };
      // Lo que el servicio entrega ya normalizado, MySQL lo acepta (en estudiantes y en la copia del certificado).
      if (!(tiposEst.valores.includes(n.doc_tipo) && caben(est, n) && cumplen(reglasEst, n))) problemas.push(`TS entrega algo que estudiantes rechaza: ${etiqueta}`);
      const snap = { estudiante_doc_pais: n.doc_pais, estudiante_doc_tipo: n.doc_tipo, estudiante_doc_numero: n.doc_numero };
      if (!(tiposCert.valores.includes(n.doc_tipo) && caben(cert, snap) && cumplen(reglasCert, snap))) problemas.push(`TS entrega algo que certificados rechaza: ${etiqueta}`);
      if (JSON.stringify(n) === JSON.stringify(fila) && !sqlAcepta) problemas.push(`TS acepta sin cambios y SQL no: ${etiqueta}`);
    }
    if (ts.ok && ts.documento === null && !(fila.doc_pais === null && fila.doc_tipo === null && fila.doc_numero === null)) problemas.push(`TS toma por ausente una fila con datos: ${etiqueta}`);
  }

  // Certificados: mismas reglas de formato sobre los campos de la copia (todos obligatorios).
  for (const fila of corpus()) {
    if (fila.doc_pais === null || fila.doc_tipo === null || fila.doc_numero === null) continue;
    const snap = { estudiante_doc_pais: fila.doc_pais, estudiante_doc_tipo: fila.doc_tipo, estudiante_doc_numero: fila.doc_numero };
    const enumOk = tiposCert.valores.includes(fila.doc_tipo);
    const sqlAcepta = enumOk && caben(cert, snap) && cumplen(reglasCert, snap);
    if (!enumOk && cumplen(reglasCert, { ...snap, estudiante_doc_tipo: '' })) problemas.push(`certificados acepta '' en modo no estricto: ${JSON.stringify(fila)}`);
    const ts = normalizarDocumento(fila);
    const tsSinCambios = ts.ok && ts.documento !== null && JSON.stringify(ts.documento) === JSON.stringify(fila);
    if (sqlAcepta !== tsSinCambios) problemas.push(`certificados y TS difieren: ${JSON.stringify(fila)}`);
  }

  // Docentes (si la sucesión ya incluye 20261020-docentes): documento opcional con exactamente la regla de estudiantes y la de normalizarDocumento.
  const docentes = m.docentes;
  if (docentes) {
    const tiposDoc = docentes.enums.doc_tipo;
    if (!tiposDoc) problemas.push('docentes.doc_tipo no es un ENUM');
    else {
      if (JSON.stringify(tiposDoc.valores) !== JSON.stringify(TIPOS_DOCUMENTO)) problemas.push(`ENUM de docentes.doc_tipo: ${tiposDoc.valores.join(',')}`);
      if (!tiposDoc.nulo) problemas.push('docentes.doc_tipo debe admitir NULL (documento opcional)');
      const reglasDoc = checksDocumento(docentes);
      for (const fila of corpus()) {
        const etiqueta = JSON.stringify(fila);
        const enumOkDoc = fila.doc_tipo === null || tiposDoc.valores.includes(fila.doc_tipo);
        const aceptaDocente = enumOkDoc && caben(docentes, fila) && cumplen(reglasDoc, fila);
        const aceptaEstudiante = (fila.doc_tipo === null || tiposEst.valores.includes(fila.doc_tipo)) && caben(est, fila) && cumplen(reglasEst, fila);
        if (aceptaDocente !== aceptaEstudiante) problemas.push(`docentes y estudiantes difieren: ${etiqueta}`);
        if (!enumOkDoc && cumplen(reglasDoc, { ...fila, doc_tipo: '' })) problemas.push(`docentes acepta '' en modo no estricto: ${etiqueta}`);
        const ts = normalizarDocumento(fila);
        if (ts.ok && ts.documento) {
          const n = { doc_pais: ts.documento.doc_pais, doc_tipo: ts.documento.doc_tipo, doc_numero: ts.documento.doc_numero };
          if (!(tiposDoc.valores.includes(n.doc_tipo) && caben(docentes, n) && cumplen(reglasDoc, n))) problemas.push(`TS entrega algo que docentes rechaza: ${etiqueta}`);
        }
      }
    }
  }

  // Salvaguarda contra una prueba vacía: el corpus debe contener ambos resultados.
  if (aceptadasSql < 5 || rechazadasSql < 500) problemas.push('el corpus no ejerce suficientes casos aceptados y rechazados');
  return problemas;
}

test('paridad: la sucesión real de migraciones incluye E4.2 y la de solo DNI, en ese orden', () => {
  assert.ok(ACADEMICAS.length >= 2);
  assert.equal(ACADEMICAS[0], E42);
  assert.ok(ACADEMICAS.indexOf(SOLO_DNI) > 0, 'la migración de solo DNI está registrada después de E4.2');
});

test('paridad: el esquema efectivo (E4.2 + solo DNI) y normalizarDocumento aceptan y rechazan lo mismo', () => {
  const m = modelo(SQL);
  assert.deepEqual(m.estudiantes.enums.doc_tipo, { valores: ['DNI'], nulo: true });
  assert.deepEqual(m.certificados.enums.estudiante_doc_tipo, { valores: ['DNI'], nulo: false });
  // Las columnas no cambian: CHAR(2) para el país (por eso «PE\n» no cabe) y VARCHAR(20) para el número (conserva ceros iniciales).
  assert.deepEqual([m.estudiantes.columnas.doc_pais, m.estudiantes.columnas.doc_numero, m.certificados.columnas.estudiante_doc_pais, m.certificados.columnas.estudiante_doc_numero], [2, 20, 2, 20]);
  // Se conservan las demás restricciones y la regla de todo o nada.
  assert.deepEqual(Object.keys(m.estudiantes.checks).sort(), ['estudiantes_documento_completo_chk', 'estudiantes_documento_formato_chk', 'estudiantes_nombres_chk', 'estudiantes_revision_chk']);
  assert.deepEqual(Object.keys(m.certificados.checks).sort(), ['certificados_anulacion_chk', 'certificados_codigo_chk', 'certificados_documento_chk', 'certificados_fechas_chk', 'certificados_nombres_chk']);
  assert.equal(m.estudiantes.checks.estudiantes_documento_completo_chk, modelo([sqlE42]).estudiantes.checks.estudiantes_documento_completo_chk);
  // Docentes: mismo documento opcional de solo DNI; las demás restricciones (nombres, texto, estado y revisión) no leen el documento.
  assert.deepEqual(m.docentes.enums.doc_tipo, { valores: ['DNI'], nulo: true });
  assert.deepEqual([m.docentes.columnas.doc_pais, m.docentes.columnas.doc_numero], [2, 20]);
  assert.deepEqual(Object.keys(m.docentes.checks).sort(), ['docentes_activo_chk', 'docentes_documento_completo_chk', 'docentes_documento_formato_chk', 'docentes_nombres_chk', 'docentes_revision_chk', 'docentes_texto_chk']);
  assert.deepEqual(discrepancias(SQL), []);
});

test('paridad: el resultado es el mismo con migraciones en CRLF y en LF', () => {
  const lf = SQL.map(normalizarSaltos);
  const crlf = lf.map(s => s.replace(/\n/g, '\r\n'));
  assert.ok(crlf.every(s => s.includes('\r\n')));
  assert.deepEqual(crlf.map(normalizarSaltos), lf);
  assert.deepEqual(discrepancias(crlf.map(normalizarSaltos)), []);
  assert.deepEqual(discrepancias(lf), []);
});

test('paridad: el esquema de E4.2 sin la migración de solo DNI se detecta (todavía admite CE y PASAPORTE)', () => {
  const problemas = discrepancias([sqlE42]);
  assert.ok(problemas.some(p => p.startsWith('ENUM de estudiantes.doc_tipo: DNI,CE,PASAPORTE')));
  assert.ok(problemas.some(p => p.startsWith('SQL acepta y TS no') && p.includes('"CE"')));
  assert.ok(problemas.some(p => p.startsWith('certificados y TS difieren') && p.includes('"PASAPORTE"')));
  // Y el «$» de ICU: E4.2 aceptaba un DNI con salto de línea final.
  assert.ok(problemas.some(p => p.startsWith('SQL acepta y TS no') && p.includes('"12345678\\n"')));
});

test('paridad: docentes aplica la misma regla de documento que estudiantes y se detecta una regla alterada en su migración', () => {
  const DOCENTES = '20261020-docentes';
  assert.ok(ACADEMICAS.includes(DOCENTES), 'la migración de docentes forma parte de la sucesión académica');
  const sqlDocentes = leer(DOCENTES);
  const sucesion = (sql: string) => ACADEMICAS.map((nombre, i) => (nombre === DOCENTES ? sql : SQL[i]));
  assert.deepEqual(discrepancias(sucesion(sqlDocentes)), []);
  const mutaciones: [string, string, string][] = [
    ['quitar CHAR_LENGTH (aceptaría un salto de línea final)', ' AND CHAR_LENGTH(`doc_numero`) = 8', ''],
    ['reintroducir CE en el ENUM', "ENUM('DNI') NULL", "ENUM('DNI','CE') NULL"],
    ['DNI de 9 dígitos', '^[0-9]{8}$', '^[0-9]{9}$'],
    ['país distinto de PE', "'^PE$', 'c'", "'^[A-Z]{2}$', 'c'"],
    ['quitar el tipo = DNI (modo no estricto)', " AND `doc_tipo` = 'DNI'", ''],
  ];
  for (const [etiqueta, de, a] of mutaciones) {
    assert.ok(sqlDocentes.includes(de), `la mutación «${etiqueta}» no encuentra su objetivo`);
    assert.ok(discrepancias(sucesion(sqlDocentes.split(de).join(a))).length > 0, `la paridad no detectó en docentes: ${etiqueta}`);
  }
});

test('paridad: la prueba detecta reglas SQL alteradas en la migración de solo DNI', () => {
  const mutar = (de: string, a: string) => {
    const partes = sqlDni.split(de);
    assert.ok(partes.length > 1, `la mutación «${de}» no encuentra su objetivo`);
    return partes.join(a); // sustituye todas las apariciones (estudiantes y certificados)
  };
  const sucesion = (dni: string) => ACADEMICAS.map((nombre, i) => (nombre === SOLO_DNI ? dni : SQL[i]));
  const mutaciones: [string, string, string][] = [
    ['reintroducir CE en el ENUM de estudiantes', "ENUM('DNI') NULL", "ENUM('DNI','CE') NULL"],
    ['reintroducir PASAPORTE en el ENUM de certificados', "ENUM('DNI') NOT NULL", "ENUM('DNI','PASAPORTE') NOT NULL"],
    ['reintroducir CE en el ENUM y en el CHECK de estudiantes', "AND CHAR_LENGTH(`doc_numero`) = 8)),\n  MODIFY `doc_tipo` ENUM('DNI') NULL", "AND CHAR_LENGTH(`doc_numero`) = 8) OR (`doc_tipo` = 'CE' AND REGEXP_LIKE(`doc_pais`, '^PE$', 'c') AND REGEXP_LIKE(`doc_numero`, '^[A-Z0-9]{1,12}$', 'c'))),\n  MODIFY `doc_tipo` ENUM('DNI','CE') NULL"],
    ['reintroducir PASAPORTE en el ENUM y en el CHECK de certificados', "CHAR_LENGTH(`estudiante_doc_numero`) = 8),\n  MODIFY `estudiante_doc_tipo` ENUM('DNI') NOT NULL", "CHAR_LENGTH(`estudiante_doc_numero`) = 8 OR (`estudiante_doc_tipo` = 'PASAPORTE' AND REGEXP_LIKE(`estudiante_doc_numero`, '^[A-Z0-9]{1,20}$', 'c'))),\n  MODIFY `estudiante_doc_tipo` ENUM('DNI','PASAPORTE') NOT NULL"],
    ['quitar CHAR_LENGTH de estudiantes', ' AND CHAR_LENGTH(`doc_numero`) = 8', ''],
    ['quitar CHAR_LENGTH de certificados', ' AND CHAR_LENGTH(`estudiante_doc_numero`) = 8', ''],
    ['CHAR_LENGTH distinto de 8', ') = 8', ') = 9'],
    ['quitar tipo = DNI de estudiantes (modo no estricto)', "`doc_tipo` = 'DNI' AND ", ''],
    ['quitar tipo = DNI de certificados (modo no estricto)', "`estudiante_doc_tipo` = 'DNI' AND ", ''],
    ['DNI de 9 dígitos', '^[0-9]{8}$', '^[0-9]{9}$'],
    ['DNI de 7 u 8 dígitos', '^[0-9]{8}$', '^[0-9]{7,8}$'],
    ['DNI sin «$» ni CHAR_LENGTH en estudiantes', "'^[0-9]{8}$', 'c') AND CHAR_LENGTH(`doc_numero`) = 8", "'^[0-9]{8}', 'c')"],
    ['país distinto de PE', '^PE$', '^[A-Z]{2}$'],
    ['país sin distinguir mayúsculas', "'^PE$', 'c'", "'^PE$', 'i'"],
    ['quitar el país de estudiantes', " AND REGEXP_LIKE(`doc_pais`, '^PE$', 'c')", ''],
  ];
  // Cada mutación debe producir discrepancias reales (no un error del analizador, que podría ocultar una mutación mal escrita).
  // La de una sola barra invertida ('^\d{8}$') se comprueba aparte: se rechaza con un error explícito.
  for (const [etiqueta, de, a] of mutaciones) assert.ok(discrepancias(sucesion(mutar(de, a))).length > 0, `la paridad no detectó: ${etiqueta}`);
  // Control: la evaluación es semántica, no textual. Con CHAR_LENGTH = 8, quitar «^» o «$» del patrón no cambia lo que se acepta.
  for (const a of ['^[0-9]{8}', '[0-9]{8}$', '[0-9]{8}']) assert.deepEqual(discrepancias(sucesion(mutar('^[0-9]{8}$', a))), [], `equivalente: ${a}`);
  // Eliminar sentencias completas: sin el ALTER de certificados siguen vigentes las reglas de E4.2 (PASAPORTE en certificados).
  const [alterEst, alterCert] = sqlDni.split(';').map(s => s.trim()).filter(Boolean);
  assert.ok(discrepancias(sucesion(alterEst + ';')).length > 0, 'sin el ALTER de certificados');
  assert.ok(discrepancias(sucesion(alterCert + ';')).length > 0, 'sin el ALTER de estudiantes');
  // Una migración POSTERIOR que reintroduce CE también se detecta: rige la sucesión completa, no solo la migración de solo DNI.
  assert.ok(discrepancias([...SQL, "ALTER TABLE `estudiantes` MODIFY `doc_tipo` ENUM('DNI','CE') NULL;"]).length > 0);
  assert.ok(discrepancias([...SQL, 'ALTER TABLE `estudiantes` DROP CHECK `estudiantes_documento_formato_chk`;']).length > 0, 'quitar la regla de formato');
  assert.ok(discrepancias([...SQL, 'ALTER TABLE `estudiantes` DROP CHECK `estudiantes_documento_completo_chk`;']).length > 0, 'quitar la regla de todo o nada');
  // Quitar la regla de «todo o nada» dentro del CHECK de E4.2 también se detecta.
  const sinCompleto = sqlE42.replace('(`doc_pais` IS NOT NULL AND `doc_tipo` IS NOT NULL AND `doc_numero` IS NOT NULL))', '(`doc_pais` IS NOT NULL))');
  assert.notEqual(sinCompleto, sqlE42);
  assert.ok(discrepancias([sinCompleto, ...SQL.slice(1)]).length > 0);
});

test('paridad: una sintaxis desconocida en la sucesión de migraciones hace fallar la prueba', () => {
  const casos = [
    'ALTER TABLE `estudiantes` ADD COLUMN `doc_extra` VARCHAR(5) NULL;',
    'ALTER TABLE `estudiantes` ALTER CHECK `estudiantes_documento_formato_chk` NOT ENFORCED;',
    "ALTER TABLE `certificados` CHANGE `estudiante_doc_tipo` `estudiante_doc_tipo` ENUM('DNI','CE') NOT NULL;",
    "UPDATE `estudiantes` SET `doc_tipo` = 'DNI';",
    'ALTER TABLE estudiantes DROP CHECK estudiantes_documento_formato_chk;', // sin comillas inversas
    "ALTER TABLE `convocatorias` ADD COLUMN `doc_numero` VARCHAR(20) NULL;", // documento en otra tabla
    'ALTER TABLE `estudiantes` DROP CHECK `no_existe_chk`;',
    "ALTER TABLE `estudiantes` ADD CONSTRAINT `estudiantes_documento_formato_chk` CHECK (`doc_tipo` IS NULL);", // duplicada sin DROP
  ];
  for (const extra of casos) assert.throws(() => discrepancias([...SQL, extra]), Error, `se aceptó: ${extra}`);
});

test('paridad: los literales SQL con barra invertida se rechazan de forma explícita', () => {
  const reemplazar = (a: string) => sqlDni.split('^[0-9]{8}$').join(a);
  // Una barra (\d), dos barras (\\d), una comilla escapada (\') y un escape de control (\n): ninguno se interpreta ni se ignora.
  for (const a of ['^\\d{8}$', '^\\\\d{8}$', "^\\'{8}$", '^\\n{8}$']) {
    assert.notEqual(reemplazar(a), sqlDni);
    assert.throws(() => discrepancias([sqlE42, reemplazar(a)]), /barra invertida|fuera del subconjunto/, `se aceptó el literal ${a}`);
  }
});

test('paridad: los patrones fuera del subconjunto soportado se rechazan', () => {
  for (const a of ['^.{8}$', '^[0-9]+$', '^(?:[0-9]{8})$', '^[0-9]{8}|x$']) {
    assert.throws(() => discrepancias([sqlE42, sqlDni.split('^[0-9]{8}$').join(a)]), /fuera del subconjunto/, `se aceptó el patrón ${a}`);
  }
  assert.throws(() => discrepancias([sqlE42, sqlDni.split("'^[0-9]{8}$', 'c'").join("'^[0-9]{8}$', 'm'")]), /bandera de REGEXP_LIKE no soportada/);
});
