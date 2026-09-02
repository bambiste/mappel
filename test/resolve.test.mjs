import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickTarget, resolveExport, subpathsOf, packageDir } from '../src/resolve.mjs';

const pkg = (dir, manifest, files = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
};

test('a nested condition resolves to the file, not the object', () => {
  assert.equal(pickTarget({ import: { types: './x.d.ts', default: './x.js' } }), './x.js');
  assert.equal(pickTarget([{ types: './a.d.ts' }, './b.js']), './b.js');
});

test('exports without a dot key is the root entry, not a subpath map', () => {
  const dir = pkg(join(mkdtempSync(join(tmpdir(), 'im-')), 'flat'), {
    name: 'flat',
    version: '1.0.0',
    exports: { types: './d.ts', import: './index.mjs', require: './index.cjs' },
  });
  assert.equal(resolveExport(dir, '.'), './index.mjs');
  assert.equal(resolveExport(dir, './nope'), null);
});

test('a wildcard subpath fills in', () => {
  const dir = pkg(join(mkdtempSync(join(tmpdir(), 'im-')), 'wild'), {
    name: 'wild',
    version: '1.0.0',
    exports: { './css/*': './dist/css/*' },
  });
  assert.equal(resolveExport(dir, './css/button.css'), './dist/css/button.css');
});

test('a package with no root export still lists its subpaths', () => {
  const root = mkdtempSync(join(tmpdir(), 'im-'));
  pkg(join(root, 'packages', 'skin'), {
    name: '@scope/skin',
    version: '1.0.0',
    exports: { './package.json': './package.json', './styles.css': './skin.css', './ripple': './ripple.js' },
  });
  assert.deepEqual(subpathsOf(root, '@scope/skin').sort(), [
    '@scope/skin/ripple',
    '@scope/skin/styles.css',
  ]);
});

test('a workspace folder whose name differs from the package is not mistaken for it', () => {
  const root = mkdtempSync(join(tmpdir(), 'im-'));
  pkg(join(root, 'packages', 'kit'), { name: '@other/kit', version: '1.0.0' });
  assert.equal(packageDir(root, '@scope/kit'), null);
});
