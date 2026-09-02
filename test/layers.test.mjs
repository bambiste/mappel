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
