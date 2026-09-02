/**
 * Pure operations logic — no I/O, no Google client, no React.
 *
 * Everything here is deterministic and directly unit-testable. The repositories
 * (jobs.ts, reminders.ts, logs.ts) import from this module rather than
 * reimplementing rules, so what the tests prove is what production runs.
 */

import { createHash } from 'node:crypto';

/* ================================================================== *
 * HEADERS AND COLUMN RESOLUTION
 * ================================================================== */

const DIACRITICS = new RegExp(
  '[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

export function normHeader(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9#/]+/g, ' ')
    .trim();
}

export type FieldSpec = { patterns: RegExp[]; expected?: string };
export type ColumnMap = Record<string, number>;

/**
 * Map declared fields onto real columns. Each physical column is claimed by at
 * most one field, and each field takes at most one column: the first (most
 * specific) pattern that hits an unclaimed column wins.
 */
export function resolveColumns(
  headers: string[],
  fields: Record<string, FieldSpec>,
): ColumnMap {
  const normed = headers.map(normHeader);
  const taken = new Set<number>();
  const out: ColumnMap = {};

  for (const [field, spec] of Object.entries(fields)) {
    outer: for (const pattern of spec.patterns) {
      for (let c = 0; c < normed.length; c++) {
        if (taken.has(c) || !normed[c]) continue;
        if (pattern.test(normed[c])) {
          out[field] = c + 1;
          taken.add(c);
          break outer;
        }
      }
    }
  }
  return out;
}

export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = (n - m - 1) / 26;
  }
  return s;
}

/* ================================================================== *
 * ADDRESS
 *
 * "All Jobs" owns a real **Full Address** column, and the existing records
 * already carry the city inside it (NP-96651 is "225 Rue Peel, Montreal, QC").
 * City and Unit are separate columns that this application does not touch.
 *
 * So there is nothing to compose and nothing to split: read the column, show
 * it, write it back. Composing it from parts appended the city a second time;
 * splitting it dropped the street.
 * ================================================================== */

/**
 * Tidy whitespace and comma spacing without changing content.
 * A value that is already well-formed must come back byte-identical.
 */
export function normaliseFullAddress(v: string): string {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
}

/**
 * True when the Full Address already ends with the given city, so callers can
 * refuse to append it a second time.
 */
export function fullAddressIncludesCity(full: string, city: string): boolean {
  const f = normKey(full);
  const c = normKey(city);
  return c.length > 0 && f.endsWith(c);
}

/* ================================================================== *
 * BUSINESS CALENDAR
 *
 * Lives in its own module so client components can import a business date
 * without dragging node:crypto (used further down this file) into the
 * browser bundle. Re-exported here so every rule still has one import site.
 * ================================================================== */

import {
  addDays, businessDay, monthKey, monthStart, parseSheetDate, previousMonthKey, weekStart,
} from './business-time';

export * from './business-time';

/* ================================================================== *
 * JOB VOCABULARY
 * ================================================================== */

export const JOB_STATUSES = [
  'NEW LEAD', 'NEED INFO', 'NEED SCHEDULING', 'UPCOMING', 'TOMORROW PLAN',
  'SCHEDULED', 'ONGOING', 'WAITING MATERIAL', 'WAITING APPROVAL',
  'NEED FOLLOW-UP', 'ON HOLD', 'DONE', 'COMPLETED', 'CANCELLED',
] as const;

export const JOB_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT', 'EMERGENCY'] as const;

export const CLOSED_STATUSES = ['DONE', 'COMPLETED'];
export const INACTIVE_STATUSES = [...CLOSED_STATUSES, 'CANCELLED'];

export type JobLike = {
  row: number;
  jobId: string;
  customer: string;
  /** The live sheet's own "Full Address" column, already including the city. */
  fullAddress: string;
  woNumber: string;
  poNumber: string;
  status: string;
  priority: string;
  scheduledDate: string;
  /** Authoritative completion date on this workbook. */
  projectEnd: string;
  lastUpdated: string;
  materials: string;
  materialStatus: string;
  longProject: string;
  technicians: string[];
  crewCount: number;
  followUpDate: string;
};

export function isActiveJob(job: Pick<JobLike, 'status'>): boolean {
  return !INACTIVE_STATUSES.includes(job.status.toUpperCase().trim());
}

export function isClosedJob(job: Pick<JobLike, 'status'>): boolean {
  return CLOSED_STATUSES.includes(job.status.toUpperCase().trim());
}

/* ---------------------------------------------------------- duplicates */

export function normKey(v: string): string {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export type DuplicateInput = {
  jobId?: string; woNumber?: string; poNumber?: string;
  customer?: string; fullAddress?: string;
};

export type DuplicateMatch<T> = { job: T; reason: string; confidence: number };

/**
 * Find the existing job an input most likely refers to.
 * Strongest signal first: explicit ID, then WO, then PO, then customer+address.
 */
export function findDuplicate<T extends Pick<JobLike, 'row' | 'jobId' | 'woNumber' | 'poNumber' | 'customer' | 'fullAddress'>>(
  jobs: T[],
  input: DuplicateInput,
): DuplicateMatch<T> | null {
  if (input.jobId) {
    const hit = jobs.find((j) => j.jobId && normKey(j.jobId) === normKey(input.jobId!));
    if (hit) return { job: hit, reason: `Job ID ${hit.jobId}`, confidence: 1 };
  }
  if (input.woNumber) {
    const hit = jobs.find((j) => j.woNumber && normKey(j.woNumber) === normKey(input.woNumber!));
    if (hit) return { job: hit, reason: `WO ${hit.woNumber}`, confidence: 0.95 };
  }
  if (input.poNumber) {
    const hit = jobs.find((j) => j.poNumber && normKey(j.poNumber) === normKey(input.poNumber!));
    if (hit) return { job: hit, reason: `PO ${hit.poNumber}`, confidence: 0.9 };
  }
  if (input.customer) {
    const c = normKey(input.customer);
    const candidates = jobs.filter((j) => {
      if (!j.customer) return false;
      const jc = normKey(j.customer);
      return jc === c || jc.includes(c) || c.includes(jc);
    });
    if (input.fullAddress) {
      const a = normKey(input.fullAddress);
      const hit = candidates.find(
        (j) => j.fullAddress && (normKey(j.fullAddress) === a || normKey(j.fullAddress).includes(a)),
      );
      if (hit) return { job: hit, reason: 'customer + address', confidence: 0.85 };
    }
    if (candidates.length === 1 && !input.fullAddress) {
      return { job: candidates[0], reason: `customer "${candidates[0].customer}"`, confidence: 0.6 };
    }
  }
  return null;
}

/* ---------------------------------------------------------------- views */

export const VIEW_KEYS = [
  'all', 'upcoming', 'tomorrow', 'scheduled', 'ongoing', 'waiting',
  'waiting-materials', 'waiting-approval', 'urgent', 'completed', 'cancelled',
  'long-projects', 'unassigned', 'overdue',
] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];

const UPCOMING_STATUSES = ['UPCOMING', 'SCHEDULED', 'NEED SCHEDULING', 'NEW LEAD', 'NEED INFO'];

export function filterView<T extends JobLike>(jobs: T[], view: ViewKey, now: Date): T[] {
  const t = businessDay(now);
  const tomorrow = addDays(t, 1);
  const S = (j: T) => j.status.toUpperCase().trim();

  switch (view) {
    case 'upcoming':
      return jobs.filter((j) => UPCOMING_STATUSES.includes(S(j)));
    case 'tomorrow':
      return jobs.filter((j) => S(j) === 'TOMORROW PLAN' || parseSheetDate(j.scheduledDate) === tomorrow);
    // Distinct from 'upcoming': that bucket also covers NEED SCHEDULING,
    // NEW LEAD and NEED INFO — this is only jobs already marked SCHEDULED.
    case 'scheduled':
      return jobs.filter((j) => S(j) === 'SCHEDULED');
    case 'ongoing':
      return jobs.filter((j) => S(j) === 'ONGOING');
    // The saved-view chip; the two statuses below remain selectable
    // individually (the Dashboard's Waiting Materials / Waiting Approval
    // tiles link straight to them) without being duplicated in this list.
    case 'waiting':
      return jobs.filter((j) => S(j) === 'WAITING MATERIAL' || S(j) === 'WAITING APPROVAL');
    case 'waiting-materials':
      return jobs.filter((j) => S(j) === 'WAITING MATERIAL');
    case 'waiting-approval':
      return jobs.filter((j) => S(j) === 'WAITING APPROVAL');
    case 'urgent':
      return jobs.filter((j) => isActiveJob(j) &&
        ['URGENT', 'EMERGENCY'].includes(j.priority.toUpperCase().trim()));
    case 'completed':
      return jobs.filter((j) => CLOSED_STATUSES.includes(S(j)));
    case 'cancelled':
      return jobs.filter((j) => S(j) === 'CANCELLED');
    case 'long-projects':
      return jobs.filter((j) => j.longProject.toUpperCase().startsWith('YES'));
    case 'unassigned':
      return jobs.filter((j) => isActiveJob(j) && j.technicians.length === 0);
    case 'overdue': {
      return jobs.filter((j) => {
        const d = parseSheetDate(j.scheduledDate);
        return isActiveJob(j) && d !== null && d < t;
      });
    }
    default:
      return jobs;
  }
}

/** Materials module: any job carrying a requirement, still tied to its job. */
export const MATERIAL_TO_BUY = ['NEED LIST', 'NEED PURCHASE', 'ORDERED'];

export function filterMaterials<T extends JobLike>(jobs: T[]): T[] {
  return jobs.filter(
    (j) => j.materials.trim() !== '' || MATERIAL_TO_BUY.includes(j.materialStatus.toUpperCase().trim()),
  );
}

/* ------------------------------------------------------------ completed */

export type CompletedRange = 'today' | 'week' | 'month' | 'archive' | 'all';

/**
 * Completion date for a closed job.
 *
 * "Project End" is authoritative on this workbook. "Last Updated" is the only
 * fallback — the scheduled date is when the crew was *booked*, not when the
 * work finished, and using it silently mis-dates completed work.
 */
export function completionDate(job: Pick<JobLike, 'projectEnd' | 'lastUpdated'>): string | null {
  return parseSheetDate(job.projectEnd) ?? parseSheetDate(job.lastUpdated);
}

export function filterCompleted<T extends JobLike>(
  jobs: T[], range: CompletedRange, now: Date,
): T[] {
  const done = jobs.filter(isClosedJob);
  if (range === 'all') return done;
  // Previous-month records never disappear — they just move from the "this
  // month" window into this one, on the same completionDate rule.
  if (range === 'archive') return archivedCompleted(jobs, now);

  const t = businessDay(now);
  const from = range === 'today' ? t : range === 'week' ? weekStart(t) : monthStart(t);
  return done.filter((j) => {
    const d = completionDate(j);
    return d !== null && d >= from && d <= t;
  });
}

/**
 * Records from before this month. The month view rolls forward on its own;
 * these stay reachable and are never deleted.
 */
export function archivedCompleted<T extends JobLike>(jobs: T[], now: Date): T[] {
  const ms = monthStart(businessDay(now));
  return jobs.filter(isClosedJob).filter((j) => {
    const d = completionDate(j);
    return d !== null && d < ms;
  });
}

/**
 * Totals for a set of completed jobs.
 *
 * Person-hours come from the Daily Logs rows that belong to these jobs, because
 * "Total Labor Hours" in the workbook is *already* person-hours. Multiplying it
 * by crew count again would double-count every crew member.
 */
export function completedTotals<T extends JobLike>(jobs: T[], logs: LogLike[] = []) {
  const ids = new Set(jobs.map((j) => normKey(j.jobId)).filter(Boolean));
  const own = logs.filter((l) => ids.has(normKey(l.jobId)));
  const technicians = new Set([
    ...jobs.flatMap((j) => j.technicians),
    ...own.flatMap((l) => l.technicians),
  ]);
  return {
    projects: jobs.length,
    technicians: technicians.size,
    personHours: round(own.reduce((s, l) => s + l.totalHours, 0), 1),
    loggedDays: new Set(own.map((l) => parseSheetDate(l.workDate)).filter(Boolean)).size,
    withMaterials: jobs.filter((j) => j.materials.trim() !== '').length,
  };
}

/* ------------------------------------------------------------------ KPIs */

/**
 * Dashboard counters.
 *
 * Labour hours are read from Daily Logs (Work Date + Total Labor Hours), never
 * from the job rows: the workbook records hours per working day, and a job's
 * scheduled date says nothing about when hours were actually worked.
 */
export function computeKpis<T extends JobLike>(
  jobs: T[], logs: LogLike[] = [], now: Date,
) {
  const t = businessDay(now);
  const ws = weekStart(t);
  const ms = monthStart(t);
  const in7 = addDays(t, 7);

  // Total Labor Hours is already person-hours — summed as-is.
  const hoursIn = (from: string) =>
    logs.reduce((sum, l) => {
      const d = parseSheetDate(l.workDate);
      return d !== null && d >= from && d <= t ? sum + l.totalHours : sum;
    }, 0);

  return {
    total: jobs.length,
    active: jobs.filter(isActiveJob).length,
    upcoming: filterView(jobs, 'upcoming', now).length,
    tomorrow: filterView(jobs, 'tomorrow', now).length,
    ongoing: filterView(jobs, 'ongoing', now).length,
    waitingMaterials: filterView(jobs, 'waiting-materials', now).length,
    waitingApproval: filterView(jobs, 'waiting-approval', now).length,
    urgent: jobs.filter((j) => isActiveJob(j) &&
      ['URGENT', 'EMERGENCY'].includes(j.priority.toUpperCase())).length,
    unassigned: filterView(jobs, 'unassigned', now).length,
    overdue: filterView(jobs, 'overdue', now).length,
    next7: jobs.filter((j) => {
      const d = parseSheetDate(j.scheduledDate);
      return d !== null && d >= t && d <= in7;
    }).length,
    // Distinct from `ongoing`: a job can be scheduled for today (UPCOMING /
    // SCHEDULED / TOMORROW PLAN carried over) without field work having
    // started yet, so this is its own count rather than reusing 'ongoing'.
    scheduledToday: jobs.filter((j) => isActiveJob(j) && parseSheetDate(j.scheduledDate) === t).length,
    waitingScheduling: jobs.filter((j) => j.status.toUpperCase().trim() === 'NEED SCHEDULING').length,
    overdueFollowUps: jobs.filter((j) => {
      if (!isActiveJob(j)) return false;
      const d = parseSheetDate(j.followUpDate);
      return d !== null && d < t;
    }).length,
    completedToday: filterCompleted(jobs, 'today', now).length,
    completedWeek: filterCompleted(jobs, 'week', now).length,
    completedMonth: filterCompleted(jobs, 'month', now).length,
    hoursToday: round(hoursIn(t), 1),
    hoursWeek: round(hoursIn(ws), 1),
    hoursMonth: round(hoursIn(ms), 1),
    longProjects: jobs.filter((j) => j.longProject.toUpperCase().startsWith('YES') && isActiveJob(j)).length,
    assigned: jobs.filter((j) => isActiveJob(j) && j.technicians.length > 0).length,
    activeTechs: new Set(jobs.filter(isActiveJob).flatMap((j) => j.technicians)).size,
  };
}

export function groupCount<T>(items: T[], key: (i: T) => string): Array<{ name: string; value: number }> {
  const m = new Map<string, number>();
  for (const i of items) {
    const k = (key(i) || 'UNSPECIFIED').toUpperCase().trim();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

/* ================================================================== *
 * CREW
 * ================================================================== */

export const MAX_CREW = 5;

/** Normalise a crew selection: trimmed, de-duplicated, capped at five. */
export function normaliseCrew(technicians: string[] | undefined): string[] {
  if (!technicians) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of technicians) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
    if (out.length === MAX_CREW) break;
  }
  return out;
}

/** Spread a crew across the sheet's five technician columns. */
export function crewToColumns(technicians: string[] | undefined): Record<string, string> {
  const crew = normaliseCrew(technicians);
  const patch: Record<string, string> = {};
  for (let i = 0; i < MAX_CREW; i++) patch[`tech${i + 1}`] = crew[i] ?? '';
  return patch;
}

/* ================================================================== *
 * LABOUR
 * ================================================================== */

/** Minutes since midnight from "8:00 AM", "08:00", "8:00 a.m." */
export function parseClock(v: string): number | null {
  const s = String(v ?? '').trim().toLowerCase().replace(/\./g, '');
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

/** (clock out - clock in) - break, in hours. Tolerates an overnight shift. */
export function hoursPerPerson(clockIn: string, clockOut: string, breakMin = 0): number {
  const a = parseClock(clockIn);
  const b = parseClock(clockOut);
  if (a === null || b === null) return 0;
  const span = (b - a + 1440) % 1440;
  return Math.max(0, round((span - breakMin) / 60, 2));
}

/** Person-hours for one working day: crew size x hours each. */
export function personHours(crewSize: number, hoursEach: number): number {
  return round(crewSize * hoursEach, 2);
}

export type LogLike = {
  jobId: string;
  workDate: string;
  technicians: string[];
  crewCount: number;
  /** Already person-hours in this workbook. Never multiply by crew again. */
  totalHours: number;
  materialsUsed: string;
};

export function rollupProject(logs: LogLike[]) {
  const dates = logs.map((l) => parseSheetDate(l.workDate)).filter(Boolean) as string[];
  const workers = new Set(logs.flatMap((l) => l.technicians));
  const materials = [...new Set(logs.map((l) => l.materialsUsed).filter(Boolean))];
  const sorted = dates.slice().sort();
  return {
    workingDays: new Set(dates).size,
    workers: workers.size,
    totalPersonHours: round(logs.reduce((s, l) => s + l.totalHours, 0), 2),
    avgCrew: logs.length ? round(logs.reduce((s, l) => s + l.crewCount, 0) / logs.length, 1) : 0,
    materials,
    startDate: sorted[0] ?? '',
    endDate: sorted.at(-1) ?? '',
  };
}

/* ================================================================== *
 * REMINDERS
 * ================================================================== */

export const REMINDER_PRIORITIES = ['Critical', 'High', 'Normal', 'Low'] as const;
export type ReminderPriority = (typeof REMINDER_PRIORITIES)[number];

export const REMINDER_STATUSES = [
  'New',
  'Action Required',
  'In Progress',
  'Scheduled',
  'Follow-Up Required',
  'Waiting for Response',
  'Waiting for Payment',
  'Waiting for Approval',
  'Completed — Check Required',
  'Completed',
  'On Hold',
  'Cancelled',
  'Removed',
] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const SHEET_ACTIVE_REMINDERS = 'ACTIVE REMINDERS';
export const SHEET_ARCHIVE = 'ARCHIVE';

/** Only these three leave ACTIVE. "Completed — Check Required" deliberately does not. */
export const ARCHIVING_STATUSES: string[] = ['Completed', 'Cancelled', 'Removed'];

/**
 * Snap a free-typed status onto the exact spec spelling.
 *
 * Callers (and the AI path) may send any casing; the sheet should always end up
 * with the canonical Title-Case value. An unrecognised status is passed through
 * unchanged rather than being silently rewritten.
 */
export function canonicalReminderStatus(status: string): string {
  const s = String(status ?? '').trim();
  if (!s) return s;
  const hit = REMINDER_STATUSES.find((v) => v.toLowerCase() === s.toLowerCase());
  if (hit) return hit;
  // Tolerate a plain hyphen where the spec uses an em dash.
  const dashed = s.replace(/\s*[-–]\s*check required$/i, ' — Check Required');
  return REMINDER_STATUSES.find((v) => v.toLowerCase() === dashed.toLowerCase()) ?? s;
}

/** Same idea for priority: Critical / High / Normal / Low. */
export function canonicalReminderPriority(priority: string): string {
  const p = String(priority ?? '').trim();
  if (!p) return p;
  return REMINDER_PRIORITIES.find((v) => v.toLowerCase() === p.toLowerCase()) ?? p;
}

/**
 * Canonicalise or refuse.
 *
 * The lenient functions above pass an unrecognised value straight through,
 * which is right for display but wrong for a write: a status the workbook does
 * not know would land in the cell and quietly fall out of the ARCHIVE formula's
 * match list. Every write path goes through these instead, so an invented
 * status is rejected at the boundary rather than persisted.
 */
export function assertReminderStatus(status: string): string {
  const s = String(status ?? '').trim();
  if (!s) return s;
  const c = canonicalReminderStatus(s);
  if (!(REMINDER_STATUSES as readonly string[]).includes(c)) {
    throw new Error(
      `Unknown reminder status ${JSON.stringify(s)}. Expected one of: ` +
      REMINDER_STATUSES.join(', '),
    );
  }
  return c;
}

export function assertReminderPriority(priority: string): string {
  const p = String(priority ?? '').trim();
  if (!p) return p;
  const c = canonicalReminderPriority(p);
  if (!(REMINDER_PRIORITIES as readonly string[]).includes(c)) {
    throw new Error(
      `Unknown reminder priority ${JSON.stringify(p)}. Expected one of: ` +
      REMINDER_PRIORITIES.join(', '),
    );
  }
  return c;
}

const canonicalStatus = canonicalReminderStatus;

export function isCheckRequired(status: string): boolean {
  return canonicalStatus(status).toLowerCase() === 'completed — check required';
}

/**
 * Reminders are only ever written here.
 *
 * ARCHIVE is a formula view: its A6 holds an ARRAYFORMULA over
 * ACTIVE REMINDERS. Archiving happens by changing the status on the source
 * row, never by writing to the view.
 */
export const REMINDER_WRITE_SHEET = SHEET_ACTIVE_REMINDERS;

/**
 * Which view a reminder with this status will surface in.
 *
 * This is a prediction about the ARCHIVE formula's output, not a write target.
 * Use REMINDER_WRITE_SHEET for writes.
 */
export function reminderVisibleIn(status: string): string {
  const s = canonicalStatus(status);
  if (isCheckRequired(s)) return SHEET_ACTIVE_REMINDERS;
  return ARCHIVING_STATUSES.some((a) => a.toLowerCase() === s.toLowerCase())
    ? SHEET_ARCHIVE
    : SHEET_ACTIVE_REMINDERS;
}

/** Retained name for the same prediction. */
export const reminderTargetSheet = reminderVisibleIn;

/**
 * Collapse the ACTIVE and ARCHIVE reads into one list.
 *
 * Because ARCHIVE mirrors rows out of ACTIVE REMINDERS, the same reminder can
 * arrive twice. The source row wins so callers always edit the real record.
 */
export function dedupeReminders<T extends ReminderLike>(list: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of list) {
    const key = normKey(r.id) || `${normKey(r.customer)}|${normKey(r.requiredAction)}`;
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) { seen.set(key, r); continue; }
    // Prefer the writable source row over the derived view.
    if (existing.sheet !== SHEET_ACTIVE_REMINDERS && r.sheet === SHEET_ACTIVE_REMINDERS) {
      seen.set(key, r);
    }
  }
  return [...seen.values()];
}

export type ReminderLike = {
  row: number;
  sheet: string;
  id: string;
  customer: string;
  requiredAction: string;
  status: string;
  priority: string;
  dueAt: string;
};

/** Merge rule: same customer plus same required action is the same reminder. */
export function findReminder<T extends ReminderLike>(
  list: T[], input: { id?: string; customer?: string; requiredAction?: string },
): T | null {
  if (input.id) {
    const hit = list.find((r) => r.id && normKey(r.id) === normKey(input.id!));
    if (hit) return hit;
  }
  if (input.customer && input.requiredAction) {
    const c = normKey(input.customer);
    const a = normKey(input.requiredAction);
    const hit = list.find((r) => normKey(r.customer) === c && normKey(r.requiredAction) === a);
    if (hit) return hit;
  }
  return null;
}

const PRIORITY_RANK: Record<string, number> = {
  critical: 0, high: 1, normal: 2, low: 3,
};

export function isReminderOverdue(r: Pick<ReminderLike, 'sheet' | 'dueAt'>, now: Date): boolean {
  if (r.sheet !== SHEET_ACTIVE_REMINDERS) return false;
  const d = parseSheetDate(r.dueAt);
  return d !== null && d < businessDay(now);
}

export const REMINDER_GROUP_KEYS = [
  'overdue', 'dueToday', 'dueTomorrow', 'scheduled', 'followUp', 'waiting', 'other',
] as const;
export type ReminderGroupKey = (typeof REMINDER_GROUP_KEYS)[number];

const WAITING_STATUSES = ['waiting for response', 'waiting for payment', 'waiting for approval'];

/**
 * Bucket ACTIVE REMINDERS for the daily-operations view. Every reminder lands
 * in exactly one bucket — a reminder overdue AND "Follow-Up Required" is
 * urgency-first (Overdue), not duplicated into both, so the buckets can be
 * rendered as separate sections without double-counting.
 */
export function groupReminders<T extends ReminderLike>(
  list: T[], now: Date,
): Record<ReminderGroupKey, T[]> {
  const t = businessDay(now);
  const tomorrow = addDays(t, 1);
  const out: Record<ReminderGroupKey, T[]> = {
    overdue: [], dueToday: [], dueTomorrow: [], scheduled: [], followUp: [], waiting: [], other: [],
  };

  for (const r of sortReminders(list, now)) {
    const status = canonicalReminderStatus(r.status).toLowerCase();
    const due = parseSheetDate(r.dueAt);

    if (isReminderOverdue(r, now)) { out.overdue.push(r); continue; }
    if (due === t) { out.dueToday.push(r); continue; }
    if (due === tomorrow) { out.dueTomorrow.push(r); continue; }
    if (status === 'scheduled') { out.scheduled.push(r); continue; }
    if (status === 'follow-up required') { out.followUp.push(r); continue; }
    if (WAITING_STATUSES.includes(status)) { out.waiting.push(r); continue; }
    out.other.push(r);
  }
  return out;
}

/** Overdue first, then soonest due, then priority. */
export function sortReminders<T extends ReminderLike>(list: T[], now: Date): T[] {
  return list.slice().sort((a, b) => {
    const ao = isReminderOverdue(a, now);
    const bo = isReminderOverdue(b, now);
    if (ao !== bo) return ao ? -1 : 1;
    const da = parseSheetDate(a.dueAt) ?? '9999-12-31';
    const db = parseSheetDate(b.dueAt) ?? '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    const pa = PRIORITY_RANK[(a.priority || '').toLowerCase()] ?? 9;
    const pb = PRIORITY_RANK[(b.priority || '').toLowerCase()] ?? 9;
    return pa - pb;
  });
}

/* ================================================================== *
 * TOMORROW PLAN CONFIRMATION
 *
 * A Tomorrow Plan job starts out proposed (tentative); once locked in it is
 * confirmed, and confirmed always requires the customer to be told before
 * the crew — never the reverse.
 * ================================================================== */

export const TOMORROW_PLAN_STATUS = 'TOMORROW PLAN';

export type JobConfirmation = {
  confirmed: boolean;
  customerConfirmed: boolean;
  crewConfirmed: boolean;
};

export const DEFAULT_CONFIRMATION: JobConfirmation = {
  confirmed: false, customerConfirmed: false, crewConfirmed: false,
};

/** True once a job is locked in but the two-step coordination isn't finished. */
export function needsCoordination(c: JobConfirmation): boolean {
  return c.confirmed && !(c.customerConfirmed && c.crewConfirmed);
}

/**
 * The crew can only be marked confirmed once the customer already is —
 * enforced here so a machine caller (ChatGPT, Claude MCP) can't skip the
 * customer step the way the UI already prevents by disabling the control.
 */
export function assertCoordinationOrder(
  current: JobConfirmation, patch: Partial<JobConfirmation>,
): void {
  const customerWillBeConfirmed = patch.customerConfirmed ?? current.customerConfirmed;
  if (patch.crewConfirmed === true && !customerWillBeConfirmed) {
    throw new Error('The customer must be confirmed before the crew.');
  }
}

/**
 * Apply a saved manual priority order on top of the live reminder list.
 *
 * A reminder created after the order was last saved has no entry in `order`
 * and is appended at the end, in its existing relative position, rather than
 * being hidden. An order entry for a reminder that no longer exists (deleted,
 * archived, id changed) is simply skipped — never invented, never throws.
 */
export function applyManualOrder<T extends { id: string }>(list: T[], order: string[]): T[] {
  const byId = new Map(list.map((r) => [normKey(r.id), r] as const));
  const placed = new Set<string>();
  const out: T[] = [];
  for (const id of order) {
    const key = normKey(id);
    const hit = byId.get(key);
    if (hit && !placed.has(key)) { out.push(hit); placed.add(key); }
  }
  for (const r of list) {
    const key = normKey(r.id);
    if (!placed.has(key)) { out.push(r); placed.add(key); }
  }
  return out;
}

/* ================================================================== *
 * REMINDER COMMENTS
 * ================================================================== */

export type ReminderCommentLike = {
  commentId: string;
  reminderId: string;
  createdAt: string;
};

/** Oldest first, so a thread reads top-to-bottom like a conversation. */
export function sortComments<T extends ReminderCommentLike>(list: T[]): T[] {
  return list.slice().sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.commentId < b.commentId ? -1 : a.commentId > b.commentId ? 1 : 0;
  });
}

/** Money always displays in CAD. */
export function formatCad(v: string): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n) || n === 0) return s;
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

/* ================================================================== *
 * FORMULA-VIEW PROTECTION
 * ================================================================== */

export const SHEET_ALL_JOBS = 'All Jobs';
export const SHEET_COMPLETED_ARCHIVE = 'Completed Archive';
export const SHEET_MATERIALS = 'Materials';
export const SHEET_DAILY_LOGS = 'Daily Logs';
export const SHEET_TEAM_FLEET = 'Team & Fleet';

/**
 * Formula-driven views. Writing to any of these destroys the array formula
 * that produces them.
 *
 * ARCHIVE belongs here: its A6 holds an ARRAYFORMULA derived from
 * ACTIVE REMINDERS. A reminder reaches the archive by having its status
 * changed in ACTIVE REMINDERS — never by being written here.
 */
export const READONLY_VIEWS: string[] = [
  'Upcoming', 'Tomorrow Plan', 'Ongoing', 'Done',
  SHEET_MATERIALS, 'Long Projects', SHEET_ARCHIVE,
];

export function isWritableSheet(sheet: string): boolean {
  return !READONLY_VIEWS.includes(sheet);
}

export function assertWritable(sheet: string): void {
  if (!isWritableSheet(sheet)) {
    throw new Error(
      `"${sheet}" is a live formula view of All Jobs and is never written to directly. ` +
      'Change the job on All Jobs and the view follows.',
    );
  }
}

/* ================================================================== *
 * IDEMPOTENCY
 * ================================================================== */

/** Stable, order-insensitive JSON so equal payloads hash equal. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  if (typeof value === 'string') return JSON.stringify(value.trim());
  return JSON.stringify(value);
}

/**
 * Deterministic idempotency key.
 *
 * The same logical request produces the same key on every retry, so a dropped
 * response that the client re-sends cannot create a second record. Different
 * requests hash differently, so genuine follow-up edits still go through.
 */
export function stableIdempotencyKey(
  source: string, action: string, payload: unknown,
): string {
  const material = `${source}|${action}|${canonicalJson(payload)}`;
  return `sk_${createHash('sha256').update(material).digest('hex').slice(0, 32)}`;
}

/* ================================================================== *
 * ROLES AND CAPABILITIES
 * ================================================================== */

export const ROLES = ['admin', 'coordinator', 'technician', 'readonly'] as const;
export type Role = (typeof ROLES)[number];

/**
 * What each role may do.
 *
 * `log` (filing a daily report) belongs to coordinators and admins as well as
 * technicians: ChatGPT and the Claude MCP server authenticate with a bearer
 * token that maps to `coordinator`, so omitting it made every machine call to
 * add_daily_log fail with 403.
 *
 * Technicians may complete work and file logs, but cannot create or re-scope
 * jobs, change settings, or read the audit trail.
 */
export const CAPABILITIES: Record<Role, string[]> = {
  admin: ['read', 'write', 'complete', 'log', 'settings', 'audit', 'undo', 'ai'],
  coordinator: ['read', 'write', 'complete', 'log', 'audit', 'ai'],
  technician: ['read', 'log', 'complete'],
  readonly: ['read'],
};

export function can(role: Role, capability: string): boolean {
  return CAPABILITIES[role]?.includes(capability) ?? false;
}

function parseEmailList(v: string | undefined): string[] {
  return (v ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Resolve a role from the allowlist environment. Unlisted means no access. */
export function roleForEmail(
  email: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Role | null {
  const e = (email ?? '').toLowerCase().trim();
  if (!e) return null;
  if (parseEmailList(env.ALLOWLIST_ADMIN).includes(e)) return 'admin';
  if (parseEmailList(env.ALLOWLIST_COORDINATOR).includes(e)) return 'coordinator';
  if (parseEmailList(env.ALLOWLIST_TECHNICIAN).includes(e)) return 'technician';
  if (parseEmailList(env.ALLOWLIST_READONLY).includes(e)) return 'readonly';
  return null;
}

/* ================================================================== *
 * SMALL HELPERS
 * ================================================================== */

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
