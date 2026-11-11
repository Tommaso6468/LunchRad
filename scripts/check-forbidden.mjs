#!/usr/bin/env node
// Fails the build when source code uses APIs that bypass Angular's built-in
// XSS protection or execute strings as code. These are banned outright in
// this project (see SECURITY.md). There is no allow-list on purpose: if you
// think you need one of these, open a discussion first.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = ['app/src', 'worker/src', 'shared/src'];
const EXTENSIONS = ['.ts', '.html'];

const RULES = [
  { pattern: /bypassSecurityTrust\w*/, reason: 'bypasses Angular sanitization' },
  { pattern: /\[innerHTML\]|\[outerHTML\]/, reason: 'renders raw HTML in a template' },
  { pattern: /\.(innerHTML|outerHTML)\s*=/, reason: 'writes raw HTML to the DOM' },
  { pattern: /insertAdjacentHTML\s*\(/, reason: 'writes raw HTML to the DOM' },
  { pattern: /document\.write\s*\(/, reason: 'writes raw HTML to the DOM' },
  { pattern: /\beval\s*\(/, reason: 'executes a string as code' },
  { pattern: /new\s+Function\s*\(/, reason: 'executes a string as code' },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (EXTENSIONS.some((ext) => full.endsWith(ext))) {
      yield full;
    }
  }
}

const findings = [];
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  try {
    statSync(abs);
  } catch {
    continue;
  }
  for (const file of walk(abs)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        if (rule.pattern.test(line)) {
          findings.push(`${relative(ROOT, file)}:${i + 1}  ${rule.reason}: ${line.trim()}`);
        }
      }
    });
  }
}

if (findings.length > 0) {
  console.error('Forbidden APIs found:\n' + findings.join('\n'));
  process.exit(1);
}
console.log('No forbidden APIs found.');
