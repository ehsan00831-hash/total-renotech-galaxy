/**
 * Daily logs for long projects, plus the roll-up a project needs at completion.
 * Labour maths: hours per person = (out - in) - break; person-hours = crew x hours.
 */

import { LOG_FIELDS, TABLES, SHEETS, type DailyLogInput } from './schema';
import { appendRecord, readRecords, type SheetRow } from './sheets';
import { priorApplication, recordAudit } from './audit';
import {
  parseSheetDate, parseClock as coreParseClock,
  hoursPerPerson as coreHoursPerPerson, rollupProject,
} from './core';

export type DailyLog = {
  row: number;
  logId: string;
  workDate: string;
  jobId: string;
  project: string;
  location: string;
  truck: string;
  technicians: string[];
  teamSummary: string;
  crewCount: number;
  clockIn: string;
  clockOut: string;
  breakMin: number;
  hoursPerPerson: number;
  totalHours: number;
  workCompleted: string;
  materialsUsed: string;
  issues: string;
  photos: string;
  nextStep: string;
  dailyStatus: string;
  supervisor: string;
  verified: string;
  notes: string;
};

const TECHS = ['tech1', 'tech2', 'tech3', 'tech4', 'tech5'] as const;

function num(v: string): number {
  const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export const parseClock = coreParseClock;

export const hoursPerPerson = coreHoursPerPerson;

function toLog(r: SheetRow): DailyLog {
  const technicians = TECHS.map((f) => (r[f] ?? '').trim()).filter(Boolean);
  const crewCount = num(r.crewCount) || technicians.length;
  const hpp = num(r.hoursPerPerson) || hoursPerPerson(r.clockIn ?? '', r.clockOut ?? '', num(r.breakMin));
  return {
    row: r.__row,
    logId: r.logId ?? '',
    workDate: r.workDate ?? '',
    jobId: r.jobId ?? '',
    project: r.project ?? '',
    location: r.location ?? '',
    truck: r.truck ?? '',
    technicians,
    teamSummary: r.teamSummary || technicians.join(', '),
    crewCount,
    clockIn: r.clockIn ?? '',
    clockOut: r.clockOut ?? '',
    breakMin: num(r.breakMin),
    hoursPerPerson: hpp,
    totalHours: num(r.totalHours) || Math.round(crewCount * hpp * 100) / 100,
    workCompleted: r.workCompleted ?? '',
    materialsUsed: r.materialsUsed ?? '',
    issues: r.issues ?? '',
    photos: r.photos ?? '',
    nextStep: r.nextStep ?? '',
    dailyStatus: r.dailyStatus ?? '',
    supervisor: r.supervisor ?? '',
    verified: r.verified ?? '',
    notes: r.notes ?? '',
  };
}

export async function listLogs(jobId?: string): Promise<DailyLog[]> {
  const { rows } = await readRecords(TABLES.DAILY_LOGS, LOG_FIELDS, 'workDate');
  const logs = rows.map(toLog);
  const filtered = jobId
    ? logs.filter((l) => l.jobId.toLowerCase() === jobId.toLowerCase())
    : logs;
  return filtered.sort((a, b) => (parseSheetDate(b.workDate) ?? '').localeCompare(parseSheetDate(a.workDate) ?? ''));
}

export async function addLog(
  input: DailyLogInput,
  ctx: { user: string; source: string; idempotencyKey?: string },
): Promise<{ row: number; logId: string; totalHours: number }> {
  const replay = await priorApplication(ctx.idempotencyKey);
  const existing = await listLogs();

  if (replay) {
    const prior = existing.find((l) => l.row === replay.row);
    return { row: replay.row, logId: '', totalHours: prior?.totalHours ?? 0 };
  }

  // One row per project per day: an existing entry for the same job and date is patched.
  const day = parseSheetDate(input.workDate);
  const dup = existing.find(
    (l) => parseSheetDate(l.workDate) === day &&
           (input.jobId ? l.jobId.toLowerCase() === input.jobId.toLowerCase() : false),
  );

  const techs = input.technicians ?? [];
  const crew = techs.length;
  const hpp = hoursPerPerson(input.clockIn ?? '', input.clockOut ?? '', input.breakMin ?? 0);
  const total = Math.round(crew * hpp * 100) / 100;

  const record: Record<string, string | number | undefined> = {
    workDate: input.workDate,
    jobId: input.jobId,
    project: input.project,
    location: input.location,
    truck: input.truck,
    tech1: techs[0] ?? '', tech2: techs[1] ?? '', tech3: techs[2] ?? '',
    tech4: techs[3] ?? '', tech5: techs[4] ?? '',
    teamSummary: techs.join(', '),
    crewCount: crew || undefined,
    clockIn: input.clockIn,
    clockOut: input.clockOut,
    breakMin: input.breakMin,
    hoursPerPerson: hpp || undefined,
    totalHours: total || undefined,
    workCompleted: input.workCompleted,
    materialsUsed: input.materialsUsed,
    issues: input.issues,
    photos: input.photos,
    nextStep: input.nextStep,
    supervisor: input.supervisor,
    notes: input.notes,
  };

  if (dup) {
    const { updateRow, columnsFor } = await import('./sheets');
    const { cols } = await columnsFor(TABLES.DAILY_LOGS, LOG_FIELDS);
    await updateRow(TABLES.DAILY_LOGS, dup.row, cols, record);
    await recordAudit({
      user: ctx.user, source: ctx.source, action: 'update_daily_log',
      sheet: SHEETS.DAILY_LOGS, row: dup.row, field: 'totalHours',
      prev: String(dup.totalHours), next: String(total), result: 'ok',
      idempotencyKey: ctx.idempotencyKey,
    });
    return { row: dup.row, logId: dup.logId, totalHours: total };
  }

  const { row } = await appendRecord(TABLES.DAILY_LOGS, LOG_FIELDS, 'workDate', record);
  await recordAudit({
    user: ctx.user, source: ctx.source, action: 'add_daily_log',
    sheet: SHEETS.DAILY_LOGS, row, field: 'workDate', prev: '', next: input.workDate,
    result: 'ok', idempotencyKey: ctx.idempotencyKey,
  });
  return { row, logId: '', totalHours: total };
}

export type ProjectRollup = {
  jobId: string;
  project: string;
  workingDays: number;
  workers: number;
  totalPersonHours: number;
  avgCrew: number;
  materials: string[];
  startDate: string;
  endDate: string;
};

export function rollup(logs: DailyLog[], jobId: string, project: string): ProjectRollup {
  return { jobId, project, ...rollupProject(logs) };
}
