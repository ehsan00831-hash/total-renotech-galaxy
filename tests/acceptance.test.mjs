/**
 * Acceptance checklist.
 *
 * One test per item on the sign-off list, asserted against the mock of the
 * live workbook (real headers, real header rows, the real ARCHIVE array
 * formula) rather than an in-memory convenience fake. Each test prints the
 * value it observed, so the run itself is the evidence.
 *
 * Runs in every host timezone via `npm run test:tz`.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { __setSheetsClientForTests } from '../.test-build/sheets.js';
import { listJobs, upsertJob, setStatus, filterCompleted, computeKpis } from '../.test-build/jobs.js';
import { listReminders, upsertReminder } from '../.test-build/reminders.js';
import { addLog } from '../.test-build/logs.js';
import { loadTeamFleet, crewOptions, truckOptions, driverOptions } from '../.test-build/team.js';
import { seenIdempotencyKey } from '../.test-build/audit.js';
import {
  businessInstant, can, stableIdempotencyKey,
  REMINDER_STATUSES, REMINDER_PRIORITIES,
  canonicalReminderStatus, canonicalReminderPriority, groupReminders,
} from '../.test-build/core.js';
import { buildLiveLikeWorkbook, ARCHIVE_A6_FORMULA } from './helpers/mock-sheets.mjs';

const CTX = { user: 'tester@totalrenotech.ca', source: 'webapp' };
const AUG_24 = businessInstant(2026, 8, 24, 12, 0);

let wb;
beforeEach(() => {
  wb = buildLiveLikeWorkbook();
  __setSheetsClientForTests(wb.client());
});

const show = (label, value) => console.log(`      ${label}: ${value}`);

/* ================================================================== */

describe('ACCEPTANCE 1 — Full Address round-trip', () => {
  test('NP-96651 reads and writes back byte-identically', async () => {
    const before = (await listJobs()).find((j) => j.jobId === 'NP-96651');
    show('read', JSON.stringify(before.fullAddress));
    assert.equal(before.fullAddress, '225 Rue Peel, Montreal, QC');

    // Touch an unrelated field; the address must not be rebuilt from parts.
    await upsertJob({ jobId: 'NP-96651', priority: 'HIGH' }, CTX);
    const after = (await listJobs()).find((j) => j.jobId === 'NP-96651');
    show('after unrelated edit', JSON.stringify(after.fullAddress));

    assert.equal(after.fullAddress, '225 Rue Peel, Montreal, QC');
    assert.notEqual(after.fullAddress, 'Montreal, QC', 'the street must not be dropped');
    assert.notEqual(
      after.fullAddress, '225 Rue Peel, Montreal, QC, Montreal, QC',
      'the city must not be appended a second time',
    );
  });

  test('an explicit write of the same value changes nothing on the sheet', async () => {
    const cellBefore = wb.get('All Jobs', 6, 4);
    await upsertJob({ jobId: 'NP-96651', fullAddress: '225 Rue Peel, Montreal, QC' }, CTX);
    const cellAfter = wb.get('All Jobs', 6, 4);
    show('column D', `${JSON.stringify(cellBefore)} -> ${JSON.stringify(cellAfter)}`);
    assert.equal(cellAfter, cellBefore);
  });
});

describe('ACCEPTANCE 2 — Completed this month = 8', () => {
  test('the month window returns all eight completed jobs', async () => {
    const jobs = await listJobs();
    const month = filterCompleted(jobs, 'month', AUG_24);
    show('completed this month', month.length);
    show('job ids', month.map((j) => j.jobId).join(', '));
    assert.equal(month.length, 8);
  });

  test('the count comes from Project End, not the July scheduled dates', async () => {
    const jobs = await listJobs();
    const month = filterCompleted(jobs, 'month', AUG_24);
    for (const j of month) {
      assert.match(j.projectEnd, /^2026-08-/, `${j.jobId} Project End`);
      assert.match(j.scheduledDate, /^2026-07-/, `${j.jobId} was scheduled in July`);
    }
    show('all eight', 'scheduled in July, ended in August');
  });
});

describe('ACCEPTANCE 3 — Team members = 12', () => {
  test('exactly twelve personnel load from the team table', async () => {
    const { people } = await loadTeamFleet();
    show('personnel', people.length);
    show('names', people.map((p) => p.displayName || p.fullName).join(', '));
    assert.equal(people.length, 12);
    assert.ok(people.every((p) => (p.displayName || p.fullName) !== ''), 'every person is named');
  });

  test('the crew selector is populated from those records', async () => {
    const { people } = await loadTeamFleet();
    const crew = crewOptions(people);
    show('crew selector', crew.join(', '));
    assert.equal(crew.length, 14, '12 people plus OTHER and TBD');
    assert.ok(crew.includes('Meisam') && crew.includes('Ehsan'));

    const drivers = driverOptions(people);
    show('driver selector', drivers.join(', '));
    assert.ok(drivers.length >= 3, 'the drivers on the team are offered');
  });
});

describe('ACCEPTANCE 4 — Fleet records = 8', () => {
  test('exactly eight fleet records load from the fleet table', async () => {
    const { trucks } = await loadTeamFleet();
    show('fleet', trucks.length);
    show('units', trucks.map((t) => t.truckNumber).join(', '));
    assert.equal(trucks.length, 8);
    assert.ok(trucks.every((t) => t.truckNumber !== ''), 'every truck is identified');
  });

  test('the truck selector is populated from those records', async () => {
    const { trucks } = await loadTeamFleet();
    const opts = truckOptions(trucks);
    show('truck selector', opts.join(', '));
    assert.ok(opts.includes('TRUCK #1'));
    assert.ok(opts.includes('OTHER'));
  });
});

describe('ACCEPTANCE 5 — ARCHIVE A6 formula unchanged', () => {
  test('the array formula is byte-identical after a full reminder lifecycle', async () => {
    const before = wb.getFormula('ARCHIVE', 6, 1);
    assert.equal(before, ARCHIVE_A6_FORMULA, 'fixture sanity');

    await upsertReminder({ requiredAction: 'Acceptance probe', status: 'New', priority: 'High' }, CTX);
    const created = (await listReminders('active')).find((r) => r.requiredAction === 'Acceptance probe');
    await upsertReminder({ id: created.id, status: 'Completed' }, CTX);
    await upsertReminder({ id: created.id, status: 'Cancelled' }, CTX);

    const after = wb.getFormula('ARCHIVE', 6, 1);
    show('A6 before', before);
    show('A6 after ', after);
    assert.equal(after, before, 'ARCHIVE!A6 must never be touched');
  });

  test('nothing was ever written to the ARCHIVE sheet', async () => {
    await upsertReminder({ requiredAction: 'Probe two', status: 'Completed', priority: 'Low' }, CTX);
    const writes = wb.writesTo('ARCHIVE');
    show('write calls targeting ARCHIVE', writes.length);
    assert.deepEqual(writes, [], 'ARCHIVE is a formula view and is never written');
  });

  test('a completed reminder still appears in ARCHIVE, via the formula', async () => {
    await upsertReminder({ requiredAction: 'Probe three', status: 'New', priority: 'Normal' }, CTX);
    const r = (await listReminders('active')).find((x) => x.requiredAction === 'Probe three');
    await upsertReminder({ id: r.id, status: 'Completed' }, CTX);

    const archive = await listReminders('archive');
    show('visible in ARCHIVE', archive.map((x) => x.requiredAction).join(', ') || '(none)');
    assert.ok(archive.some((x) => x.requiredAction === 'Probe three'));

    const active = await listReminders('active');
    assert.ok(!active.some((x) => x.requiredAction === 'Probe three'), 'and no longer active');

    const both = await listReminders('all');
    const dupes = both.filter((x) => x.requiredAction === 'Probe three');
    show('rows when listing both', dupes.length);
    assert.equal(dupes.length, 1, 'listing both must not double-count');
  });

  test('"Completed — Check Required" stays active', async () => {
    await upsertReminder({ requiredAction: 'Needs a check', status: 'Completed — Check Required', priority: 'High' }, CTX);
    const active = await listReminders('active');
    show('still active', active.filter((x) => x.requiredAction === 'Needs a check').length);
    assert.ok(active.some((x) => x.requiredAction === 'Needs a check'));
    const archive = await listReminders('archive');
    assert.ok(!archive.some((x) => x.requiredAction === 'Needs a check'));
  });
});

describe('ACCEPTANCE 6 — a retried write produces one row', () => {
  const retried = async (label, key, fn) => {
    const rowsBefore = wb.rowCount(label);
    await fn(key);
    const afterFirst = wb.rowCount(label);
    await fn(key);                       // same key, same payload — a retry
    const afterSecond = wb.rowCount(label);
    show(`${label} rows`, `${rowsBefore} -> ${afterFirst} -> ${afterSecond}`);
    assert.equal(afterFirst, rowsBefore + 1, 'the first call appends one row');
    assert.equal(afterSecond, afterFirst, 'the retry appends nothing');
    assert.equal(await seenIdempotencyKey(key), true);
  };

  test('POST /api/jobs retried once creates one job', async () => {
    const payload = { jobId: 'NP-99001', customer: 'Retry Co', fullAddress: '1 Rue Test, Montreal, QC' };
    const key = stableIdempotencyKey('webapp', 'create_job', payload);
    await retried('All Jobs', key, (k) =>
      upsertJob(payload, { ...CTX, idempotencyKey: k }));
  });

  test('POST /api/logs retried once creates one log', async () => {
    const payload = { jobId: 'NP-96651', workDate: '2026-08-24', clockIn: '08:00', clockOut: '16:00' };
    const key = stableIdempotencyKey('chatgpt', 'add_daily_log', payload);
    await retried('Daily Logs', key, (k) =>
      addLog(payload, { ...CTX, source: 'chatgpt', idempotencyKey: k }));
  });

  test('POST /api/reminders retried once creates one reminder', async () => {
    const payload = { requiredAction: 'Retry reminder', status: 'New', priority: 'Normal' };
    const key = stableIdempotencyKey('claude', 'create_reminder', payload);
    await retried('ACTIVE REMINDERS', key, (k) =>
      upsertReminder(payload, { ...CTX, source: 'claude', idempotencyKey: k }));
  });

  test('the same payload always yields the same key, a different one does not', () => {
    const a = stableIdempotencyKey('webapp', 'create_job', { jobId: 'X', customer: 'Y' });
    const b = stableIdempotencyKey('webapp', 'create_job', { customer: 'Y', jobId: 'X' });
    const c = stableIdempotencyKey('webapp', 'create_job', { jobId: 'X', customer: 'Z' });
    show('key', a);
    assert.equal(a, b, 'key order must not matter');
    assert.notEqual(a, c);
    assert.match(a, /^sk_[0-9a-f]{32}$/);
  });
});

describe('ACCEPTANCE 7 — add_daily_log is authorised', () => {
  test('the bearer/MCP caller role may file a daily log', () => {
    // Bearer tokens (ChatGPT Action, Claude MCP, webhooks) resolve to
    // coordinator; POST /api/logs is guarded on the `log` capability.
    show('coordinator can log', can('coordinator', 'log'));
    assert.equal(can('coordinator', 'log'), true, 'add_daily_log would 403 without this');
  });

  test('a technician may also file a daily log and complete work', () => {
    show('technician log/complete/write',
      `${can('technician', 'log')}/${can('technician', 'complete')}/${can('technician', 'write')}`);
    assert.equal(can('technician', 'log'), true);
    assert.equal(can('technician', 'complete'), true);
    assert.equal(can('technician', 'write'), false, 'but may not create or re-scope jobs');
  });

  test('a read-only caller still cannot log', () => {
    assert.equal(can('readonly', 'log'), false);
  });

  test('the log actually lands on the sheet for a bearer caller', async () => {
    const before = wb.rowCount('Daily Logs');
    await addLog(
      { jobId: 'NP-96651', workDate: '2026-08-24', clockIn: '08:00', clockOut: '16:30' },
      { user: 'api:chatgpt', source: 'chatgpt', role: 'coordinator' },
    );
    show('Daily Logs rows', `${before} -> ${wb.rowCount('Daily Logs')}`);
    assert.equal(wb.rowCount('Daily Logs'), before + 1);
  });
});

describe('ACCEPTANCE 8 — exact reminder vocabulary everywhere', () => {
  const EXPECTED_STATUSES = [
    'New', 'Action Required', 'In Progress', 'Scheduled', 'Follow-Up Required',
    'Waiting for Response', 'Waiting for Payment', 'Waiting for Approval',
    'Completed — Check Required', 'Completed', 'On Hold', 'Cancelled', 'Removed',
  ];
  const EXPECTED_PRIORITIES = ['Critical', 'High', 'Normal', 'Low'];

  const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

  test('Core carries the exact list', () => {
    show('statuses', REMINDER_STATUSES.length);
    assert.deepEqual([...REMINDER_STATUSES], EXPECTED_STATUSES);
    assert.deepEqual([...REMINDER_PRIORITIES], EXPECTED_PRIORITIES);
  });

  test('the em dash is a real em dash, not a hyphen', () => {
    const s = REMINDER_STATUSES.find((x) => x.startsWith('Completed —'));
    show('codepoint', `U+${s.charCodeAt(10).toString(16).toUpperCase()}`);
    assert.equal(s, 'Completed — Check Required');
  });

  test('the AI prompt lists the same values', () => {
    const src = read('src/lib/ai.ts');
    for (const v of [...EXPECTED_STATUSES, ...EXPECTED_PRIORITIES]) {
      assert.ok(src.includes(v), `AI prompt is missing ${JSON.stringify(v)}`);
    }
  });

  test('the MCP tool schema lists the same values', () => {
    const src = read('mcp/server.mjs');
    for (const v of [...EXPECTED_STATUSES, ...EXPECTED_PRIORITIES]) {
      assert.ok(src.includes(v), `MCP schema is missing ${JSON.stringify(v)}`);
    }
  });

  test('the OpenAPI enums list the same values', () => {
    const src = read('src/lib/openapi.ts');
    for (const v of [...EXPECTED_STATUSES, ...EXPECTED_PRIORITIES]) {
      assert.ok(src.includes(v), `OpenAPI is missing ${JSON.stringify(v)}`);
    }
  });

  test('the UI renders the list from Core rather than its own copy', () => {
    const src = read('src/app/reminders/page.tsx');
    assert.ok(src.includes("REMINDER_STATUSES") && src.includes("from '@/lib/core'"));
  });

  test('a near-miss value is canonicalised before it is written', () => {
    assert.equal(canonicalReminderStatus('completed'), 'Completed');
    assert.equal(canonicalReminderStatus('IN PROGRESS'), 'In Progress');
    assert.equal(canonicalReminderStatus('Completed - Check Required'), 'Completed — Check Required');
    assert.equal(canonicalReminderPriority('critical'), 'Critical');
    show('canonicalised', "'completed' -> 'Completed', hyphen -> em dash");
  });

  test('an invalid value is rejected rather than written', async () => {
    await assert.rejects(
      () => upsertReminder({ requiredAction: 'Bad', status: 'Sort of done', priority: 'Normal' }, CTX),
      /status/i,
    );
    show('rejected', "'Sort of done'");
  });

  test('what is written to the sheet is the exact vocabulary', async () => {
    await upsertReminder({ requiredAction: 'Vocab probe', status: 'in progress', priority: 'high' }, CTX);
    const r = (await listReminders('active')).find((x) => x.requiredAction === 'Vocab probe');
    show('stored', `${r.status} / ${r.priority}`);
    assert.equal(r.status, 'In Progress');
    assert.equal(r.priority, 'High');
  });
});

describe('ACCEPTANCE 9 — the exact Hamed Tabrizi logo ships', () => {
  const asset = (p) => path.join(process.cwd(), 'public/brand', p);

  test('every logo asset is present and non-trivial', () => {
    for (const f of ['trt-logo.png', 'trt-logo-plate.png', 'icon-512.png', 'icon-192.png', 'apple-touch-icon.png']) {
      const size = fs.statSync(asset(f)).size;
      show(f, `${(size / 1024).toFixed(0)} KB`);
      assert.ok(size > 8_000, `${f} is suspiciously small`);
    }
  });

  test('the assets are derived from the supplied master, on the record', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/build-logo.mjs'), 'utf8');
    assert.ok(
      script.includes('Logo no bg new fr tif@@1.25x.png'),
      'the build script must name the supplied master artwork',
    );
    show('master', 'Logo no bg new fr tif@@1.25x.png');
  });

  test('only transparent margin is removed — no crop of the artwork', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/build-logo.mjs'), 'utf8');
    assert.ok(script.includes('!== 0'), 'the box is the alpha bounding box');
    assert.ok(!/\.trim\(/.test(script), 'no blind trim');
  });

  test('there is no remote logo fallback left to substitute a shorter mark', () => {
    const brand = fs.readFileSync(path.join(process.cwd(), 'src/lib/brand.ts'), 'utf8');
    const shell = fs.readFileSync(path.join(process.cwd(), 'src/components/shell/AppShell.tsx'), 'utf8');
    assert.ok(!brand.includes('LOGO_FALLBACK'), 'brand.ts still exports a fallback');
    assert.ok(!shell.includes('LOGO_FALLBACK'), 'the header still falls back');
    assert.ok(!/wp-content/.test(brand + shell), 'a public wp-content URL is still referenced');
    show('remote fallback', 'removed');
  });

  test('the alt text names the full lockup', () => {
    const shell = fs.readFileSync(path.join(process.cwd(), 'src/components/shell/AppShell.tsx'), 'utf8');
    assert.ok(shell.includes('Hamed Tabrizi'));
  });

  test('the logo sits on the dark plate the white artwork needs', () => {
    const shell = fs.readFileSync(path.join(process.cwd(), 'src/components/shell/AppShell.tsx'), 'utf8');
    assert.ok(shell.includes('bg-[#0B0F14]'), 'the header plate is gone');
  });
});

describe('ACCEPTANCE 10 — the Completed Archive tab resolves by identity', () => {
  test('the tab is found by sheet id, not by its "No Name" title', async () => {
    const { completedArchiveTitle } = await import('../.test-build/sheets.js');
    const title = await completedArchiveTitle();
    show('sheetId 2026082401 resolves to', JSON.stringify(title));
    assert.equal(title, 'No Name', 'resolved by id, and the title is left alone');
  });
});

/* ================================================================== *
 * Data safety — regressions found while proving the checklist
 * ================================================================== */

describe('DATA SAFETY — a record is never hidden or overwritten', () => {
  test('a reminder with no customer is still readable', async () => {
    // The reminder table was keyed on Customer/Project, which is optional.
    // A reminder without one was written to the sheet and then read back as
    // if it did not exist.
    const res = await upsertReminder(
      { requiredAction: 'General task, no customer', status: 'New', priority: 'Normal' }, CTX,
    );
    const active = await listReminders('active');
    const found = active.find((r) => r.id === res.id);
    show('written to row', res.row);
    show('read back', found ? `${found.id} — ${found.requiredAction}` : '(missing)');
    assert.ok(found, 'a reminder with no customer must not vanish from the list');
    assert.equal(found.requiredAction, 'General task, no customer');
  });

  test('appending never lands on a populated row', async () => {
    const first = await upsertReminder(
      { requiredAction: 'First, no customer', status: 'New', priority: 'Normal' }, CTX,
    );
    const second = await upsertReminder(
      { requiredAction: 'Second, no customer', status: 'New', priority: 'Low' }, CTX,
    );
    show('rows', `${first.row} then ${second.row}`);
    assert.notEqual(second.row, first.row, 'the second append must not reuse the first row');

    const active = await listReminders('active');
    assert.ok(active.some((r) => r.requiredAction === 'First, no customer'), 'the first survived');
    assert.ok(active.some((r) => r.requiredAction === 'Second, no customer'));
  });

  test('a job row is only reused when every mapped cell is empty', async () => {
    const before = wb.rowCount('All Jobs');
    await upsertJob({ jobId: 'NP-99100', customer: 'Row Safety Co' }, CTX);
    await upsertJob({ jobId: 'NP-99101', customer: 'Row Safety Two' }, CTX);
    const jobs = await listJobs();
    show('All Jobs rows', `${before} -> ${wb.rowCount('All Jobs')}`);
    assert.equal(wb.rowCount('All Jobs'), before + 2);
    assert.ok(jobs.some((j) => j.jobId === 'NP-99100'));
    assert.ok(jobs.some((j) => j.jobId === 'NP-99101'));
    assert.ok(jobs.some((j) => j.jobId === 'NP-96651'), 'the seeded record is untouched');
  });
});

describe('ACCEPTANCE 11 — Dashboard KPIs against the live-like workbook', () => {
  test('the new drill-down counts are sane against real headers and rows', async () => {
    const jobs = await listJobs();
    const k = computeKpis(jobs, [], AUG_24);
    show('scheduledToday', k.scheduledToday);
    show('waitingScheduling', k.waitingScheduling);
    show('overdueFollowUps', k.overdueFollowUps);
    for (const key of ['scheduledToday', 'waitingScheduling', 'overdueFollowUps']) {
      assert.ok(Number.isInteger(k[key]) && k[key] >= 0, `${key} must be a non-negative integer`);
    }
  });
});

describe('ACCEPTANCE 12 — reminder grouping against the live-like workbook', () => {
  test('every active reminder lands in exactly one daily-operations bucket', async () => {
    const active = await listReminders('active');
    const groups = groupReminders(active, AUG_24);
    const total = Object.values(groups).reduce((sum, g) => sum + g.length, 0);
    show('active reminders', active.length);
    show('bucketed total', total);
    assert.equal(total, active.length, 'no reminder is lost or duplicated across buckets');
  });

  test('a reminder updated to Completed — Check Required stays out of ARCHIVE', async () => {
    const active = await listReminders('active');
    const first = active[0];
    await upsertReminder({ id: first.id, status: 'Completed — Check Required' }, CTX);
    const stillActive = await listReminders('active');
    assert.ok(stillActive.some((r) => r.id === first.id));
    show('Completed — Check Required', 'still in ACTIVE REMINDERS');
  });
});

describe('ACCEPTANCE 13 — material status update never touches other job fields', () => {
  test('updating only materialStatus preserves Full Address, WO, PO and technicians', async () => {
    const before = (await listJobs()).find((j) => j.jobId === 'NP-96651');
    await upsertJob({ jobId: 'NP-96651', materialStatus: 'ORDERED' }, CTX);
    const after = (await listJobs()).find((j) => j.jobId === 'NP-96651');

    assert.equal(after.materialStatus, 'ORDERED');
    assert.equal(after.fullAddress, before.fullAddress, 'address must be untouched');
    assert.equal(after.woNumber, before.woNumber);
    assert.equal(after.poNumber, before.poNumber);
    assert.deepEqual(after.technicians, before.technicians);
    show('materialStatus-only update', `fullAddress, WO, PO, crew all unchanged`);
  });
});
