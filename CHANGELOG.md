# mappel

## 0.3.0

### Minor Changes

- dcf9029: Every map is now written twice — name.json to read, and name.js which installs that map into the page that loads it as an ordinary script tag. `--no-js`, or `js: false` in the config, writes only the json.

## 0.2.0

### Minor Changes

- 6b0f580: Running `mappel` with no arguments now writes every layer a config declares, and `--dist-tag` puts a channel in the url instead of the installed version.

## 0.1.0

### Minor Changes

- c82a39e: The `mappel` command-line tool now reads package manifests and import statements to generate the import map JSON a page needs.
