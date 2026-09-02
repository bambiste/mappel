# @bambiste/import-map

This package builds an import map from what a workspace actually imports. It reads package manifests and import statements, and writes JSON. It does not bundle or build anything.

The browser resolves a bare specifier only through an import map and never reads package.json. Every transitive subpath has to be listed — including the ones a package reaches through its own dependencies. Written by hand, that list is wrong within a release.

It resolves each specifier through the package's own exports map — nested conditions, wildcards, and the form with no "." key — then walks the files it finds for more specifiers. It reports what it could not resolve rather than emitting a map that fails in the browser.

A repo declares named layers in importmap.config.mjs, and a layer can exclude what another already resolves, so a page loads two maps and neither repeats the other. Layers can also drop a whole scope by prefix. A css specifier maps to a `.js` sibling that adds the file as a link, because a browser cannot import a stylesheet as a module. Pass `--css link` to get the specifier mapped away and the link tags printed instead.

```sh
import-map --layer min                          # to stdout, urls pinned to installed versions
import-map --layer components --split dist/     # one file per package in the layer
import-map --layer foundation --target local    # workspace paths, for a dev server
import-map --layer min --html                   # ready to paste into a page
```

```js
// importmap.config.mjs
export default {
  layers: {
    base: { packages: ['@scope/core', '@scope/dom'] },
    extra: { packages: ['@scope/extra'], excludes: ['base'] },
  },
};
```
