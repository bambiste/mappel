import { readFileSync, existsSync } from 'node:fs';
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
  const { root, target = 'cdn', cdn = 'https://unpkg.com', css = 'loader', workspaces } = options;
  const imports = {};
  const stylesheets = new Set();
  const unresolved = new Set();
  const visited = new Set();

  const urlFor = (name, dir, file) => {
    const clean = file.replace(/^\.\//, '');
    return target === 'local'
      ? '/' + relative(root, join(dir, clean)).split('\\').join('/')
      : `${cdn}/${name}@${manifest(dir).version}/${clean}`;
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
