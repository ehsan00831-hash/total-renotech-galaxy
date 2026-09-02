/**
 * Applies a parsed intent to the workbook.
 *
 * Nothing is written unless the caller confirms, or confidence is high and the
 * caller opted into auto-commit. Every path returns the exact sheet and row so
 * ChatGPT and Claude can report back precisely what changed.
 */

import { JobUpsertSchema, ReminderUpsertSchema, DailyLogSchema, SHEETS } from './schema';
import type { ParsedIntent } from './ai';
import { findDuplicate, listJobs, upsertJob, setStatus, type Job } from './jobs';
import {
  canonicalReminderPriority, canonicalReminderStatus, type DuplicateMatch,
  businessDay,
} from './core';
import { upsertReminder } from './reminders';
import { addLog } from './logs';
import { CLOSED_STATUSES } from './brand';

export type IntakePreview = {
  action: string;
  confidence: number;
  reasoning: string;
  missing: string[];
  fields: Record<string, unknown>;
  duplicate?: { jobId: string; customer: string; row: number; reason: string; confidence: number };
  willCreate: boolean;
  needsConfirmation: boolean;
  blockers: string[];
};

export type IntakeCommit = {
  committed: true;
  action: string;
  sheet: string;
  row: number;
  recordId: string;
  changed: string[];
  note?: string;
};

const AUTO_COMMIT_FLOOR = 0.85;

/** Build a human-checkable summary without touching the sheet. */
export async function previewIntent(intent: ParsedIntent): Promise<IntakePreview> {
  const f = intent.fields;
  const blockers: string[] = [];
  let duplicate: DuplicateMatch<Job> | null = null;

  const jobish = ['create_job', 'update_job', 'schedule_job', 'assign_crew', 'assign_truck',
                  'change_status', 'complete_job', 'add_material', 'add_labour_hours',
                  'add_follow_up', 'attach_reference'].includes(intent.action);

  if (jobish) {
    const parsed = JobUpsertSchema.safeParse(toJobInput(f));
    if (!parsed.success) {
      blockers.push(`Validation failed: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
    } else {
      const jobs = await listJobs();
      duplicate = findDuplicate(jobs, parsed.data);
      if (!duplicate && intent.action !== 'create_job') {
        blockers.push('No existing job matched. Nothing to update — create it first, or add a Job ID / WO number.');
      }
      if (!duplicate && intent.action === 'create_job' && !parsed.data.customer) {
        blockers.push('A new job needs at least a customer or project name.');
      }
    }
  }

  if (intent.action === 'upsert_reminder') {
    const parsed = ReminderUpsertSchema.safeParse(toReminderInput(f));
    if (!parsed.success) blockers.push('Reminder validation failed.');
    else if (!parsed.data.customer && !parsed.data.requiredAction) {
      blockers.push('A reminder needs a customer or a required action.');
    }
  }

  if (intent.action === 'add_daily_log') {
    const parsed = DailyLogSchema.safeParse(toLogInput(f));
    if (!parsed.success) blockers.push('A daily log needs at least a work date.');
  }

  return {
    action: intent.action,
    confidence: intent.confidence,
    reasoning: intent.reasoning,
    missing: intent.missing,
    fields: f,
    duplicate: duplicate
      ? { jobId: duplicate.job.jobId, customer: duplicate.job.customer,
          row: duplicate.job.row, reason: duplicate.reason, confidence: duplicate.confidence }
      : undefined,
    willCreate: intent.action === 'create_job' && !duplicate,
    needsConfirmation: intent.needsConfirmation || blockers.length > 0,
    blockers,
  };
}

export function mayAutoCommit(preview: IntakePreview, autoCommit: boolean): boolean {
  if (!autoCommit) return false;
  if (preview.blockers.length) return false;
  if (preview.missing.length) return false;
  return preview.confidence >= AUTO_COMMIT_FLOOR;
}

export async function commitIntent(
  intent: ParsedIntent,
  ctx: { user: string; source: string; idempotencyKey?: string },
): Promise<IntakeCommit> {
  const f = intent.fields;

  switch (intent.action) {
    case 'upsert_reminder': {
      const input = ReminderUpsertSchema.parse(toReminderInput(f));
      const r = await upsertReminder(input, ctx);
      return {
        committed: true, action: intent.action, sheet: r.sheet, row: r.row,
        recordId: r.id, changed: r.changed,
        note: r.visibleIn === 'ARCHIVE'
          ? 'Status set on ACTIVE REMINDERS; the ARCHIVE formula will surface it.'
          : undefined,
      };
    }

    case 'add_daily_log': {
      const input = DailyLogSchema.parse(toLogInput(f));
      const r = await addLog(input, ctx);
      return { committed: true, action: intent.action, sheet: SHEETS.DAILY_LOGS,
               row: r.row, recordId: input.jobId ?? '', changed: ['dailyLog'],
               note: `Total person-hours ${r.totalHours}` };
    }

    case 'complete_job': {
      const jobId = String(f.jobId ?? '');
      const status = String(f.status ?? 'COMPLETED').toUpperCase();
      const finalStatus = CLOSED_STATUSES.includes(status) ? status : 'COMPLETED';
      const r = await setStatus(jobId, finalStatus, ctx);
      return { committed: true, action: intent.action, sheet: r.sheet, row: r.row,
               recordId: r.jobId, changed: r.changed };
    }

    default: {
      const input = JobUpsertSchema.parse(toJobInput(f));
      const r = await upsertJob(input, ctx);
      return { committed: true, action: intent.action, sheet: r.sheet, row: r.row,
               recordId: r.jobId, changed: r.changed,
               note: r.duplicate ? `Matched existing job by ${r.duplicate.reason}` : undefined };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Field shaping
 * ------------------------------------------------------------------ */

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

function toJobInput(f: Record<string, unknown>) {
  return {
    jobId: str(f.jobId),
    customer: str(f.customer),
    projectType: str(f.projectType),
    fullAddress: str(f.fullAddress) ?? str(f.address),
    contactName: str(f.contactName),
    phone: str(f.phone),
    email: str(f.email),
    woNumber: str(f.woNumber),
    poNumber: str(f.poNumber),
    scope: str(f.scope),
    requiredAction: str(f.requiredAction),
    priority: str(f.priority)?.toUpperCase(),
    status: str(f.status)?.toUpperCase(),
    scheduledDate: str(f.scheduledDate),
    arrivalWindow: str(f.arrivalWindow),
    actualStart: str(f.actualStart),
    actualEnd: str(f.actualEnd),
    truck: str(f.truck),
    technicians: Array.isArray(f.technicians) ? (f.technicians as string[]) : undefined,
    materials: str(f.materials),
    materialStatus: str(f.materialStatus)?.toUpperCase(),
    followUpDate: str(f.followUpDate),
    notes: str(f.notes),
  };
}

function toReminderInput(f: Record<string, unknown>) {
  return {
    id: str(f.jobId) && !str(f.customer) ? undefined : undefined,
    category: str(f.category),
    customer: str(f.customer),
    requiredAction: str(f.requiredAction) ?? str(f.scope),
    assignedTo: str(f.assignedTo) ??
      (Array.isArray(f.technicians) ? (f.technicians as string[]).join(', ') : undefined),
    priority: canonicalReminderPriority(str(f.priority) ?? ''),
    status: canonicalReminderStatus(str(f.status) ?? ''),
    dueAt: str(f.dueAt) ?? str(f.followUpDate) ?? str(f.scheduledDate),
    nextFollowUp: str(f.followUpDate),
    contactAddress: [str(f.contactName), str(f.phone), str(f.fullAddress) ?? str(f.address)]
      .filter(Boolean).join(' | ') || undefined,
    reference: str(f.reference) ?? str(f.woNumber),
    amount: str(f.amount),
    notes: str(f.notes),
  };
}

function toLogInput(f: Record<string, unknown>) {
  return {
    jobId: str(f.jobId),
    project: str(f.customer),
    workDate: str(f.workDate) ?? str(f.scheduledDate) ?? businessDay(new Date()),
    location: str(f.fullAddress) ?? str(f.address),
    truck: str(f.truck),
    technicians: Array.isArray(f.technicians) ? (f.technicians as string[]) : undefined,
    clockIn: str(f.clockIn) ?? str(f.actualStart),
    clockOut: str(f.clockOut) ?? str(f.actualEnd),
    breakMin: str(f.breakMin),
    workCompleted: str(f.workCompleted),
    materialsUsed: str(f.materials),
    notes: str(f.notes),
  };
}
