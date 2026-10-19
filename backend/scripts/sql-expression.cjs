// Forma canónica de una expresión SQL de CHECK o de columna generada, para comparar la definición real de MySQL con la de la migración.
// MySQL reescribe las expresiones al guardarlas: minúsculas, paréntesis en cada comparación, introductores de juego de caracteres
// (_utf8mb4'x', _latin1'x', según el cliente que creó la tabla) y comillas escapadas (\'x\') en information_schema. Aquí se analiza
// la expresión y se reduce a un árbol: el formato desaparece, pero no la lógica (operadores, operandos, orden y agrupación reales).
// Solo admite la gramática que usan las migraciones; algo desconocido lanza un error en lugar de aceptarse por aproximación.
// Sin dependencias: se puede probar sin cargar database.cjs ni ningún .env.

const OPERATORS = ['>=', '<=', '<>', '!=', '&&', '||', '=', '<', '>', '(', ')', ',', '-'];

// Literal numérico exacto (entero o decimal) en forma canónica, SIN pasar por coma flotante: Number() confundiría 1 con
// 1.00000000000000000001. Se quitan los ceros a la izquierda y los decimales finales a cero (01.000 → 1, 1.50 → 1.5) y se anota la
// escala escrita (número de decimales), que solo se ignora cuando el literal es directamente un operando de una comparación o de IN.
function exactNumber(literal) {
  const [int, frac = ''] = literal.split('.');
  const digits = (int.replace(/^0+/, '') || '0') + (frac.replace(/0+$/, '') ? '.' + frac.replace(/0+$/, '') : '');
  return { value: digits, scale: literal.includes('.') ? frac.length : 0 };
}
const negate = value => value === '0' ? '0' : value.startsWith('-') ? value.slice(1) : '-' + value;

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
    // Enteros y decimales (1, 1.5, 1., .5). La notación exponencial (1e3, un DOUBLE aproximado) y un número pegado a letras no se admiten.
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(text.slice(i));
    if (number) {
      if (/[A-Za-z0-9_$.]/.test(text[i + number[0].length] ?? '')) throw new Error('Literal numérico no admitido (notación exponencial o número pegado a letras).');
      tokens.push({ type: 'number', ...exactNumber(number[0]) }); i += number[0].length; continue;
    }
    if (text.startsWith('--', i)) throw new Error('Comentario o doble signo no admitido en la expresión.');
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
      const list = [operand(expr())];
      while (isWord(',')) { p++; list.push(operand(expr())); }
      expect(')');
      return (negated ? 'notin(' : 'in(') + operand(text(left)) + ',[' + list.join(',') + '])';
    }
    if (peek() && peek().type === 'op' && COMPARISONS.has(peek().value)) {
      const op = peek().value; p++;
      return op + '(' + operand(text(left)) + ',' + operand(text(primary())) + ')';
    }
    return left;
  }
  // Al comparar, 1, 1.0 y 01.000 son el mismo valor exacto: se descarta la escala. Solo si el operando ES el literal (no dentro de una función).
  function operand(item) { return /^n:-?[0-9.]+;s\d+$/.test(item) ? item.replace(/;s\d+$/, '') : item; }
  const number = (value, scale) => 'n:' + value + (scale ? ';s' + scale : '');
  function primary() {
    const token = peek();
    if (!token) throw new Error('Expresión incompleta.');
    if (token.type === 'op' && token.value === '(') { p++; const inner = or(); expect(')'); return inner; }
    if (token.type === 'string') { p++; return 's:' + JSON.stringify(token.value); }
    if (token.type === 'number') { p++; return number(token.value, token.scale); }
    // Menos unario: MySQL guarda -1 como -(1). Sobre un literal se pliega en su valor exacto; sobre otra cosa queda como neg(...).
    // No hay resta: «a - 1» deja elementos sin consumir y se rechaza.
    if (token.type === 'op' && token.value === '-') {
      p++;
      const inner = text(primary());
      const literal = /^n:(-?[0-9.]+)(?:;s(\d+))?$/.exec(inner);
      return literal ? number(negate(literal[1]), Number(literal[2] ?? 0)) : 'neg(' + inner + ')';
    }
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
