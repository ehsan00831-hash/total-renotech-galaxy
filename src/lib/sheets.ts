/**
 * Google Sheets access layer.
 *
 * Design rules:
 *  - Columns are resolved from the live header row, never hard-coded.
 *  - A table declares its own header row, so two tables can share one tab.
 *  - Writes target individual cells by field name, so a reordered column
 *    cannot corrupt a different field.
 *  - Formula-driven sheets (the job views and ARCHIVE) refuse every write.
 *  - When credentials are absent the layer reports `configured: false`
 *    instead of throwing, so the app still renders with a clear banner.
 */

import { readFileSync } from 'node:fs';
import { google, type sheets_v4 } from 'googleapis';
import {
  COMPLETED_ARCHIVE_SHEET_ID, COMPLETED_ARCHIVE_SIGNATURE,
  type FieldSpec, type TableSpec,
} from './schema';
import {
  assertWritable as coreAssertWritable, colLetter as coreColLetter,
  normHeader, resolveColumns as coreResolveColumns, type ColumnMap,
} from './core';

export const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID ??
  '1OEdYzStnJuJeD9EyXDo5IcAn_kujW5tpPy_Uq3DjZBQ';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let clientPromise: Promise<sheets_v4.Sheets> | null = null;

export class SheetsNotConfiguredError extends Error {
  constructor() {
    super(
      'Google Sheets credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL ' +
      'and GOOGLE_PRIVATE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_FILE ' +
      'in the environment, and share the spreadsheet with that service account as an Editor.',
    );
    this.name = 'SheetsNotConfiguredError';
  }
}

export function credentialsPresent(): boolean {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return true;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) return true;
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

function parseCredentialJson(raw: string): { email: string; key: string } {
  const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
  if (!parsed.client_email || !parsed.private_key) throw new SheetsNotConfiguredError();
  return { email: parsed.client_email, key: parsed.private_key };
}

function loadCredentials(): { email: string; key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) return parseCredentialJson(raw);

  // Local verification only — a Windows file path does not survive deployment,
  // so production must use GOOGLE_SERVICE_ACCOUNT_JSON instead.
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim();
  if (file) {
    try {
      return parseCredentialJson(readFileSync(file, 'utf8'));
    } catch (err) {
      if (err instanceof SheetsNotConfiguredError) throw err;
      throw new SheetsNotConfiguredError();
    }
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) throw new SheetsNotConfiguredError();
  // Vercel and .env files store the PEM with escaped newlines.
  return { email, key: key.replace(/\\n/g, '\n') };
}

/**
 * Test seam: integration tests install a stub that behaves like the real
 * client, so repository behaviour is exercised without a network call.
 */
let injected: sheets_v4.Sheets | null = null;

export function __setSheetsClientForTests(client: sheets_v4.Sheets | null): void {
  injected = client;
  clientPromise = null;
  headerCache.clear();
  titleCache.clear();
}

export async function sheetsClient(): Promise<sheets_v4.Sheets> {
  if (injected) return injected;
  if (!credentialsPresent()) throw new SheetsNotConfiguredError();
  if (!clientPromise) {
    clientPromise = (async () => {
      const { email, key } = loadCredentials();
      // Use googleapis' own JWT class: importing it from google-auth-library
      // directly gives a structurally different type to the one googleapis expects.
      const auth = new google.auth.JWT({ email, key, scopes: SCOPES });
      await auth.authorize();
      return google.sheets({ version: 'v4', auth });
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/* ------------------------------------------------------------------ *
 * A1 helpers
 * ------------------------------------------------------------------ */

export const colLetter = coreColLetter;
export const resolveColumns = coreResolveColumns;
export const assertWritable = coreAssertWritable;
export type { ColumnMap };

function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

/* ------------------------------------------------------------------ *
 * Sheet identity
 * ------------------------------------------------------------------ */

const titleCache = new Map<number, string>();

/**
 * Resolve a tab by its numeric sheet id.
 *
 * The completed-history tab is titled "No Name" in this workbook. A title like
 * that is not a safe address — it reads as a placeholder and could be renamed
 * by anyone — and renaming it is not ours to do, so the sheet id is the
 * identity and the title is only ever the result.
 */
export async function titleForSheetId(sheetId: number): Promise<string | null> {
  const hit = titleCache.get(sheetId);
  if (hit) return hit;

  const api = await sheetsClient();
  const meta = await api.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  for (const s of meta.data.sheets ?? []) {
    const id = s.properties?.sheetId;
    const title = s.properties?.title;
    if (typeof id === 'number' && title) titleCache.set(id, title);
  }
  return titleCache.get(sheetId) ?? null;
}

/**
 * Title of the completed-history tab.
 *
 * The sheet id is authoritative. If the tab has been recreated — which changes
 * its id — fall back to the header signature so the app still finds it rather
 * than silently reporting that the completed history has disappeared.
 */
export async function completedArchiveTitle(): Promise<string | null> {
  const byId = await titleForSheetId(COMPLETED_ARCHIVE_SHEET_ID);
  if (byId) return byId;

  for (const { title } of await listSheets()) {
    if (!title) continue;
    const probe: TableSpec = { sheet: title, headerRow: 5, firstDataRow: 6 };
    try {
      if (await headerSignatureMatches(probe, COMPLETED_ARCHIVE_SIGNATURE)) return title;
    } catch {
      // A tab that cannot be read is simply not the one we are looking for.
    }
  }
  return null;
}

/** Tab titles present in the workbook — used by the health check. */
export async function listSheets(): Promise<Array<{ title: string; sheetId: number }>> {
  const api = await sheetsClient();
  const meta = await api.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return (meta.data.sheets ?? [])
    .map((s) => ({ title: s.properties?.title ?? '', sheetId: s.properties?.sheetId ?? -1 }))
    .filter((s) => s.sheetId >= 0);
}

/* ------------------------------------------------------------------ *
 * Header resolution
 * ------------------------------------------------------------------ */

type HeaderCache = { at: number; headers: string[] };
const headerCache = new Map<string, HeaderCache>();
const HEADER_TTL_MS = 60_000;

function cacheKey(t: TableSpec): string {
  return `${t.sheet}#${t.headerRow}`;
}

export async function readHeaders(table: TableSpec): Promise<string[]> {
  const key = cacheKey(table);
  const hit = headerCache.get(key);
  if (hit && Date.now() - hit.at < HEADER_TTL_MS) return hit.headers;

  const api = await sheetsClient();
  const res = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quoteSheet(table.sheet)}!${table.headerRow}:${table.headerRow}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const headers = ((res.data.values?.[0] ?? []) as unknown[]).map((v) => String(v ?? ''));
  headerCache.set(key, { at: Date.now(), headers });
  return headers;
}

export async function columnsFor(
  table: TableSpec,
  fields: Record<string, FieldSpec>,
): Promise<{ cols: ColumnMap; headers: string[] }> {
  const headers = await readHeaders(table);
  return { cols: resolveColumns(headers, fields), headers };
}

/** Does this sheet's header row look like the table we expect? */
export async function headerSignatureMatches(
  table: TableSpec, signature: string[],
): Promise<boolean> {
  const headers = (await readHeaders(table)).map(normHeader);
  return signature.every((s) => headers.some((h) => h.includes(normHeader(s))));
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export type SheetRow = { __row: number } & Record<string, string>;

/**
 * Read a table into records keyed by field name.
 *
 * `keyField` decides which field must be non-empty for a row to count as real
 * data. `maxRows` bounds the read so a second table further down the same tab
 * is never pulled in.
 */
export async function readRecords(
  table: TableSpec,
  fields: Record<string, FieldSpec>,
  keyField: string,
): Promise<{ rows: SheetRow[]; cols: ColumnMap; headers: string[] }> {
  const api = await sheetsClient();
  const { cols, headers } = await columnsFor(table, fields);

  const width = Math.max(headers.length, ...Object.values(cols), 1);
  const lastRow = table.maxRows
    ? table.firstDataRow + table.maxRows - 1
    : undefined;

  const range = lastRow
    ? `${quoteSheet(table.sheet)}!A${table.firstDataRow}:${colLetter(width)}${lastRow}`
    : `${quoteSheet(table.sheet)}!A${table.firstDataRow}:${colLetter(width)}`;

  const res = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const raw = (res.data.values ?? []) as unknown[][];
  const keyCol = cols[keyField];
  const rows: SheetRow[] = [];

  raw.forEach((line, i) => {
    const rec = { __row: table.firstDataRow + i } as SheetRow;
    for (const [field, col] of Object.entries(cols)) {
      rec[field] = String(line[col - 1] ?? '').trim();
    }
    // A row counts as a record when it carries any value at all. Requiring
    // the key column would hide real rows whose key is legitimately empty —
    // a reminder with no customer, a job entered without an ID yet — and a
    // hidden record is indistinguishable from a deleted one.
    const anyValue = Object.entries(rec).some(([k, v]) => k !== '__row' && v !== '');
    if (anyValue) rows.push(rec);
  });

  return { rows, cols, headers };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Every write here uses USER_ENTERED so dates/numbers still get recognised
 * and formatted — but that means Sheets parses a string starting with
 * `=`, `+`, `-` or `@` as a formula (a phone number like "+1 514 ..." comes
 * back as `#ERROR!`). A leading apostrophe is Sheets' own escape for
 * "literal text, don't parse this" and is never shown in the cell.
 */
function escapeForSheets(value: string | number): string | number {
  if (typeof value !== 'string') return value;
  return /^[=+@-]/.test(value) ? `'${value}` : value;
}

/** Patch named fields on one existing row. Untouched fields stay untouched. */
export async function updateRow(
  table: TableSpec,
  row: number,
  cols: ColumnMap,
  patch: Record<string, string | number | undefined>,
): Promise<string[]> {
  assertWritable(table.sheet);
  const api = await sheetsClient();

  const data: sheets_v4.Schema$ValueRange[] = [];
  const applied: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const col = cols[field];
    if (!col) continue;
    data.push({
      range: `${quoteSheet(table.sheet)}!${colLetter(col)}${row}`,
      values: [[escapeForSheets(value)]],
    });
    applied.push(`${field}=${colLetter(col)}${row}`);
  }
  if (!data.length) return [];

  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
  return applied;
}

/**
 * Append a record. Finds the first row whose key column is empty and writes
 * there, so it fills gaps left by the table's fixed height rather than pushing
 * past it into whatever sits below.
 */
export async function appendRecord(
  table: TableSpec,
  fields: Record<string, FieldSpec>,
  keyField: string,
  record: Record<string, string | number | undefined>,
): Promise<{ row: number; applied: string[] }> {
  assertWritable(table.sheet);
  const api = await sheetsClient();
  const { cols, headers } = await columnsFor(table, fields);
  const keyCol = cols[keyField];

  const width = Math.max(headers.length, ...Object.values(cols), 1);
  const budget = table.maxRows ?? 500;
  const scan = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quoteSheet(table.sheet)}!A${table.firstDataRow}:${colLetter(width)}${table.firstDataRow + budget - 1}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const raw = (scan.data.values ?? []) as unknown[][];

  // Reuse a row only when every mapped cell on it is blank. Testing the key
  // column alone would treat a fully populated row whose key happens to be
  // empty as free, and the append would overwrite it.
  const mapped = Object.values(cols);
  let target = table.firstDataRow + raw.length;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i] ?? [];
    const occupied = mapped.some((c) => String(line[c - 1] ?? '').trim() !== '');
    if (!occupied) { target = table.firstDataRow + i; break; }
  }
  void keyCol;

  if (target > table.firstDataRow + budget - 1) {
    throw new Error(
      `"${table.sheet}" has no free row within its ${budget}-row budget. ` +
      'Extend the table in the sheet before adding more records.',
    );
  }

  const applied = await updateRow(table, target, cols, record);
  return { row: target, applied };
}

/** Ensure a sheet exists; create it with the given header row if missing. */
export async function ensureSheet(table: TableSpec, headers: string[]): Promise<void> {
  const api = await sheetsClient();
  const meta = await api.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === table.sheet);
  if (exists) return;

  await api.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: table.sheet } } }] },
  });
  await api.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quoteSheet(table.sheet)}!A${table.headerRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
  headerCache.delete(cacheKey(table));
}
