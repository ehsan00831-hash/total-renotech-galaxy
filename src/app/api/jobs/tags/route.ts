import { guarded, ok, fail } from '@/lib/route-utils';
import { setJobTags } from '@/lib/job-tags';
import { JobTagsSchema } from '@/lib/schema';

// Same capability as PATCH /api/jobs/[jobId]: tagging a job is editing
// job-adjacent operational state, gated like any other job edit.
export const POST = guarded('write', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = JobTagsSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid tags payload.', 422, { issues: parsed.error.issues });
  }
  const record = await setJobTags(parsed.data, { user: caller.user, source: caller.source });
  return ok({ tags: record });
});
