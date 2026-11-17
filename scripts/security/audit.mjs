// npm audit with time-limited exceptions.
//
// 1. The production tree (what ships in the Worker and the app bundle) must
//    have no known vulnerability at all: no exceptions apply there.
// 2. The full tree fails on high or critical, except for advisories listed in
//    audit-exceptions.json with a reason and an end date that has not passed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function audit(args) {
  try {
    return JSON.parse(execFileSync(npm, ['audit', '--json', ...args], { encoding: 'utf8' }));
  } catch (error) {
    // npm audit exits non-zero when it finds something; the JSON is still on stdout.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

function advisories(report) {
  const found = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via) {
      if (typeof via !== 'object') continue;
      const id = String(via.url ?? '')
        .split('/')
        .pop();
      found.set(id || via.title, { severity: via.severity, title: via.title, name: via.name });
    }
  }
  return found;
}

let failed = false;

const prod = advisories(audit(['--omit=dev']));
for (const [id, a] of prod) {
  console.log(`::error::Production dependency ${a.name}: ${id} (${a.severity}) ${a.title}`);
  failed = true;
}

const exceptions = JSON.parse(
  readFileSync(new URL('./audit-exceptions.json', import.meta.url), 'utf8'),
);
const today = new Date().toISOString().slice(0, 10);
const all = advisories(audit([]));
for (const [id, a] of all) {
  if (a.severity !== 'high' && a.severity !== 'critical') continue;
  const exception = exceptions[id];
  if (exception && exception.until >= today) {
    console.log(
      `Accepted until ${exception.until}: ${a.name} ${id} (${a.severity}). ${exception.reason}`,
    );
    continue;
  }
  const why = exception ? `exception expired on ${exception.until}` : 'no exception';
  console.log(`::error::${a.name}: ${id} (${a.severity}) ${a.title} [${why}]`);
  failed = true;
}

if (failed) process.exit(1);
console.log(
  `npm audit: production tree clean, ${all.size} advisory(ies) in the full tree checked.`,
);
