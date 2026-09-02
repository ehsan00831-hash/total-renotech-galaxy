/**
 * Operations rules — unit tests against the real production module.
 *
 * Everything imported here is the same code the API routes call, compiled by
 * scripts/prepare-tests.mjs. No behaviour is re-implemented for the tests.
 *
 * Fixtures mirror the live workbook: Full Address is one column that already
 * contains the city, and Project End is the completion date.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normHeader, resolveColumns, colLetter,
  normaliseFullAddress, fullAddressIncludesCity,
  parseSheetDate, businessDay, businessInstant,
  findDuplicate, filterView, computeKpis, isActiveJob, isClosedJob,
  filterCompleted, archivedCompleted, completedTotals, filterMaterials,
  completionDate,
  normaliseCrew, crewToColumns, MAX_CREW,
  parseClock, hoursPerPerson, personHours, rollupProject,
  reminderVisibleIn, reminderTargetSheet, findReminder, sortReminders, groupReminders,
  isCheckRequired, isReminderOverdue, formatCad, dedupeReminders,
  applyManualOrder, sortComments,
  needsCoordination, assertCoordinationOrder,
  REMINDER_STATUSES, REMINDER_PRIORITIES, REMINDER_WRITE_SHEET,
  canonicalReminderStatus, canonicalReminderPriority,
  SHEET_ACTIVE_REMINDERS, SHEET_ARCHIVE,
  isWritableSheet, assertWritable, READONLY_VIEWS,
  stableIdempotencyKey, canonicalJson,
} from '../.test-build/core.js';

/* ------------------------------------------------------------------ *
 * fixtures — shaped like the live sheet
 * ------------------------------------------------------------------ */

const TODAY = businessInstant(2026, 8, 24, 12, 0);  // noon in Montreal, a Monday

function job(over = {}) {
  return {
    row: 6, jobId: 'NP-1', customer: 'WINNERS #451',
    fullAddress: '225 Rue Peel, Montreal, QC',
    woNumber: '', poNumber: '', status: 'UPCOMING', priority: 'NORMAL',
    scheduledDate: '', projectEnd: '', lastUpdated: '',
    materials: '', materialStatus: '', longProject: '',
    technicians: [], crewCount: 0, followUpDate: '', ...over,
  };
}

function log(over = {}) {
  return {
    jobId: 'NP-1', workDate: '2026-08-24', technicians: ['Ali', 'Meisam'],
    crewCount: 2, totalHours: 12, materialsUsed: '', ...over,
  };
}

function reminder(over = {}) {
  return {
    row: 6, sheet: SHEET_ACTIVE_REMINDERS, id: 'REM-0001',
    customer: 'WINNERS #451', requiredAction: 'Send estimate',
    status: 'New', priority: 'Normal', dueAt: '', ...over,
  };
}

/* ================================================================== */

describe('column resolution', () => {
  test('matches headers regardless of case, accents and punctuation', () => {
    assert.equal(normHeader('  Scheduled Date  '), 'scheduled date');
    assert.equal(normHeader('Client / Store'), 'client / store');
    assert.equal(normHeader('Propriété'), 'propriete');
  });

  test('each column is claimed by at most one field', () => {
    const headers = ['Job ID', 'Client / Store', 'Status', 'Notes'];
    const cols = resolveColumns(headers, {
      jobId: { patterns: [/^job\s*id$/] },
      customer: { patterns: [/^client\s*\/?\s*store/] },
      status: { patterns: [/^status$/] },
      notes: { patterns: [/^notes?$/] },
    });
    assert.deepEqual(cols, { jobId: 1, customer: 2, status: 3, notes: 4 });
  });

  test('Full Address wins over City and Unit', () => {
    const headers = ['Full Address', 'City', 'Unit'];
    const cols = resolveColumns(headers, {
      fullAddress: { patterns: [/^full\s*address/, /^address/] },
      city: { patterns: [/^city/] },
      unit: { patterns: [/^unit/] },
    });
    assert.deepEqual(cols, { fullAddress: 1, city: 2, unit: 3 });
  });

  test('survives a reordered sheet', () => {
    const spec = {
      status: { patterns: [/^status$/] },
      jobId: { patterns: [/^job\s*id$/] },
    };
    assert.deepEqual(resolveColumns(['Job ID', 'Status'], spec), { status: 2, jobId: 1 });
    assert.deepEqual(resolveColumns(['Status', 'Job ID'], spec), { status: 1, jobId: 2 });
  });

  test('a field with no matching header is simply absent', () => {
    const cols = resolveColumns(['Job ID'], { ghost: { patterns: [/^nothing$/] } });
    assert.equal(cols.ghost, undefined);
  });

  test('colLetter handles multi-letter columns', () => {
    assert.equal(colLetter(1), 'A');
    assert.equal(colLetter(26), 'Z');
    assert.equal(colLetter(27), 'AA');
    assert.equal(colLetter(44), 'AR');
  });
});

describe('full address', () => {
  test('NP-96651 round-trips byte-for-byte', () => {
    const live = '225 Rue Peel, Montreal, QC';
    assert.equal(normaliseFullAddress(live), live);
    assert.equal(normaliseFullAddress(normaliseFullAddress(live)), live);
  });

  test('the city is never dropped', () => {
    const out = normaliseFullAddress('225 Rue Peel, Montreal, QC');
    assert.notEqual(out, 'Montreal, QC');
    assert.ok(out.startsWith('225 Rue Peel'));
    assert.ok(out.endsWith('Montreal, QC'));
  });

  test('the city is never duplicated', () => {
    const out = normaliseFullAddress('225 Rue Peel, Montreal, QC');
    assert.notEqual(out, '225 Rue Peel, Montreal, QC, Montreal, QC');
    assert.equal(out.match(/Montreal/g).length, 1);
  });

  test('tidies spacing without changing content', () => {
    assert.equal(
      normaliseFullAddress('  225  Rue Peel ,Montreal ,  QC  '),
      '225 Rue Peel, Montreal, QC',
    );
  });

  test('trailing separators are trimmed', () => {
    assert.equal(normaliseFullAddress('225 Rue Peel, Montreal, QC,'), '225 Rue Peel, Montreal, QC');
  });

  test('empty stays empty', () => {
    assert.equal(normaliseFullAddress(''), '');
    assert.equal(normaliseFullAddress('   '), '');
  });

  test('detects when the city is already present', () => {
    assert.equal(fullAddressIncludesCity('225 Rue Peel, Montreal, QC', 'Montreal, QC'), true);
    assert.equal(fullAddressIncludesCity('225 Rue Peel', 'Montreal, QC'), false);
    assert.equal(fullAddressIncludesCity('225 Rue Peel, Montreal, QC', ''), false);
  });

  test('every live address shape survives unchanged', () => {
    for (const live of [
      '225 Rue Peel, Montreal, QC',
      '6321 Autoroute Transcanadienne, Montreal, QC',
      '1405-582 Chemin de Touraine, Boucherville, QC',
      'Address on National WO',
    ]) {
      assert.equal(normaliseFullAddress(live), live, live);
    }
  });
});

describe('dates', () => {
  test('parses the formats the sheet actually produces', () => {
    assert.equal(parseSheetDate('2026-08-24'), '2026-08-24');
    assert.equal(parseSheetDate('2026-8-4'), '2026-08-04');
    assert.equal(parseSheetDate('24/08/2026'), '2026-08-24');
    assert.equal(parseSheetDate(''), null);
    assert.equal(parseSheetDate('not a date'), null);
  });

  test('the fixture instant is noon on the business calendar', () => {
    assert.equal(businessDay(TODAY), '2026-08-24');
  });

  // Calendar windows, DST and month/year rollover are covered in
  // timezone.test.mjs, which runs under UTC, America/Toronto and Asia/Tokyo.
});

describe('job duplicate matching', () => {
  const jobs = [
    job({ row: 6, jobId: 'NP-95766', customer: 'MARSHALLS MEGA #777', woNumber: '95766', poNumber: '357617196', fullAddress: '6321 Autoroute Transcanadienne, Montreal, QC' }),
    job({ row: 7, jobId: 'NP-95818', customer: 'WINNERS MEGA #365/39', woNumber: '95818', poNumber: '357821321', fullAddress: '1405-582 Chemin de Touraine, Boucherville, QC' }),
    job({ row: 8, jobId: 'NP-96214', customer: 'H&M JOLIETTE #53', woNumber: '96214', poNumber: '', fullAddress: 'Address on National WO' }),
  ];

  test('Job ID is the strongest signal', () => {
    const m = findDuplicate(jobs, { jobId: 'NP-95818' });
    assert.equal(m?.job.row, 7);
    assert.equal(m?.confidence, 1);
  });

  test('matches on WO number', () => {
    const m = findDuplicate(jobs, { woNumber: '96214' });
    assert.equal(m?.job.jobId, 'NP-96214');
    assert.ok(m.reason.includes('WO'));
  });

  test('matches on PO number', () => {
    const m = findDuplicate(jobs, { poNumber: '357617196' });
    assert.equal(m?.job.jobId, 'NP-95766');
  });

  test('matches on customer plus full address', () => {
    const m = findDuplicate(jobs, {
      customer: 'MARSHALLS MEGA #777',
      fullAddress: '6321 Autoroute Transcanadienne, Montreal, QC',
    });
    assert.equal(m?.job.row, 6);
    assert.equal(m?.reason, 'customer + address');
  });

  test('ignores punctuation and case differences', () => {
    assert.equal(findDuplicate(jobs, { jobId: 'np95818' })?.job.row, 7);
  });

  test('a genuinely new job matches nothing', () => {
    assert.equal(findDuplicate(jobs, { customer: 'BRAND NEW CLIENT' }), null);
  });

  test('an ambiguous customer with no address does not match', () => {
    const two = [job({ row: 6, customer: 'WINNERS #1' }), job({ row: 7, customer: 'WINNERS #2' })];
    assert.equal(findDuplicate(two, { customer: 'WINNERS' }), null);
  });
});

describe('job views', () => {
  const jobs = [
    job({ row: 6, status: 'UPCOMING' }),
    job({ row: 7, status: 'ONGOING' }),
    job({ row: 8, status: 'TOMORROW PLAN' }),
    job({ row: 9, status: 'WAITING MATERIAL' }),
    job({ row: 10, status: 'WAITING APPROVAL' }),
    job({ row: 11, status: 'COMPLETED', projectEnd: '2026-08-24' }),
    job({ row: 12, status: 'CANCELLED' }),
    job({ row: 13, status: 'ONGOING', longProject: 'YES' }),
    job({ row: 14, status: 'ONGOING', technicians: ['Meisam'] }),
    job({ row: 15, status: 'UPCOMING', scheduledDate: '2026-08-20' }),
    job({ row: 16, status: 'SCHEDULED' }),
    job({ row: 17, status: 'ONGOING', priority: 'URGENT' }),
    job({ row: 18, status: 'CANCELLED', priority: 'EMERGENCY' }), // inactive — excluded from urgent
  ];

  test('each view selects only its own statuses', () => {
    assert.deepEqual(filterView(jobs, 'ongoing', TODAY).map((j) => j.row), [7, 13, 14, 17]);
    assert.deepEqual(filterView(jobs, 'waiting-materials', TODAY).map((j) => j.row), [9]);
    assert.deepEqual(filterView(jobs, 'waiting-approval', TODAY).map((j) => j.row), [10]);
    assert.deepEqual(filterView(jobs, 'waiting', TODAY).map((j) => j.row), [9, 10]);
    assert.deepEqual(filterView(jobs, 'cancelled', TODAY).map((j) => j.row), [12, 18]);
    assert.deepEqual(filterView(jobs, 'long-projects', TODAY).map((j) => j.row), [13]);
  });

  test("'scheduled' is only the SCHEDULED status, distinct from the broader 'upcoming' bucket", () => {
    assert.deepEqual(filterView(jobs, 'scheduled', TODAY).map((j) => j.row), [16]);
    const upcoming = filterView(jobs, 'upcoming', TODAY).map((j) => j.row);
    assert.ok(upcoming.includes(16), 'SCHEDULED still counts as upcoming too');
  });

  test("'urgent' is active jobs at URGENT or EMERGENCY priority", () => {
    assert.deepEqual(filterView(jobs, 'urgent', TODAY).map((j) => j.row), [17]);
  });

  test('tomorrow catches both the status and a matching scheduled date', () => {
    const withDate = [...jobs, job({ row: 16, status: 'SCHEDULED', scheduledDate: '2026-08-25' })];
    const rows = filterView(withDate, 'tomorrow', TODAY).map((j) => j.row);
    assert.ok(rows.includes(8));
    assert.ok(rows.includes(16));
  });

  test('unassigned means active with no crew', () => {
    const rows = filterView(jobs, 'unassigned', TODAY).map((j) => j.row);
    assert.ok(rows.includes(7));
    assert.ok(!rows.includes(14));
    assert.ok(!rows.includes(11));
    assert.ok(!rows.includes(12));
  });

  test('overdue means active and scheduled before today', () => {
    assert.deepEqual(filterView(jobs, 'overdue', TODAY).map((j) => j.row), [15]);
  });

  test('completed and cancelled are not active', () => {
    assert.equal(isActiveJob({ status: 'COMPLETED' }), false);
    assert.equal(isActiveJob({ status: 'DONE' }), false);
    assert.equal(isActiveJob({ status: 'CANCELLED' }), false);
    assert.equal(isActiveJob({ status: 'ONGOING' }), true);
    assert.equal(isClosedJob({ status: 'CANCELLED' }), false);
  });
});

describe('completion date', () => {
  test('Project End is authoritative', () => {
    assert.equal(
      completionDate({ projectEnd: '2026-08-20', lastUpdated: '2026-08-24 09:00' }),
      '2026-08-20',
    );
  });

  test('falls back to Last Updated only when Project End is empty', () => {
    assert.equal(
      completionDate({ projectEnd: '', lastUpdated: '2026-08-24 09:00' }),
      '2026-08-24',
    );
  });

  test('the scheduled date is never used', () => {
    // A job booked in July but closed in August must count as August.
    const j = job({ status: 'COMPLETED', scheduledDate: '2026-07-02', projectEnd: '2026-08-11' });
    assert.equal(completionDate(j), '2026-08-11');
    assert.deepEqual(filterCompleted([j], 'month', TODAY).map((x) => x.row), [6]);
  });

  test('with neither date the job has no completion date', () => {
    assert.equal(completionDate({ projectEnd: '', lastUpdated: '' }), null);
  });
});

describe('completed windows and month rollover', () => {
  const jobs = [
    job({ row: 6, status: 'COMPLETED', projectEnd: '2026-08-24' }),
    job({ row: 7, status: 'DONE', projectEnd: '2026-08-22' }),
    job({ row: 8, status: 'COMPLETED', projectEnd: '2026-08-05' }),
    job({ row: 9, status: 'COMPLETED', projectEnd: '2026-07-28' }),
    job({ row: 10, status: 'ONGOING' }),
  ];

  test('today, week and month narrow correctly', () => {
    assert.deepEqual(filterCompleted(jobs, 'today', TODAY).map((j) => j.row), [6]);
    assert.deepEqual(filterCompleted(jobs, 'week', TODAY).map((j) => j.row), [6]);
    assert.deepEqual(filterCompleted(jobs, 'month', TODAY).map((j) => j.row), [6, 7, 8]);
  });

  test('all includes every closed job regardless of date', () => {
    assert.deepEqual(filterCompleted(jobs, 'all', TODAY).map((j) => j.row), [6, 7, 8, 9]);
  });

  test('eight jobs completed this month all appear', () => {
    const eight = Array.from({ length: 8 }, (_, i) =>
      job({ row: 6 + i, jobId: `NP-${900 + i}`, status: 'COMPLETED', projectEnd: `2026-08-${String(i + 3).padStart(2, '0')}` }));
    assert.equal(filterCompleted(eight, 'month', TODAY).length, 8);
  });

  test('previous-month work leaves the month view but is never lost', () => {
    const month = filterCompleted(jobs, 'month', TODAY).map((j) => j.row);
    assert.ok(!month.includes(9));
    assert.deepEqual(archivedCompleted(jobs, TODAY).map((j) => j.row), [9]);
  });

  test("the 'archive' range is the same set as archivedCompleted — the Completed Archive tab", () => {
    assert.deepEqual(filterCompleted(jobs, 'archive', TODAY).map((j) => j.row), [9]);
    assert.deepEqual(
      filterCompleted(jobs, 'archive', TODAY).map((j) => j.row),
      archivedCompleted(jobs, TODAY).map((j) => j.row),
    );
  });

  test('the month view rolls forward on its own at the turn of the month', () => {
    const september = businessInstant(2026, 9, 1, 9, 0);
    assert.deepEqual(filterCompleted(jobs, 'month', september).map((j) => j.row), []);
    assert.deepEqual(archivedCompleted(jobs, september).map((j) => j.row), [6, 7, 8, 9]);
    assert.deepEqual(filterCompleted(jobs, 'archive', september).map((j) => j.row), [6, 7, 8, 9]);
  });

  test('person-hours come from the logs, never from crew x hours', () => {
    const closed = [job({ row: 6, jobId: 'NP-1', status: 'COMPLETED', projectEnd: '2026-08-24' })];
    const logs = [
      log({ jobId: 'NP-1', workDate: '2026-08-23', crewCount: 2, totalHours: 12 }),
      log({ jobId: 'NP-1', workDate: '2026-08-24', crewCount: 3, totalHours: 18 }),
      log({ jobId: 'NP-OTHER', workDate: '2026-08-24', crewCount: 5, totalHours: 40 }),
    ];
    const totals = completedTotals(closed, logs);
    assert.equal(totals.personHours, 30, 'summed as-is, and only this job');
    assert.equal(totals.loggedDays, 2);
    assert.equal(totals.projects, 1);
  });
});

describe('material routing', () => {
  const jobs = [
    job({ row: 6, materials: 'Sloan Royal 111-ES flush valve', materialStatus: 'NEED PURCHASE' }),
    job({ row: 7, materials: '', materialStatus: 'NEED LIST' }),
    job({ row: 8, materials: '', materialStatus: 'NONE' }),
    job({ row: 9, materials: 'Wax ring', materialStatus: '' }),
    job({ row: 10, materials: '', materialStatus: '' }),
  ];

  test('a job appears as soon as it carries a requirement', () => {
    assert.deepEqual(filterMaterials(jobs).map((j) => j.row), [6, 7, 9]);
  });

  test('jobs with no material at all stay out', () => {
    const rows = filterMaterials(jobs).map((j) => j.row);
    assert.ok(!rows.includes(8));
    assert.ok(!rows.includes(10));
  });

  test('every material line keeps its originating job', () => {
    const line = filterMaterials(jobs)[0];
    assert.equal(line.jobId, 'NP-1');
    assert.equal(line.customer, 'WINNERS #451');
  });
});

describe('protected formula views', () => {
  test('the job views refuse writes', () => {
    for (const sheet of ['Upcoming', 'Tomorrow Plan', 'Ongoing', 'Done', 'Materials', 'Long Projects']) {
      assert.equal(isWritableSheet(sheet), false, sheet);
      assert.throws(() => assertWritable(sheet), /formula view/);
    }
  });

  test('ARCHIVE refuses writes — its A6 array formula must survive', () => {
    assert.equal(isWritableSheet('ARCHIVE'), false);
    assert.throws(() => assertWritable('ARCHIVE'), /formula view/);
  });

  test('the writable source tables accept writes', () => {
    for (const sheet of ['All Jobs', 'ACTIVE REMINDERS', 'Daily Logs', 'Team & Fleet']) {
      assert.equal(isWritableSheet(sheet), true, sheet);
      assert.doesNotThrow(() => assertWritable(sheet));
    }
  });

  test('the read-only list covers all seven formula views', () => {
    assert.equal(READONLY_VIEWS.length, 7);
    assert.ok(READONLY_VIEWS.includes('ARCHIVE'));
  });
});

describe('crew assignment', () => {
  test('accepts several people on one job', () => {
    assert.deepEqual(normaliseCrew(['Ali', 'Meisam']), ['Ali', 'Meisam']);
    assert.deepEqual(normaliseCrew(['Arsalan', 'Pirooz', 'Farzad']), ['Arsalan', 'Pirooz', 'Farzad']);
    assert.deepEqual(
      normaliseCrew(['Arash', 'Agha Nemat', 'Mohammad', 'Ali 2 - Helper']),
      ['Arash', 'Agha Nemat', 'Mohammad', 'Ali 2 - Helper'],
    );
  });

  test('trims, drops blanks and de-duplicates', () => {
    assert.deepEqual(normaliseCrew(['  Ali  ', '', 'ali', 'Meisam']), ['Ali', 'Meisam']);
  });

  test('caps at five so the sheet columns cannot overflow', () => {
    assert.equal(normaliseCrew(['A', 'B', 'C', 'D', 'E', 'F', 'G']).length, MAX_CREW);
  });

  test('spreads across the five technician columns and blanks the rest', () => {
    assert.deepEqual(crewToColumns(['Ali', 'Meisam']), {
      tech1: 'Ali', tech2: 'Meisam', tech3: '', tech4: '', tech5: '',
    });
  });

  test('an empty crew clears every column rather than leaving stale names', () => {
    assert.deepEqual(crewToColumns([]), {
      tech1: '', tech2: '', tech3: '', tech4: '', tech5: '',
    });
  });
});

describe('daily labour calculations', () => {
  test('parses the clock formats staff actually type', () => {
    assert.equal(parseClock('08:00'), 480);
    assert.equal(parseClock('8:00 AM'), 480);
    assert.equal(parseClock('8:00 a.m.'), 480);
    assert.equal(parseClock('2:30 PM'), 870);
    assert.equal(parseClock('12:00 AM'), 0);
    assert.equal(parseClock('12:00 PM'), 720);
    assert.equal(parseClock('nonsense'), null);
    assert.equal(parseClock('25:00'), null);
  });

  test('hours per person subtracts the break', () => {
    assert.equal(hoursPerPerson('08:00', '14:30', 30), 6);
    assert.equal(hoursPerPerson('08:00', '16:00', 0), 8);
    assert.equal(hoursPerPerson('08:00', '16:00', 60), 7);
  });

  test('handles an overnight shift', () => {
    assert.equal(hoursPerPerson('22:00', '02:00', 0), 4);
  });

  test('never returns a negative day', () => {
    assert.equal(hoursPerPerson('08:00', '08:15', 60), 0);
  });

  test('missing clock times yield zero rather than a wrong number', () => {
    assert.equal(hoursPerPerson('', '16:00', 0), 0);
    assert.equal(hoursPerPerson('08:00', '', 0), 0);
  });

  test('person-hours is crew size times hours each', () => {
    assert.equal(personHours(2, 6), 12);
    assert.equal(personHours(4, 7.5), 30);
    assert.equal(personHours(0, 8), 0);
  });

  test('worked example: 2 techs, 08:00-14:30, 30 min break', () => {
    const each = hoursPerPerson('08:00', '14:30', 30);
    assert.equal(each, 6);
    assert.equal(personHours(2, each), 12);
  });

  test('project roll-up totals days, workers and person-hours', () => {
    const logs = [
      log({ workDate: '2026-08-20', technicians: ['Ali', 'Meisam'], crewCount: 2, totalHours: 12, materialsUsed: 'Pipe' }),
      log({ workDate: '2026-08-21', technicians: ['Ali'], crewCount: 1, totalHours: 7, materialsUsed: 'Pipe' }),
      log({ workDate: '2026-08-22', technicians: ['Ali', 'Farzad', 'Arash'], crewCount: 3, totalHours: 21, materialsUsed: 'Valve' }),
    ];
    const r = rollupProject(logs);
    assert.equal(r.workingDays, 3);
    assert.equal(r.workers, 4);
    assert.equal(r.totalPersonHours, 40, 'summed as-is — already person-hours');
    assert.equal(r.avgCrew, 2);
    assert.deepEqual(r.materials, ['Pipe', 'Valve']);
    assert.equal(r.startDate, '2026-08-20');
    assert.equal(r.endDate, '2026-08-22');
  });
});

describe('reminder vocabulary', () => {
  test('priorities match the specification exactly', () => {
    assert.deepEqual([...REMINDER_PRIORITIES], ['Critical', 'High', 'Normal', 'Low']);
  });

  test('statuses match the specification exactly, in order', () => {
    assert.deepEqual([...REMINDER_STATUSES], [
      'New', 'Action Required', 'In Progress', 'Scheduled', 'Follow-Up Required',
      'Waiting for Response', 'Waiting for Payment', 'Waiting for Approval',
      'Completed — Check Required', 'Completed', 'On Hold', 'Cancelled', 'Removed',
    ]);
  });
});

describe('reminder canonicalisation', () => {
  test('any casing snaps to the spec spelling', () => {
    assert.equal(canonicalReminderStatus('follow-up required'), 'Follow-Up Required');
    assert.equal(canonicalReminderStatus('WAITING FOR PAYMENT'), 'Waiting for Payment');
    assert.equal(canonicalReminderStatus('waiting for approval'), 'Waiting for Approval');
    assert.equal(canonicalReminderStatus('action required'), 'Action Required');
    assert.equal(canonicalReminderPriority('critical'), 'Critical');
    assert.equal(canonicalReminderPriority('NORMAL'), 'Normal');
  });

  test('a plain hyphen becomes the em dash the spec uses', () => {
    assert.equal(canonicalReminderStatus('Completed - Check Required'), 'Completed — Check Required');
  });

  test('an unknown value is passed through, never silently rewritten', () => {
    assert.equal(canonicalReminderStatus('Bespoke Status'), 'Bespoke Status');
    assert.equal(canonicalReminderPriority('Urgent'), 'Urgent');
  });

  test('blank stays blank', () => {
    assert.equal(canonicalReminderStatus(''), '');
  });
});

describe('reminder archiving', () => {
  test('reminders are only ever written to ACTIVE REMINDERS', () => {
    assert.equal(REMINDER_WRITE_SHEET, SHEET_ACTIVE_REMINDERS);
  });

  test('only Completed, Cancelled and Removed surface in ARCHIVE', () => {
    assert.equal(reminderVisibleIn('Completed'), SHEET_ARCHIVE);
    assert.equal(reminderVisibleIn('Cancelled'), SHEET_ARCHIVE);
    assert.equal(reminderVisibleIn('Removed'), SHEET_ARCHIVE);
  });

  test('every working status stays in ACTIVE', () => {
    for (const s of ['New', 'Action Required', 'In Progress', 'Scheduled',
      'Follow-Up Required', 'Waiting for Response', 'Waiting for Payment',
      'Waiting for Approval', 'On Hold']) {
      assert.equal(reminderVisibleIn(s), SHEET_ACTIVE_REMINDERS, s);
    }
  });

  test('"Completed — Check Required" stays active until a human verifies it', () => {
    assert.equal(isCheckRequired('Completed — Check Required'), true);
    assert.equal(reminderVisibleIn('Completed — Check Required'), SHEET_ACTIVE_REMINDERS);
  });

  test('a plain hyphen is accepted for the em dash', () => {
    assert.equal(reminderVisibleIn('Completed - Check Required'), SHEET_ACTIVE_REMINDERS);
  });

  test('status matching is case-insensitive', () => {
    assert.equal(reminderVisibleIn('completed'), SHEET_ARCHIVE);
    assert.equal(reminderVisibleIn('CANCELLED'), SHEET_ARCHIVE);
  });

  test('an unrecognised status defaults to ACTIVE rather than disappearing', () => {
    assert.equal(reminderVisibleIn('Something Else'), SHEET_ACTIVE_REMINDERS);
  });

  test('the retained alias behaves identically', () => {
    assert.equal(reminderTargetSheet('Completed'), reminderVisibleIn('Completed'));
  });
});

describe('reminder de-duplication across the two views', () => {
  test('a reminder mirrored into ARCHIVE is listed once', () => {
    const source = reminder({ row: 9, sheet: SHEET_ACTIVE_REMINDERS, id: 'REM-0007', status: 'Completed' });
    const mirrored = reminder({ row: 6, sheet: SHEET_ARCHIVE, id: 'REM-0007', status: 'Completed' });
    const out = dedupeReminders([mirrored, source]);
    assert.equal(out.length, 1);
    assert.equal(out[0].sheet, SHEET_ACTIVE_REMINDERS, 'the writable source row wins');
    assert.equal(out[0].row, 9);
  });

  test('matching falls back to customer plus action when ids are blank', () => {
    const a = reminder({ row: 9, sheet: SHEET_ACTIVE_REMINDERS, id: '' });
    const b = reminder({ row: 6, sheet: SHEET_ARCHIVE, id: '' });
    assert.equal(dedupeReminders([b, a]).length, 1);
  });

  test('genuinely different reminders both survive', () => {
    const a = reminder({ id: 'REM-0001' });
    const b = reminder({ row: 7, id: 'REM-0002', requiredAction: 'Book visit' });
    assert.equal(dedupeReminders([a, b]).length, 2);
  });
});

describe('reminder merging', () => {
  const list = [
    reminder({ row: 6, id: 'REM-0001', customer: 'WINNERS #451', requiredAction: 'Send estimate' }),
    reminder({ row: 7, id: 'REM-0002', customer: 'H&M JOLIETTE #53', requiredAction: 'Chase payment' }),
  ];

  test('finds by id', () => {
    assert.equal(findReminder(list, { id: 'REM-0002' })?.row, 7);
  });

  test('same customer plus same action is the same reminder', () => {
    assert.equal(findReminder(list, { customer: 'WINNERS #451', requiredAction: 'Send estimate' })?.row, 6);
  });

  test('merging ignores case and punctuation', () => {
    assert.equal(findReminder(list, { customer: 'winners #451', requiredAction: 'send  estimate' })?.row, 6);
  });

  test('a different action on the same customer is a new reminder', () => {
    assert.equal(findReminder(list, { customer: 'WINNERS #451', requiredAction: 'Book visit' }), null);
  });

  test('customer alone is not enough to merge', () => {
    assert.equal(findReminder(list, { customer: 'WINNERS #451' }), null);
  });
});

describe('reminder ordering', () => {
  test('overdue first, then due date, then priority', () => {
    const list = [
      reminder({ row: 6, id: 'a', dueAt: '2026-08-30', priority: 'Low' }),
      reminder({ row: 7, id: 'b', dueAt: '2026-08-01', priority: 'Normal' }),
      reminder({ row: 8, id: 'c', dueAt: '2026-08-30', priority: 'Critical' }),
      reminder({ row: 9, id: 'd', dueAt: '', priority: 'High' }),
    ];
    const order = sortReminders(list, TODAY).map((r) => r.id);
    assert.deepEqual(order, ['b', 'c', 'a', 'd']);
  });

  test('archived reminders are never flagged overdue', () => {
    assert.equal(isReminderOverdue(reminder({ sheet: SHEET_ARCHIVE, dueAt: '2026-01-01' }), TODAY), false);
  });

  test('an active reminder past its date is overdue', () => {
    assert.equal(isReminderOverdue(reminder({ dueAt: '2026-08-01' }), TODAY), true);
    assert.equal(isReminderOverdue(reminder({ dueAt: '2026-09-01' }), TODAY), false);
  });
});

describe('Tomorrow Plan confirmation', () => {
  const NONE = { confirmed: false, customerConfirmed: false, crewConfirmed: false };

  test('a proposed (unconfirmed) job never needs coordination', () => {
    assert.equal(needsCoordination(NONE), false);
  });

  test('confirmed with neither step done needs coordination', () => {
    assert.equal(needsCoordination({ confirmed: true, customerConfirmed: false, crewConfirmed: false }), true);
  });

  test('confirmed with only the customer done still needs coordination', () => {
    assert.equal(needsCoordination({ confirmed: true, customerConfirmed: true, crewConfirmed: false }), true);
  });

  test('confirmed with both steps done needs nothing further', () => {
    assert.equal(needsCoordination({ confirmed: true, customerConfirmed: true, crewConfirmed: true }), false);
  });

  test('the crew cannot be confirmed before the customer', () => {
    assert.throws(() => assertCoordinationOrder(NONE, { crewConfirmed: true }));
  });

  test('confirming the customer and crew in the same call is allowed', () => {
    assert.doesNotThrow(() => assertCoordinationOrder(NONE, { customerConfirmed: true, crewConfirmed: true }));
  });

  test('the crew can be confirmed once the customer already is', () => {
    const alreadyCustomer = { confirmed: true, customerConfirmed: true, crewConfirmed: false };
    assert.doesNotThrow(() => assertCoordinationOrder(alreadyCustomer, { crewConfirmed: true }));
  });

  test('unrelated patches (just flipping confirmed) never throw', () => {
    assert.doesNotThrow(() => assertCoordinationOrder(NONE, { confirmed: true }));
  });
});

describe('manual priority order', () => {
  test('reorders the list to match the saved order', () => {
    const list = [reminder({ id: 'a' }), reminder({ id: 'b' }), reminder({ id: 'c' })];
    const out = applyManualOrder(list, ['c', 'a', 'b']);
    assert.deepEqual(out.map((r) => r.id), ['c', 'a', 'b']);
  });

  test('a reminder created after the order was saved is appended, not hidden', () => {
    const list = [reminder({ id: 'a' }), reminder({ id: 'b' }), reminder({ id: 'new' })];
    const out = applyManualOrder(list, ['b', 'a']);
    assert.deepEqual(out.map((r) => r.id), ['b', 'a', 'new']);
  });

  test('a stale order entry for a deleted reminder is skipped, never invented', () => {
    const list = [reminder({ id: 'a' }), reminder({ id: 'b' })];
    const out = applyManualOrder(list, ['gone', 'b', 'a']);
    assert.deepEqual(out.map((r) => r.id), ['b', 'a']);
  });

  test('order matching is case- and whitespace-insensitive, like every other reminder key', () => {
    const list = [reminder({ id: 'REM-0001' }), reminder({ id: 'REM-0002' })];
    const out = applyManualOrder(list, [' rem-0002 ', 'rem-0001']);
    assert.deepEqual(out.map((r) => r.id), ['REM-0002', 'REM-0001']);
  });

  test('an empty saved order leaves the original list untouched', () => {
    const list = [reminder({ id: 'a' }), reminder({ id: 'b' })];
    assert.deepEqual(applyManualOrder(list, []).map((r) => r.id), ['a', 'b']);
  });
});

describe('reminder comment threads', () => {
  function comment(over = {}) {
    return { commentId: 'CMT-0001', reminderId: 'REM-0001', createdAt: '2026-08-24T10:00:00.000Z', ...over };
  }

  test('sorts oldest first, like a conversation', () => {
    const list = [
      comment({ commentId: 'CMT-0003', createdAt: '2026-08-24T12:00:00.000Z' }),
      comment({ commentId: 'CMT-0001', createdAt: '2026-08-24T09:00:00.000Z' }),
      comment({ commentId: 'CMT-0002', createdAt: '2026-08-24T10:30:00.000Z' }),
    ];
    assert.deepEqual(sortComments(list).map((c) => c.commentId), ['CMT-0001', 'CMT-0002', 'CMT-0003']);
  });

  test('ties on the same timestamp break by comment id, deterministically', () => {
    const list = [
      comment({ commentId: 'CMT-0002', createdAt: '2026-08-24T09:00:00.000Z' }),
      comment({ commentId: 'CMT-0001', createdAt: '2026-08-24T09:00:00.000Z' }),
    ];
    assert.deepEqual(sortComments(list).map((c) => c.commentId), ['CMT-0001', 'CMT-0002']);
  });
});

describe('reminder grouping — the daily-operations buckets', () => {
  const list = [
    reminder({ row: 6, id: 'overdue-1', status: 'New', dueAt: '2026-08-01' }),
    reminder({ row: 7, id: 'today-1', status: 'Action Required', dueAt: '2026-08-24' }),
    reminder({ row: 8, id: 'tomorrow-1', status: 'New', dueAt: '2026-08-25' }),
    reminder({ row: 9, id: 'scheduled-1', status: 'Scheduled', dueAt: '2026-09-10' }),
    reminder({ row: 10, id: 'followup-1', status: 'Follow-Up Required', dueAt: '2026-09-11' }),
    reminder({ row: 11, id: 'waiting-response', status: 'Waiting for Response', dueAt: '' }),
    reminder({ row: 12, id: 'waiting-payment', status: 'Waiting for Payment', dueAt: '' }),
    reminder({ row: 13, id: 'waiting-approval', status: 'Waiting for Approval', dueAt: '' }),
    reminder({ row: 14, id: 'other-1', status: 'In Progress', dueAt: '' }),
    reminder({ row: 15, id: 'other-2', status: 'On Hold', dueAt: '' }),
    reminder({ row: 16, id: 'check-required', status: 'Completed — Check Required', dueAt: '' }),
    // Urgency wins: overdue AND Follow-Up Required must land in Overdue only.
    reminder({ row: 17, id: 'overdue-followup', status: 'Follow-Up Required', dueAt: '2026-08-10' }),
  ];
  const groups = groupReminders(list, TODAY);

  test('every reminder lands in exactly one bucket', () => {
    const total = Object.values(groups).reduce((sum, g) => sum + g.length, 0);
    assert.equal(total, list.length);
  });

  test('due-date urgency takes precedence over status', () => {
    assert.deepEqual(groups.overdue.map((r) => r.id), ['overdue-1', 'overdue-followup']);
    assert.deepEqual(groups.dueToday.map((r) => r.id), ['today-1']);
    assert.deepEqual(groups.dueTomorrow.map((r) => r.id), ['tomorrow-1']);
  });

  test('status buckets only see what urgency did not already claim', () => {
    assert.deepEqual(groups.scheduled.map((r) => r.id), ['scheduled-1']);
    assert.deepEqual(groups.followUp.map((r) => r.id), ['followup-1']);
    assert.deepEqual(
      groups.waiting.map((r) => r.id).sort(),
      ['waiting-approval', 'waiting-payment', 'waiting-response'],
    );
  });

  test('Completed — Check Required and In Progress/On Hold fall into Other Active', () => {
    assert.deepEqual(
      groups.other.map((r) => r.id).sort(),
      ['check-required', 'other-1', 'other-2'],
    );
  });

  test('an empty list produces empty buckets, not an error', () => {
    const empty = groupReminders([], TODAY);
    for (const key of Object.keys(empty)) assert.deepEqual(empty[key], []);
  });
});

describe('money', () => {
  test('amounts display in CAD', () => {
    assert.match(formatCad('1500'), /1,500\.00/);
    assert.match(formatCad('1500'), /\$/);
    assert.equal(formatCad(''), '');
  });

  test('unparseable text is returned untouched rather than zeroed', () => {
    assert.equal(formatCad('TBD'), 'TBD');
  });
});

describe('idempotency', () => {
  test('the same request always produces the same key', () => {
    const a = stableIdempotencyKey('claude', 'create_or_update_job', { jobId: 'NP-1', status: 'ONGOING' });
    const b = stableIdempotencyKey('claude', 'create_or_update_job', { jobId: 'NP-1', status: 'ONGOING' });
    assert.equal(a, b);
  });

  test('key order does not change the key', () => {
    assert.equal(
      stableIdempotencyKey('chatgpt', 'x', { a: 1, b: 2 }),
      stableIdempotencyKey('chatgpt', 'x', { b: 2, a: 1 }),
    );
  });

  test('whitespace differences do not change the key', () => {
    assert.equal(
      stableIdempotencyKey('chatgpt', 'x', { customer: 'WINNERS #451' }),
      stableIdempotencyKey('chatgpt', 'x', { customer: '  WINNERS #451  ' }),
    );
  });

  test('absent, null and empty fields are equivalent', () => {
    assert.equal(
      stableIdempotencyKey('claude', 'x', { jobId: 'NP-1' }),
      stableIdempotencyKey('claude', 'x', { jobId: 'NP-1', notes: '', truck: null }),
    );
  });

  test('a different payload produces a different key', () => {
    assert.notEqual(
      stableIdempotencyKey('claude', 'x', { jobId: 'NP-1', status: 'ONGOING' }),
      stableIdempotencyKey('claude', 'x', { jobId: 'NP-1', status: 'COMPLETED' }),
    );
  });

  test('a different action produces a different key', () => {
    assert.notEqual(
      stableIdempotencyKey('claude', 'assign_crew', { jobId: 'NP-1' }),
      stableIdempotencyKey('claude', 'complete_job', { jobId: 'NP-1' }),
    );
  });

  test('crew order is meaningful and must not collapse', () => {
    assert.notEqual(
      stableIdempotencyKey('claude', 'assign_crew', { technicians: ['Ali', 'Meisam'] }),
      stableIdempotencyKey('claude', 'assign_crew', { technicians: ['Meisam', 'Ali'] }),
    );
  });

  test('keys are compact and prefixed', () => {
    assert.match(stableIdempotencyKey('claude', 'x', { a: 1 }), /^sk_[0-9a-f]{32}$/);
  });

  test('canonical JSON is stable', () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
    assert.equal(canonicalJson({ a: '', b: null, c: 3 }), '{"c":3}');
  });
});

describe('KPIs', () => {
  const jobs = [
    job({ row: 6, status: 'UPCOMING', scheduledDate: '2026-08-26' }),
    job({ row: 7, status: 'ONGOING', technicians: ['Ali'], scheduledDate: '2026-08-24' }),
    job({ row: 8, status: 'WAITING MATERIAL' }),
    job({ row: 9, status: 'COMPLETED', projectEnd: '2026-08-24' }),
    job({ row: 10, status: 'ONGOING', priority: 'URGENT' }),
    job({ row: 11, status: 'UPCOMING', scheduledDate: '2026-08-10' }),
  ];

  test('counts line up with the views they link to', () => {
    const k = computeKpis(jobs, [], TODAY);
    assert.equal(k.total, 6);
    assert.equal(k.active, 5);
    assert.equal(k.ongoing, filterView(jobs, 'ongoing', TODAY).length);
    assert.equal(k.waitingMaterials, 1);
    assert.equal(k.urgent, 1);
    assert.equal(k.overdue, 1);
    assert.equal(k.completedToday, 1);
  });

  test('labour hours come from the logs, not the jobs', () => {
    const logs = [
      log({ workDate: '2026-08-24', totalHours: 12 }),
      log({ workDate: '2026-08-23', totalHours: 7 }),
      log({ workDate: '2026-07-30', totalHours: 100 }),
    ];
    const k = computeKpis(jobs, logs, TODAY);
    assert.equal(k.hoursToday, 12);
    assert.equal(k.hoursWeek, 12, 'the 23rd is the previous week');
    assert.equal(k.hoursMonth, 19, 'July is excluded');
  });

  test('scheduled-today, waiting-scheduling and overdue-follow-up counts', () => {
    const mix = [
      job({ row: 20, status: 'UPCOMING', scheduledDate: '2026-08-24' }), // scheduled today, active
      job({ row: 21, status: 'DONE', scheduledDate: '2026-08-24' }),     // scheduled today but closed — excluded
      job({ row: 22, status: 'NEED SCHEDULING' }),
      job({ row: 23, status: 'need scheduling' }),                       // case-insensitive
      job({ row: 24, status: 'UPCOMING', followUpDate: '2026-08-20' }),  // overdue follow-up
      job({ row: 25, status: 'UPCOMING', followUpDate: '2026-08-24' }),  // due today, not overdue
      job({ row: 26, status: 'CANCELLED', followUpDate: '2026-08-01' }), // inactive — excluded
    ];
    const k = computeKpis(mix, [], TODAY);
    assert.equal(k.scheduledToday, 1, 'a closed job does not count as scheduled today');
    assert.equal(k.waitingScheduling, 2, 'status match is case-insensitive');
    assert.equal(k.overdueFollowUps, 1, 'due-today and inactive jobs are excluded');
  });

  test('no logs means zero hours, not a job-derived number', () => {
    const k = computeKpis(jobs, [], TODAY);
    assert.equal(k.hoursToday, 0);
    assert.equal(k.hoursWeek, 0);
    assert.equal(k.hoursMonth, 0);
  });

  test('an empty workbook produces zeroes, not NaN', () => {
    const k = computeKpis([], [], TODAY);
    for (const [name, value] of Object.entries(k)) {
      assert.ok(Number.isFinite(value), `${name} should be finite, got ${value}`);
    }
    assert.equal(k.total, 0);
  });
});
