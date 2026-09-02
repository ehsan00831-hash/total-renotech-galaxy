/**
 * Audit log. Every mutation is recorded to a dedicated sheet with the previous
 * and new value, so any change can be traced and recent safe changes undone.
 */

import { SHEETS, TABLES } from './schema';
import { appendRecord, ensureSheet, readRecords, updateRow, columnsFor } from './sheets';
import type { FieldSpec, TableSpec } from './schema';

export const AUDIT_HEADERS = [
  'Audit ID', 'Timestamp', 'User', 'Source', 'Action', 'Sheet', 'Row',
  'Field', 'Previous Value', 'New Value', 'Result', 'Error', 'Idempotency Key', 'Undone',
];

export const AUDIT_FIELDS: Record<string, FieldSpec> = {
  auditId:   { patterns: [/audit\s*id/] },
  timestamp: { patterns: [/^timestamp/] },
  user:      { patterns: [/^user/] },
  source:    { patterns: [/^source/] },
  action:    { patterns: [/^action/] },
  sheet:     { patterns: [/^sheet/] },
  row:       { patterns: [/^row/] },
  field:     { patterns: [/^field/] },
  prev:      { patterns: [/previous\s*value/] },
  next:      { patterns: [/new\s*value/] },
  result:    { patterns: [/^result/] },
  error:     { patterns: [/^error/] },
  idem:      { patterns: [/idempotency/] },
  undone:    { patterns: [/^undone/] },
};

export type AuditEntry = {
  user: string;
  source: string;
  action: string;
  sheet: string;
  row: number;
  field?: string;
  prev?: string;
  next?: string;
  result: 'ok' | 'error' | 'skipped';
  error?: string;
  idempotencyKey?: string;
};

let auditReady = false;

async function ready(): Promise<void> {
  if (auditReady) return;
  await ensureSheet(TABLES.AUDIT, AUDIT_HEADERS);
  auditReady = true;
}

export async function recordAudit(entry: AuditEntry): Promise<string> {
  await ready();
  const auditId = `AUD-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36).slice(2, 6).toUpperCase()}`;

  await appendRecord(TABLES.AUDIT, AUDIT_FIELDS, 'auditId', {
    auditId,
    timestamp: new Date().toISOString(),
    user: entry.user,
    source: entry.source,
    action: entry.action,
    sheet: entry.sheet,
    row: entry.row,
    field: entry.field ?? '',
    prev: truncate(entry.prev),
    next: truncate(entry.next),
    result: entry.result,
    error: entry.error ? truncate(entry.error) : '',
    idem: entry.idempotencyKey ?? '',
    undone: '',
  });
  return auditId;
}

/** Record many field-level changes from one logical action. */
export async function recordChanges(
  base: Omit<AuditEntry, 'field' | 'prev' | 'next' | 'result'>,
  changes: Array<{ field: string; prev?: string; next?: string }>,
): Promise<void> {
  for (const c of changes) {
    await recordAudit({ ...base, ...c, result: 'ok' });
  }
}

function truncate(v: unknown, max = 500): string {
  const s = String(v ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Has this idempotency key already been applied successfully? */
export async function seenIdempotencyKey(key: string): Promise<boolean> {
  if (!key) return false;
  try {
    await ready();
    const { rows } = await readRecords(TABLES.AUDIT, AUDIT_FIELDS, 'auditId');
    return rows.some((r) => r.idem === key && r.result === 'ok');
  } catch {
    return false;
  }
}

/**
 * What an idempotency key already did.
 *
 * `seenIdempotencyKey` only answers yes/no, which is enough to skip a write
 * but not enough to answer the caller: a retry has to return the same row and
 * record id as the original call, or the client sees a success with no target.
 */
export type PriorApplication = { sheet: string; row: number; recordId: string };

export async function priorApplication(
  key: string | undefined,
): Promise<PriorApplication | null> {
  if (!key) return null;
  try {
    await ready();
    const { rows } = await readRecords(TABLES.AUDIT, AUDIT_FIELDS, 'auditId');
    const hits = rows.filter((r) => r.idem === key && r.result === 'ok' && !r.undone);
    if (hits.length === 0) return null;
    const first = hits[0];
    const row = Number(first.row);
    if (!Number.isFinite(row)) return null;
    // The id is recorded as the "new value" of the id field on create.
    const idHit = hits.find((r) => r.field === 'id' || r.field === 'jobId');
    return { sheet: first.sheet, row, recordId: idHit?.next ?? '' };
  } catch {
    return null;
  }
}

export type AuditRow = {
  auditId: string; timestamp: string; user: string; source: string; action: string;
  sheet: string; row: string; field: string; prev: string; next: string;
  result: string; error: string; undone: string;
};

export async function listAudit(limit = 100): Promise<AuditRow[]> {
  await ready();
  const { rows } = await readRecords(TABLES.AUDIT, AUDIT_FIELDS, 'auditId');
  return rows
    .slice(-limit)
    .reverse()
    .map((r) => ({
      auditId: r.auditId, timestamp: r.timestamp, user: r.user, source: r.source,
      action: r.action, sheet: r.sheet, row: r.row, field: r.field,
      prev: r.prev, next: r.next, result: r.result, error: r.error, undone: r.undone,
    }));
}

/**
 * Undo one audit entry by writing the previous value back. Only field-level
 * entries that have not already been undone are eligible.
 */
export async function undoAudit(auditId: string, user: string): Promise<string> {
  await ready();
  const { rows, cols } = await readRecords(TABLES.AUDIT, AUDIT_FIELDS, 'auditId');
  const entry = rows.find((r) => r.auditId === auditId);
  if (!entry) throw new Error(`Audit entry ${auditId} not found.`);
  if (entry.undone) throw new Error(`Audit entry ${auditId} was already undone.`);
  if (!entry.field) throw new Error('This entry has no field-level change to undo.');

  const target = entry.sheet;
  const targetRow = Number(entry.row);
  if (!target || !Number.isFinite(targetRow)) throw new Error('Audit entry is missing a target.');

  // Re-resolve the target table's columns so an undo cannot write to a stale
  // index. Only writable source tables are undoable — ARCHIVE is a formula
  // view, so there is nothing there to revert.
  const { JOB_FIELDS, REMINDER_FIELDS, LOG_FIELDS } = await import('./schema');
  const targets: Record<string, { table: TableSpec; fields: Record<string, FieldSpec> }> = {
    [SHEETS.ALL_JOBS]: { table: TABLES.ALL_JOBS, fields: JOB_FIELDS },
    [SHEETS.ACTIVE_REMINDERS]: { table: TABLES.REMINDERS, fields: REMINDER_FIELDS },
    [SHEETS.DAILY_LOGS]: { table: TABLES.DAILY_LOGS, fields: LOG_FIELDS },
  };
  const spec = targets[target];
  if (!spec) throw new Error(`Undo is not supported for sheet "${target}".`);

  const { cols: targetCols } = await columnsFor(spec.table, spec.fields);
  await updateRow(spec.table, targetRow, targetCols, { [entry.field]: entry.prev });

  await updateRow(TABLES.AUDIT, entry.__row, cols, {
    undone: `${new Date().toISOString()} by ${user}`,
  });

  await recordAudit({
    user, source: 'webapp', action: 'undo', sheet: target, row: targetRow,
    field: entry.field, prev: entry.next, next: entry.prev, result: 'ok',
  });

  return `Reverted ${entry.field} on ${target} row ${targetRow}.`;
}
