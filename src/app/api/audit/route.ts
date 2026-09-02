import { guarded, ok, fail, searchParams } from '@/lib/route-utils';
import { listAudit, undoAudit } from '@/lib/audit';

export const GET = guarded('audit', async (req) => {
  const raw = Number(searchParams(req).get('limit') ?? 100);
  const entries = await listAudit(Number.isFinite(raw) ? raw : 100);
  return ok({ entries, count: entries.length });
});

export const POST = guarded('undo', async (req, caller) => {
  const body = (await req.json().catch(() => null)) as { auditId?: string } | null;
  if (!body?.auditId) return fail('auditId is required.', 422);
  const message = await undoAudit(body.auditId, caller.user);
  return ok({ message });
});
