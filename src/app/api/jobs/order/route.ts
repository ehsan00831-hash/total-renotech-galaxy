import { guarded, ok, fail } from '@/lib/route-utils';
import { getJobOrder, saveJobOrder } from '@/lib/job-order';
import { ReminderOrderSchema } from '@/lib/schema';

export const GET = guarded('read', async () => {
  const order = await getJobOrder();
  return ok({ order });
});

// Same capability as PATCH /api/jobs/[jobId]: only coordinator/admin may
// change a job's board position, matching who may edit a job at all.
export const POST = guarded('write', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = ReminderOrderSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid order payload.', 422, { issues: parsed.error.issues });
  }
  await saveJobOrder(parsed.data.order, { user: caller.user, source: caller.source });
  return ok({ order: parsed.data.order });
});
