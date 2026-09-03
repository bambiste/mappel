import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLayer } from '../src/index.mjs';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'im-'));
  const add = (name, manifest, entry = '') => {
    const dir = join(root, 'packages', name.split('/').pop());
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }));
    writeFileSync(join(dir, 'dist', 'index.js'), entry);
  };
  add('@w/base', { exports: { '.': './dist/index.js' } });
  add('@w/leaf', { exports: { '.': './dist/index.js' } }, "import '@w/base';");
  return root;
}

test('a layer leaves out what another layer already resolves', () => {
  const root = workspace();
  const config = {
    layers: {
      base: { packages: ['@w/base'] },
      leaf: { packages: ['@w/leaf'], excludes: ['base'] },
    },
  };
  const base = buildLayer('base', config, { root });
  const leaf = buildLayer('leaf', config, { root });

  assert.deepEqual(Object.keys(base.imports), ['@w/base']);
  assert.deepEqual(Object.keys(leaf.imports), ['@w/leaf'], 'the base entry is not repeated');
});

test('excludePrefixes drops a whole scope', () => {
  const root = workspace();
  const config = {
    layers: { leaf: { packages: ['@w/leaf'], excludePrefixes: ['@w/b'] } },
  };
  assert.deepEqual(Object.keys(buildLayer('leaf', config, { root }).imports), ['@w/leaf']);
});

test('entries come out sorted, so the same input gives the same file', () => {
  const root = workspace();
  const config = { layers: { all: { packages: ['@w/leaf', '@w/base'] } } };
  const keys = Object.keys(buildLayer('all', config, { root }).imports);
  assert.deepEqual(keys, [...keys].sort());
});

test('a dist tag replaces the pinned version, and none drops it', () => {
  const root = workspace();
  const config = { layers: { base: { packages: ['@w/base'] } } };
  const pinned = buildLayer('base', config, { root });
  const tagged = buildLayer('base', config, { root, distTag: 'alpha' });
  const floating = buildLayer('base', config, { root, distTag: 'none' });

  assert.match(pinned.imports['@w/base'], /@w\/base@1\.0\.0\//);
  assert.match(tagged.imports['@w/base'], /@w\/base@alpha\//);
  assert.match(floating.imports['@w/base'], /unpkg\.com\/@w\/base\/dist/);
});

test('writeAll writes a file per layer plus the combined one', async () => {
  const { mkdtempSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { writeAll } = await import('../src/index.mjs');

  const root = workspace();
  const out = join(mkdtempSync(join(tmpdir(), 'im-out-')), 'maps');
  const config = {
    layers: { base: { packages: ['@w/base'] }, leaf: { packages: ['@w/leaf'], excludes: ['base'] } },
  };
  writeAll(config, { root, out });
  assert.deepEqual(readdirSync(out).sort(), ['base.json', 'full.json', 'leaf.json']);
});
