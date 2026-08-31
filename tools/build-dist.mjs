#!/usr/bin/env node
/**
 * build-dist.mjs — makes the distributable copy of the panel.
 *   node tools/build-dist.mjs [--check]
 *
 * Why a package at all, in a project with no build step: HACS copies only the
 * `.js` files it finds for a dashboard plugin, and only from one directory. A
 * panel that links three stylesheets and keeps its modules in `js/` would arrive
 * unstyled and half-missing. So `dist/` is the same code, flattened, with the
 * stylesheets inlined into the entry point and every import version-stamped:
 *
 *   dist/ha_deye.js        the entry (named after the repository, as HACS wants)
 *   dist/<module>.js       the eighteen modules, flat
 *   dist/index.html        the standalone debugging page
 *
 * `--check` regenerates into memory and compares, so CI can fail on a `dist/`
 * that no longer matches the source rather than shipping stale code.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const SRC = join(ROOT, 'deye-dashboard');
const OUT = join(ROOT, 'dist');
const ENTRY_OUT = 'ha_deye.js';          // must match the repository name for HACS
const CSS_FILES = ['dashboard.css', 'components.css', 'responsive.css'];

const version = (() => {
  const m = readFileSync(join(SRC, 'js', 'config.js'), 'utf8').match(/export const VERSION = '([^']+)'/);
  if (!m) throw new Error('VERSION not found in js/config.js');
  return m[1];
})();

/** `from './x.js'` → `from './x.js?v=1.2.3'`, and the entry's `./js/x.js` → `./x.js`. */
const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+?\.js)(['"])/g;
function rewriteImports(src, { flatten = false } = {}) {
  return src.replace(IMPORT_RE, (all, kw, q, spec, q2) => {
    if (spec.includes('?')) return all;
    let out = spec;
    if (flatten) out = out.replace(/^\.\/js\//, './');
    return `${kw}${q}${out}?v=${version}${q2}`;
  });
}

/** The stylesheets, concatenated in load order, as a JS string literal. */
function inlineCss() {
  const parts = CSS_FILES.map((name) => {
    const text = readFileSync(join(SRC, 'css', name), 'utf8');
    return `/* ${name} */\n${text}`;
  });
  return JSON.stringify(parts.join('\n'));
}

function build() {
  const files = new Map();

  // 1. the entry: flattened imports, inlined stylesheets, no ?v= on the entry
  //    itself (panel_custom or the resource URL carries that).
  let entry = readFileSync(join(SRC, 'deye-dashboard.js'), 'utf8');
  entry = rewriteImports(entry, { flatten: true });
  entry = entry.replace("const INLINE_CSS = '';", `const INLINE_CSS = ${inlineCss()};`);
  if (!/const INLINE_CSS = "/.test(entry)) throw new Error('the INLINE_CSS placeholder was not replaced');
  entry = entry.replace('/local/deye-dashboard/deye-dashboard.js', '/hacsfiles/ha_deye/ha_deye.js');
  files.set(ENTRY_OUT, entry);

  // 2. the modules, flat, imports stamped
  for (const name of readdirSync(join(SRC, 'js')).filter((f) => f.endsWith('.js')).sort()) {
    files.set(name, rewriteImports(readFileSync(join(SRC, 'js', name), 'utf8')));
  }

  // 3. the standalone page, pointed at the packaged entry
  // The favicon lives in assets/, which HACS would not copy, and a page with no
  // icon at all makes the browser ask for /favicon.ico. Inlining it keeps the
  // package self-contained and free of 404s.
  const icon = readFileSync(join(SRC, 'assets', 'icon.svg'), 'utf8');
  const iconHref = `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`;
  const html = readFileSync(join(SRC, 'index.html'), 'utf8')
    .replace('./deye-dashboard.js', `./${ENTRY_OUT}`)
    .replace('href="assets/icon.svg"', `href="${iconHref}"`);
  files.set('index.html', html);

  return files;
}

const built = build();
const check = process.argv.includes('--check');

if (check) {
  const problems = [];
  for (const [name, text] of built) {
    const path = join(OUT, name);
    if (!existsSync(path)) { problems.push(`${name}: missing from dist/`); continue; }
    if (readFileSync(path, 'utf8') !== text) problems.push(`${name}: dist/ differs from the source`);
  }
  const extra = existsSync(OUT) ? readdirSync(OUT).filter((f) => !built.has(f)) : [];
  for (const f of extra) problems.push(`${f}: in dist/ but not produced by the build`);
  if (problems.length) {
    console.error('dist/ is out of date — run `node tools/build-dist.mjs`:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log(`dist/ matches the source (${built.size} files, version ${version})`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const [name, text] of built) writeFileSync(join(OUT, name), text);
  const bytes = [...built.values()].reduce((a, t) => a + Buffer.byteLength(t), 0);
  console.log(`dist/: ${built.size} files, ${(bytes / 1024).toFixed(0)} KB, version ${version}`);
  console.log(`  entry ${ENTRY_OUT}, ${CSS_FILES.length} stylesheets inlined, imports stamped ?v=${version}`);
}
