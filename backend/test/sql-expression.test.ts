import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { canonical, definitionsFromMigration } = require('../scripts/sql-expression.cjs');
const migration = definitionsFromMigration(readFileSync(join(__dirname, '..', 'migrations', '20261015-academico-estructura.sql'), 'utf8'));
const same = (a: string, b: string) => canonical(a) === canonical(b);

test('db:check E4.2: la migración declara 16 CHECK y una columna generada, todos analizables', () => {
  assert.equal(Object.keys(migration.checks).length, 16);
  assert.deepEqual(Object.keys(migration.generated), ['certificados.vigente_matricula_id']);
  for (const expression of [...Object.values(migration.checks), ...Object.values(migration.generated)] as string[]) assert.doesNotThrow(() => canonical(expression));
});

test('db:check E4.2: se aceptan las reescrituras inocuas de MySQL (minúsculas, paréntesis, introductores y comillas escapadas)', () => {
  // Textos tal como los devuelve MySQL 8.4 en information_schema (con introductor _utf8mb4 o _latin1 según el cliente que creó la tabla).
  const real: Record<string, string> = {
    convocatorias_revision_chk: '(`revision` >= 1)',
    certificados_codigo_chk: "regexp_like(`codigo_verificacion`,_utf8mb4\\'^[A-Z0-9]{16,32}$\\',_utf8mb4\\'c\\')",
    certificados_fechas_chk: '((`convocatoria_fecha_inicio` is null) or (`convocatoria_fecha_fin` is null) or (`convocatoria_fecha_fin` >= `convocatoria_fecha_inicio`))',
    matriculas_confirmacion_chk: "(((`cumplimiento` = _latin1\\'pendiente\\') and (`confirmado_por` is null) and (`confirmado_rol` is null) and (`confirmado_at` is null)) or ((`cumplimiento` in (_latin1\\'cumplido\\',_latin1\\'no_cumplido\\')) and (`confirmado_por` is not null) and (`confirmado_at` is not null) and (`confirmado_rol` is not null) and (`confirmado_rol` in (_latin1\\'GERENTE_GENERAL\\',_latin1\\'COORDINADORA_INSTITUCIONAL\\'))))",
    academico_historial_campos_chk: "((`campos` is null) or (json_type(`campos`) = _utf8mb4\\'ARRAY\\'))",
  };
  for (const [name, text] of Object.entries(real)) assert.ok(same(text, migration.checks[name]), name);
  assert.ok(same("(case when (`estado` = _utf8mb4\\'vigente\\') then `matricula_id` else NULL end)", migration.generated['certificados.vigente_matricula_id']));
  assert.ok(same('a AND (b AND c)', '((a and b) and c)'), 'AND es asociativo');
  assert.ok(same("x = 'v'", "`x`=_utf8mb4'v'"));
  assert.ok(same('a != 1', 'a <> 1'));
  assert.ok(same('CASE WHEN a = 1 THEN b END', 'case when (a = 1) then b else null end'), 'CASE sin ELSE equivale a ELSE NULL');
});

test('db:check E4.2: se rechazan expresiones con otra lógica aunque conserven el nombre', () => {
  assert.ok(!same('TRUE', migration.checks.convocatorias_revision_chk), 'CHECK (TRUE)');
  assert.ok(!same('(`revision` >= 0)', migration.checks.convocatorias_revision_chk), 'otro umbral');
  assert.ok(!same('(`revision` > 1)', migration.checks.convocatorias_revision_chk), 'otro operador');
  assert.ok(!same("(case when (`estado` <> _utf8mb4\\'vigente\\') then `matricula_id` else NULL end)", migration.generated['certificados.vigente_matricula_id']), 'condición invertida');
  assert.ok(!same("(case when (`estado` = _utf8mb4\\'anulado\\') then `matricula_id` else NULL end)", migration.generated['certificados.vigente_matricula_id']), 'otro estado');
  assert.ok(!same("(case when (`estado` = _utf8mb4\\'vigente\\') then `id` else NULL end)", migration.generated['certificados.vigente_matricula_id']), 'otra columna');
  assert.ok(!same("x = 'Vigente'", "x = 'vigente'"), 'los literales distinguen mayúsculas');
  assert.ok(!same('a or b and c', '(a or b) and c'), 'la agrupación real cuenta');
  assert.ok(!same('a is null', 'a is not null'));
  assert.ok(!same("a in ('x','y')", "a not in ('x','y')"));
  assert.ok(!same('fecha_fin >= fecha_inicio', 'fecha_inicio >= fecha_fin'), 'el orden de los operandos cuenta');
});

test('db:check E4.2: una sintaxis no reconocida no se acepta por aproximación', () => {
  for (const text of ['a = ', '(a = 1', "a = 'sin cerrar", 'a = 1 garbage', 'a BETWEEN 1 AND 2', 'a LIKE 1', 'a ; b', 'case end']) assert.throws(() => canonical(text), text);
});

test('db:check E4.2: los literales numéricos se comparan exactos, sin coma flotante (reverificación de Codex)', () => {
  // Reproducción exacta: Number() convertía ambos en 1.
  assert.ok(!same('revision >= 1.00000000000000000001', 'revision >= 1'), '1 frente a 1.00000000000000000001');
  assert.ok(!same('(`revision` >= 1.00000000000000000001)', migration.checks.convocatorias_revision_chk), 'contra la migración real');
  // Pares distintos que Number() redondearía al mismo double.
  for (const [a, b] of [['0.1', '0.10000000000000000001'], ['9007199254740993', '9007199254740992'], ['123456789012345678901234567890', '123456789012345678901234567891'], ['0.3', '0.30000000000000001']]) {
    assert.equal(Number(a), Number(b), 'precondición: JavaScript no distingue ' + a + ' de ' + b);
    assert.ok(!same('x >= ' + a, 'x >= ' + b), a + ' ≠ ' + b);
  }
  // Mismo valor exacto con otro formato: equivalentes al comparar.
  for (const text of ['revision >= 1.0', 'revision >= 01.000', 'revision >= 1.', '(`revision` >= 0001)']) assert.ok(same(text, migration.checks.convocatorias_revision_chk), text);
  assert.ok(same('x = .5', 'x = 0.50'));
  assert.ok(same("x in (1.0, 2)", 'x in (1, 2.00)'), 'también en IN');
  // Negativos: MySQL guarda -1 como -(1).
  assert.ok(same('x > -1', 'x > -(1)')); assert.ok(same('x > -(1.50)', 'x > -1.5')); assert.ok(same('x = -0', 'x = 0'));
  assert.ok(!same('x > -1', 'x > 1')); assert.ok(!same('x > -1', 'x > -1.00000000000000000001'));
  assert.ok(!same('x > -y', 'x > y'), 'menos unario sobre una columna');
  // Fuera de una comparación la escala escrita cuenta (1.0 es DECIMAL, 1 es INT): no se iguala por aproximación.
  assert.ok(!same('f(1.0)', 'f(1)'));
  assert.ok(!same('case when a = 1 then 1.0 else 2 end', 'case when a = 1 then 1 else 2 end'));
});

test('db:check E4.2: literales numéricos no admitidos se rechazan en lugar de aproximarse', () => {
  for (const text of ['x >= 1e0', 'x >= 1E-3', 'x >= 1.5e2', 'x >= 1..2', 'x >= 1.2.3', 'x >= 1abc', 'x >= 0x1F', 'x - 1 >= 0', 'x >= 1 - 1', 'x >= -- 1', 'x >= +1']) assert.throws(() => canonical(text), text);
});
