import { guarded, ok } from '@/lib/route-utils';
import { computeKpis, groupCount, listJobs, filterView, isActive } from '@/lib/jobs';
import { listLogs } from '@/lib/logs';
import { listReminders } from '@/lib/reminders';
import { loadTeamFleet } from '@/lib/team';
import {
  businessDay, parseSheetDate, groupReminders, needsCoordination, normKey,
  TOMORROW_PLAN_STATUS,
} from '@/lib/core';
import { listConfirmations } from '@/lib/job-confirmations';
import { displayNameFor, listOpenMentions } from '@/lib/reminder-comments';

export const GET = guarded('read', async (_req, caller) => {
  // Labour hours come from Daily Logs, so the logs are loaded alongside jobs.
  const [jobs, logs, reminders, fleet, confirmations] = await Promise.all([
    listJobs(),
    listLogs().catch(() => []),
    listReminders('active').catch(() => []),
    loadTeamFleet().catch(() => ({ people: [], trucks: [] })),
    listConfirmations().catch(() => new Map()),
  ]);

  // One clock read per request: every window below sees the same instant.
  const now = new Date();
  const kpis = computeKpis(jobs, logs, now);
  const today = businessDay(now);
  const reminderGroups = groupReminders(reminders, now);

  // Tomorrow Plan coordination — the one board status that carries real
  // day-before risk, so the central dashboard surfaces it directly rather
  // than making a coordinator remember to scroll to that board column.
  const tomorrowPlanJobs = jobs.filter((j) => j.status.toUpperCase().trim() === TOMORROW_PLAN_STATUS);
  let proposed = 0;
  let confirmed = 0;
  const needsCoordinationJobs = [];
  for (const j of tomorrowPlanJobs) {
    const c = confirmations.get(normKey(j.jobId));
    const state = c ? { confirmed: c.confirmed, customerConfirmed: c.customerConfirmed, crewConfirmed: c.crewConfirmed }
      : { confirmed: false, customerConfirmed: false, crewConfirmed: false };
    if (!state.confirmed) { proposed++; continue; }
    confirmed++;
    if (needsCoordination(state)) needsCoordinationJobs.push(j);
  }

  const myName = await displayNameFor(caller.user);
  const myMentions = await listOpenMentions(myName).catch(() => []);

  return ok({
    generatedAt: now.toISOString(),
    kpis: {
      ...kpis,
      openReminders: reminders.length,
      overdueReminders: reminders.filter((r) => r.overdue).length,
      availableTrucks: fleet.trucks.filter((t) => t.available).length,
      rosterActive: fleet.people.filter((p) => p.active).length,
    },
    charts: {
      byStatus: groupCount(jobs, (j) => j.status),
      byPriority: groupCount(jobs.filter(isActive), (j) => j.priority),
      byType: groupCount(jobs, (j) => j.projectType),
    },
    // Today's Operations: every active job scheduled for today, carrying
    // crew/truck/time/status so the dashboard needs no second request.
    todayOperations: jobs
      .filter((j) => isActive(j) && parseSheetDate(j.scheduledDate) === today)
      .slice(0, 50),
    urgent: jobs
      .filter((j) => isActive(j) && ['URGENT', 'EMERGENCY'].includes(j.priority.toUpperCase()))
      .slice(0, 10),
    waitingMaterials: filterView(jobs, 'waiting-materials', now).slice(0, 10),
    overdueReminders: reminders.filter((r) => r.overdue).slice(0, 10),
    tomorrowPlan: {
      proposed, confirmed, needsCoordination: needsCoordinationJobs.length,
      needsCoordinationJobs: needsCoordinationJobs.slice(0, 10),
    },
    reminderAlerts: {
      overdue: reminderGroups.overdue.length,
      dueToday: reminderGroups.dueToday.length,
      dueTomorrow: reminderGroups.dueTomorrow.length,
      items: [...reminderGroups.overdue, ...reminderGroups.dueToday, ...reminderGroups.dueTomorrow].slice(0, 10),
    },
    myMentions: myMentions.slice(0, 5),
  });
});
