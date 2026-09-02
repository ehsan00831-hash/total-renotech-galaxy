import {
  guarded, ok, fail, searchParams, idempotencyKeyFor, replayGuard,
} from '@/lib/route-utils';
import { filterView, listJobs, upsertJob, VIEW_KEYS, type ViewKey } from '@/lib/jobs';
import { JobUpsertSchema } from '@/lib/schema';
import { getJobOrder } from '@/lib/job-order';
import { listConfirmations } from '@/lib/job-confirmations';
import { listJobTags } from '@/lib/job-tags';
import { normKey } from '@/lib/core';

export const GET = guarded('read', async (req) => {
  const p = searchParams(req);
  const view = (p.get('view') ?? 'all') as ViewKey;
  if (!VIEW_KEYS.includes(view)) return fail('Unknown view: ' + view);

  const q = (p.get('q') ?? '').toLowerCase().trim();
  const status = p.get('status') ?? '';
  const priority = p.get('priority') ?? '';
  const projectType = p.get('projectType') ?? '';
  const tech = p.get('tech') ?? '';
  const truck = p.get('truck') ?? '';

  let jobs = filterView(await listJobs(), view, new Date());

  if (q) {
    jobs = jobs.filter((j) =>
      [j.jobId, j.customer, j.woNumber, j.poNumber, j.fullAddress, j.scope,
        j.contactName, j.phone, j.teamSummary]
        .join(' ').toLowerCase().includes(q));
  }
  if (status) jobs = jobs.filter((j) => j.status.toUpperCase() === status.toUpperCase());
  if (priority) jobs = jobs.filter((j) => j.priority.toUpperCase() === priority.toUpperCase());
  if (projectType) jobs = jobs.filter((j) => j.projectType.toUpperCase() === projectType.toUpperCase());
  if (tech) jobs = jobs.filter((j) => j.technicians.some((x) => x.toLowerCase() === tech.toLowerCase()));
  if (truck) jobs = jobs.filter((j) => j.truck.toLowerCase() === truck.toLowerCase());

  // The board's manual priority order — bundled here rather than a second
  // request, so the board never flashes an unordered layout before reordering.
  const order = await getJobOrder().catch(() => []);

  // Tomorrow Plan confirmation state, keyed by this response's own job id
  // casing so the client can look it up with a plain `confirmations[jobId]`
  // — normKey matching happens here, server-side only, never in the bundle.
  const confMap = await listConfirmations().catch(() => new Map());
  const confirmations: Record<string, {
    confirmed: boolean; customerConfirmed: boolean; crewConfirmed: boolean;
    customerConfirmedBy: string; crewConfirmedBy: string;
  }> = {};
  for (const j of jobs) {
    const c = confMap.get(j.jobId.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    if (c) {
      confirmations[j.jobId] = {
        confirmed: c.confirmed, customerConfirmed: c.customerConfirmed, crewConfirmed: c.crewConfirmed,
        customerConfirmedBy: c.customerConfirmedBy, crewConfirmedBy: c.crewConfirmedBy,
      };
    }
  }

  // Needs Approval / Needs Estimate — orthogonal to status, so a job can
  // carry them in any column, not just Ongoing.
  const tagMap = await listJobTags().catch(() => new Map());
  const tags: Record<string, { needsApproval: boolean; needsEstimate: boolean }> = {};
  for (const j of jobs) {
    const tg = tagMap.get(normKey(j.jobId));
    if (tg && (tg.needsApproval || tg.needsEstimate)) {
      tags[j.jobId] = { needsApproval: tg.needsApproval, needsEstimate: tg.needsEstimate };
    }
  }

  return ok({ jobs, count: jobs.length, view, order, confirmations, tags });
});

export const POST = guarded('write', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = JobUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid job payload.', 422, { issues: parsed.error.issues });
  }
  const key = idempotencyKeyFor(req, caller, 'create_or_update_job', parsed.data);
  const replay = await replayGuard(key);
  if (replay) return replay;

  const result = await upsertJob(parsed.data, {
    user: caller.user, source: caller.source, idempotencyKey: key,
  });
  return ok({ result, idempotencyKey: key });
});
