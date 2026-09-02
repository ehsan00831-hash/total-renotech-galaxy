/**
 * Workbook schema.
 *
 * The live workbook keeps changing shape (sheets get added, columns get
 * reordered), so nothing here hard-codes a column index. Every field declares
 * header patterns and the data layer resolves them against the real header row
 * at request time. `expected` records the position verified on 2026-08-23 and
 * is used only for diagnostics, never for reads.
 */

import { z } from 'zod';
import {
  normHeader as coreNormHeader, READONLY_VIEWS as CORE_READONLY,
  assertReminderPriority, assertReminderStatus,
} from './core';

/** Default header row. Most sheets use row 5 with data from row 6. */
export const HEADER_ROW = 5;
export const FIRST_DATA_ROW = 6;

/**
 * Where a table actually starts. Team & Fleet stacks two tables on one tab
 * with different header rows, so a single workbook-wide constant is wrong.
 */
export type TableSpec = {
  sheet: string;
  headerRow: number;
  firstDataRow: number;
  /** Hard row budget, so the second table cannot bleed into the first. */
  maxRows?: number;
};

export const SHEETS = {
  DASHBOARD: 'Dashboard',
  ALL_JOBS: 'All Jobs',
  UPCOMING: 'Upcoming',
  TOMORROW: 'Tomorrow Plan',
  ONGOING: 'Ongoing',
  DONE: 'Done',
  COMPLETED_ARCHIVE: 'Completed Archive',
  MATERIALS: 'Materials',
  LONG_PROJECTS: 'Long Projects',
  DAILY_LOGS: 'Daily Logs',
  ACTIVE_REMINDERS: 'ACTIVE REMINDERS',
  ARCHIVE: 'ARCHIVE',
  REMINDER_COMMENTS: 'Reminder Comments',
  REMINDER_ORDER: 'Reminder Order',
  JOB_CONFIRMATIONS: 'Job Confirmations',
  JOB_TAGS: 'Job Tags',
  TEAM_FLEET: 'Team & Fleet',
  SETTINGS: 'Settings & Lists',
  AUDIT: '_TRT_AUDIT_LOG',
} as const;

/** Sheets that are formula-driven views — never written to. */
export const READONLY_VIEWS: string[] = CORE_READONLY;

/**
 * Table layouts as they exist in the live workbook.
 *
 * Team & Fleet stacks two tables on one tab: personnel headers on row 6 and
 * fleet headers on row 50. Each table gets a hard row budget so the personnel
 * read cannot run into the fleet header, and vice versa.
 */
export const TABLES = {
  ALL_JOBS:  { sheet: SHEETS.ALL_JOBS,  headerRow: 5,  firstDataRow: 6,  maxRows: 150 },
  DAILY_LOGS:{ sheet: SHEETS.DAILY_LOGS, headerRow: 5, firstDataRow: 6,  maxRows: 300 },
  REMINDERS: { sheet: SHEETS.ACTIVE_REMINDERS, headerRow: 5, firstDataRow: 6, maxRows: 200 },
  ARCHIVE:   { sheet: SHEETS.ARCHIVE,   headerRow: 5,  firstDataRow: 6,  maxRows: 200 },
  // New tabs, created on first use via ensureSheet — never touches ACTIVE
  // REMINDERS or any other existing tab or column.
  REMINDER_COMMENTS: { sheet: SHEETS.REMINDER_COMMENTS, headerRow: 5, firstDataRow: 6, maxRows: 4000 },
  // Always exactly one data row: the whole manual priority order as one JSON
  // array, rather than one row per reminder — cheap to read and to overwrite
  // atomically after a drag.
  REMINDER_ORDER:    { sheet: SHEETS.REMINDER_ORDER,    headerRow: 5, firstDataRow: 6, maxRows: 2 },
  JOB_CONFIRMATIONS:{ sheet: SHEETS.JOB_CONFIRMATIONS, headerRow: 5, firstDataRow: 6, maxRows: 300 },
  JOB_TAGS:         { sheet: SHEETS.JOB_TAGS,         headerRow: 5, firstDataRow: 6, maxRows: 300 },
  TEAM:      { sheet: SHEETS.TEAM_FLEET, headerRow: 6,  firstDataRow: 7,  maxRows: 40 },
  FLEET:     { sheet: SHEETS.TEAM_FLEET, headerRow: 50, firstDataRow: 51, maxRows: 20 },
  SETTINGS:  { sheet: SHEETS.SETTINGS,  headerRow: 5,  firstDataRow: 6,  maxRows: 120 },
  AUDIT:     { sheet: SHEETS.AUDIT,     headerRow: 5,  firstDataRow: 6,  maxRows: 5000 },
} as const satisfies Record<string, TableSpec>;

/**
 * The completed-history tab currently shows a blank title in the workbook.
 * Resolve it by sheet id rather than by name, and never rename it.
 */
export const COMPLETED_ARCHIVE_SHEET_ID = 2026082401;

/** Header signature used to confirm a sheet is the completed-history tab. */
export const COMPLETED_ARCHIVE_SIGNATURE = ['job id', 'client', 'status'];

export type FieldSpec = { patterns: RegExp[]; expected?: string };

/** Re-exported so callers have one import for schema concerns. */
export const normHeader = coreNormHeader;

/* ------------------------------------------------------------------ *
 * ALL JOBS — the canonical job record
 * ------------------------------------------------------------------ */

export const JOB_FIELDS: Record<string, FieldSpec> = {
  jobId:        { patterns: [/^job\s*id$/, /^id$/], expected: 'A' },
  customer:     { patterns: [/^client\s*\/?\s*store/, /^client/, /^customer/], expected: 'B' },
  projectType:  { patterns: [/project\s*type/, /^type$/], expected: 'C' },
  // The live sheet owns this column and it already contains the city.
  fullAddress:  { patterns: [/^full\s*address/, /^address/], expected: 'D' },
  city:         { patterns: [/^city/], expected: 'E' },
  unit:         { patterns: [/^unit/], expected: 'F' },
  contactName:  { patterns: [/contact\s*name/, /^contact$/], expected: 'G' },
  phone:        { patterns: [/^phone/, /^tel/], expected: 'H' },
  email:        { patterns: [/^e-?mail/], expected: 'I' },
  woNumber:     { patterns: [/^wo\s*#?/, /work\s*order/], expected: 'J' },
  poNumber:     { patterns: [/^po\s*#?/, /purchase\s*order/], expected: 'K' },
  scope:        { patterns: [/scope\s*of\s*work/, /^scope/], expected: 'L' },
  priority:     { patterns: [/^priority/], expected: 'M' },
  status:       { patterns: [/^status$/], expected: 'N' },
  scheduledDate:{ patterns: [/schedul\w*\s*date/, /^date\s*schedul/], expected: 'O' },
  arrivalWindow:{ patterns: [/arrival\s*window/, /^arrival/], expected: 'P' },
  actualStart:  { patterns: [/actual\s*start/], expected: 'Q' },
  actualEnd:    { patterns: [/actual\s*end/, /actual\s*finish/], expected: 'R' },
  truck:        { patterns: [/^truck/, /^vehicle/], expected: 'S' },
  tech1:        { patterns: [/tech\w*\s*1\b/], expected: 'T' },
  tech2:        { patterns: [/tech\w*\s*2\b/], expected: 'U' },
  tech3:        { patterns: [/tech\w*\s*3\b/], expected: 'V' },
  tech4:        { patterns: [/tech\w*\s*4\b/], expected: 'W' },
  tech5:        { patterns: [/tech\w*\s*5\b/], expected: 'X' },
  teamSummary:  { patterns: [/team\s*summary/], expected: 'Y' },
  crewCount:    { patterns: [/crew\s*count/], expected: 'Z' },
  hoursPerPerson:{ patterns: [/hours?\s*\/?\s*person/, /hours?\s*per\s*person/], expected: 'AA' },
  totalHours:   { patterns: [/total\s*lab(?:o|ou)r\s*hours?/, /^total\s*hours?/], expected: 'AB' },
  materials:    { patterns: [/^materials?$/], expected: 'AC' },
  materialStatus:{ patterns: [/material\s*status/], expected: 'AD' },
  longProject:  { patterns: [/^long\s*project/], expected: 'AE' },
  projectStart: { patterns: [/project\s*start/], expected: 'AF' },
  // Authoritative completion date on this workbook, matched ahead of any
  // generic "completed date" header.
  projectEnd:   { patterns: [/project\s*end/, /completion\s*date/], expected: 'AG' },
  latestReport: { patterns: [/latest\s*work\s*report/, /work\s*report/], expected: 'AH' },
  photosLink:   { patterns: [/photos?\s*\/?\s*docs?/, /^photos?/], expected: 'AI' },
  clientSignature:{ patterns: [/client\s*signature/, /^signature/], expected: 'AJ' },
  checkInOut:   { patterns: [/check\s*-?\s*in\s*\/?\s*out/], expected: 'AK' },
  invoiceStatus:{ patterns: [/invoice\s*status/, /^invoice/], expected: 'AL' },
  paymentStatus:{ patterns: [/payment\s*status/, /^payment/], expected: 'AM' },
  followUpDate: { patterns: [/follow\s*-?\s*up\s*date/, /^follow\s*-?\s*up$/], expected: 'AN' },
  reminderType: { patterns: [/reminder\s*type/], expected: 'AO' },
  notes:        { patterns: [/^notes?$/, /internal\s*notes?/], expected: 'AP' },
  lastUpdated:  { patterns: [/last\s*updated/], expected: 'AQ' },
  createdBy:    { patterns: [/created\s*by/], expected: 'AR' },
  requiredAction:{ patterns: [/required\s*action/] },
  clientNotes:  { patterns: [/client\s*notes?/] },
  createdDate:  { patterns: [/created\s*date/, /date\s*created/] },
  updatedBy:    { patterns: [/updated\s*by/] },
};

export type JobField = keyof typeof JOB_FIELDS;

/* ------------------------------------------------------------------ *
 * REMINDERS — the 16-field compact structure
 * ------------------------------------------------------------------ */

export const REMINDER_FIELDS: Record<string, FieldSpec> = {
  id:            { patterns: [/^id$/, /reminder\s*id/] },
  dateAdded:     { patterns: [/date\s*added/, /^added/] },
  category:      { patterns: [/^category/, /reminder\s*type/] },
  customer:      { patterns: [/customer\s*\/?\s*project/, /^customer/, /^client/, /^project$/] },
  requiredAction:{ patterns: [/required\s*action/, /^action/] },
  assignedTo:    { patterns: [/assigned\s*to/, /^owner/, /^assignee/] },
  priority:      { patterns: [/^priority/] },
  status:        { patterns: [/^status$/] },
  dueAt:         { patterns: [/due\s*date\s*&?\s*time/, /^due\s*date/, /^due$/] },
  nextFollowUp:  { patterns: [/next\s*follow\s*-?\s*up/, /follow\s*-?\s*up/] },
  contactAddress:{ patterns: [/contact\s*&?\s*address/, /^contact/, /^address/] },
  reference:     { patterns: [/related\s*file/, /reference/, /^file/] },
  amount:        { patterns: [/payment\s*\/?\s*amount/, /^amount/, /^payment/] },
  waitingFor:    { patterns: [/waiting\s*for/, /latest\s*response/] },
  notes:         { patterns: [/notes?\s*\/?\s*links?/, /^notes?$/] },
  lastUpdated:   { patterns: [/last\s*updated/] },
};


/* ------------------------------------------------------------------ *
 * REMINDER COMMENTS — comment/mention thread, one row per comment
 * ------------------------------------------------------------------ */

export const REMINDER_COMMENT_HEADERS = [
  'Comment ID', 'Reminder ID', 'Author', 'Author Email', 'Text', 'Mentions',
  'Action Done', 'Done By', 'Done At', 'Created At',
];

export const REMINDER_COMMENT_FIELDS: Record<string, FieldSpec> = {
  commentId:  { patterns: [/comment\s*id/] },
  reminderId: { patterns: [/reminder\s*id/] },
  author:     { patterns: [/^author$/] },
  authorEmail:{ patterns: [/author\s*email/] },
  text:       { patterns: [/^text$/] },
  mentions:   { patterns: [/^mentions?$/] },
  actionDone: { patterns: [/action\s*done/] },
  doneBy:     { patterns: [/done\s*by/] },
  doneAt:     { patterns: [/done\s*at/] },
  createdAt:  { patterns: [/created\s*at/] },
};

/* ------------------------------------------------------------------ *
 * REMINDER ORDER — one JSON row holding the whole manual priority order
 * ------------------------------------------------------------------ */

export const REMINDER_ORDER_HEADERS = ['ID', 'Order JSON', 'Updated By', 'Updated At'];

export const REMINDER_ORDER_FIELDS: Record<string, FieldSpec> = {
  id:        { patterns: [/^id$/] },
  orderJson: { patterns: [/order\s*json/] },
  updatedBy: { patterns: [/updated\s*by/] },
  updatedAt: { patterns: [/updated\s*at/] },
};

/* ------------------------------------------------------------------ *
 * JOB CONFIRMATIONS — the Tomorrow Plan proposed → confirmed workflow,
 * one row per job that has ever been touched by it. Created on first use,
 * never touches All Jobs.
 * ------------------------------------------------------------------ */

export const JOB_CONFIRMATION_HEADERS = [
  'Job ID', 'Confirmed', 'Customer Confirmed', 'Customer Confirmed By', 'Customer Confirmed At',
  'Crew Confirmed', 'Crew Confirmed By', 'Crew Confirmed At', 'Updated By', 'Updated At',
];

export const JOB_CONFIRMATION_FIELDS: Record<string, FieldSpec> = {
  jobId:               { patterns: [/job\s*id/] },
  confirmed:           { patterns: [/^confirmed$/] },
  customerConfirmed:   { patterns: [/customer\s*confirmed$/] },
  customerConfirmedBy: { patterns: [/customer\s*confirmed\s*by/] },
  customerConfirmedAt: { patterns: [/customer\s*confirmed\s*at/] },
  crewConfirmed:       { patterns: [/crew\s*confirmed$/] },
  crewConfirmedBy:     { patterns: [/crew\s*confirmed\s*by/] },
  crewConfirmedAt:     { patterns: [/crew\s*confirmed\s*at/] },
  updatedBy:           { patterns: [/updated\s*by/] },
  updatedAt:           { patterns: [/updated\s*at/] },
};

/* ------------------------------------------------------------------ *
 * JOB TAGS — lightweight operational flags orthogonal to status (a job
 * stays ONGOING while also flagged as blocked on approval or an estimate).
 * One row per job that has ever carried a tag. Created on first use.
 * ------------------------------------------------------------------ */

export const JOB_TAG_HEADERS = [
  'Job ID', 'Needs Approval', 'Needs Estimate', 'Updated By', 'Updated At',
];

export const JOB_TAG_FIELDS: Record<string, FieldSpec> = {
  jobId:         { patterns: [/job\s*id/] },
  needsApproval: { patterns: [/needs\s*approval/] },
  needsEstimate: { patterns: [/needs\s*estimate/] },
  updatedBy:     { patterns: [/updated\s*by/] },
  updatedAt:     { patterns: [/updated\s*at/] },
};

/* ------------------------------------------------------------------ *
 * DAILY LOGS
 * ------------------------------------------------------------------ */

export const LOG_FIELDS: Record<string, FieldSpec> = {
  logId:       { patterns: [/^log\s*id/], expected: 'A' },
  workDate:    { patterns: [/^work\s*date/, /^date$/], expected: 'B' },
  jobId:       { patterns: [/^job\s*id/], expected: 'C' },
  project:     { patterns: [/client\s*\/?\s*project/, /^project/], expected: 'D' },
  location:    { patterns: [/^location/], expected: 'E' },
  truck:       { patterns: [/^truck/], expected: 'F' },
  tech1:       { patterns: [/tech\w*\s*1\b/], expected: 'G' },
  tech2:       { patterns: [/tech\w*\s*2\b/], expected: 'H' },
  tech3:       { patterns: [/tech\w*\s*3\b/], expected: 'I' },
  tech4:       { patterns: [/tech\w*\s*4\b/], expected: 'J' },
  tech5:       { patterns: [/tech\w*\s*5\b/], expected: 'K' },
  teamSummary: { patterns: [/team\s*summary/], expected: 'L' },
  crewCount:   { patterns: [/crew\s*count/], expected: 'M' },
  clockIn:     { patterns: [/clock\s*-?\s*in/, /start\s*time/], expected: 'N' },
  clockOut:    { patterns: [/clock\s*-?\s*out/, /end\s*time/], expected: 'O' },
  breakMin:    { patterns: [/^break/], expected: 'P' },
  hoursPerPerson:{ patterns: [/hours?\s*\/?\s*person/], expected: 'Q' },
  totalHours:  { patterns: [/total\s*lab(?:o|ou)r\s*hours?/, /total\s*person/], expected: 'R' },
  workCompleted:{ patterns: [/work\s*completed/], expected: 'S' },
  materialsUsed:{ patterns: [/materials?\s*used/], expected: 'T' },
  issues:      { patterns: [/issues?\s*\/?\s*delays?/, /problems?/], expected: 'U' },
  photos:      { patterns: [/photos?\s*\/?\s*docs?/], expected: 'V' },
  nextStep:    { patterns: [/next\s*step/, /next\s*required/], expected: 'W' },
  dailyStatus: { patterns: [/daily\s*status/], expected: 'X' },
  supervisor:  { patterns: [/^supervisor/], expected: 'Y' },
  verified:    { patterns: [/^verified/, /client\s*approval/], expected: 'Z' },
  notes:       { patterns: [/^notes?$/], expected: 'AA' },
};

/* ------------------------------------------------------------------ *
 * TEAM & FLEET
 * ------------------------------------------------------------------ */

export const TEAM_FIELDS: Record<string, FieldSpec> = {
  employeeId:  { patterns: [/employee\s*id/] },
  fullName:    { patterns: [/full\s*name/, /^name$/] },
  displayName: { patterns: [/display\s*name/, /preferred/] },
  role:        { patterns: [/^role/] },
  department:  { patterns: [/^department/] },
  phone:       { patterns: [/^phone/] },
  email:       { patterns: [/^e-?mail/] },
  status:      { patterns: [/employment\s*status/, /^status$/] },
  defaultTruck:{ patterns: [/default\s*truck/] },
  driverStatus:{ patterns: [/driver\s*status/] },
  supervisor:  { patterns: [/^supervisor/] },
  startDate:   { patterns: [/start\s*date/] },
  certifications:{ patterns: [/certification/] },
  emergency:   { patterns: [/emergency\s*contact/] },
  notes:       { patterns: [/^notes?$/] },
  lastUpdated: { patterns: [/last\s*updated/] },
};

export const FLEET_FIELDS: Record<string, FieldSpec> = {
  truckId:     { patterns: [/truck\s*id/] },
  truckNumber: { patterns: [/truck\s*number/, /^truck$/] },
  description: { patterns: [/vehicle\s*description/, /^description/] },
  plate:       { patterns: [/licence\s*plate/, /license\s*plate/, /^plate/] },
  primaryDriver:{ patterns: [/primary\s*driver/] },
  backupDriver:{ patterns: [/backup\s*driver/] },
  status:      { patterns: [/operational\s*status/, /^status$/] },
  currentProject:{ patterns: [/current\s*project/] },
  storage:     { patterns: [/storage\s*location/, /^location/] },
  lastService: { patterns: [/last\s*service/] },
  nextMaintenance:{ patterns: [/next\s*maintenance/] },
  registration:{ patterns: [/registration\s*renewal/] },
  insurance:   { patterns: [/insurance\s*renewal/] },
  odometer:    { patterns: [/^odometer/] },
  equipmentNotes:{ patterns: [/equipment\s*notes/] },
  notes:       { patterns: [/^notes?$/] },
  lastUpdated: { patterns: [/last\s*updated/] },
};

/* ------------------------------------------------------------------ *
 * ZOD — request validation
 * ------------------------------------------------------------------ */

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

export const JobUpsertSchema = z.object({
  jobId: z.preprocess(emptyToUndef, z.string().trim().max(64).optional()),
  customer: z.preprocess(emptyToUndef, z.string().trim().max(200).optional()),
  projectType: z.preprocess(emptyToUndef, z.string().trim().max(64).optional()),
  // The app sends one Full Address; the repository decomposes it into the
  // sheet's three columns. Explicit parts still win when supplied.
  fullAddress: z.preprocess(emptyToUndef, z.string().trim().max(400).optional()),
  city: z.preprocess(emptyToUndef, z.string().trim().max(120).optional()),
  unit: z.preprocess(emptyToUndef, z.string().trim().max(60).optional()),
  contactName: z.preprocess(emptyToUndef, z.string().trim().max(120).optional()),
  phone: z.preprocess(emptyToUndef, z.string().trim().max(60).optional()),
  email: z.preprocess(emptyToUndef, z.string().trim().max(160).optional()),
  woNumber: z.preprocess(emptyToUndef, z.string().trim().max(60).optional()),
  poNumber: z.preprocess(emptyToUndef, z.string().trim().max(60).optional()),
  scope: z.preprocess(emptyToUndef, z.string().trim().max(4000).optional()),
  requiredAction: z.preprocess(emptyToUndef, z.string().trim().max(2000).optional()),
  priority: z.preprocess(emptyToUndef, z.string().trim().max(32).optional()),
  status: z.preprocess(emptyToUndef, z.string().trim().max(48).optional()),
  scheduledDate: z.preprocess(emptyToUndef, z.string().trim().max(32).optional()),
  arrivalWindow: z.preprocess(emptyToUndef, z.string().trim().max(32).optional()),
  actualStart: z.preprocess(emptyToUndef, z.string().trim().max(32).optional()),
  actualEnd: z.preprocess(emptyToUndef, z.string().trim().max(32).optional()),
  truck: z.preprocess(emptyToUndef, z.string().trim().max(64).optional()),
  technicians: z.array(z.string().trim().max(80)).max(5).optional(),
  materials: z.preprocess(emptyToUndef, z.string().trim().max(2000).optional()),
  materialStatus: z.preprocess(emptyToUndef, z.string().trim().max(48).optional()),
  longProject: z.preprocess(emptyToUndef, z.string().trim().max(8).optional()),
  followUpDate: z.preprocess(emptyToUndef, z.string().trim().max(32).optional()),
  notes: z.preprocess(emptyToUndef, z.string().trim().max(4000).optional()),
  // Written when a job is completed. Never inferred from the scheduled date.
  projectEnd: z.preprocess(emptyToUndef, z.string().trim().max(32).optional()),
});
export type JobUpsert = z.infer<typeof JobUpsertSchema>;

export const ReminderUpsertSchema = z.object({
  id: z.preprocess(emptyToUndef, z.string().trim().max(64).optional()),
  category: z.preprocess(emptyToUndef, z.string().trim().max(80).optional()),
  customer: z.preprocess(emptyToUndef, z.string().trim().max(200).optional()),
  requiredAction: z.preprocess(emptyToUndef, z.string().trim().max(2000).optional()),
  assignedTo: z.preprocess(emptyToUndef, z.string().trim().max(120).optional()),
  // Canonicalised here so a caller sending "in progress" succeeds and a caller
  // sending an invented status gets a 400 naming the allowed values, rather
  // than a 500 from the write layer.
  priority: z.preprocess(emptyToUndef,
    z.string().trim().max(32).transform(assertReminderPriority).optional()),
  status: z.preprocess(emptyToUndef,
    z.string().trim().max(64).transform(assertReminderStatus).optional()),
  dueAt: z.preprocess(emptyToUndef, z.string().trim().max(40).optional()),
  nextFollowUp: z.preprocess(emptyToUndef, z.string().trim().max(40).optional()),
  contactAddress: z.preprocess(emptyToUndef, z.string().trim().max(400).optional()),
  reference: z.preprocess(emptyToUndef, z.string().trim().max(400).optional()),
  amount: z.preprocess(emptyToUndef, z.string().trim().max(64).optional()),
  waitingFor: z.preprocess(emptyToUndef, z.string().trim().max(600).optional()),
  notes: z.preprocess(emptyToUndef, z.string().trim().max(2000).optional()),
});
export type ReminderUpsert = z.infer<typeof ReminderUpsertSchema>;

export const ReminderCommentSchema = z.object({
  reminderId: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1).max(2000),
  mentions: z.array(z.string().trim().max(120)).max(10).optional(),
});
export type ReminderCommentInput = z.infer<typeof ReminderCommentSchema>;

export const ReminderCommentActionSchema = z.object({
  commentId: z.string().trim().min(1).max(64),
  actionDone: z.boolean(),
});
export type ReminderCommentActionInput = z.infer<typeof ReminderCommentActionSchema>;

export const ReminderOrderSchema = z.object({
  order: z.array(z.string().trim().max(64)).max(500),
});
export type ReminderOrderInput = z.infer<typeof ReminderOrderSchema>;

export const JobConfirmationSchema = z.object({
  jobId: z.string().trim().min(1).max(64),
  confirmed: z.boolean().optional(),
  customerConfirmed: z.boolean().optional(),
  crewConfirmed: z.boolean().optional(),
});
export type JobConfirmationInput = z.infer<typeof JobConfirmationSchema>;

export const TeamMemberSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  role: z.preprocess(emptyToUndef, z.string().trim().max(80).optional()),
  department: z.preprocess(emptyToUndef, z.string().trim().max(80).optional()),
  phone: z.preprocess(emptyToUndef, z.string().trim().max(40).optional()),
  email: z.preprocess(emptyToUndef, z.string().trim().max(160).optional()),
  status: z.preprocess(emptyToUndef, z.string().trim().max(32).optional()),
  notes: z.preprocess(emptyToUndef, z.string().trim().max(500).optional()),
});
export type TeamMemberInput = z.infer<typeof TeamMemberSchema>;

export const TeamMemberUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  role: z.preprocess(emptyToUndef, z.string().trim().max(80).optional()),
  department: z.preprocess(emptyToUndef, z.string().trim().max(80).optional()),
  phone: z.preprocess(emptyToUndef, z.string().trim().max(40).optional()),
  email: z.preprocess(emptyToUndef, z.string().trim().max(160).optional()),
  status: z.preprocess(emptyToUndef, z.string().trim().max(32).optional()),
  notes: z.preprocess(emptyToUndef, z.string().trim().max(500).optional()),
  // Explicit, narrow escape hatch for correcting a genuinely bad existing
  // value (e.g. a formula-injection artifact) — never the default path.
  force: z.boolean().optional(),
});
export type TeamMemberUpdateInput = z.infer<typeof TeamMemberUpdateSchema>;

export const JobTagsSchema = z.object({
  jobId: z.string().trim().min(1).max(64),
  needsApproval: z.boolean().optional(),
  needsEstimate: z.boolean().optional(),
});
export type JobTagsInput = z.infer<typeof JobTagsSchema>;

export const DailyLogSchema = z.object({
  jobId: z.preprocess(emptyToUndef, z.string().trim().max(64).optional()),
  project: z.preprocess(emptyToUndef, z.string().trim().max(200).optional()),
  workDate: z.string().trim().min(1).max(32),
  location: z.preprocess(emptyToUndef, z.string().trim().max(300).optional()),
  truck: z.preprocess(emptyToUndef, z.string().trim().max(64).optional()),
  technicians: z.array(z.string().trim().max(80)).max(5).optional(),
  clockIn: z.preprocess(emptyToUndef, z.string().trim().max(32).optional()),
  clockOut: z.preprocess(emptyToUndef, z.string().trim().max(32).optional()),
  breakMin: z.preprocess(emptyToUndef, z.coerce.number().min(0).max(600).optional()),
  workCompleted: z.preprocess(emptyToUndef, z.string().trim().max(4000).optional()),
  materialsUsed: z.preprocess(emptyToUndef, z.string().trim().max(2000).optional()),
  issues: z.preprocess(emptyToUndef, z.string().trim().max(2000).optional()),
  photos: z.preprocess(emptyToUndef, z.string().trim().max(600).optional()),
  nextStep: z.preprocess(emptyToUndef, z.string().trim().max(1000).optional()),
  supervisor: z.preprocess(emptyToUndef, z.string().trim().max(120).optional()),
  notes: z.preprocess(emptyToUndef, z.string().trim().max(2000).optional()),
});
export type DailyLogInput = z.infer<typeof DailyLogSchema>;

export const INTAKE_ACTIONS = [
  'create_job', 'update_job', 'schedule_job', 'assign_crew', 'assign_truck',
  'change_status', 'complete_job', 'add_material', 'upsert_reminder',
  'add_daily_log', 'add_labour_hours', 'add_follow_up', 'attach_reference',
] as const;
export type IntakeAction = (typeof INTAKE_ACTIONS)[number];

export const IntakeSchema = z.object({
  source: z.enum(['chatgpt', 'claude', 'webapp', 'webhook']).default('webapp'),
  user: z.string().trim().max(160).optional(),
  message: z.string().trim().min(1).max(8000),
  attachments: z.array(z.string().max(600)).max(20).optional(),
  requestedAction: z.enum(INTAKE_ACTIONS).optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
  confirm: z.boolean().default(false),
  autoCommit: z.boolean().default(false),
});
export type IntakeInput = z.infer<typeof IntakeSchema>;
