/* ================================================================== *
 * BUSINESS CALENDAR
 *
 * TotalRÊNOTech runs on Montréal time. "Today", "this week", "this month" and
 * "previous month" are calendar windows in America/Toronto — not the server's
 * zone, not Vercel's UTC, not whatever a technician's phone is set to. A job
 * closed at 23:30 in Montréal belongs to that day for everyone reading it.
 *
 * So a business day is carried as a plain 'YYYY-MM-DD' string. An instant is
 * converted to a business day exactly once, at the edge, and every window is
 * then computed on the string with UTC-anchored maths — UTC has no DST, so
 * there is nothing left for a transition to shift.
 *
 * Never mix getMonth()/getFullYear() with toISOString(): the first reads the
 * host zone and the second reads UTC, and the two disagree for half the day.
 * ================================================================== */

export const BUSINESS_TIME_ZONE = 'America/Toronto';

/** A calendar day in the business zone, 'YYYY-MM-DD'. */
export type BusinessDay = string;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const BUSINESS_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

export type BusinessParts = {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
};

/** Wall-clock parts of an instant, read in the business zone. */
export function businessParts(instant: Date): BusinessParts {
  const map: Record<string, string> = {};
  for (const p of BUSINESS_PARTS.formatToParts(instant)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // h23 should already give 00, but an older ICU can hand back 24 for
    // midnight; normalise so the hour is always in range.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** The business calendar day an instant falls on. */
export function businessDay(instant: Date): BusinessDay {
  const p = businessParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 'YYYY-MM-DD HH:MM' in the business zone — what a sheet timestamp shows. */
export function businessStamp(instant: Date): string {
  const p = businessParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Offset of the business zone at an instant, in minutes east of UTC. */
export function businessOffsetMinutes(instant: Date): number {
  const p = businessParts(instant);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const whole = instant.getTime() - instant.getMilliseconds();
  return (asUTC - whole) / 60000;
}

/**
 * The instant at which the business zone's wall clock reads the given time.
 *
 * The offset depends on the instant and the instant depends on the offset, so
 * this resolves once and re-checks: across a DST transition the first answer
 * is off by an hour. A wall-clock time that does not exist (inside the
 * spring-forward gap) resolves to the instant just before the gap.
 */
export function businessInstant(
  year: number, month: number, day: number,
  hour = 0, minute = 0, second = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = wall - businessOffsetMinutes(new Date(wall)) * 60000;
  const settled = wall - businessOffsetMinutes(new Date(first)) * 60000;
  return new Date(settled);
}

/* ------------------------------------------------------- day arithmetic */

function dayToUTC(day: BusinessDay): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`Not a business day: ${JSON.stringify(day)}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function utcToDay(ts: number): BusinessDay {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Calendar-day arithmetic. Anchored in UTC, where a day is always exactly
 * 86 400 000 ms, so a DST change cannot reach it.
 */
export function addDays(day: BusinessDay, n: number): BusinessDay {
  return utcToDay(dayToUTC(day) + n * 86_400_000);
}

/** Monday-anchored start of the week containing `day`. */
export function weekStart(day: BusinessDay): BusinessDay {
  const dow = new Date(dayToUTC(day)).getUTCDay();     // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export function monthStart(day: BusinessDay): BusinessDay {
  return `${day.slice(0, 7)}-01`;
}

/** The 'YYYY-MM' a day belongs to. */
export function monthKey(day: BusinessDay): string {
  return day.slice(0, 7);
}

/** The 'YYYY-MM' before the month containing `day`. */
export function previousMonthKey(day: BusinessDay): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** Parse the sheet's date text into 'YYYY-MM-DD', tolerating several formats. */
export function parseSheetDate(v: string): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);      // d/m/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

  // "24 Aug 2026", "Aug 24, 2026" and similar. A date-only literal parses to
  // *local* midnight, so reading the local components hands back the date that
  // was written, in every host zone. Routing it through businessDay() would
  // re-read a bare date as an instant and could roll it a day.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True when `date` falls in the calendar month before the day `on`. */
export function isPreviousMonth(date: string, on: BusinessDay): boolean {
  const d = parseSheetDate(date);
  return d !== null && monthKey(d) === previousMonthKey(on);
}
