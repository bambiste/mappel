#!/usr/bin/env node
// Write the import maps a workspace declares.
//
//   mappel                          every layer in mappel.config.mjs, to its `out`
//   mappel --layer min              one layer, to stdout
//   mappel --config packages/cdn/mappel.config.mjs --out dist
//   mappel --layer min --dist-tag alpha --html
//   mappel --no-js                  maps only, without their script siblings
//
// With no arguments it finds mappel.config.mjs by walking up from the current
// directory, so a package's build script is just `mappel`. Every map is written
// twice: `<name>.json` to read, and `<name>.js` to load from a page.

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLayer, writeAll, writeMap, subpathsOf } from '../src/index.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const NAMES = ['mappel.config.mjs', 'mappel.config.js', 'importmap.config.mjs'];

function findConfig(from) {
  let dir = resolvePath(from);
  while (true) {
    for (const name of NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const explicit = flag('config', null);
const configPath = explicit ? resolvePath(explicit) : findConfig(process.cwd());
if (!configPath) {
  process.stderr.write(
    `[mappel] no ${NAMES[0]} here or above ${process.cwd()}\n` +
      `  point at one with --config, or see https://github.com/bambiste/mappel\n`,
  );
  process.exit(2);
}

let config;
try {
  config = (await import(pathToFileURL(configPath).href)).default;
} catch (error) {
  process.stderr.write(`[mappel] cannot read ${configPath}\n  ${error.message}\n`);
  process.exit(2);
}

// The config lives at the root of what it describes unless it says otherwise, so
// a path in it reads relative to the file rather than to where this was run from.
const base = dirname(configPath);
const root = resolvePath(flag('root', config.root ? join(base, config.root) : base));

const options = {
  root,
  target: flag('target', config.target ?? 'cdn'),
  cdn: flag('cdn', config.cdn ?? 'https://unpkg.com'),
  css: flag('css', config.css ?? 'loader'),
  distTag: flag('dist-tag', config.distTag ?? null),
  workspaces: config.workspaces ?? ['packages'],
};

const layerName = flag('layer', null);
const splitInto = flag('split', null);

// Each map gets a script sibling that installs it. `--no-js` writes only JSON.
const settings = { ...config, js: has('no-js') ? false : has('js') ? true : config.js };

if (!layerName && !splitInto) {
  const out = resolvePath(flag('out', config.out ? join(base, config.out) : join(base, 'dist')));
  const written = writeAll(settings, { ...options, out });
  for (const { file, entries, split } of written) {
    process.stderr.write(`  ${file} — ${entries} ${split ? 'files' : 'entries'}\n`);
  }
  process.exit(0);
}

if (splitInto) {
  const dir = resolvePath(splitInto);
  mkdirSync(dir, { recursive: true });
  const layer = config.layers[layerName];
  const names =
    typeof layer.packages === 'function'
      ? layer.packages({ subpathsOf: (n) => subpathsOf(root, n, options.workspaces), root })
      : layer.packages;
  let written = 0;
  for (const name of names) {
    const one = buildLayer(
      layerName,
      { ...config, layers: { ...config.layers, [layerName]: { ...layer, packages: [name] } } },
      options,
    );
    if (Object.keys(one.imports).length === 0) continue;
    writeMap(join(dir, name.split('/').pop() + '.json'), one.imports, settings);
    written += 1;
  }
  process.stderr.write(`wrote ${written} maps to ${dir}\n`);
  process.exit(0);
}

const { imports, stylesheets, unresolved } = buildLayer(layerName, config, options);
const json = JSON.stringify({ imports }, null, 2);
const out = flag('out', null);

if (out) {
  if (out.endsWith('.json')) writeMap(out, imports, settings);
  else writeFileSync(out, json + '\n');
  process.stderr.write(`wrote ${out} — ${Object.keys(imports).length} entries\n`);
} else if (has('html')) {
  const links =
    options.css === 'link' ? stylesheets.map((h) => `<link rel="stylesheet" href="${h}" />`).join('\n') : '';
  process.stdout.write(`<script type="importmap">\n${json}\n</script>\n${links ? links + '\n' : ''}`);
} else {
  process.stdout.write(json + '\n');
}

if (unresolved.length) {
  process.stderr.write('\nnot in the map (check they are installed):\n');
  for (const u of unresolved.sort()) process.stderr.write(`  ${u}\n`);
}
