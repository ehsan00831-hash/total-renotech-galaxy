import { guarded, ok } from '@/lib/route-utils';
import { listJobs, isActive } from '@/lib/jobs';

const TO_BUY = ['NEED LIST', 'NEED PURCHASE', 'ORDERED'];

/**
 * Materials are not a separate record. Any job carrying a material requirement
 * surfaces here, still linked to the job it came from.
 */
export const GET = guarded('read', async () => {
  const jobs = await listJobs();
  const rows = jobs
    .filter((j) => j.materials.trim() !== '' || TO_BUY.includes(j.materialStatus.toUpperCase()))
    .map((j) => ({
      jobId: j.jobId,
      customer: j.customer,
      fullAddress: j.fullAddress,
      material: j.materials,
      materialStatus: j.materialStatus || 'NONE',
      jobStatus: j.status,
      priority: j.priority,
      scheduledDate: j.scheduledDate,
      truck: j.truck,
      crew: j.teamSummary,
      notes: j.notes,
      row: j.row,
      active: isActive(j),
    }));

  const toBuy = rows.filter((r) => TO_BUY.includes(r.materialStatus.toUpperCase())).length;
  return ok({ materials: rows, count: rows.length, toBuy });
});
