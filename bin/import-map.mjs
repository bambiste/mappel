#!/usr/bin/env node
// Emit the import map a page needs, from the layers a repo defines.
//
//   import-map --layer min
//   import-map --layer components --split dist/components
//   import-map --layer foundation --target local --html
//
// Layers come from importmap.config.mjs in the repo this runs in, so the tool
// stays generic and the policy stays where it belongs.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLayer, subpathsOf } from '../src/index.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

// The repo being scanned, not where this tool is installed — it lives in
// node_modules, and every path it resolves hangs off this.
const root = resolvePath(flag('root', process.cwd()));
const configPath = resolvePath(flag('config', join(root, 'importmap.config.mjs')));

let config;
try {
  config = (await import(pathToFileURL(configPath).href)).default;
} catch (error) {
  process.stderr.write(`[import-map] cannot read ${configPath}\n  ${error.message}\n`);
  process.exit(2);
}

const options = {
  root,
  target: flag('target', 'cdn'),
  cdn: flag('cdn', 'https://unpkg.com'),
  css: flag('css', 'loader'),
  workspaces: config.workspaces ?? ['packages'],
};

const layerName = flag('layer', Object.keys(config.layers)[0]);
const splitInto = flag('split', null);

if (splitInto) {
  const layer = config.layers[layerName];
  const names =
    typeof layer.packages === 'function'
      ? layer.packages({ subpathsOf: (n) => subpathsOf(root, n, options.workspaces), root })
      : layer.packages;
  mkdirSync(splitInto, { recursive: true });
  let written = 0;
  for (const name of names) {
    const one = buildLayer(
      layerName,
      { ...config, layers: { ...config.layers, [layerName]: { ...layer, packages: [name] } } },
      options,
    );
    if (Object.keys(one.imports).length === 0) continue;
    writeFileSync(
      join(splitInto, name.split('/').pop() + '.json'),
      JSON.stringify({ imports: one.imports }, null, 2) + '\n',
    );
    written += 1;
  }
  process.stderr.write(`wrote ${written} maps to ${splitInto}\n`);
  process.exit(0);
}

const { imports, stylesheets, unresolved } = buildLayer(layerName, config, options);
const json = JSON.stringify({ imports }, null, 2);

const out = flag('out', null);
if (out) {
  writeFileSync(out, json + '\n');
  process.stderr.write(`wrote ${out} — ${Object.keys(imports).length} entries\n`);
} else if (has('html')) {
  const links =
    options.css === 'link'
      ? stylesheets.map((href) => `<link rel="stylesheet" href="${href}" />`).join('\n')
      : '';
  process.stdout.write(`<script type="importmap">\n${json}\n</script>\n${links ? links + '\n' : ''}`);
} else {
  process.stdout.write(json + '\n');
}

if (unresolved.length) {
  process.stderr.write('\nnot in the map (check they are installed):\n');
  for (const u of unresolved.sort()) process.stderr.write(`  ${u}\n`);
}
