import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { manifest, packageDir, resolveExport, splitSpecifier, subpathsOf } from './resolve.mjs';

const IMPORT_RE = /(?:from|import)\s*["']([^"']+)["']/g;

function scanImports(file) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const found = [];
  for (const [, spec] of src.matchAll(IMPORT_RE)) {
    // Doc comments quote specifiers too; a real one has no whitespace or `${}`.
    if (/\s|\$\{/.test(spec)) continue;
    found.push(spec);
  }
  return found;
}

/**
 * Walk from a set of specifiers to every bare specifier reachable from them,
 * mapped to a url a browser can fetch.
 */
export function collect(specifiers, options) {
  const {
    root,
    target = 'cdn',
    cdn = 'https://unpkg.com',
    css = 'loader',
    workspaces,
    // The version in the url. A manifest version pins the map to exactly what was
    // installed when it was written, which is what a published map wants. A dist
    // tag follows a channel instead, so a page tracks it without being rebuilt —
    // at the cost of the page changing when the channel does.
    distTag = null,
  } = options;
  const imports = {};
  const stylesheets = new Set();
  const unresolved = new Set();
  const visited = new Set();

  const urlFor = (name, dir, file) => {
    const clean = file.replace(/^\.\//, '');
    if (target === 'local') return '/' + relative(root, join(dir, clean)).split('\\').join('/');
    const version = distTag === 'none' ? '' : '@' + (distTag || manifest(dir).version);
    return `${cdn}/${name}${version}/${clean}`;
  };

  const add = (spec) => {
    if (visited.has(spec)) return;
    visited.add(spec);

    const { pkg, sub } = splitSpecifier(spec);
    const dir = packageDir(root, pkg, workspaces);
    if (!dir) return void unresolved.add(spec);

    const file = resolveExport(dir, sub);
    if (!file) return void unresolved.add(spec);

    if (spec.endsWith('.css')) {
      stylesheets.add(urlFor(pkg, dir, file));
      // A browser cannot import a stylesheet as a module. The loader sibling adds
      // it as a <link>, so importing a component still brings its styles.
      imports[spec] = css === 'loader' ? urlFor(pkg, dir, file + '.js') : 'data:text/javascript,';
      return;
    }

    imports[spec] = urlFor(pkg, dir, file);

    const entry = join(dir, file.replace(/^\.\//, ''));
    const seen = new Set();
    const stack = [entry];
    while (stack.length) {
      const current = stack.pop();
      if (seen.has(current) || !existsSync(current)) continue;
      seen.add(current);
      for (const nested of scanImports(current)) {
        if (nested.startsWith('.')) {
          const next = normalize(join(dirname(current), nested));
          stack.push(existsSync(next) ? next : next + '.js');
        } else if (!nested.startsWith('node:')) {
          add(nested);
        }
      }
    }
  };

  for (const spec of specifiers) add(spec);
  return { imports, stylesheets: [...stylesheets], unresolved: [...unresolved] };
}

const sorted = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Build one named layer. `excludes` names other layers whose entries this one
 * leaves out, so a page loading both is not handed the same entry twice.
 */
export function buildLayer(name, config, options) {
  const layer = config.layers[name];
  if (!layer) throw new Error(`[import-map] no layer named "${name}"`);

  const resolveList = (list) => (typeof list === 'function' ? list(helpers(options)) : list);
  const mine = collect(resolveList(layer.packages), { ...options, ...config.options });

  const skip = new Set();
  for (const other of layer.excludes ?? []) {
    const theirs = collect(resolveList(config.layers[other].packages), { ...options, ...config.options });
    for (const key of Object.keys(theirs.imports)) skip.add(key);
  }

  const imports = {};
  for (const [key, value] of Object.entries(mine.imports)) {
    if (skip.has(key)) continue;
    if ((layer.excludePrefixes ?? []).some((p) => key.startsWith(p))) continue;
    imports[key] = value;
  }
  return { imports: sorted(imports), stylesheets: mine.stylesheets, unresolved: mine.unresolved };
}

function helpers(options) {
  return {
    subpathsOf: (name) => subpathsOf(options.root, name, options.workspaces),
    root: options.root,
  };
}

export { subpathsOf, packageDir, resolveExport };

/**
 * Write every layer a config declares, plus any per-item split it asks for.
 * This is what `mappel` does with no arguments: the config says where the
 * workspace is and where the files go, so a repo needs no script of its own.
 */
export function writeAll(config, options) {
  const out = options.out;
  mkdirSync(out, { recursive: true });

  const written = [];
  for (const name of Object.keys(config.layers)) {
    const { imports } = buildLayer(name, config, options);
    const file = join(out, `${name}.json`);
    writeFileSync(file, JSON.stringify({ imports }, null, 2) + '\n');
    written.push({ file, entries: Object.keys(imports).length });
  }

  // A combined file, for engines that take only one import map. Several maps in
  // one page need Chromium 133 or newer. A layer of the same name means the config
  // already has one, and writing both would silently overwrite the layer's file.
  const combined = config.full === true || config.full === undefined ? 'full' : config.full;
  if (config.full !== false && config.layers[combined]) {
    throw new Error(
      `[mappel] a layer is named "${combined}" and the combined file would overwrite it. ` +
        `Set full: false, or full: "<other-name>".`,
    );
  }
  if (config.full !== false) {
    const imports = {};
    for (const name of Object.keys(config.layers)) {
      Object.assign(imports, buildLayer(name, config, options).imports);
    }
    const file = join(out, `${combined}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        { imports: Object.fromEntries(Object.entries(imports).sort(([a], [b]) => a.localeCompare(b))) },
        null,
        2,
      ) + '\n',
    );
    written.push({ file, entries: Object.keys(imports).length });
  }

  for (const [layerName, target] of Object.entries(config.split ?? {})) {
    const dir = join(out, target);
    mkdirSync(dir, { recursive: true });
    const layer = config.layers[layerName];
    const names =
      typeof layer.packages === 'function'
        ? layer.packages({
            subpathsOf: (n) => subpathsOf(options.root, n, options.workspaces),
            root: options.root,
          })
        : layer.packages;
    let count = 0;
    for (const name of names) {
      const one = buildLayer(
        layerName,
        { ...config, layers: { ...config.layers, [layerName]: { ...layer, packages: [name] } } },
        options,
      );
      if (Object.keys(one.imports).length === 0) continue;
      writeFileSync(
        join(dir, name.split('/').pop() + '.json'),
        JSON.stringify({ imports: one.imports }, null, 2) + '\n',
      );
      count += 1;
    }
    written.push({ file: `${dir}/*.json`, entries: count, split: true });
  }

  return written;
}
