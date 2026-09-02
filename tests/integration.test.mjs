/**
 * Repository integration tests.
 *
 * These drive the real jobs / reminders / logs / team modules — the same code
 * the API routes call — against a mocked Google Sheets client holding the live
 * workbook's headers, header rows and ARCHIVE array formula.
 *
 * Nothing here re-implements a rule. If a write would corrupt the sheet, it
 * fails here the same way it would fail in production.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { __setSheetsClientForTests } from '../.test-build/sheets.js';
import { listJobs, upsertJob, setStatus, filterCompleted, completionDate } from '../.test-build/jobs.js';
import { listReminders, upsertReminder } from '../.test-build/reminders.js';
import { addLog, listLogs } from '../.test-build/logs.js';
import { loadTeamFleet, crewOptions, truckOptions } from '../.test-build/team.js';
import { seenIdempotencyKey } from '../.test-build/audit.js';
import { stableIdempotencyKey, businessInstant } from '../.test-build/core.js';
import {
  buildLiveLikeWorkbook, ARCHIVE_A6_FORMULA, ALL_JOBS_HEADERS,
} from './helpers/mock-sheets.mjs';

const CTX = { user: 'tester@totalrenotech.ca', source: 'webapp' };
// A fixed instant — noon in Montreal — so the business day is the same
// whatever zone the test process runs in.
const AUG_24 = businessInstant(2026, 8, 24, 12, 0);

let wb;

beforeEach(() => {
  wb = buildLiveLikeWorkbook();
  __setSheetsClientForTests(wb.client());
});

/* ================================================================== */

describe('All Jobs — live header layout', () => {
  test('Full Address is resolved from its own column', () => {
    assert.equal(ALL_JOBS_HEADERS[3], 'Full Address');
    assert.equal(ALL_JOBS_HEADERS[4], 'City');
    assert.equal(ALL_JOBS_HEADERS[5], 'Unit');
  });

  test('NP-96651 reads back exactly as it is stored', async () => {
    const jobs = await listJobs();
    const np = jobs.find((j) => j.jobId === 'NP-96651');
    assert.ok(np, 'NP-96651 must be present');
    assert.equal(np.fullAddress, '225 Rue Peel, Montreal, QC');
  });

  test('the city is neither dropped nor duplicated on read', async () => {
    const np = (await listJobs()).find((j) => j.jobId === 'NP-96651');
    assert.notEqual(np.fullAddress, 'Montreal, QC');
    assert.notEqual(np.fullAddress, '225 Rue Peel, Montreal, QC, Montreal, QC');
    assert.equal(np.city, 'Montreal, QC', 'the separate City column is untouched');
  });

  test('an unrelated edit leaves Full Address byte-identical', async () => {
    await upsertJob({ jobId: 'NP-96651', status: 'ONGOING' }, CTX);
    const np = (await listJobs()).find((j) => j.jobId === 'NP-96651');
    assert.equal(np.fullAddress, '225 Rue Peel, Montreal, QC');
    assert.equal(np.status, 'ONGOING');
  });

  test('writing Full Address round-trips through the sheet unchanged', async () => {
    await upsertJob(
      { jobId: 'NP-96651', fullAddress: '225 Rue Peel, Montreal, QC' }, CTX,
    );
    const cell = wb.get('All Jobs', 6, 4);
    assert.equal(cell, '225 Rue Peel, Montreal, QC');
    assert.equal(wb.get('All Jobs', 6, 5), 'Montreal, QC', 'City column not rewritten');
  });

  test('Full Address is written to column D, never to City or Unit', async () => {
    await upsertJob({ jobId: 'NP-96651', fullAddress: '9 Rue Neuve, Laval, QC' }, CTX);
    assert.equal(wb.get('All Jobs', 6, 4), '9 Rue Neuve, Laval, QC');
    assert.equal(wb.get('All Jobs', 6, 5), 'Montreal, QC');
    assert.equal(wb.get('All Jobs', 6, 6), '');
  });
});

describe('completion date on the live sheet', () => {
  test('Project End drives the completed-this-month window', async () => {
    const jobs = await listJobs();
    const month = filterCompleted(jobs, 'month', AUG_24);
    assert.equal(month.length, 8, 'all eight completed jobs appear');
  });

  test('the July scheduled date is ignored', async () => {
    const jobs = await listJobs();
    const done = jobs.filter((j) => j.status === 'COMPLETED' || j.status === 'DONE');
    for (const j of done) {
      assert.equal(j.scheduledDate, '2026-07-15');
      assert.ok(completionDate(j).startsWith('2026-08'), 'completion is August');
    }
  });

  test('complete_job writes Project End', async () => {
    const before = wb.get('All Jobs', 6, 33);
    assert.equal(before, '', 'Project End starts empty');

    await setStatus('NP-96651', 'COMPLETED', CTX);

    const after = wb.get('All Jobs', 6, 33);
    assert.match(after, /^\d{4}-\d{2}-\d{2}$/, 'Project End is stamped');
    assert.equal(wb.get('All Jobs', 6, 14), 'COMPLETED');
  });

  test('a job completed today lands in every window', async () => {
    await setStatus('NP-96651', 'COMPLETED', CTX);
    const jobs = await listJobs();
    const today = filterCompleted(jobs, 'today', new Date());
    assert.ok(today.some((j) => j.jobId === 'NP-96651'));
  });

  test('a direct status-only PATCH also stamps Project End, not only setStatus', async () => {
    // The web UI's "Complete" action and any ChatGPT/MCP update_job call go
    // through upsertJob directly, never through setStatus — the stamp has to
    // live in toPatch itself or those paths silently skip it.
    const before = wb.get('All Jobs', 6, 33);
    assert.equal(before, '', 'Project End starts empty');

    await upsertJob({ jobId: 'NP-96651', status: 'COMPLETED' }, CTX);

    const after = wb.get('All Jobs', 6, 33);
    assert.match(after, /^\d{4}-\d{2}-\d{2}$/, 'Project End is stamped without setStatus');
  });

  test('an explicit Project End on the same call is never overwritten', async () => {
    await upsertJob(
      { jobId: 'NP-96651', status: 'COMPLETED', projectEnd: '2026-01-15' }, CTX,
    );
    assert.equal(wb.get('All Jobs', 6, 33), '2026-01-15', 'the caller-supplied date wins');
  });

  test('an unrelated field update never stamps Project End', async () => {
    await upsertJob({ jobId: 'NP-96651', priority: 'HIGH' }, CTX);
    assert.equal(wb.get('All Jobs', 6, 33), '', 'status was not touched, so neither is Project End');
  });
});

describe('Team & Fleet — two tables, two header rows', () => {
  test('loads exactly 12 personnel from row 6', async () => {
    const { people } = await loadTeamFleet();
    assert.equal(people.length, 12);
    assert.equal(people[0].fullName, 'Meisam');
    assert.equal(people.at(-1).fullName, 'Ehsan');
  });

  test('loads exactly 8 fleet records from row 50', async () => {
    const { trucks } = await loadTeamFleet();
    assert.equal(trucks.length, 8);
    assert.equal(trucks[0].truckNumber, 'TRUCK #1');
    assert.equal(trucks.at(-1).truckNumber, 'TBD');
  });

  test('the personnel read stops before the fleet header', async () => {
    const { people } = await loadTeamFleet();
    assert.ok(!people.some((p) => /truck/i.test(p.fullName)));
    assert.ok(people.every((p) => p.row >= 7 && p.row < 50));
  });

  test('fleet rows carry their own columns, not the team ones', async () => {
    const { trucks } = await loadTeamFleet();
    assert.ok(trucks.every((t) => t.truckId.startsWith('TRT-TRK-')));
  });

  test('crew and truck selectors are populated from those records', async () => {
    const { people, trucks } = await loadTeamFleet();
    const crew = crewOptions(people);
    const fleet = truckOptions(trucks);

    assert.ok(crew.includes('Meisam'));
    assert.ok(crew.includes('Ali 2 - Helper'));
    assert.ok(crew.includes('OTHER') && crew.includes('TBD'));
    assert.equal(crew.length, 14, '12 active people plus OTHER and TBD');

    assert.ok(fleet.includes('TRUCK #7'));
    assert.ok(fleet.includes('OFFICE / VISIT'));
  });
});

describe('ARCHIVE is a formula view and is never written', () => {
  test('the A6 array formula is present before any work', () => {
    assert.equal(wb.get('ARCHIVE', 6, 1), ARCHIVE_A6_FORMULA);
  });

  test('completing a reminder writes only to ACTIVE REMINDERS', async () => {
    const res = await upsertReminder({
      customer: 'MARSHALLS MEGA #777',
      requiredAction: 'Follow up on estimate',
      status: 'Completed',
    }, CTX);

    assert.equal(res.sheet, 'ACTIVE REMINDERS');
    assert.equal(res.visibleIn, 'ARCHIVE');
    assert.equal(res.action, 'archived');

    const archiveWrites = wb.writes.filter((r) => r.includes('ARCHIVE'));
    assert.deepEqual(archiveWrites, [], 'no write ever targeted ARCHIVE');
  });

  test('the A6 formula survives byte-for-byte', async () => {
    await upsertReminder({
      customer: 'MARSHALLS MEGA #777',
      requiredAction: 'Follow up on estimate',
      status: 'Completed',
    }, CTX);
    assert.equal(wb.get('ARCHIVE', 6, 1), ARCHIVE_A6_FORMULA);
  });

  test('the reminder reaches ARCHIVE through the formula', async () => {
    await upsertReminder({
      customer: 'MARSHALLS MEGA #777',
      requiredAction: 'Follow up on estimate',
      status: 'Completed',
    }, CTX);

    const archived = await listReminders('archive');
    assert.equal(archived.length, 1);
    assert.equal(archived[0].customer, 'MARSHALLS MEGA #777');
    assert.equal(archived[0].editable, false, 'view rows are not editable');
  });

  test('the status is updated on the source row', async () => {
    await upsertReminder({
      customer: 'MARSHALLS MEGA #777',
      requiredAction: 'Follow up on estimate',
      status: 'Completed',
    }, CTX);
    assert.equal(wb.get('ACTIVE REMINDERS', 6, 8), 'Completed');
  });

  test('an archived reminder leaves the active list', async () => {
    assert.equal((await listReminders('active')).length, 1);
    await upsertReminder({
      customer: 'MARSHALLS MEGA #777',
      requiredAction: 'Follow up on estimate',
      status: 'Completed',
    }, CTX);
    assert.equal((await listReminders('active')).length, 0);
  });

  test('listing both views shows the reminder once, not twice', async () => {
    await upsertReminder({
      customer: 'MARSHALLS MEGA #777',
      requiredAction: 'Follow up on estimate',
      status: 'Completed',
    }, CTX);

    const both = await listReminders('both');
    const hits = both.filter((r) => r.customer === 'MARSHALLS MEGA #777');
    assert.equal(hits.length, 1, 'de-duplicated across source and view');
    assert.equal(hits[0].sheet, 'ACTIVE REMINDERS', 'the writable row wins');
  });

  test('"Completed — Check Required" stays active and out of the archive', async () => {
    const res = await upsertReminder({
      customer: 'MARSHALLS MEGA #777',
      requiredAction: 'Follow up on estimate',
      status: 'Completed — Check Required',
    }, CTX);

    assert.equal(res.visibleIn, 'ACTIVE REMINDERS');
    assert.equal((await listReminders('active')).length, 1);
    assert.equal((await listReminders('archive')).length, 0);
  });

  test('status casing is normalised before it reaches the sheet', async () => {
    await upsertReminder({
      customer: 'MARSHALLS MEGA #777',
      requiredAction: 'Follow up on estimate',
      status: 'waiting for payment',
      priority: 'critical',
    }, CTX);
    assert.equal(wb.get('ACTIVE REMINDERS', 6, 8), 'Waiting for Payment');
    assert.equal(wb.get('ACTIVE REMINDERS', 6, 7), 'Critical');
  });
});

describe('idempotency at the repository level', () => {
  test('a repeated job write produces one row and one audit entry', async () => {
    const payload = { customer: 'NEW CLIENT LTD', woNumber: '99001', status: 'UPCOMING' };
    const key = stableIdempotencyKey('webapp', 'create_or_update_job', payload);

    const before = (await listJobs()).length;
    await upsertJob(payload, { ...CTX, idempotencyKey: key });

    assert.equal(await seenIdempotencyKey(key), true, 'key recorded in the audit log');

    // The route layer refuses the replay; the repository would otherwise match
    // on WO and update rather than duplicate.
    const second = await upsertJob(payload, { ...CTX, idempotencyKey: key });
    assert.notEqual(second.action, 'created');

    const after = (await listJobs()).length;
    assert.equal(after, before + 1, 'exactly one new job row');
  });

  test('content matching prevents a duplicate even with a fresh key', async () => {
    const payload = { customer: 'NEW CLIENT LTD', woNumber: '99001', status: 'UPCOMING' };
    const before = (await listJobs()).length;

    await upsertJob(payload, { ...CTX, idempotencyKey: 'key-one' });
    await upsertJob(payload, { ...CTX, idempotencyKey: 'key-two' });

    assert.equal((await listJobs()).length, before + 1);
  });

  test('a repeated daily log keeps one row per project per day', async () => {
    const payload = {
      jobId: 'NP-96651', workDate: '2026-08-24',
      technicians: ['Meisam', 'Pirooz'],
      clockIn: '08:00', clockOut: '14:30', breakMin: 30,
    };

    const first = await addLog(payload, CTX);
    const second = await addLog(payload, CTX);

    assert.equal(first.row, second.row, 'the same row was reused');
    const logs = await listLogs('NP-96651');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].totalHours, 12, '2 crew x 6 h');
  });

  test('a repeated reminder merges rather than appending', async () => {
    const payload = {
      customer: 'H&M JOLIETTE #53',
      requiredAction: 'Chase the signed quote',
      status: 'Action Required',
    };
    await upsertReminder(payload, CTX);
    await upsertReminder(payload, CTX);

    const active = await listReminders('active');
    const hits = active.filter((r) => r.customer === 'H&M JOLIETTE #53');
    assert.equal(hits.length, 1);
  });
});

describe('daily logs against the live layout', () => {
  test('person-hours are stored, not recomputed from crew count', async () => {
    await addLog({
      jobId: 'NP-96651', workDate: '2026-08-24',
      technicians: ['Ali', 'Meisam', 'Farzad'],
      clockIn: '08:00', clockOut: '16:00', breakMin: 60,
    }, CTX);

    const logs = await listLogs('NP-96651');
    assert.equal(logs[0].hoursPerPerson, 7);
    assert.equal(logs[0].totalHours, 21, '3 crew x 7 h, stored as person-hours');
    assert.equal(logs[0].crewCount, 3);
  });

  test('a correction updates the same day rather than adding a row', async () => {
    const base = {
      jobId: 'NP-96651', workDate: '2026-08-24',
      technicians: ['Ali', 'Meisam'], clockIn: '08:00', clockOut: '14:30', breakMin: 30,
    };
    await addLog(base, CTX);
    await addLog({ ...base, clockOut: '16:00' }, CTX);

    const logs = await listLogs('NP-96651');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].totalHours, 15, '2 crew x 7.5 h');
  });

  test('crew spreads across the five technician columns', async () => {
    await addLog({
      jobId: 'NP-96651', workDate: '2026-08-24',
      technicians: ['Arash', 'Agha Nemat', 'Mohammad', 'Ali 2 - Helper'],
      clockIn: '08:00', clockOut: '16:00',
    }, CTX);

    assert.equal(wb.get('Daily Logs', 6, 7), 'Arash');
    assert.equal(wb.get('Daily Logs', 6, 8), 'Agha Nemat');
    assert.equal(wb.get('Daily Logs', 6, 9), 'Mohammad');
    assert.equal(wb.get('Daily Logs', 6, 10), 'Ali 2 - Helper');
    assert.equal(wb.get('Daily Logs', 6, 11), '');
  });
});

describe('formula job views refuse writes', () => {
  test('the repository never targets a derived job view', async () => {
    await upsertJob({ jobId: 'NP-96651', status: 'UPCOMING' }, CTX);
    for (const view of ['Upcoming', 'Tomorrow Plan', 'Ongoing', 'Done', 'Materials', 'Long Projects']) {
      assert.deepEqual(
        wb.writes.filter((r) => r.startsWith(`'${view}'`)), [],
        `${view} must never be written`,
      );
    }
  });

  test('every write lands on All Jobs', async () => {
    wb.writes.length = 0;
    await upsertJob({ jobId: 'NP-96651', status: 'ONGOING' }, CTX);
    const jobWrites = wb.writes.filter((r) => !r.includes('_TRT_AUDIT_LOG'));
    assert.ok(jobWrites.length > 0);
    assert.ok(jobWrites.every((r) => r.startsWith("'All Jobs'")));
  });
});
