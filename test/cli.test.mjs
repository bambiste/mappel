import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'mappel.mjs');

/** A workspace whose config sets every option, so the flags have something to beat. */
function fixture(configExtra = '') {
  const root = mkdtempSync(join(tmpdir(), 'mappel-cli-'));
  const dir = join(root, 'packages', 'base');
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: '@w/base', version: '1.0.0', exports: { '.': './dist/index.js' } }),
  );
  writeFileSync(join(dir, 'dist', 'index.js'), '');
  writeFileSync(
    join(root, 'mappel.config.mjs'),
    `export default {
       out: 'maps',
       cdn: 'https://config.example',
       distTag: 'from-config',
       layers: { base: { packages: ['@w/base'] } },
       ${configExtra}
     };`,
  );
  return root;
}

test('a flag beats the same option in the config', async () => {
  const root = fixture();
  const { stdout } = await run('node', [cli, '--layer', 'base', '--cdn', 'https://flag.example', '--dist-tag', 'from-flag'], { cwd: root });
  const url = JSON.parse(stdout).imports['@w/base'];
  assert.match(url, /^https:\/\/flag\.example/, 'the --cdn flag wins');
  assert.match(url, /@w\/base@from-flag\//, 'the --dist-tag flag wins');
});

test('the config supplies what no flag does', async () => {
  const root = fixture();
  const { stdout } = await run('node', [cli, '--layer', 'base'], { cwd: root });
  const url = JSON.parse(stdout).imports['@w/base'];
  assert.match(url, /^https:\/\/config\.example/);
  assert.match(url, /@w\/base@from-config\//);
});

test('with no arguments it finds the config above the cwd and writes its out', async () => {
  const root = fixture();
  const deep = join(root, 'packages', 'base');
  await run('node', [cli], { cwd: deep });
  assert.deepEqual(readdirSync(join(root, 'maps')).sort(), ['base.js', 'base.json', 'full.js', 'full.json']);
});

test('--out beats the config out', async () => {
  const root = fixture();
  await run('node', [cli, '--out', join(root, 'elsewhere')], { cwd: root });
  assert.deepEqual(readdirSync(join(root, 'elsewhere')).sort(), ['base.js', 'base.json', 'full.js', 'full.json']);
});

test('--no-js beats js: true in the config', async () => {
  const root = fixture('js: true,');
  await run('node', [cli, '--no-js'], { cwd: root });
  assert.deepEqual(readdirSync(join(root, 'maps')).sort(), ['base.json', 'full.json']);
});

test('it says where to look when there is no config', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'mappel-none-'));
  await assert.rejects(
    () => run('node', [cli], { cwd: empty }),
    (error) => /no mappel\.config\.mjs/.test(error.stderr),
  );
});
