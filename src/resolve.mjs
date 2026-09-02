import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const manifests = new Map();

export function manifest(dir) {
  if (!manifests.has(dir)) {
    manifests.set(dir, JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')));
  }
  return manifests.get(dir);
}

export function splitSpecifier(spec) {
  const parts = spec.split('/');
  const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const sub = spec.length > pkg.length ? '.' + spec.slice(pkg.length) : '.';
  return { pkg, sub };
}

/**
 * Where a package lives. A workspace folder wins over an installed copy, and
 * pnpm's store is searched last: it keeps the real files under
 * .pnpm/<name>@<version>/node_modules/<name>, and a package only appears at the
 * top level when something depends on it directly.
 */
export function packageDir(root, name, workspaces = ['packages']) {
  for (const dir of workspaces) {
    const local = join(root, dir, name.split('/').pop());
    if (existsSync(join(local, 'package.json'))) {
      try {
        if (manifest(local).name === name) return local;
      } catch {
        /* not a manifest we can read */
      }
    }
  }
  const installed = join(root, 'node_modules', name);
  if (existsSync(join(installed, 'package.json'))) return installed;

  const store = join(root, 'node_modules', '.pnpm');
  if (existsSync(store)) {
    const prefix = name.replace('/', '+') + '@';
    for (const dir of readdirSync(store).filter((d) => d.startsWith(prefix)).sort().reverse()) {
      const real = join(store, dir, 'node_modules', name);
      if (existsSync(join(real, 'package.json'))) return real;
    }
  }
  return null;
}

/** Conditions nest, and `{ import: { types, default } }` is as common as a string. */
export function pickTarget(entry) {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    for (const alt of entry) {
      const found = pickTarget(alt);
      if (found) return found;
    }
    return null;
  }
  if (entry && typeof entry === 'object') {
    for (const key of ['browser', 'import', 'default', 'require']) {
      if (entry[key] === undefined) continue;
      const found = pickTarget(entry[key]);
      if (found) return found;
    }
  }
  return null;
}

export function resolveExport(dir, sub) {
  const m = manifest(dir);
  const exp = m.exports;
  if (!exp) return sub === '.' ? m.module || m.main || null : null;
  // No key starting with '.' means `exports` is a bare set of conditions that IS
  // the root entry — `{ import, require, types }` — rather than a subpath map.
  if (!Object.keys(exp).some((k) => k.startsWith('.'))) {
    return sub === '.' ? pickTarget(exp) : null;
  }
  if (exp[sub] !== undefined) return pickTarget(exp[sub]);
  for (const [pattern, entry] of Object.entries(exp)) {
    if (!pattern.includes('*')) continue;
    const [before, after] = pattern.split('*');
    if (sub.startsWith(before) && sub.endsWith(after)) {
      const filled = sub.slice(before.length, sub.length - (after.length || 0));
      const target = pickTarget(entry);
      if (target) return target.replace('*', filled);
    }
  }
  return null;
}

/** A package with no root export still has subpaths worth mapping. */
export function subpathsOf(root, name, workspaces) {
  const dir = packageDir(root, name, workspaces);
  if (!dir) return [];
  const exp = manifest(dir).exports || {};
  return Object.keys(exp)
    .filter((k) => k.startsWith('./') && k !== './package.json')
    .map((k) => name + k.slice(1));
}
