// Forma canónica de una expresión SQL de CHECK o de columna generada, para comparar la definición real de MySQL con la de la migración.
// MySQL reescribe las expresiones al guardarlas: minúsculas, paréntesis en cada comparación, introductores de juego de caracteres
// (_utf8mb4'x', _latin1'x', según el cliente que creó la tabla) y comillas escapadas (\'x\') en information_schema. Aquí se analiza
// la expresión y se reduce a un árbol: el formato desaparece, pero no la lógica (operadores, operandos, orden y agrupación reales).
// Solo admite la gramática que usan las migraciones; algo desconocido lanza un error en lugar de aceptarse por aproximación.
// Sin dependencias: se puede probar sin cargar database.cjs ni ningún .env.

const OPERATORS = ['>=', '<=', '<>', '!=', '&&', '||', '=', '<', '>', '(', ')', ','];

function tokenize(text) {
  const tokens = [];
  let i = 0;
  const readString = escaped => {
    // escaped: la cadena llega como \'...\' (information_schema); si no, '...' con '' o \x como escapes.
    let value = '';
    i += escaped ? 2 : 1;
    for (;;) {
      if (i >= text.length) throw new Error('Cadena sin cerrar en la expresión.');
      if (escaped && text.startsWith("\\'", i)) { i += 2; break; }
      const c = text[i];
      if (!escaped && c === "'") { if (text[i + 1] === "'") { value += "'"; i += 2; continue; } i++; break; }
      if (!escaped && c === '\\') { value += text[i + 1] ?? ''; i += 2; continue; }
      value += c; i++;
    }
    tokens.push({ type: 'string', value });
  };
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") { readString(false); continue; }
    if (text.startsWith("\\'", i)) { readString(true); continue; }
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end < 0) throw new Error('Identificador sin cerrar en la expresión.');
      tokens.push({ type: 'ident', value: text.slice(i + 1, end).toLowerCase() }); i = end + 1; continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(text.slice(i));
    if (number) { tokens.push({ type: 'number', value: String(Number(number[0])) }); i += number[0].length; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(i));
    if (word) {
      i += word[0].length;
      // Introductor de juego de caracteres pegado a una cadena: no cambia el valor comparado.
      if (/^_[a-z0-9]+$/i.test(word[0]) && (text[i] === "'" || text.startsWith("\\'", i))) continue;
      tokens.push({ type: 'word', value: word[0].toLowerCase() }); continue;
    }
    const op = OPERATORS.find(candidate => text.startsWith(candidate, i));
    if (!op) throw new Error('Símbolo no admitido en la expresión.');
    tokens.push({ type: 'op', value: op === '!=' ? '<>' : op === '&&' ? 'and' : op === '||' ? 'or' : op }); i += op.length;
  }
  return tokens;
}

const COMPARISONS = new Set(['=', '<>', '<', '<=', '>', '>=']);

function parse(tokens) {
  let p = 0;
  const peek = (offset = 0) => tokens[p + offset];
  const isWord = (value, offset = 0) => peek(offset) && (peek(offset).type === 'word' || peek(offset).type === 'op') && peek(offset).value === value;
  const expect = value => { if (!isWord(value)) throw new Error('Se esperaba «' + value + '» en la expresión.'); p++; };
  // AND y OR son asociativos: (a and b) and c = a and (b and c) = and(a,b,c). Los nodos se guardan como { op, items } y se serializan al final.
  const chain = (name, next) => () => {
    const items = [next()];
    while (isWord(name)) { p++; items.push(next()); }
    return items.length === 1 ? items[0] : { op: name, items: items.flatMap(item => typeof item === 'object' && item.op === name ? item.items : [item]) };
  };
  const text = item => typeof item === 'object' ? item.op + '(' + item.items.map(text).join(',') + ')' : item;
  const or = chain('or', () => and());
  const expr = () => text(or());
  const and = chain('and', () => not());
  function not() {
    if (isWord('not')) { p++; return 'not(' + text(not()) + ')'; }
    return predicate();
  }
  function predicate() {
    const left = primary();
    if (isWord('is')) {
      p++;
      const negated = isWord('not') ? (p++, true) : false;
      expect('null');
      return (negated ? 'notnull(' : 'isnull(') + text(left) + ')';
    }
    const negated = isWord('not') && isWord('in', 1) ? (p++, true) : false;
    if (isWord('in')) {
      p++; expect('(');
      const list = [expr()];
      while (isWord(',')) { p++; list.push(expr()); }
      expect(')');
      return (negated ? 'notin(' : 'in(') + text(left) + ',[' + list.join(',') + '])';
    }
    if (peek() && peek().type === 'op' && COMPARISONS.has(peek().value)) {
      const op = peek().value; p++;
      return op + '(' + text(left) + ',' + text(primary()) + ')';
    }
    return left;
  }
  function primary() {
    const token = peek();
    if (!token) throw new Error('Expresión incompleta.');
    if (token.type === 'op' && token.value === '(') { p++; const inner = or(); expect(')'); return inner; }
    if (token.type === 'string') { p++; return 's:' + JSON.stringify(token.value); }
    if (token.type === 'number') { p++; return 'n:' + token.value; }
    if (token.type === 'ident') { p++; return 'c:' + token.value; }
    if (token.type === 'word') {
      if (['null', 'true', 'false'].includes(token.value)) { p++; return token.value; }
      if (token.value === 'case') return caseExpression();
      if (peek(1) && peek(1).type === 'op' && peek(1).value === '(') {
        p += 2;
        const args = [];
        if (!isWord(')')) { args.push(expr()); while (isWord(',')) { p++; args.push(expr()); } }
        expect(')');
        return 'f:' + token.value + '(' + args.join(',') + ')';
      }
      p++; return 'c:' + token.value; // columna sin comillas inversas
    }
    throw new Error('Elemento inesperado en la expresión.');
  }
  function caseExpression() {
    expect('case');
    const subject = isWord('when') ? '' : expr();
    const branches = [];
    while (isWord('when')) { p++; const when = expr(); expect('then'); branches.push(when + '=>' + expr()); }
    if (!branches.length) throw new Error('CASE sin WHEN.');
    let otherwise = 'null'; // CASE sin ELSE devuelve NULL
    if (isWord('else')) { p++; otherwise = expr(); }
    expect('end');
    return 'case(' + subject + ';' + branches.join(';') + ';else=>' + otherwise + ')';
  }
  const result = or();
  if (p !== tokens.length) throw new Error('Sobran elementos al final de la expresión.');
  return text(result);
}

function canonical(text) { return parse(tokenize(String(text))); }

// Texto entre el paréntesis de `open` y su cierre (respeta cadenas y comillas inversas).
function balanced(sql, open) {
  if (sql[open] !== '(') throw new Error('Se esperaba un paréntesis de apertura.');
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '`') { const end = sql.indexOf(c, i + 1); if (end < 0) break; i = end; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return sql.slice(open + 1, i);
  }
  throw new Error('Paréntesis sin cerrar en la migración.');
}

// CHECK y columnas generadas declarados en el SQL de una migración: { checks: {nombre: expresión}, generated: {'tabla.columna': expresión} }.
function definitionsFromMigration(sql) {
  const checks = {}, generated = {};
  for (const match of sql.matchAll(/CONSTRAINT `(\w+)` CHECK \(/g)) checks[match[1]] = balanced(sql, match.index + match[0].length - 1);
  for (const table of sql.matchAll(/CREATE TABLE IF NOT EXISTS `(\w+)` \(/g)) {
    const body = balanced(sql, table.index + table[0].length - 1);
    for (const column of body.matchAll(/`(\w+)` [A-Z]+(?:\([^)]*\))? GENERATED ALWAYS AS \(/g)) generated[table[1] + '.' + column[1]] = balanced(body, column.index + column[0].length - 1);
  }
  return { checks, generated };
}

module.exports = { canonical, definitionsFromMigration };
