/**
 * Job tags — "Needs Approval" / "Needs Estimate", independent of status.
 * A job can sit in ONGOING (or any other status) while also carrying one or
 * both flags. One row per job that has ever been tagged, on its own "Job
 * Tags" tab, created on first use. All Jobs is never touched.
 */

import { JOB_TAG_FIELDS, JOB_TAG_HEADERS, TABLES, type JobTagsInput } from './schema';
import { appendRecord, columnsFor, ensureSheet, readRecords, updateRow, type SheetRow } from './sheets';
import { recordAudit } from './audit';
import { normKey } from './core';

export type JobTags = { needsApproval: boolean; needsEstimate: boolean };
export type JobTagsRecord = JobTags & { row: number; jobId: string };

function toRecord(r: SheetRow): JobTagsRecord {
  return {
    row: r.__row,
    jobId: r.jobId ?? '',
    needsApproval: (r.needsApproval ?? '').trim().toLowerCase() === 'yes',
    needsEstimate: (r.needsEstimate ?? '').trim().toLowerCase() === 'yes',
  };
}

let ready = false;
async function ensureReady(): Promise<void> {
  if (ready) return;
  await ensureSheet(TABLES.JOB_TAGS, JOB_TAG_HEADERS);
  ready = true;
}

export async function listJobTags(): Promise<Map<string, JobTagsRecord>> {
  await ensureReady();
  const { rows } = await readRecords(TABLES.JOB_TAGS, JOB_TAG_FIELDS, 'jobId');
  const out = new Map<string, JobTagsRecord>();
  for (const r of rows) {
    const rec = toRecord(r);
    if (rec.jobId) out.set(normKey(rec.jobId), rec);
  }
  return out;
}

export async function setJobTags(
  input: JobTagsInput,
  ctx: { user: string; source: string },
): Promise<JobTagsRecord> {
  const all = await listJobTags();
  const existing = all.get(normKey(input.jobId));

  const patch: Record<string, string> = { updatedBy: ctx.user, updatedAt: new Date().toISOString() };
  if (input.needsApproval !== undefined) patch.needsApproval = input.needsApproval ? 'Yes' : '';
  if (input.needsEstimate !== undefined) patch.needsEstimate = input.needsEstimate ? 'Yes' : '';

  let row: number;
  if (existing) {
    row = existing.row;
    const { cols } = await columnsFor(TABLES.JOB_TAGS, JOB_TAG_FIELDS);
    await updateRow(TABLES.JOB_TAGS, row, cols, patch);
  } else {
    const created = await appendRecord(TABLES.JOB_TAGS, JOB_TAG_FIELDS, 'jobId', { jobId: input.jobId, ...patch });
    row = created.row;
  }

  await recordAudit({
    user: ctx.user, source: ctx.source, action: 'set_job_tags',
    sheet: TABLES.JOB_TAGS.sheet, row, field: 'jobId', prev: '', next: input.jobId, result: 'ok',
  });

  const fresh = await listJobTags();
  return fresh.get(normKey(input.jobId)) ?? {
    row, jobId: input.jobId, needsApproval: false, needsEstimate: false,
  };
}
