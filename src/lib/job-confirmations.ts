/**
 * Tomorrow Plan confirmation state — proposed (tentative) vs confirmed, plus
 * the two-step coordination checklist (customer, then crew).
 *
 * One row per job that has ever been touched by this workflow, on its own
 * "Job Confirmations" tab, created on first use. All Jobs is never touched.
 */

import {
  JOB_CONFIRMATION_FIELDS, JOB_CONFIRMATION_HEADERS, TABLES, type JobConfirmationInput,
} from './schema';
import { appendRecord, columnsFor, ensureSheet, readRecords, updateRow, type SheetRow } from './sheets';
import { recordAudit } from './audit';
import { assertCoordinationOrder, normKey, type JobConfirmation } from './core';

export type JobConfirmationRecord = JobConfirmation & {
  row: number;
  jobId: string;
  customerConfirmedBy: string;
  customerConfirmedAt: string;
  crewConfirmedBy: string;
  crewConfirmedAt: string;
};

function toRecord(r: SheetRow): JobConfirmationRecord {
  return {
    row: r.__row,
    jobId: r.jobId ?? '',
    confirmed: (r.confirmed ?? '').trim().toLowerCase() === 'yes',
    customerConfirmed: (r.customerConfirmed ?? '').trim().toLowerCase() === 'yes',
    customerConfirmedBy: r.customerConfirmedBy ?? '',
    customerConfirmedAt: r.customerConfirmedAt ?? '',
    crewConfirmed: (r.crewConfirmed ?? '').trim().toLowerCase() === 'yes',
    crewConfirmedBy: r.crewConfirmedBy ?? '',
    crewConfirmedAt: r.crewConfirmedAt ?? '',
  };
}

let ready = false;
async function ensureReady(): Promise<void> {
  if (ready) return;
  await ensureSheet(TABLES.JOB_CONFIRMATIONS, JOB_CONFIRMATION_HEADERS);
  ready = true;
}

/** Every job ever touched by this workflow, keyed by job id. */
export async function listConfirmations(): Promise<Map<string, JobConfirmationRecord>> {
  await ensureReady();
  const { rows } = await readRecords(TABLES.JOB_CONFIRMATIONS, JOB_CONFIRMATION_FIELDS, 'jobId');
  const out = new Map<string, JobConfirmationRecord>();
  for (const r of rows) {
    const rec = toRecord(r);
    if (rec.jobId) out.set(normKey(rec.jobId), rec);
  }
  return out;
}

export async function setConfirmation(
  input: JobConfirmationInput,
  ctx: { user: string; source: string },
): Promise<JobConfirmationRecord> {
  const all = await listConfirmations();
  const existing = all.get(normKey(input.jobId));

  assertCoordinationOrder(
    existing ?? { confirmed: false, customerConfirmed: false, crewConfirmed: false },
    input,
  );

  const now = new Date().toISOString();
  const patch: Record<string, string> = { updatedBy: ctx.user, updatedAt: now };
  if (input.confirmed !== undefined) patch.confirmed = input.confirmed ? 'Yes' : '';
  if (input.customerConfirmed !== undefined) {
    patch.customerConfirmed = input.customerConfirmed ? 'Yes' : '';
    patch.customerConfirmedBy = input.customerConfirmed ? ctx.user : '';
    patch.customerConfirmedAt = input.customerConfirmed ? now : '';
  }
  if (input.crewConfirmed !== undefined) {
    patch.crewConfirmed = input.crewConfirmed ? 'Yes' : '';
    patch.crewConfirmedBy = input.crewConfirmed ? ctx.user : '';
    patch.crewConfirmedAt = input.crewConfirmed ? now : '';
  }

  let row: number;
  if (existing) {
    row = existing.row;
    const { cols } = await columnsFor(TABLES.JOB_CONFIRMATIONS, JOB_CONFIRMATION_FIELDS);
    await updateRow(TABLES.JOB_CONFIRMATIONS, row, cols, patch);
  } else {
    const created = await appendRecord(TABLES.JOB_CONFIRMATIONS, JOB_CONFIRMATION_FIELDS, 'jobId', {
      jobId: input.jobId, ...patch,
    });
    row = created.row;
  }

  await recordAudit({
    user: ctx.user, source: ctx.source, action: 'set_job_confirmation',
    sheet: TABLES.JOB_CONFIRMATIONS.sheet, row, field: 'jobId', prev: '', next: input.jobId,
    result: 'ok',
  });

  const fresh = await listConfirmations();
  return fresh.get(normKey(input.jobId)) ?? {
    row, jobId: input.jobId, confirmed: false, customerConfirmed: false, crewConfirmed: false,
    customerConfirmedBy: '', customerConfirmedAt: '', crewConfirmedBy: '', crewConfirmedAt: '',
  };
}
