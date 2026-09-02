/**
 * Reminders.
 *
 * ACTIVE REMINDERS is the source table and the only thing this module writes.
 * ARCHIVE is a formula view — its A6 holds an ARRAYFORMULA over ACTIVE
 * REMINDERS — so a reminder is archived by changing its status on the source
 * row and letting the formula do the rest. Nothing here appends to, patches or
 * clears ARCHIVE.
 */

import { REMINDER_FIELDS, TABLES, SHEETS, type ReminderUpsert } from './schema';
import { appendRecord, columnsFor, readRecords, updateRow, type SheetRow } from './sheets';
import { priorApplication, recordAudit, recordChanges } from './audit';
import {
  assertReminderPriority, assertReminderStatus, dedupeReminders,
  findReminder, isReminderOverdue, normKey, reminderVisibleIn, sortReminders,
  REMINDER_PRIORITIES, REMINDER_STATUSES, REMINDER_WRITE_SHEET, formatCad,
  businessStamp,
} from './core';

export {
  REMINDER_PRIORITIES, REMINDER_STATUSES, REMINDER_WRITE_SHEET,
  formatCad, reminderVisibleIn, normKey,
};

export type Reminder = {
  row: number;
  sheet: string;
  id: string;
  dateAdded: string;
  category: string;
  customer: string;
  requiredAction: string;
  assignedTo: string;
  priority: string;
  status: string;
  dueAt: string;
  nextFollowUp: string;
  contactAddress: string;
  reference: string;
  amount: string;
  waitingFor: string;
  notes: string;
  lastUpdated: string;
  overdue: boolean;
  /** False for rows read out of the ARCHIVE formula view. */
  editable: boolean;
};

function toReminder(r: SheetRow, sheet: string, now: Date): Reminder {
  const base = {
    row: r.__row,
    sheet,
    id: r.id ?? '',
    dateAdded: r.dateAdded ?? '',
    category: r.category ?? '',
    customer: r.customer ?? '',
    requiredAction: r.requiredAction ?? '',
    assignedTo: r.assignedTo ?? '',
    priority: (r.priority ?? '').trim(),
    status: (r.status ?? '').trim(),
    dueAt: r.dueAt ?? '',
    nextFollowUp: r.nextFollowUp ?? '',
    contactAddress: r.contactAddress ?? '',
    reference: r.reference ?? '',
    amount: r.amount ?? '',
    waitingFor: r.waitingFor ?? '',
    notes: r.notes ?? '',
    lastUpdated: r.lastUpdated ?? '',
  };
  return {
    ...base,
    overdue: isReminderOverdue(base, now),
    editable: sheet === REMINDER_WRITE_SHEET,
  };
}

async function readActive(now: Date): Promise<Reminder[]> {
  try {
    const { rows } = await readRecords(TABLES.REMINDERS, REMINDER_FIELDS, 'id');
    return rows.map((r) => toReminder(r, SHEETS.ACTIVE_REMINDERS, now));
  } catch {
    return [];
  }
}

async function readArchive(now: Date): Promise<Reminder[]> {
  try {
    const { rows } = await readRecords(TABLES.ARCHIVE, REMINDER_FIELDS, 'id');
    return rows.map((r) => toReminder(r, SHEETS.ARCHIVE, now));
  } catch {
    return [];
  }
}

export async function listReminders(
  which: 'active' | 'archive' | 'both' = 'active',
): Promise<Reminder[]> {
  const now = new Date();

  if (which === 'active') {
    // The source table also holds rows the formula has mirrored into ARCHIVE;
    // show only the ones that are genuinely still open.
    const active = await readActive(now);
    return sortReminders(
      active.filter((r) => reminderVisibleIn(r.status) === SHEETS.ACTIVE_REMINDERS),
      now,
    );
  }

  if (which === 'archive') {
    return sortReminders(await readArchive(now), now);
  }

  const [active, archive] = await Promise.all([readActive(now), readArchive(now)]);
  return sortReminders(dedupeReminders([...active, ...archive]), now);
}

/** Every reminder in the source table, whatever its status. Used for merging. */
async function readSourceForMatching(): Promise<Reminder[]> {
  return readActive(new Date());
}

function nextId(list: Reminder[]): string {
  const nums = list
    .map((r) => /(\d{3,})/.exec(r.id)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `REM-${String(next).padStart(4, '0')}`;
}

/** Drop undefined / empty so a blank never overwrites a populated cell. */
function present(o: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = String(v);
  }
  return out;
}

export type ReminderResult = {
  action: 'created' | 'updated' | 'archived' | 'unchanged';
  id: string;
  row: number;
  /** Always ACTIVE REMINDERS — the only reminder sheet written to. */
  sheet: string;
  changed: string[];
  /** Where the ARCHIVE formula will surface this reminder. */
  visibleIn: string;
};

export async function upsertReminder(
  input: ReminderUpsert,
  ctx: { user: string; source: string; idempotencyKey?: string },
): Promise<ReminderResult> {
  // A retry of a call that already succeeded must not write again. Natural-key
  // matching is not enough here: a reminder created without an id, customer or
  // required action has nothing to match on, so the retry would append a
  // second row.
  const replay = await priorApplication(ctx.idempotencyKey);

  const source = await readSourceForMatching();

  if (replay) {
    const prior = source.find((r) => r.row === replay.row);
    return {
      action: 'unchanged',
      id: prior?.id ?? replay.recordId,
      row: replay.row,
      sheet: SHEETS.ACTIVE_REMINDERS,
      changed: [],
      visibleIn: reminderVisibleIn(prior?.status ?? 'New'),
    };
  }

  const existing = findReminder(source, {
    id: input.id,
    customer: input.customer,
    requiredAction: input.requiredAction,
  });
  const stamp = businessStamp(new Date());

  // Canonicalise or refuse — an unknown value must never reach a cell.
  const desiredStatus = assertReminderStatus(input.status ?? existing?.status ?? 'New');
  const visibleIn = reminderVisibleIn(desiredStatus);

  const patch = present({
    ...input,
    status: desiredStatus,
    priority: assertReminderPriority(input.priority ?? ''),
  });
  delete patch.id;

  /* ---------------------------------------------------------- create */
  if (!existing) {
    const id = input.id || nextId(source);
    const { row, applied } = await appendRecord(
      TABLES.REMINDERS, REMINDER_FIELDS, 'id',
      { ...patch, id, dateAdded: stamp.slice(0, 10), lastUpdated: stamp },
    );
    await recordAudit({
      user: ctx.user, source: ctx.source, action: 'create_reminder',
      sheet: SHEETS.ACTIVE_REMINDERS, row, field: 'id', prev: '', next: id,
      result: 'ok', idempotencyKey: ctx.idempotencyKey,
    });
    return {
      action: 'created', id, row,
      sheet: SHEETS.ACTIVE_REMINDERS, changed: applied, visibleIn,
    };
  }

  /* ---------------------------------------------------------- update */
  const changes: Array<{ field: string; prev?: string; next?: string }> = [];
  for (const [field, value] of Object.entries(patch)) {
    const prev = (existing as unknown as Record<string, string>)[field] ?? '';
    if (prev === value) continue;
    changes.push({ field, prev, next: value });
  }

  if (!changes.length) {
    return {
      action: 'unchanged', id: existing.id, row: existing.row,
      sheet: SHEETS.ACTIVE_REMINDERS, changed: [], visibleIn,
    };
  }

  const { cols } = await columnsFor(TABLES.REMINDERS, REMINDER_FIELDS);
  await updateRow(TABLES.REMINDERS, existing.row, cols, { ...patch, lastUpdated: stamp });

  const statusChanged = changes.some((c) => c.field === 'status');
  await recordChanges(
    {
      user: ctx.user, source: ctx.source,
      action: statusChanged && visibleIn === SHEETS.ARCHIVE
        ? 'archive_reminder' : 'update_reminder',
      sheet: SHEETS.ACTIVE_REMINDERS, row: existing.row,
      idempotencyKey: ctx.idempotencyKey,
    },
    changes,
  );

  return {
    action: statusChanged && visibleIn === SHEETS.ARCHIVE ? 'archived' : 'updated',
    id: existing.id, row: existing.row,
    sheet: SHEETS.ACTIVE_REMINDERS,
    changed: changes.map((c) => c.field),
    visibleIn,
  };
}
