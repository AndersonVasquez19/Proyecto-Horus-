import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require('../scripts/uploads-backup-lib.cjs');
const backupScript = join(__dirname, '..', 'scripts', 'backup-uploads.cjs'), restoreScript = join(__dirname, '..', 'scripts', 'restore-uploads.cjs');

// Solo carpetas temporales propias (horus-uploads-test-*) con archivos ficticios: nunca se lee ni se toca el UPLOAD_DIR real.
const temp: string[] = [];
const workspace = () => { const dir = mkdtempSync(join(tmpdir(), 'horus-uploads-test-')); temp.push(dir); return dir; };
test.after(() => { for (const dir of temp) rmSync(dir, { recursive: true, force: true }); });
const NAMES = ['11111111-1111-4111-8111-111111111111.png', '22222222-2222-4222-8222-222222222222.jpg', '33333333-3333-4333-8333-333333333333.webp'];
function makeSource(root: string) {
  const source = join(root, 'uploads'); mkdirSync(source);
  NAMES.forEach((name, i) => writeFileSync(join(source, name), Buffer.from('imagen-ficticia-' + i + '-'.repeat(i * 1000))));
  return source;
}
const run = (script: string, args: string[], env: Record<string, string> = {}) => {
  const clean = { ...process.env }; delete clean.UPLOAD_DIR;
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...clean, ...env } });
  return { code: result.status, out: result.stdout + result.stderr };
};
const NOW = new Date('2026-10-10T15:30:45.000Z');

test('respaldo: copia cada archivo con nombre fechado, manifiesto firmado y verifica sin errores; el origen queda intacto', async () => {
  const root = workspace(), source = makeSource(root), before = readdirSync(source).sort();
  const { snapshot, manifest } = await lib.createBackup({ source, dir: join(root, 'respaldos'), now: NOW });
  assert.ok(snapshot.endsWith('uploads-20261010-153045'));
  assert.deepEqual(manifest.files.map((f: { path: string }) => f.path), NAMES);
  assert.equal(manifest.totalBytes, manifest.files.reduce((s: number, f: { bytes: number }) => s + f.bytes, 0));
  assert.ok(existsSync(join(snapshot, 'manifest.json.sha256')));
  const verified = await lib.verifyBackup(snapshot);
  assert.equal(verified.manifest.files.length, 3); assert.deepEqual(verified.extra, []);
  assert.deepEqual(readdirSync(source).sort(), before, 'el origen no se modifica');
  await assert.rejects(() => lib.createBackup({ source, dir: join(root, 'respaldos'), now: NOW }), /Ya existe un respaldo/, 'nunca sobrescribe un respaldo existente');
});

test('respaldo: excluye temporales y archivos de sistema sin borrarlos, omite enlaces simbólicos y conserva archivos de usuario con otros nombres', async () => {
  const root = workspace(), source = makeSource(root);
  for (const name of ['subida.tmp', 'parcial.part', '.DS_Store', 'Thumbs.db', 'copia~']) writeFileSync(join(source, name), 'x');
  writeFileSync(join(source, 'logo-antiguo.png'), 'logo'); // archivo de usuario con nombre no UUID: SÍ se respalda
  try { symlinkSync(join(source, NAMES[0]), join(source, 'enlace.png')); } catch { /* sin permiso para enlaces en este sistema: se omite la comprobación */ }
  const { manifest } = await lib.createBackup({ source, dir: join(root, 'r'), now: NOW });
  assert.deepEqual(manifest.excluded.sort(), ['.DS_Store', 'Thumbs.db', 'copia~', 'parcial.part', 'subida.tmp'].sort());
  assert.ok(manifest.files.some((f: { path: string }) => f.path === 'logo-antiguo.png'));
  assert.ok(!manifest.files.some((f: { path: string }) => f.path === 'enlace.png'));
  for (const name of ['subida.tmp', '.DS_Store', 'copia~']) assert.ok(existsSync(join(source, name)), 'lo excluido no se elimina del origen');
});

test('verificación: detecta archivo modificado, faltante, manifiesto alterado o sin firma y rutas peligrosas', async () => {
  const root = workspace(), source = makeSource(root);
  const make = async (stamp: Date) => (await lib.createBackup({ source, dir: join(root, 'r'), now: stamp })).snapshot as string;
  const edited = await make(new Date('2026-10-10T10:00:00Z')); writeFileSync(join(edited, 'files', NAMES[0]), 'alterado');
  await assert.rejects(() => lib.verifyBackup(edited), /tamaño distinto|no coincide/);
  const missing = await make(new Date('2026-10-10T10:00:01Z')); rmSync(join(missing, 'files', NAMES[1]));
  await assert.rejects(() => lib.verifyBackup(missing), /falta/);
  const tampered = await make(new Date('2026-10-10T10:00:02Z')); writeFileSync(join(tampered, 'manifest.json'), readFileSync(join(tampered, 'manifest.json'), 'utf8').replace('"files"', '"files" '));
  await assert.rejects(() => lib.verifyBackup(tampered), /firma del manifiesto no coincide/);
  const unsigned = await make(new Date('2026-10-10T10:00:03Z')); rmSync(join(unsigned, 'manifest.json.sha256'));
  await assert.rejects(() => lib.verifyBackup(unsigned), /Falta manifest.json.sha256/);
  const hostile = (path: string) => JSON.stringify({ format: lib.FORMAT, files: [{ path, bytes: 1, sha256: 'a'.repeat(64) }] });
  for (const path of ['../fuera.png', '/etc/passwd', 'C:/x.png', 'a/../../b.png', 'a\\b.png', '']) assert.throws(() => lib.parseManifest(hostile(path)), /ruta no válida/, path);
});

test('restauración: copia a un destino nuevo o vacío y reproduce exactamente los archivos', async () => {
  const root = workspace(), source = makeSource(root);
  const { snapshot } = await lib.createBackup({ source, dir: join(root, 'r'), now: NOW });
  const target = join(root, 'restaurado');
  assert.equal(lib.validateRestoreTarget({ target, snapshot }), '');
  const result = await lib.restoreBackup({ snapshot, target });
  assert.deepEqual(result, { restored: 3, skipped: 0, conflicts: [] });
  for (const name of NAMES) assert.deepEqual(readFileSync(join(target, name)), readFileSync(join(source, name)));
  const empty = join(root, 'vacio'); mkdirSync(empty);
  assert.equal(lib.validateRestoreTarget({ target: empty, snapshot }), '');
});

test('restauración: nunca sobrescribe; un destino con datos se rechaza y --only-missing solo añade lo que falta', async () => {
  const root = workspace(), source = makeSource(root);
  const { snapshot } = await lib.createBackup({ source, dir: join(root, 'r'), now: NOW });
  const live = join(root, 'vivo'); mkdirSync(live);
  writeFileSync(join(live, NAMES[0]), readFileSync(join(source, NAMES[0]))); // idéntico
  writeFileSync(join(live, NAMES[1]), 'contenido distinto del usuario'); // en conflicto
  assert.match(lib.validateRestoreTarget({ target: live, snapshot }), /no está vacío/);
  await assert.rejects(() => lib.restoreBackup({ snapshot, target: live }), /no se sobrescribe/);
  assert.equal(readFileSync(join(live, NAMES[1]), 'utf8'), 'contenido distinto del usuario', 'lo existente no cambia');
  assert.equal(lib.validateRestoreTarget({ target: live, snapshot, onlyMissing: true }), '');
  const result = await lib.restoreBackup({ snapshot, target: live, onlyMissing: true });
  assert.deepEqual(result, { restored: 1, skipped: 1, conflicts: [NAMES[1]] });
  assert.equal(readFileSync(join(live, NAMES[1]), 'utf8'), 'contenido distinto del usuario');
  assert.deepEqual(readFileSync(join(live, NAMES[2])), readFileSync(join(source, NAMES[2])));
});

test('restauración: un respaldo dañado no escribe nada y los destinos peligrosos se rechazan', async () => {
  const root = workspace(), source = makeSource(root);
  const { snapshot } = await lib.createBackup({ source, dir: join(root, 'r'), now: NOW });
  writeFileSync(join(snapshot, 'files', NAMES[2]), 'dañado');
  const target = join(root, 'destino');
  await assert.rejects(() => lib.restoreBackup({ snapshot, target }), /dañado o incompleto/);
  assert.ok(!existsSync(target), 'no se creó el destino');
  assert.match(lib.validateRestoreTarget({ target: join(snapshot, 'files'), snapshot }), /dentro del respaldo/);
  assert.match(lib.validateRestoreTarget({ target: source, snapshot, live: source }), /--allow-upload-dir/);
  assert.match(lib.validateRestoreTarget({ target: '', snapshot }), /--target/);
  const file = join(root, 'archivo.txt'); writeFileSync(file, 'x');
  assert.match(lib.validateRestoreTarget({ target: file, snapshot }), /no es una carpeta/);
  await assert.rejects(() => lib.createBackup({ source, dir: join(source, 'dentro'), now: NOW }), /dentro de la carpeta de archivos subidos/);
});

test('comandos: respaldo → verificación → restauración de punta a punta, con confirmación obligatoria y mensajes sin trazas', () => {
  const root = workspace(), source = makeSource(root), dir = join(root, 'r');
  const made = run(backupScript, ['--source=' + source, '--dir=' + dir]);
  assert.equal(made.code, 0, made.out); assert.match(made.out, /creado y verificado/); assert.match(made.out, /Archivos: 3/);
  const snapshot = join(dir, readdirSync(dir)[0]);
  const verify = run(restoreScript, ['--from=' + snapshot, '--verify-only']);
  assert.equal(verify.code, 0, verify.out); assert.match(verify.out, /Respaldo íntegro: 3 archivos/);
  const target = join(root, 'ensayo');
  const noConfirm = run(restoreScript, ['--from=' + snapshot, '--target=' + target]);
  assert.equal(noConfirm.code, 1); assert.match(noConfirm.out, /--yes/); assert.ok(!existsSync(target), 'sin --yes no se escribe');
  const restored = run(restoreScript, ['--from=' + snapshot, '--target=' + target, '--yes']);
  assert.equal(restored.code, 0, restored.out); assert.match(restored.out, /Restaurados: 3/);
  assert.deepEqual(readdirSync(target).sort(), NAMES);
  const live = run(restoreScript, ['--from=' + snapshot, '--target=' + source, '--yes'], { UPLOAD_DIR: source });
  assert.equal(live.code, 1); assert.match(live.out, /--allow-upload-dir/);
  const bad = run(backupScript, ['--source=' + join(root, 'no-existe'), '--dir=' + dir]);
  assert.equal(bad.code, 1); assert.match(bad.out, /no existe/); assert.ok(!/\bat \w|node:internal/.test(bad.out), 'sin trazas');
  assert.equal(run(restoreScript, ['--borrar']).code, 1);
});

test('origen sin archivos: se rechaza salvo --allow-empty; lo omitido o temporal no cuenta como contenido', async () => {
  const root = workspace(), empty = join(root, 'vacio'); mkdirSync(empty);
  await assert.rejects(() => lib.createBackup({ source: empty, dir: join(root, 'r') }), /No hay archivos que respaldar.*--allow-empty/);
  assert.ok(!existsSync(join(root, 'r')), 'no se crea ninguna instantánea');
  writeFileSync(join(empty, 'subida.tmp'), 'x'); mkdirSync(join(empty, 'carpeta-vacia'));
  await assert.rejects(() => lib.createBackup({ source: empty, dir: join(root, 'r') }), /solo temporales u omitidos: 1/);
  const allowed = await lib.createBackup({ source: empty, dir: join(root, 'r'), allowEmpty: true, now: NOW });
  assert.equal(allowed.manifest.files.length, 0); assert.ok((await lib.verifyBackup(allowed.snapshot)).manifest.files.length === 0);
  const withFiles = makeSource(workspace());
  assert.equal((await lib.createBackup({ source: withFiles, dir: join(root, 'r2'), now: NOW })).manifest.files.length, 3, 'con archivos no hace falta la opción');
});

test('comando: origen vacío o inexistente falla sin crear respaldo; --allow-empty lo permite expresamente', () => {
  const root = workspace(), empty = join(root, 'vacio'), dir = join(root, 'r'); mkdirSync(empty);
  const refused = run(backupScript, ['--source=' + empty, '--dir=' + dir]);
  assert.equal(refused.code, 1); assert.match(refused.out, /--allow-empty/); assert.ok(!existsSync(dir) || readdirSync(dir).length === 0);
  const missing = run(backupScript, ['--source=' + join(root, 'no-existe'), '--dir=' + dir]);
  assert.equal(missing.code, 1); assert.match(missing.out, /no existe/);
  const allowed = run(backupScript, ['--source=' + empty, '--dir=' + dir, '--allow-empty']);
  assert.equal(allowed.code, 0, allowed.out); assert.match(allowed.out, /Archivos: 0/);
});

test('nombres no admitidos: se omiten y se listan en el manifiesto (los UUID que genera la aplicación sí se respaldan)', async () => {
  const root = workspace(), source = makeSource(root);
  writeFileSync(join(source, 'logo cliente.png'), 'x'); writeFileSync(join(source, 'año.png'), 'y');
  const { manifest } = await lib.createBackup({ source, dir: join(root, 'r'), now: NOW });
  assert.deepEqual(manifest.files.map((f: { path: string }) => f.path), NAMES);
  assert.deepEqual(manifest.skipped.map((s: { path: string; motivo: string }) => [s.path, s.motivo]).sort(), [['año.png', 'nombre no admitido'], ['logo cliente.png', 'nombre no admitido']]);
});
