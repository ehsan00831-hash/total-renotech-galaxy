import {
  guarded, ok, fail, searchParams, idempotencyKeyFor, replayGuard,
} from '@/lib/route-utils';
import { addLog, listLogs, rollup } from '@/lib/logs';
import { DailyLogSchema } from '@/lib/schema';

export const GET = guarded('read', async (req) => {
  const jobId = searchParams(req).get('jobId') ?? undefined;
  const logs = await listLogs(jobId);
  return ok({
    logs,
    count: logs.length,
    rollup: jobId && logs.length ? rollup(logs, jobId, logs[0]?.project ?? '') : null,
  });
});

export const POST = guarded('log', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = DailyLogSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid daily log payload.', 422, { issues: parsed.error.issues });
  }
  const key = idempotencyKeyFor(req, caller, 'add_daily_log', parsed.data);
  const replay = await replayGuard(key);
  if (replay) return replay;

  const result = await addLog(parsed.data, {
    user: caller.user, source: caller.source, idempotencyKey: key,
  });
  return ok({ result, idempotencyKey: key });
});
