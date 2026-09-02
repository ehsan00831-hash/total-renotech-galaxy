/**
 * Timezone safety.
 *
 * The company's business calendar is America/Toronto. Every window in the
 * application — today, this week, this month, previous month — is a Montreal
 * calendar window, and must come out identical whether the process runs on a
 * Vercel box in UTC, in the office in Toronto, or on a laptop in Tokyo.
 *
 * `npm run test:tz` spawns this suite once per zone with an explicit TZ. The
 * first describe block proves the zone actually took effect, so a run that
 * silently fell back to the host default fails instead of passing for the
 * wrong reason.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUSINESS_TIME_ZONE, businessDay, businessStamp, businessParts, businessInstant,
  businessOffsetMinutes, addDays, weekStart, monthStart, monthKey, previousMonthKey,
  isPreviousMonth, parseSheetDate,
} from '../.test-build/business-time.js';
import { filterCompleted, archivedCompleted, computeKpis, filterView } from '../.test-build/core.js';

const HOST_TZ = process.env.TZ ?? '(host default)';
const EXPECTED_TZ = process.env.TRT_EXPECTED_TZ ?? null;
const RESOLVED_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/* ================================================================== *
 * The zone under test really is the zone we asked for
 * ================================================================== */

describe(`host zone (TZ=${HOST_TZ})`, () => {
  test('reports the zone it is actually running under', () => {
    console.log(
      `      process.env.TZ           = ${JSON.stringify(process.env.TZ ?? null)}\n` +
      `      resolvedOptions.timeZone = ${RESOLVED_TZ}\n` +
      `      getTimezoneOffset()      = ${new Date().getTimezoneOffset()} min\n` +
      `      BUSINESS_TIME_ZONE       = ${BUSINESS_TIME_ZONE}`,
    );
    assert.equal(BUSINESS_TIME_ZONE, 'America/Toronto');
  });

  test('the requested zone actually took effect', (t) => {
    if (!EXPECTED_TZ) {
      t.skip('run via `npm run test:tz` to pin the host zone');
      return;
    }
    assert.equal(process.env.TZ, EXPECTED_TZ, 'TZ did not reach this process');
    assert.equal(
      RESOLVED_TZ, EXPECTED_TZ,
      `Node resolved ${RESOLVED_TZ}, not the requested ${EXPECTED_TZ}`,
    );
  });

  test('the host offset matches the requested zone', (t) => {
    if (!EXPECTED_TZ) {
      t.skip('no pinned zone');
      return;
    }
    // A fixed instant in January, when neither Toronto nor Tokyo is on DST.
    const jan = new Date('2026-01-15T12:00:00Z');
    const expected = { 'UTC': 0, 'America/Toronto': 300, 'Asia/Tokyo': -540 }[EXPECTED_TZ];
    assert.equal(jan.getTimezoneOffset(), expected, `offset for ${EXPECTED_TZ}`);
  });
});

/* ================================================================== *
 * Business day resolution
 * ================================================================== */

describe(`business day under TZ=${HOST_TZ}`, () => {
  test('an instant maps to the Montreal calendar day, not the host one', () => {
    // 03:00 UTC on 1 September is still 31 August in Montreal (23:00 EDT),
    // while Tokyo is already at midday on the 1st.
    assert.equal(businessDay(new Date('2026-09-01T03:00:00Z')), '2026-08-31');
    // 05:00 UTC is 01:00 EDT — the new month has begun.
    assert.equal(businessDay(new Date('2026-09-01T05:00:00Z')), '2026-09-01');
  });

  test('midnight in Montreal starts the business day', () => {
    const justBefore = new Date('2026-08-24T03:59:59Z');  // 23:59:59 EDT, 23 Aug
    const atMidnight = new Date('2026-08-24T04:00:00Z');  // 00:00:00 EDT, 24 Aug
    assert.equal(businessDay(justBefore), '2026-08-23');
    assert.equal(businessDay(atMidnight), '2026-08-24');
    assert.equal(businessParts(atMidnight).hour, 0, 'midnight reads as hour 0, never 24');
  });

  test('the stamp is Montreal wall-clock time', () => {
    assert.equal(businessStamp(new Date('2026-08-24T16:30:00Z')), '2026-08-24 12:30');
    assert.equal(businessStamp(new Date('2026-01-15T16:30:00Z')), '2026-01-15 11:30');
  });

  test('the zone offset is read from the zone, not the host', () => {
    assert.equal(businessOffsetMinutes(new Date('2026-01-15T12:00:00Z')), -300, 'EST');
    assert.equal(businessOffsetMinutes(new Date('2026-07-15T12:00:00Z')), -240, 'EDT');
  });

  test('a Montreal wall-clock time resolves to the same instant everywhere', () => {
    const noon = businessInstant(2026, 8, 24, 12, 0);
    assert.equal(noon.toISOString(), '2026-08-24T16:00:00.000Z');
    assert.equal(businessDay(noon), '2026-08-24');
    assert.equal(businessStamp(noon), '2026-08-24 12:00');

    const winterNoon = businessInstant(2026, 1, 15, 12, 0);
    assert.equal(winterNoon.toISOString(), '2026-01-15T17:00:00.000Z');
  });
});

/* ================================================================== *
 * Calendar arithmetic
 * ================================================================== */

describe(`calendar arithmetic under TZ=${HOST_TZ}`, () => {
  test('addDays walks the calendar', () => {
    assert.equal(addDays('2026-08-31', 1), '2026-09-01');
    assert.equal(addDays('2026-09-01', -1), '2026-08-31');
    assert.equal(addDays('2026-08-24', 7), '2026-08-31');
  });

  test('addDays crosses a year boundary', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
    assert.equal(addDays('2026-12-25', 10), '2027-01-04');
  });

  test('addDays handles a leap day', () => {
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2028-02-29', 1), '2028-03-01');
    assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  });

  test('the week always starts on Monday', () => {
    for (const d of [24, 25, 26, 27, 28, 29, 30]) {
      assert.equal(weekStart(`2026-08-${d}`), '2026-08-24', `Aug ${d}`);
    }
    assert.equal(weekStart('2026-08-31'), '2026-08-31');
    assert.equal(weekStart('2026-08-23'), '2026-08-17', 'Sunday belongs to the week before');
  });

  test('month helpers are pure string maths', () => {
    assert.equal(monthStart('2026-08-24'), '2026-08-01');
    assert.equal(monthKey('2026-08-24'), '2026-08');
    assert.equal(previousMonthKey('2026-08-24'), '2026-07');
    assert.equal(previousMonthKey('2027-01-05'), '2026-12', 'crosses the year');
  });

  test('previous-month detection is stable', () => {
    assert.equal(isPreviousMonth('2026-07-01', '2026-08-24'), true);
    assert.equal(isPreviousMonth('2026-07-31', '2026-08-24'), true);
    assert.equal(isPreviousMonth('2026-08-01', '2026-08-24'), false);
    assert.equal(isPreviousMonth('2026-06-30', '2026-08-24'), false);
    assert.equal(isPreviousMonth('2026-12-31', '2027-01-15'), true, 'year rollover');
    assert.equal(isPreviousMonth('2026-11-30', '2027-01-15'), false);
  });

  test('parseSheetDate is not shifted by the host zone', () => {
    assert.equal(parseSheetDate('2026-01-01'), '2026-01-01');
    assert.equal(parseSheetDate('2026-12-31'), '2026-12-31');
    assert.equal(parseSheetDate('01/01/2026'), '2026-01-01');
    assert.equal(parseSheetDate('Aug 24, 2026'), '2026-08-24');
    assert.equal(parseSheetDate('24 Aug 2026'), '2026-08-24');
  });
});

/* ================================================================== *
 * Daylight saving
 * ================================================================== */

describe(`daylight saving under TZ=${HOST_TZ}`, () => {
  // Montreal 2026: DST starts 08 March, ends 01 November.
  test('DST start does not lose a day', () => {
    assert.equal(addDays('2026-03-07', 1), '2026-03-08');
    assert.equal(addDays('2026-03-08', 1), '2026-03-09');
    assert.equal(businessDay(new Date('2026-03-08T06:59:00Z')), '2026-03-08', '01:59 EST');
    assert.equal(businessDay(new Date('2026-03-08T07:01:00Z')), '2026-03-08', '03:01 EDT');
  });

  test('the spring-forward hour really is skipped', () => {
    assert.equal(businessOffsetMinutes(new Date('2026-03-08T06:59:00Z')), -300);
    assert.equal(businessOffsetMinutes(new Date('2026-03-08T07:01:00Z')), -240);
    assert.equal(businessParts(new Date('2026-03-08T06:59:00Z')).hour, 1);
    assert.equal(businessParts(new Date('2026-03-08T07:01:00Z')).hour, 3);
  });

  test('DST end does not duplicate a day', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-11-01', 1), '2026-11-02');
    // 01:30 EDT and 01:30 EST are two different instants on the same day.
    assert.equal(businessDay(new Date('2026-11-01T05:30:00Z')), '2026-11-01');
    assert.equal(businessDay(new Date('2026-11-01T06:30:00Z')), '2026-11-01');
    assert.equal(businessParts(new Date('2026-11-01T05:30:00Z')).hour, 1);
    assert.equal(businessParts(new Date('2026-11-01T06:30:00Z')).hour, 1);
  });

  test('a week spanning a DST change is still seven days', () => {
    let spring = '2026-03-02';
    for (let i = 0; i < 7; i++) spring = addDays(spring, 1);
    assert.equal(spring, '2026-03-09');

    let autumn = '2026-10-26';
    for (let i = 0; i < 7; i++) autumn = addDays(autumn, 1);
    assert.equal(autumn, '2026-11-02');
  });

  test('a DST day is still one business day wide', () => {
    for (const day of ['2026-03-08', '2026-11-01']) {
      assert.equal(businessDay(businessInstant(...day.split('-').map(Number), 12, 0)), day);
    }
  });
});

/* ================================================================== *
 * Windows built on the business calendar
 * ================================================================== */

function job(over = {}) {
  return {
    row: 6, jobId: 'NP-1', customer: 'X', fullAddress: '',
    woNumber: '', poNumber: '', status: 'COMPLETED', priority: 'NORMAL',
    scheduledDate: '', projectEnd: '', lastUpdated: '',
    materials: '', materialStatus: '', longProject: '',
    technicians: [], crewCount: 0, ...over,
  };
}

describe(`windows under TZ=${HOST_TZ}`, () => {
  test('a job closed on the 1st counts in the new month everywhere', () => {
    const j = job({ projectEnd: '2026-09-01' });
    const onTheFirst = businessInstant(2026, 9, 1, 9, 0);
    assert.deepEqual(filterCompleted([j], 'month', onTheFirst).map((x) => x.row), [6]);
    assert.deepEqual(archivedCompleted([j], onTheFirst), []);
  });

  test('the month view turns over at Montreal midnight, not UTC midnight', () => {
    const august = Array.from({ length: 8 }, (_, i) =>
      job({ row: 6 + i, projectEnd: `2026-08-${String(i + 3).padStart(2, '0')}` }));

    const lateAugust = new Date('2026-09-01T03:30:00Z');     // 23:30 EDT, 31 Aug
    const earlySeptember = new Date('2026-09-01T04:30:00Z'); // 00:30 EDT, 1 Sep

    assert.equal(filterCompleted(august, 'month', lateAugust).length, 8, 'still August');
    assert.equal(archivedCompleted(august, lateAugust).length, 0);
    assert.equal(filterCompleted(august, 'month', earlySeptember).length, 0, 'now September');
    assert.equal(archivedCompleted(august, earlySeptember).length, 8);
  });

  test('the year turns over on the Montreal calendar', () => {
    const j = job({ projectEnd: '2026-12-31' });
    const lastMinute = new Date('2027-01-01T04:30:00Z');   // 23:30 EST, 31 Dec
    const firstMinute = new Date('2027-01-01T05:30:00Z');  // 00:30 EST, 1 Jan
    assert.equal(filterCompleted([j], 'month', lastMinute).length, 1);
    assert.equal(filterCompleted([j], 'month', firstMinute).length, 0);
    assert.equal(isPreviousMonth('2026-12-31', businessDay(firstMinute)), true);
  });

  test('labour windows do not leak across the month edge', () => {
    const logs = [
      { jobId: 'A', workDate: '2026-08-24', technicians: [], crewCount: 2, totalHours: 12, materialsUsed: '' },
      { jobId: 'A', workDate: '2026-08-23', technicians: [], crewCount: 1, totalHours: 7, materialsUsed: '' },
      { jobId: 'A', workDate: '2026-07-31', technicians: [], crewCount: 1, totalHours: 5, materialsUsed: '' },
    ];
    const k = computeKpis([], logs, businessInstant(2026, 8, 24, 12, 0));
    assert.equal(k.hoursToday, 12);
    assert.equal(k.hoursWeek, 12, 'the 23rd was the previous week');
    assert.equal(k.hoursMonth, 19, 'July is excluded');
  });

  test('tomorrow is the next Montreal calendar day', () => {
    const jobs = [job({ row: 6, status: 'SCHEDULED', scheduledDate: '2026-09-01' })];
    const lateOnTheLast = new Date('2026-09-01T01:00:00Z');  // 21:00 EDT, 31 Aug
    assert.deepEqual(filterView(jobs, 'tomorrow', lateOnTheLast).map((j) => j.row), [6]);
  });

  test('overdue compares calendar days, not instants', () => {
    const jobs = [job({ row: 6, status: 'UPCOMING', scheduledDate: '2026-08-23' })];
    for (const hour of [0, 6, 12, 18, 23]) {
      assert.equal(
        filterView(jobs, 'overdue', businessInstant(2026, 8, 24, hour, 30)).length, 1,
        `hour ${hour}`,
      );
    }
  });

  test('a job scheduled for today is never overdue, whatever the hour', () => {
    const jobs = [job({ row: 6, status: 'UPCOMING', scheduledDate: '2026-08-24' })];
    for (const hour of [0, 6, 12, 18, 23]) {
      assert.equal(
        filterView(jobs, 'overdue', businessInstant(2026, 8, 24, hour, 30)).length, 0,
        `hour ${hour}`,
      );
    }
  });
});
