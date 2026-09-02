#!/usr/bin/env node
/**
 * Write the OpenAPI specification to disk.
 *
 * Imports the same module the live /api/openapi route serves, so the committed
 * file can never drift from what ChatGPT actually fetches.
 *
 *   node scripts/emit-openapi.mjs [baseUrl]
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';

const base = process.argv[2] ?? process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

if (!existsSync('.test-build/openapi.js')) {
  execFileSync(process.execPath, ['scripts/prepare-tests.mjs'], { stdio: 'inherit' });
}

const { buildSpec } = await import('../.test-build/openapi.js');
const spec = buildSpec(base);

// A path item may carry a `parameters` array alongside its HTTP-method keys
// (shared params, declared once) — only the method keys are operations.
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  HTTP_METHODS.filter((m) => item[m]).map((method) => ({ path, method, op: item[method] })));

/* ---- validation: every operationId unique, every parameter unique ---- */
const errors = [];

const seenOpIds = new Map();
for (const { path, method, op } of operations) {
  if (!op.operationId) { errors.push(`${method.toUpperCase()} ${path} has no operationId`); continue; }
  const prior = seenOpIds.get(op.operationId);
  if (prior) errors.push(`operationId "${op.operationId}" used by both ${prior} and ${method.toUpperCase()} ${path}`);
  seenOpIds.set(op.operationId, `${method.toUpperCase()} ${path}`);
}

// The GPT Actions importer does not recognise a path item's own top-level
// `parameters` property — it responds with "unrecognized method parameters"
// and skips the whole path. Every parameter must live on the operation.
for (const [path, item] of Object.entries(spec.paths)) {
  if (item.parameters) {
    errors.push(
      `${path} has a path-level "parameters" property — GPT Actions cannot ` +
      'read this; move each parameter into the operations that need it',
    );
  }
}

for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of HTTP_METHODS) {
    if (!item[method]) continue;
    const seen = new Map();
    for (const p of item[method].parameters ?? []) {
      const key = `${p.in}:${p.name}`;
      if (seen.has(key)) {
        errors.push(`${method.toUpperCase()} ${path}: parameter "${p.name}" (${p.in}) is duplicated`);
      }
      seen.set(key, true);
    }
  }
}

if (errors.length > 0) {
  console.error('openapi.json NOT written — validation failed:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

writeFileSync('openapi.json', JSON.stringify(spec, null, 2) + '\n');

const ops = operations.map((o) => o.op.operationId);
console.log('openapi.json written for ' + base);
console.log(ops.length + ' operations, all operationIds and parameters unique: ' + ops.join(', '));
