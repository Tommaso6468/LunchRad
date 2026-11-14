#!/usr/bin/env node
// Writes dist/app/browser/sw.js from app/sw/sw.js with the list of built
// files to precache and a version derived from their contents. Runs after
// `ng build`. Only content-hashed files and the static icons/manifest are
// listed; index.html is not (the shell is always fetched fresh).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'app/dist/app/browser');
const SKIP = new Set([
  'index.html',
  'sw.js',
  '_headers',
  '3rdpartylicenses.txt',
  'prerendered-routes.json',
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const files = [];
const hash = createHash('sha256');
for (const file of [...walk(OUT)].sort()) {
  const path = relative(OUT, file).split('\\').join('/');
  if (SKIP.has(path)) continue;
  files.push(`/${path}`);
  hash.update(path).update(readFileSync(file));
}
const version = hash.digest('hex').slice(0, 16);

const template = readFileSync(join(ROOT, 'app/sw/sw.js'), 'utf8');
const output = template
  .replace("'__VERSION__'", JSON.stringify(version))
  .replace('__PRECACHE__', JSON.stringify(files, null, 2));
if (output.includes('__PRECACHE__') || output.includes('__VERSION__')) {
  throw new Error('sw.js placeholders not replaced');
}
writeFileSync(join(OUT, 'sw.js'), output);
console.log(`sw.js: version ${version}, ${files.length} files precached`);
