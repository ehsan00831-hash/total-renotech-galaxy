/**
 * Run the whole suite once per host timezone, each in its own Node process.
 *
 * Setting TZ inside a running process is unreliable — the zone is read when
 * the process starts, and on Windows a shell env prefix (`TZ=Asia/Tokyo npm
 * test`) can be dropped entirely on its way through npm. So each run is
 * spawned directly with an explicit env, and the suite itself asserts the zone
 * it actually got (see tests/timezone.test.mjs). A run whose zone did not take
 * effect fails loudly instead of passing under the host default.
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const ZONES = ['UTC', 'America/Toronto', 'Asia/Tokyo'];

const runner = [
  '--test',
  ...(process.argv.includes('--quiet') ? ['--test-reporter=dot'] : []),
  'tests/**/*.test.mjs',
];

// Compile once; the child processes only run the suite.
const prep = spawnSync(process.execPath, ['scripts/prepare-tests.mjs'], { stdio: 'inherit' });
if (prep.status !== 0) process.exit(prep.status ?? 1);

const results = [];
for (const zone of ZONES) {
  console.log(`\n${'='.repeat(72)}\n  TZ=${zone}\n${'='.repeat(72)}`);
  const r = spawnSync(process.execPath, runner, {
    stdio: 'inherit',
    env: { ...process.env, TZ: zone, TRT_EXPECTED_TZ: zone },
  });
  results.push({ zone, status: r.status ?? 1 });
}

console.log(`\n${'='.repeat(72)}`);
for (const { zone, status } of results) {
  console.log(`  ${status === 0 ? 'PASS' : 'FAIL'}  TZ=${zone}`);
}
console.log('='.repeat(72));

process.exit(results.every((r) => r.status === 0) ? 0 : 1);
