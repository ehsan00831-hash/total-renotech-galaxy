import { guarded, ok, fail } from '@/lib/route-utils';
import { getJob, upsertJob } from '@/lib/jobs';
import { listLogs, rollup } from '@/lib/logs';
import { JobUpsertSchema } from '@/lib/schema';

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { jobId } = await ctx.params;
  return guarded('read', async () => {
    const job = await getJob(jobId);
    if (!job) return fail('Job not found: ' + jobId, 404);
    const logs = await listLogs(jobId).catch(() => []);
    return ok({
      job,
      logs,
      rollup: logs.length ? rollup(logs, job.jobId, job.customer) : null,
    });
  })(req);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { jobId } = await ctx.params;
  return guarded('write', async (r, caller) => {
    const body = await r.json().catch(() => null);
    const parsed = JobUpsertSchema.safeParse({ ...(body as object), jobId });
    if (!parsed.success) {
      return fail('Invalid job payload.', 422, { issues: parsed.error.issues });
    }
    const result = await upsertJob(parsed.data, {
      user: caller.user,
      source: caller.source,
      idempotencyKey: r.headers.get('idempotency-key') ?? undefined,
    });
    return ok({ result });
  })(req);
}
