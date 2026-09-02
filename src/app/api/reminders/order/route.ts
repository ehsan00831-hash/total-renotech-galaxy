import { guarded, ok, fail } from '@/lib/route-utils';
import { getOrder, saveOrder } from '@/lib/reminder-order';
import { ReminderOrderSchema } from '@/lib/schema';

export const GET = guarded('read', async () => {
  const order = await getOrder();
  return ok({ order });
});

export const POST = guarded('log', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = ReminderOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid order payload.', 422, { issues: parsed.error.issues });
  }
  await saveOrder(parsed.data.order, { user: caller.user, source: caller.source });
  return ok({ order: parsed.data.order });
});
