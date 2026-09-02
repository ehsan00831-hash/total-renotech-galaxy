#!/usr/bin/env node
/**
 * Compile the server-side modules for the test runner.
 *
 * The repositories are compiled exactly as they ship, so the integration tests
 * drive the real jobs / reminders / logs / team code against a mocked Google
 * Sheets client rather than a re-implementation.
 *
 * TypeScript emits ESM without file extensions, which Node's ESM resolver
 * rejects, so relative specifiers get a `.js` suffix afterwards.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const OUT = '.test-build';

const SOURCES = [
  'src/lib/business-time.ts',
  'src/lib/core.ts',
  'src/lib/schema.ts',
  'src/lib/sheets.ts',
  'src/lib/jobs.ts',
  'src/lib/reminders.ts',
  'src/lib/logs.ts',
  'src/lib/team.ts',
  'src/lib/audit.ts',
  'src/lib/openapi.ts',
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Run the compiler's own entry point rather than the npx shim: spawning a
// .cmd wrapper fails with EINVAL on Windows.
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

execFileSync(
  process.execPath,
  [
    tsc, ...SOURCES,
    '--outDir', OUT,
    '--target', 'es2022',
    '--module', 'es2022',
    '--moduleResolution', 'bundler',
    '--strict',
    '--skipLibCheck',
  ],
  { stdio: 'inherit' },
);

// Node's ESM loader needs explicit extensions on relative imports.
for (const file of readdirSync(OUT).filter((f) => f.endsWith('.js'))) {
  const path = join(OUT, file);
  const src = readFileSync(path, 'utf8');
  const fixed = src.replace(
    /(\bfrom\s+|\bimport\s*\()(['"])(\.\.?\/[^'"]+?)(?<!\.js)\2/g,
    (_m, lead, q, spec) => `${lead}${q}${spec}.js${q}`,
  );
  if (fixed !== src) writeFileSync(path, fixed);
}

// Mark the emitted JavaScript as ESM regardless of the root package type.
writeFileSync(join(OUT, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

console.log(`compiled ${SOURCES.length} modules to ${OUT}/`);
