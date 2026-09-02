/**
 * Job repository. "All Jobs" is the single canonical record; every other job
 * view in the workbook is a formula view and is never written to.
 *
 * The sheet owns a "Full Address" column that already contains the city, so
 * this module reads and writes that column directly. City and Unit are
 * separate columns the application does not modify.
 */

import { JOB_FIELDS, TABLES, SHEETS, type JobUpsert } from './schema';
import { appendRecord, columnsFor, readRecords, updateRow, type SheetRow } from './sheets';
import { priorApplication, recordAudit, recordChanges } from './audit';
import {
  normaliseFullAddress, crewToColumns, normaliseCrew,
  findDuplicate as coreFindDuplicate, filterView as coreFilterView,
  computeKpis as coreComputeKpis, filterCompleted as coreFilterCompleted,
  archivedCompleted as coreArchivedCompleted, completedTotals as coreCompletedTotals,
  filterMaterials as coreFilterMaterials, groupCount as coreGroupCount,
  completionDate as coreCompletionDate,
  isActiveJob, isClosedJob, parseSheetDate as coreParseSheetDate,
  VIEW_KEYS as CORE_VIEW_KEYS, CLOSED_STATUSES,
  type ViewKey, type CompletedRange, type DuplicateMatch, type LogLike,
  businessDay, businessStamp,
} from './core';

export const VIEW_KEYS = CORE_VIEW_KEYS;
export type { ViewKey, CompletedRange };
export const parseSheetDate = coreParseSheetDate;
export const groupCount = coreGroupCount;
export const isActive = isActiveJob;
export const isClosed = isClosedJob;
export const completionDate = coreCompletionDate;

export type Job = {
  row: number;
  jobId: string;
  customer: string;
  projectType: string;
  /** The sheet's own Full Address column, city included. */
  fullAddress: string;
  city: string;
  unit: string;
  contactName: string;
  phone: string;
  email: string;
  woNumber: string;
  poNumber: string;
  scope: string;
  requiredAction: string;
  priority: string;
  status: string;
  scheduledDate: string;
  arrivalWindow: string;
  actualStart: string;
  actualEnd: string;
  truck: string;
  technicians: string[];
  teamSummary: string;
  crewCount: number;
  materials: string;
  materialStatus: string;
  longProject: string;
  projectStart: string;
  /** Authoritative completion date. */
  projectEnd: string;
  photosLink: string;
  invoiceStatus: string;
  paymentStatus: string;
  followUpDate: string;
  notes: string;
  clientNotes: string;
  lastUpdated: string;
  updatedBy: string;
};

const TECH_FIELDS = ['tech1', 'tech2', 'tech3', 'tech4', 'tech5'] as const;

function num(v: string): number {
  const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function toJob(r: SheetRow): Job {
  const technicians = TECH_FIELDS.map((f) => (r[f] ?? '').trim()).filter(Boolean);
  return {
    row: r.__row,
    jobId: r.jobId ?? '',
    customer: r.customer ?? '',
    projectType: r.projectType ?? '',
    fullAddress: normaliseFullAddress(r.fullAddress ?? ''),
    city: r.city ?? '',
    unit: r.unit ?? '',
    contactName: r.contactName ?? '',
    phone: r.phone ?? '',
    email: r.email ?? '',
    woNumber: r.woNumber ?? '',
    poNumber: r.poNumber ?? '',
    scope: r.scope ?? '',
    requiredAction: r.requiredAction ?? '',
    priority: (r.priority ?? '').trim(),
    status: (r.status ?? '').trim(),
    scheduledDate: r.scheduledDate ?? '',
    arrivalWindow: r.arrivalWindow ?? '',
    actualStart: r.actualStart ?? '',
    actualEnd: r.actualEnd ?? '',
    truck: r.truck ?? '',
    technicians,
    teamSummary: r.teamSummary || technicians.join(', '),
    crewCount: num(r.crewCount) || technicians.length,
    materials: r.materials ?? '',
    materialStatus: r.materialStatus ?? '',
    longProject: r.longProject ?? '',
    projectStart: r.projectStart ?? '',
    projectEnd: r.projectEnd ?? '',
    photosLink: r.photosLink ?? '',
    invoiceStatus: r.invoiceStatus ?? '',
    paymentStatus: r.paymentStatus ?? '',
    followUpDate: r.followUpDate ?? '',
    notes: r.notes ?? '',
    clientNotes: r.clientNotes ?? '',
    lastUpdated: r.lastUpdated ?? '',
    updatedBy: r.updatedBy || r.createdBy || '',
  };
}

export async function listJobs(): Promise<Job[]> {
  const { rows } = await readRecords(TABLES.ALL_JOBS, JOB_FIELDS, 'customer');
  return rows.map(toJob);
}

export async function getJob(jobId: string): Promise<Job | null> {
  const key = jobId.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const jobs = await listJobs();
  return jobs.find((j) => j.jobId.toLowerCase().replace(/[^a-z0-9]+/g, '') === key) ?? null;
}

/* ------------------------------------------------------------------ *
 * Derived views — the app filters the canonical list rather than
 * re-reading the formula sheets, so a view can never disagree.
 * ------------------------------------------------------------------ */

export const filterView = coreFilterView<Job>;
export const filterCompleted = coreFilterCompleted<Job>;
export const archivedCompleted = coreArchivedCompleted<Job>;
export const filterMaterials = coreFilterMaterials<Job>;
export const findDuplicate = coreFindDuplicate<Job>;

export function completedTotals(jobs: Job[], logs: LogLike[] = []) {
  return coreCompletedTotals(jobs, logs);
}

export function computeKpis(jobs: Job[], logs: LogLike[] = [], now = new Date()) {
  return coreComputeKpis(jobs, logs, now);
}

export type { DuplicateMatch };

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Turn an app-shaped payload into sheet columns.
 *
 * Full Address is written verbatim to its own column — never split, and never
 * recomposed from City, which would append the city a second time.
 */
export function toPatch(input: JobUpsert): Record<string, string | undefined> {
  const { technicians, fullAddress, ...rest } = input;
  const patch: Record<string, string | undefined> =
    { ...rest } as Record<string, string | undefined>;

  if (fullAddress !== undefined) {
    patch.fullAddress = normaliseFullAddress(fullAddress);
  }

  if (technicians !== undefined) {
    const crew = normaliseCrew(technicians);
    Object.assign(patch, crewToColumns(crew));
    patch.teamSummary = crew.join(', ');
    patch.crewCount = String(crew.length);
  }

  // Closing a job always stamps Project End — the one date every
  // "completed this month" window reads — no matter which caller (web UI,
  // ChatGPT Action, Claude MCP) flips the status. Only stamped when the
  // caller doesn't already supply their own projectEnd, so an explicit value
  // (a backdated correction, say) is never overwritten.
  if (
    input.status !== undefined &&
    CLOSED_STATUSES.includes(input.status.toUpperCase().trim()) &&
    input.projectEnd === undefined
  ) {
    patch.projectEnd = businessDay(new Date());
  }

  return patch;
}

export type UpsertResult = {
  action: 'created' | 'updated' | 'unchanged';
  jobId: string;
  row: number;
  sheet: string;
  changed: string[];
  duplicate?: DuplicateMatch<Job>;
};

/** Next identifier, following the workbook's existing style. */
export function nextJobId(jobs: Array<Pick<Job, 'jobId'>>, input: JobUpsert): string {
  if (input.jobId) return input.jobId;
  if (input.woNumber) return `NP-${input.woNumber}`;
  const nums = jobs
    .map((j) => /(\d{3,})/.exec(j.jobId)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = (nums.length ? Math.max(...nums) : 1000) + 1;
  return `TRT-${next}`;
}

export async function upsertJob(
  input: JobUpsert,
  ctx: { user: string; source: string; idempotencyKey?: string },
): Promise<UpsertResult> {
  const replay = await priorApplication(ctx.idempotencyKey);
  const { cols } = await columnsFor(TABLES.ALL_JOBS, JOB_FIELDS);
  const jobs = await listJobs();

  if (replay) {
    const prior = jobs.find((j) => j.row === replay.row);
    return {
      action: 'unchanged',
      jobId: prior?.jobId ?? replay.recordId,
      row: replay.row,
      sheet: SHEETS.ALL_JOBS,
      changed: [],
    };
  }

  const dup = findDuplicate(jobs, input);
  const stamp = businessStamp(new Date());
  const patch = toPatch(input);

  if (dup) {
    const target = dup.job;
    const changes: Array<{ field: string; prev?: string; next?: string }> = [];

    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const raw = (target as unknown as Record<string, unknown>)[field];
      const prev = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '');
      if (prev === String(value)) continue;
      changes.push({ field, prev, next: String(value) });
    }

    if (!changes.length) {
      return {
        action: 'unchanged', jobId: target.jobId, row: target.row,
        sheet: SHEETS.ALL_JOBS, changed: [], duplicate: dup,
      };
    }

    await updateRow(TABLES.ALL_JOBS, target.row, cols, {
      ...patch, lastUpdated: stamp, updatedBy: ctx.user,
    });
    await recordChanges(
      {
        user: ctx.user, source: ctx.source, action: 'update_job',
        sheet: SHEETS.ALL_JOBS, row: target.row, idempotencyKey: ctx.idempotencyKey,
      },
      changes,
    );

    return {
      action: 'updated', jobId: target.jobId, row: target.row,
      sheet: SHEETS.ALL_JOBS, changed: changes.map((c) => c.field), duplicate: dup,
    };
  }

  const jobId = nextJobId(jobs, input);
  const { row, applied } = await appendRecord(TABLES.ALL_JOBS, JOB_FIELDS, 'customer', {
    ...patch,
    jobId,
    status: input.status ?? 'NEED INFO',
    priority: input.priority ?? 'NORMAL',
    lastUpdated: stamp,
    createdBy: ctx.user,
    updatedBy: ctx.user,
    createdDate: stamp,
  });

  await recordAudit({
    user: ctx.user, source: ctx.source, action: 'create_job',
    sheet: SHEETS.ALL_JOBS, row, field: 'jobId', prev: '', next: jobId,
    result: 'ok', idempotencyKey: ctx.idempotencyKey,
  });

  return { action: 'created', jobId, row, sheet: SHEETS.ALL_JOBS, changed: applied };
}

/**
 * Change a job's status. Closing a job stamps Project End, which is the
 * completion date every completed-work window reads.
 */
export async function setStatus(
  jobId: string,
  status: string,
  ctx: { user: string; source: string; idempotencyKey?: string },
): Promise<UpsertResult> {
  const patch: JobUpsert = { jobId, status };
  if (CLOSED_STATUSES.includes(status.toUpperCase())) {
    patch.projectEnd = businessDay(new Date());
  }
  return upsertJob(patch, ctx);
}
