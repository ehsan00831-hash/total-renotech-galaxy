import {
  guarded, ok, fail, searchParams, idempotencyKeyFor, replayGuard,
} from '@/lib/route-utils';
import { listReminders, upsertReminder } from '@/lib/reminders';
import { ReminderUpsertSchema } from '@/lib/schema';
import { applyManualOrder, groupReminders, normKey } from '@/lib/core';
import { commentCounts } from '@/lib/reminder-comments';
import { getOrder } from '@/lib/reminder-order';

export const GET = guarded('read', async (req) => {
  const which = (searchParams(req).get('which') ?? 'active') as 'active' | 'archive' | 'both';
  const [reminders, counts, order] = await Promise.all([
    listReminders(which),
    commentCounts().catch(() => new Map<string, { total: number; openMentions: number }>()),
    which === 'active' ? getOrder().catch(() => []) : Promise.resolve([]),
  ]);
  const now = new Date();

  const withCounts = reminders.map((r) => {
    const c = counts.get(normKey(r.id)) ?? { total: 0, openMentions: 0 };
    return { ...r, commentCount: c.total, openMentions: c.openMentions };
  });

  return ok({
    reminders: withCounts,
    count: withCounts.length,
    overdue: withCounts.filter((r) => r.overdue).length,
    // The daily-operations grouping only makes sense over ACTIVE REMINDERS —
    // Archive is a closed record, not something to triage into "due today".
    groups: which === 'active' ? groupReminders(withCounts, now) : null,
    // The manually dragged priority order, active reminders only.
    priorityOrder: which === 'active' ? applyManualOrder(withCounts, order) : null,
  });
});

export const POST = guarded('write', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = ReminderUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid reminder payload.', 422, { issues: parsed.error.issues });
  }
  const key = idempotencyKeyFor(req, caller, 'create_or_update_reminder', parsed.data);
  const replay = await replayGuard(key);
  if (replay) return replay;

  const result = await upsertReminder(parsed.data, {
    user: caller.user, source: caller.source, idempotencyKey: key,
  });
  return ok({ result, idempotencyKey: key });
});
