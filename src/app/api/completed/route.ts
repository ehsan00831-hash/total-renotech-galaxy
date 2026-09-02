import { guarded, ok, fail, searchParams } from '@/lib/route-utils';
import { filterCompleted, completedTotals, listJobs, completionDate } from '@/lib/jobs';
import { listLogs } from '@/lib/logs';
import type { CompletedRange } from '@/lib/core';

const RANGES: CompletedRange[] = ['today', 'week', 'month', 'archive', 'all'];

/**
 * Completed work for one window.
 *
 * The window is measured on Project End (falling back to Last Updated), and
 * person-hours come from the Daily Logs rows belonging to these jobs — the
 * workbook's Total Labor Hours is already person-hours.
 */
export const GET = guarded('read', async (req) => {
  const range = (searchParams(req).get('range') ?? 'month') as CompletedRange;
  if (!RANGES.includes(range)) return fail('Unknown range: ' + range);

  const now = new Date();
  const [jobs, logs] = await Promise.all([listJobs(), listLogs().catch(() => [])]);
  const selected = filterCompleted(jobs, range, now);

  return ok({
    range,
    jobs: selected.map((j) => ({ ...j, completedOn: completionDate(j) })),
    count: selected.length,
    totals: completedTotals(selected, logs),
  });
});
