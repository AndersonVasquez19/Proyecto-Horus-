import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as ts from 'typescript';

const backend = resolve(__dirname, '..');
const cli = require.resolve('@nestjs/cli/bin/nest.js');
const manifest = JSON.parse(readFileSync(join(backend, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

function configuration(file: string, directory = backend) {
  const filename = join(directory, file);
  const read = ts.readConfigFile(filename, ts.sys.readFile);
  assert.equal(read.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, directory, undefined, filename);
  assert.deepEqual(parsed.errors, []);
  return parsed;
}

test('development commands isolate their output and incremental cache from production', () => {
  const production = configuration('tsconfig.build.json');
  for (const command of ['start', 'start:dev', 'start:debug']) {
    const configPath = manifest.scripts[command].match(/--path\s+(\S+)/)?.[1];
    assert.ok(configPath, command + ' must choose its development configuration');
    const development = configuration(configPath);
    assert.notEqual(development.options.outDir, production.options.outDir);
    assert.equal(dirname(development.options.tsBuildInfoFile!), development.options.outDir);
    assert.ok(development.fileNames.some(file => file.endsWith('deployment.config.ts')));
    assert.ok(development.fileNames.every(file => !file.replace(/\\/g, '/').includes('/test/')));
  }
});

test('production rebuilds preserve the running development modules', { timeout: 30000 }, () => {
  const temporaryRoot = realpathSync(tmpdir());
  const fixture = mkdtempSync(join(temporaryRoot, 'horus-build-output-'));
  const build = (config: string) => {
    const result = spawnSync(process.execPath, [cli, 'build', '--path', config], {
      cwd: fixture, encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  try {
    for (const file of ['tsconfig.json', 'tsconfig.build.json', 'tsconfig.dev.json', 'nest-cli.json']) {
      copyFileSync(join(backend, file), join(fixture, file));
    }
    mkdirSync(join(fixture, 'src'));
    writeFileSync(join(fixture, 'src/deployment.config.ts'), 'export const port = 3000;\n');
    writeFileSync(join(fixture, 'src/main.ts'), "import { port } from './deployment.config'; export const runtimePort = port;\n");

    build('tsconfig.dev.json');
    const developmentOutput = configuration('tsconfig.dev.json', fixture).options.outDir!;
    const productionOutput = configuration('tsconfig.build.json', fixture).options.outDir!;
    const marker = join(developmentOutput, 'running.marker');
    writeFileSync(marker, 'development server is running');
    const developmentModule = readFileSync(join(developmentOutput, 'deployment.config.js'), 'utf8');

    for (let iteration = 0; iteration < 2; iteration++) {
      build('tsconfig.build.json');
      assert.ok(existsSync(marker), 'production cleanup must not delete development files');
      assert.equal(readFileSync(join(developmentOutput, 'deployment.config.js'), 'utf8'), developmentModule);
      for (const output of [developmentOutput, productionOutput]) {
        const result = spawnSync(process.execPath, ['-e', "const entry=require(process.argv[1]); if(entry.runtimePort!==3000)process.exit(1)", join(output, 'main.js')], {
          encoding: 'utf8', timeout: 5000, windowsHide: true,
        });
        assert.equal(result.status, 0, result.stderr);
      }
    }
  } finally {
    assert.equal(dirname(fixture), temporaryRoot);
    rmSync(fixture, { recursive: true, force: true });
  }
});
