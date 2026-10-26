import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const start = require('../scripts/container-start.cjs');

test('container start only fixes UPLOAD_DIR strictly under /data/', () => {
  assert.equal(start.uploadDirToFix({}), '/data/uploads');
  assert.equal(start.uploadDirToFix({ UPLOAD_DIR: '/data/uploads/' }), '/data/uploads');
  assert.equal(start.uploadDirToFix({ UPLOAD_DIR: '/data/a/b' }), '/data/a/b');
  for (const outside of ['/data', '/data/', '/data/../etc', '/data/x/../../etc', '/database', '/etc', 'data/uploads', 'relative']) {
    assert.equal(start.uploadDirToFix({ UPLOAD_DIR: outside }), null, outside);
  }
});

function fakeFs(tree: Record<string, string[]>, dirs: Set<string>) {
  const calls: string[] = [];
  return {
    calls,
    mkdirSync: (dir: string) => { calls.push(`mkdir ${dir}`); },
    lchownSync: (p: string, uid: number, gid: number) => { calls.push(`lchown ${p} ${uid}:${gid}`); },
    chownSync: () => { throw new Error('chown sigue enlaces: no debe usarse'); },
    readdirSync: (dir: string) => (tree[dir] || []).map((name) => ({
      name,
      isDirectory: () => dirs.has(`${dir}/${name}`),
    })),
  };
}

test('container start changes ownership with lchown and never descends into non-directories', () => {
  // "link" representa un enlace simbólico a /etc: readdir con withFileTypes no lo marca como directorio.
  const fs = fakeFs({ '/data/uploads': ['a', 'sub', 'link'], '/data/uploads/sub': ['b'] }, new Set(['/data/uploads/sub']));
  start.chownTree('/data/uploads', 1000, 1000, fs);
  assert.deepEqual(fs.calls, [
    'lchown /data/uploads 1000:1000',
    'lchown /data/uploads/a 1000:1000',
    'lchown /data/uploads/sub 1000:1000',
    'lchown /data/uploads/sub/b 1000:1000',
    'lchown /data/uploads/link 1000:1000',
  ]);
});

function fakeProc(uid: number, env: Record<string, string> = {}, opts: { failSetuid?: boolean } = {}) {
  const state = { uid, gid: uid, groups: [0, 10], order: [] as string[] };
  return {
    state,
    env,
    getuid: () => state.uid, geteuid: () => state.uid,
    getgid: () => state.gid, getegid: () => state.gid,
    getgroups: () => state.groups,
    setgroups: (g: number[]) => { state.order.push('setgroups'); state.groups = g; },
    setgid: (g: number) => { state.order.push('setgid'); state.gid = g; },
    setuid: (u: number) => { state.order.push('setuid'); if (!opts.failSetuid) state.uid = u; },
  };
}

test('container start as root fixes the volume and then drops root in the safe order', () => {
  const proc = fakeProc(0, { UPLOAD_DIR: '/data/uploads' });
  const fs = fakeFs({}, new Set());
  start.prepare(proc, fs);
  assert.deepEqual(fs.calls, ['mkdir /data/uploads', 'lchown /data/uploads 1000:1000']);
  assert.deepEqual(proc.state.order, ['setgroups', 'setgid', 'setuid']);
  assert.equal(proc.state.uid, 1000);
  assert.equal(proc.state.gid, 1000);
  assert.deepEqual(proc.state.groups, [1000]);
});

test('container start as root with UPLOAD_DIR outside /data/ still drops root without touching files', () => {
  const proc = fakeProc(0, { UPLOAD_DIR: '/etc' });
  const fs = fakeFs({}, new Set());
  start.prepare(proc, fs);
  assert.deepEqual(fs.calls, []);
  assert.equal(proc.state.uid, 1000);
});

test('container start without root changes nothing', () => {
  const proc = fakeProc(1000, { UPLOAD_DIR: '/data/uploads' });
  const fs = fakeFs({}, new Set());
  start.prepare(proc, fs);
  assert.deepEqual(fs.calls, []);
  assert.deepEqual(proc.state.order, []);
});

test('container start refuses to continue if root could not be dropped', () => {
  const proc = fakeProc(0, {}, { failSetuid: true });
  assert.throws(() => start.prepare(proc, fakeFs({}, new Set())), /privilegios de root/);
});

test('runtime image is distroless, pinned by digest, without shell CMD and with a non-root user', () => {
  const dockerfile = readFileSync(join(__dirname, '..', 'Dockerfile'), 'utf8');
  const froms = dockerfile.split(/\r?\n/).filter((l) => /^FROM\s/.test(l));
  for (const from of froms) {
    const image = from.split(/\s+/)[1];
    if (/^[a-z-]+$/.test(image)) continue; // referencia a una etapa anterior
    assert.match(image, /@sha256:[0-9a-f]{64}$/, `Base sin digest: ${from}`);
  }
  // El workflow de GHCR exige esta línea (etapa de construcción).
  assert.match(dockerfile, /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64}/m);
  assert.match(dockerfile, /^FROM gcr\.io\/distroless\/nodejs22-debian13@sha256:[0-9a-f]{64} AS distroless-base$/m);
  assert.match(dockerfile, /^FROM distroless-base AS runtime$/m);
  assert.match(dockerfile, /^USER 1000:1000$/m);
  assert.match(dockerfile, /^CMD \["scripts\/container-start\.cjs"\]$/m);
  const instructions = dockerfile.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(instructions, /sh -c|setpriv/);
  assert.match(dockerfile, /npm ci --omit=dev --omit=optional --omit=peer --ignore-scripts/);
});
