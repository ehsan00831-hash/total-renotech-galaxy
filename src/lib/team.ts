/**
 * Team & Fleet master records.
 *
 * The tab stacks two tables with different header rows — personnel headers on
 * row 6, fleet headers on row 50 — so each is read as its own table with its
 * own row budget. Reading both with one header row silently produced empty
 * columns and an undercount.
 */

import {
  FLEET_FIELDS, TABLES, TEAM_FIELDS, type TeamMemberInput, type TeamMemberUpdateInput,
} from './schema';
import { appendRecord, columnsFor, readRecords, updateRow, type SheetRow } from './sheets';
import { recordAudit } from './audit';
import { businessStamp, normKey } from './core';

export type Person = {
  row: number;
  employeeId: string;
  fullName: string;
  displayName: string;
  role: string;
  department: string;
  phone: string;
  email: string;
  status: string;
  defaultTruck: string;
  driverStatus: string;
  supervisor: string;
  startDate: string;
  certifications: string;
  emergency: string;
  notes: string;
  active: boolean;
  isDriver: boolean;
};

export type Truck = {
  row: number;
  truckId: string;
  truckNumber: string;
  description: string;
  plate: string;
  primaryDriver: string;
  backupDriver: string;
  status: string;
  currentProject: string;
  storage: string;
  lastService: string;
  nextMaintenance: string;
  registration: string;
  insurance: string;
  odometer: string;
  notes: string;
  available: boolean;
  isPlaceholder: boolean;
};

/** Rows that are section banners or a repeated header, not real records. */
function isNoise(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === '' ||
    /^table\s*\d/.test(s) ||
    s === 'full name' ||
    s === 'truck number' ||
    s === 'name';
}

function toPerson(r: SheetRow): Person {
  const status = (r.status ?? '').trim().toUpperCase();
  const driver = (r.driverStatus ?? '').trim().toUpperCase();
  return {
    row: r.__row,
    employeeId: r.employeeId ?? '',
    fullName: r.fullName ?? '',
    displayName: r.displayName || r.fullName || '',
    role: r.role ?? '',
    department: r.department ?? '',
    phone: r.phone ?? '',
    email: r.email ?? '',
    status: r.status ?? '',
    defaultTruck: r.defaultTruck ?? '',
    driverStatus: r.driverStatus ?? '',
    supervisor: r.supervisor ?? '',
    startDate: r.startDate ?? '',
    certifications: r.certifications ?? '',
    emergency: r.emergency ?? '',
    notes: r.notes ?? '',
    active: status === 'ACTIVE' || status === 'TEMPORARY',
    isDriver: driver === 'DRIVER',
  };
}

function toTruck(r: SheetRow): Truck {
  const status = (r.status ?? '').trim().toUpperCase();
  const number = r.truckNumber ?? '';
  return {
    row: r.__row,
    truckId: r.truckId ?? '',
    truckNumber: number,
    description: r.description ?? '',
    plate: r.plate ?? '',
    primaryDriver: r.primaryDriver ?? '',
    backupDriver: r.backupDriver ?? '',
    status: r.status ?? '',
    currentProject: r.currentProject ?? '',
    storage: r.storage ?? '',
    lastService: r.lastService ?? '',
    nextMaintenance: r.nextMaintenance ?? '',
    registration: r.registration ?? '',
    insurance: r.insurance ?? '',
    odometer: r.odometer ?? '',
    notes: r.notes ?? '',
    available: status === 'AVAILABLE',
    isPlaceholder: /office|^tbd$/i.test(number),
  };
}

export async function loadTeamFleet(): Promise<{ people: Person[]; trucks: Truck[] }> {
  const [peopleRes, trucksRes] = await Promise.all([
    readRecords(TABLES.TEAM, TEAM_FIELDS, 'fullName')
      .catch(() => ({ rows: [] as SheetRow[] })),
    readRecords(TABLES.FLEET, FLEET_FIELDS, 'truckNumber')
      .catch(() => ({ rows: [] as SheetRow[] })),
  ]);

  const people = peopleRes.rows
    .map(toPerson)
    .filter((p) => !isNoise(p.fullName));

  const trucks = trucksRes.rows
    .map(toTruck)
    .filter((t) => !isNoise(t.truckNumber));

  return { people, trucks };
}

/**
 * Add a new person to the roster.
 *
 * Refuses a duplicate full name rather than creating a second row for the
 * same person — a genuine correction goes through the Team & Fleet sheet
 * directly, same as every other field this module doesn't expose a writer for.
 */
export async function addPerson(
  input: TeamMemberInput,
  ctx: { user: string; source: string },
): Promise<Person> {
  const { people } = await loadTeamFleet();
  const key = normKey(input.fullName);
  if (people.some((p) => normKey(p.fullName) === key)) {
    throw new Error(`"${input.fullName}" is already on the roster.`);
  }

  const { row } = await appendRecord(TABLES.TEAM, TEAM_FIELDS, 'fullName', {
    fullName: input.fullName,
    role: input.role,
    department: input.department,
    phone: input.phone,
    email: input.email,
    status: input.status ?? 'ACTIVE',
    notes: input.notes,
    lastUpdated: businessStamp(new Date()),
  });

  await recordAudit({
    user: ctx.user, source: ctx.source, action: 'add_team_member',
    sheet: TABLES.TEAM.sheet, row, field: 'fullName', prev: '', next: input.fullName, result: 'ok',
  });

  const { people: fresh } = await loadTeamFleet();
  const created = fresh.find((p) => p.row === row);
  if (!created) throw new Error('Added, but could not be read back.');
  return created;
}

/**
 * Fill in blank fields on an existing person — matched by exact full name.
 * Only touches fields the caller actually supplied; never overwrites a
 * field that already has a value, so a genuine correction still has to go
 * through the Team & Fleet sheet directly, same as every other edit this
 * module doesn't expose a writer for.
 */
export async function updatePerson(
  input: TeamMemberUpdateInput,
  ctx: { user: string; source: string },
): Promise<Person> {
  const { people } = await loadTeamFleet();
  const key = normKey(input.fullName);
  const existing = people.find((p) => normKey(p.fullName) === key);
  if (!existing) throw new Error(`"${input.fullName}" is not on the roster.`);

  const patch: Record<string, string> = {};
  const already: string[] = [];
  for (const [field, value] of Object.entries({
    role: input.role, department: input.department, phone: input.phone,
    email: input.email, status: input.status, notes: input.notes,
  })) {
    if (value === undefined) continue;
    const current = (existing as unknown as Record<string, string>)[field] ?? '';
    if (current.trim() !== '' && !input.force) { already.push(field); continue; }
    patch[field] = value;
  }
  if (already.length) {
    throw new Error(
      `${existing.fullName} already has a value for: ${already.join(', ')}. ` +
      'Refusing to overwrite — correct it on the Team & Fleet sheet directly, ' +
      'or resend with force:true to intentionally replace it.',
    );
  }
  if (!Object.keys(patch).length) return existing;

  patch.lastUpdated = businessStamp(new Date());
  const { cols } = await columnsFor(TABLES.TEAM, TEAM_FIELDS);
  await updateRow(TABLES.TEAM, existing.row, cols, patch);

  await recordAudit({
    user: ctx.user, source: ctx.source, action: 'update_team_member',
    sheet: TABLES.TEAM.sheet, row: existing.row, field: Object.keys(patch).join(','),
    prev: '', next: Object.values(patch).join(' | '), result: 'ok',
  });

  const { people: fresh } = await loadTeamFleet();
  return fresh.find((p) => p.row === existing.row) ?? existing;
}

/** Names offered in crew selectors: active people, plus the permanent specials. */
export function crewOptions(people: Person[]): string[] {
  const active = people.filter((p) => p.active).map((p) => p.displayName || p.fullName);
  return [...new Set([...active, 'OTHER', 'TBD'])];
}

/** Drivers offered where a driver specifically is required. */
export function driverOptions(people: Person[]): string[] {
  const drivers = people
    .filter((p) => p.active && p.isDriver)
    .map((p) => p.displayName || p.fullName);
  return [...new Set([...drivers, 'OTHER', 'TBD'])];
}

/** Trucks offered in selectors: anything not out of service. */
export function truckOptions(trucks: Truck[]): string[] {
  const usable = trucks
    .filter((t) => (t.status || '').toUpperCase() !== 'OUT OF SERVICE')
    .map((t) => t.truckNumber);
  return [...new Set([...usable, 'OTHER'])];
}
