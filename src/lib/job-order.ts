/**
 * Manual priority order for jobs, within each status column of the board.
 *
 * Shares the "Reminder Order" tab with the reminders priority order — same
 * generic id/orderJson/updatedBy/updatedAt shape, just a second row keyed
 * 'JOBS' instead of 'MAIN'. No new tab, no schema change.
 */

import { REMINDER_ORDER_FIELDS, REMINDER_ORDER_HEADERS, TABLES } from './schema';
import { appendRecord, ensureSheet, readRecords, updateRow } from './sheets';
import { recordAudit } from './audit';

const ROW_ID = 'JOBS';

let ready = false;
async function ensureReady(): Promise<void> {
  if (ready) return;
  await ensureSheet(TABLES.REMINDER_ORDER, REMINDER_ORDER_HEADERS);
  ready = true;
}

export async function getJobOrder(): Promise<string[]> {
  await ensureReady();
  const { rows } = await readRecords(TABLES.REMINDER_ORDER, REMINDER_ORDER_FIELDS, 'id');
  const row = rows.find((r) => r.id === ROW_ID);
  if (!row?.orderJson) return [];
  try {
    const parsed = JSON.parse(row.orderJson);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveJobOrder(order: string[], ctx: { user: string; source: string }): Promise<void> {
  await ensureReady();
  const { rows, cols } = await readRecords(TABLES.REMINDER_ORDER, REMINDER_ORDER_FIELDS, 'id');
  const existing = rows.find((r) => r.id === ROW_ID);
  const patch = {
    id: ROW_ID,
    orderJson: JSON.stringify(order),
    updatedBy: ctx.user,
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    await updateRow(TABLES.REMINDER_ORDER, existing.__row, cols, patch);
  } else {
    await appendRecord(TABLES.REMINDER_ORDER, REMINDER_ORDER_FIELDS, 'id', patch);
  }

  await recordAudit({
    user: ctx.user, source: ctx.source, action: 'save_job_order',
    sheet: TABLES.REMINDER_ORDER.sheet, row: existing?.__row ?? 0, field: 'orderJson',
    prev: existing?.orderJson ?? '', next: patch.orderJson, result: 'ok',
  });
}
