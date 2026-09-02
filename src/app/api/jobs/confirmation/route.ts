import { guarded, ok, fail } from '@/lib/route-utils';
import { setConfirmation } from '@/lib/job-confirmations';
import { JobConfirmationSchema } from '@/lib/schema';

// Same capability as PATCH /api/jobs/[jobId]: confirming a job for tomorrow
// is editing job-adjacent operational state, gated like any other job edit.
export const POST = guarded('write', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = JobConfirmationSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid confirmation payload.', 422, { issues: parsed.error.issues });
  }
  const record = await setConfirmation(parsed.data, { user: caller.user, source: caller.source });
  return ok({ confirmation: record });
});
