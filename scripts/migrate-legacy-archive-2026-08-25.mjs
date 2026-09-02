/**
 * ONE-TIME LIVE DATA MIGRATION — 2026-08-25
 *
 * Archives all "All Jobs" records except NP-96742 into a dedicated archive
 * sheet, and archives their related Daily Logs into a second archive sheet.
 * Authorized in chat by the workbook owner as a one-time exception to the
 * standing "never delete/overwrite customer records" project rule.
 *
 * Every destructive step is gated on a verification that must pass exactly.
 * If any count, identity or content check fails, the script aborts *before*
 * touching the source data and prints exactly what didn't match.
 *
 * This script has not been run by Claude. It is meant to be reviewed and
 * executed by the workbook owner directly, in their own terminal, so the
 * one truly destructive step (Phase 5, clearing All Jobs / Daily Logs) is a
 * deliberate, visible action on their side rather than something that
 * happens inside an agent session.
 *
 * MODES
 *   DRY_RUN=1               Read-only. Stops after identification, before any write.
 *   RESUME=1                Expects the four target sheets to already exist. Verifies
 *                            and, if a sheet exists but is still empty, fills it — it
 *                            never re-creates or double-writes a sheet that already has
 *                            data. Use this if a previous run stopped partway through.
 *   RESUME=1 VERIFY_ONLY=1  Strictly read-only against the four existing target sheets:
 *                            runs every count/identity/cell-for-cell check Phase 5 is
 *                            gated on, prints a PASS/FAIL line for each, and exits before
 *                            Phase 2 ever runs. Creates, fills, clears, updates or
 *                            formats nothing.
 *   RESUME=1 REPAIR_ARCHIVES=1
 *                            Rebuilds ONLY the two legacy archive sheets from the live
 *                            source, using an exact Sheets range copy (values *and*
 *                            number formats, full source row width — no hand-computed
 *                            column count, no schema-field mapping) instead of the
 *                            array-based write the rest of this script uses elsewhere.
 *                            Takes a timestamped safety duplicate of both archive sheets
 *                            before clearing their data-body rows. Never touches All
 *                            Jobs or Daily Logs. Exits before Phase 2/Phase 5.
 *   RESUME=1 REPAIR_LEGACY_LOG_IDS_ONLY=1
 *                            The narrowest write in this file: repairs only the Log ID
 *                            cell(s) of LEGACY DAILY LOGS ARCHIVE 2026-08-25, pairing
 *                            strictly by Job ID (never Log ID — that's the column being
 *                            repaired). Hard-asserts 2 source rows, 2 archive rows,
 *                            unique Job IDs on both sides, and both sets are exactly
 *                            {TR-2026-012, TR-2026-013} before doing anything. Then
 *                            confirms every existing difference is confined to the Log
 *                            ID column — aborts, writing nothing, if any other column
 *                            differs. Takes a timestamped safety duplicate of the archive
 *                            sheet, then copies each row's single Log ID cell from Daily
 *                            Logs via a native single-cell range copy (never typed or
 *                            hardcoded). Never touches All Jobs, Daily Logs, either
 *                            backup, or the Legacy Jobs Archive. Exits before Phase 2/5.
 *   (neither)                Fresh run. Aborts instead if any target sheet name is
 *                            already taken, rather than silently reusing or overwriting it.
 *
 * Run from the repo root (PowerShell):
 *   $env:GOOGLE_SHEETS_SPREADSHEET_ID = "1OEdYzStnJuJeD9EyXDo5IcAn_kujW5tpPy_Uq3DjZBQ"
 *   $env:GOOGLE_SERVICE_ACCOUNT_FILE  = "C:\Users\Es7\Downloads\quantum-keep-497904-i2-8f1e1a177193.json"
 *   node scripts/migrate-legacy-archive-2026-08-25.mjs          # DRY_RUN first, see below
 */

import { sheetsClient, SPREADSHEET_ID } from '../.test-build/sheets.js';
import { recordAudit } from '../.test-build/audit.js';
import { resolveColumns } from '../.test-build/core.js';
import { JOB_FIELDS, LOG_FIELDS } from '../.test-build/schema.js';

const KEEP_JOB_ID = 'NP-96742';
const NOTES_CHECK_JOB_ID = 'TR-2026-012';
const ALL_JOBS = 'All Jobs';
const DAILY_LOGS = 'Daily Logs';
const MAX_COL = 100; // generous scan width — trimmed to the real used width below
const RAW_ERRORS = ['#REF!', '#VALUE!', '#N/A', '#DIV/0!', '#NAME?', '#NULL!', '#ERROR!'];
const EXPECTED_TOTAL_JOBS = 24;
const EXPECTED_LEGACY_JOBS = 23;
const EXPECTED_TOTAL_LOGS = 2;
const EXPECTED_LEGACY_LOGS = 2;
// The Legacy Daily Logs Archive is paired by Job ID only, not Log ID — see
// matchLegacyLogsByJobId for why. Hardcoding the two real Job IDs here is
// deliberate and scoped to this one-time migration; a third or different
// Job ID surfacing at runtime hard-fails the check below rather than being
// silently absorbed.
const EXPECTED_LEGACY_LOG_JOB_IDS = ['TR-2026-012', 'TR-2026-013'];

const DRY_RUN = process.env.DRY_RUN === '1';
const RESUME = process.env.RESUME === '1';
const VERIFY_ONLY = process.env.VERIFY_ONLY === '1';
const REPAIR_ARCHIVES = process.env.REPAIR_ARCHIVES === '1';
const REPAIR_LEGACY_LOG_IDS_ONLY = process.env.REPAIR_LEGACY_LOG_IDS_ONLY === '1';

const backupJobsName = 'BACKUP ALL JOBS 2026-08-25';
const backupLogsName = 'BACKUP DAILY LOGS 2026-08-25';
const archiveJobsName = 'LEGACY JOBS ARCHIVE 2026-08-25';
const archiveLogsName = 'LEGACY DAILY LOGS ARCHIVE 2026-08-25';

const say = (msg) => console.log(msg);
const fail = (msg) => { say(`\nABORT: ${msg}`); say('No destructive action was taken.'); process.exit(1); };

if (VERIFY_ONLY && !RESUME) {
  fail('VERIFY_ONLY=1 requires RESUME=1 — there is nothing to verify against sheets that were never created.');
}
if (VERIFY_ONLY && DRY_RUN) {
  fail('VERIFY_ONLY=1 and DRY_RUN=1 are not combinable — DRY_RUN never expects the four target sheets to exist.');
}
if (REPAIR_ARCHIVES && !RESUME) {
  fail('REPAIR_ARCHIVES=1 requires RESUME=1 — repair rebuilds sheets that must already exist.');
}
if (REPAIR_ARCHIVES && DRY_RUN) {
  fail('REPAIR_ARCHIVES=1 and DRY_RUN=1 are not combinable.');
}
if (REPAIR_ARCHIVES && VERIFY_ONLY) {
  fail('REPAIR_ARCHIVES=1 and VERIFY_ONLY=1 are not combinable — repair writes, VERIFY_ONLY must never write.');
}
if (REPAIR_LEGACY_LOG_IDS_ONLY && !RESUME) {
  fail('REPAIR_LEGACY_LOG_IDS_ONLY=1 requires RESUME=1 — it repairs a sheet that must already exist.');
}
if (REPAIR_LEGACY_LOG_IDS_ONLY && DRY_RUN) {
  fail('REPAIR_LEGACY_LOG_IDS_ONLY=1 and DRY_RUN=1 are not combinable.');
}
if (REPAIR_LEGACY_LOG_IDS_ONLY && VERIFY_ONLY) {
  fail('REPAIR_LEGACY_LOG_IDS_ONLY=1 and VERIFY_ONLY=1 are not combinable — this mode writes, VERIFY_ONLY must never write.');
}
if (REPAIR_LEGACY_LOG_IDS_ONLY && REPAIR_ARCHIVES) {
  fail('REPAIR_LEGACY_LOG_IDS_ONLY=1 and REPAIR_ARCHIVES=1 are not combinable — run one at a time.');
}

/** PASS/FAIL line for one named check. Never aborts — every check runs and is reported. */
const results = [];
function verifyCheck(label, ok, detail) {
  results.push({ label, ok });
  say(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? `: ${detail}` : ''}`);
}
function summarizeAndExit(context) {
  const failed = results.filter((r) => !r.ok);
  say(`\n=== ${context} summary: ${results.length - failed.length}/${results.length} checks passed ===`);
  if (failed.length) {
    say(`FAILED: ${failed.map((r) => r.label).join(', ')}`);
    say('Nothing further was written. Phase 5 was not reached.');
    process.exit(1);
  }
  say('All checks passed. Phase 5 (clearing All Jobs / Daily Logs) was not reached in this mode.');
  process.exit(0);
}

function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
function quote(name) { return `'${name.replace(/'/g, "''")}'`; }
function hasAnyValue(row) { return (row ?? []).some((v) => String(v ?? '').trim() !== ''); }

const api = await sheetsClient();

async function getMeta() {
  const res = await api.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title,gridProperties))',
  });
  const map = new Map();
  for (const s of res.data.sheets ?? []) {
    map.set(s.properties.title, { sheetId: s.properties.sheetId, grid: s.properties.gridProperties });
  }
  return map;
}

/**
 * The one read function used everywhere in this script, for every sheet,
 * on every comparison — identical valueRenderOption and dateTimeRenderOption
 * on both sides of every diff, so a mismatch always means the data actually
 * differs, never that the same cell was rendered two different ways.
 *
 * UNFORMATTED_VALUE + SERIAL_NUMBER returns the raw stored value: plain
 * strings/numbers for ordinary cells, and the underlying Sheets date/time
 * serial number for genuine date-typed cells (not a locale-dependent display
 * string). normalizeCell() below turns that serial into a stable
 * YYYY-MM-DD / YYYY-MM-DD HH:MM / HH:MM string before any comparison.
 */
async function readRaw(sheetName, lastRow) {
  const range = `${quote(sheetName)}!A1:${colLetter(MAX_COL)}${lastRow}`;
  const res = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  return res.data.values ?? [];
}

function realWidth(headerRowValues) {
  let w = 0;
  for (let i = 0; i < (headerRowValues ?? []).length; i++) {
    if (String(headerRowValues[i] ?? '').trim() !== '') w = i + 1;
  }
  return w;
}

/**
 * Find the real header row by content, not position. Scans from the top of
 * an already-fetched grid for the first row containing a cell that matches
 * the sheet's own primary-key header pattern (e.g. "Job ID", "Log ID") —
 * so a title, banner or instruction row above it is never mistaken for the
 * header, and never counted as a record either, whatever row number it
 * happens to land on.
 */
function findHeaderRowIndex(rawGrid, primaryKeyPattern, scanRows = 15) {
  const limit = Math.min(scanRows, rawGrid.length);
  for (let r = 0; r < limit; r++) {
    const row = rawGrid[r] ?? [];
    if (row.some((c) => primaryKeyPattern.test(String(c ?? '').trim()))) return r; // 0-based
  }
  return -1;
}

/* ------------------------------------------------------------- *
 * Date/time normalization
 *
 * This workbook's own spreadsheet-level time zone is America/Toronto
 * (confirmed via spreadsheets.get earlier in this project) and Google
 * Sheets serials are naive local values, not absolute instants — so a
 * serial read from this specific spreadsheet already *is* the Toronto
 * wall-clock date/time. No further offset conversion is needed; the
 * conversion below is the standard Sheets-serial-to-calendar-date math.
 * ------------------------------------------------------------- */
function serialToParts(serial) {
  const days = Math.floor(serial);
  const frac = serial - days;
  // 25569 = days between the Sheets epoch (1899-12-30) and the Unix epoch.
  const utcMs = Math.round((days - 25569) * 86400000 + frac * 86400000);
  const d = new Date(utcMs);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hh: d.getUTCHours(), mm: d.getUTCMinutes(),
    hasTime: Math.abs(frac) > 1e-9,
  };
}
function pad(n) { return String(n).padStart(2, '0'); }
function serialToDateStr(serial) {
  const p = serialToParts(serial);
  return `${p.y}-${pad(p.mo)}-${pad(p.day)}`;
}
function serialToDateTimeStr(serial) {
  const p = serialToParts(serial);
  return p.hasTime ? `${serialToDateStr(serial)} ${pad(p.hh)}:${pad(p.mm)}` : serialToDateStr(serial);
}
function serialToTimeStr(serial) {
  const p = serialToParts(serial);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

const DATE_FIELD_NAMES = new Set([
  'workDate', 'scheduledDate', 'dateAdded', 'dueAt', 'nextFollowUp', 'followUpDate',
  'lastUpdated', 'createdDate', 'projectStart', 'projectEnd', 'actualStart', 'actualEnd',
]);
const TIME_FIELD_NAMES = new Set(['clockIn', 'clockOut']);

/** Column index (0-based) -> field name, using the app's own header patterns. */
function columnFieldMap(headerRow, fields) {
  const cols = resolveColumns(headerRow, fields); // { fieldName: 1-based column }
  const byIndex = new Map();
  for (const [name, idx] of Object.entries(cols)) byIndex.set(idx - 1, name);
  return byIndex;
}

/**
 * Normalize one cell for comparison. Only two kinds of representation
 * differences are collapsed: blank/null -> '', and a date/time serial ->
 * a stable calendar string. Ordinary text, IDs, hours and counts pass
 * through as their exact string form — nothing is trimmed or weakened.
 * A raw value's *type* matters too: normalizeCell keeps numbers and
 * strings visibly distinct (e.g. the number 6 vs the text "6") so a type
 * change is never silently treated as a match.
 */
function normalizeCell(raw, fieldName) {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number') {
    if (TIME_FIELD_NAMES.has(fieldName)) return `time:${serialToTimeStr(raw)}`;
    if (DATE_FIELD_NAMES.has(fieldName)) return `date:${serialToDateTimeStr(raw)}`;
    return `num:${raw}`; // an ordinary number — hours, counts — untouched, tagged so "6" (num) != "6" (text)
  }
  return `text:${raw}`;
}
function displayValue(normalized) {
  return normalized === '' ? '(blank)' : normalized.replace(/^(num|text|date|time):/, '');
}

/**
 * Cell-by-cell diff between a source row and an archive/backup row, read
 * with identical options. Returns [] when everything matches. Each entry
 * names the real column (from the header), the field it maps to, and both
 * normalized values — never raw credentials or anything outside this row.
 */
/** A blank/undefined cell reads as type "blank"; otherwise the real JS typeof. */
function cellType(raw) {
  return raw === null || raw === undefined || raw === '' ? 'blank' : typeof raw;
}

function diffRow(sourceCells, otherCells, headerRow, fieldByIndex, width) {
  const diffs = [];
  for (let i = 0; i < width; i++) {
    const fieldName = fieldByIndex.get(i) ?? null;
    const rawA = sourceCells[i];
    const rawB = otherCells[i];
    const a = normalizeCell(rawA, fieldName);
    const b = normalizeCell(rawB, fieldName);
    if (a !== b) {
      diffs.push({
        column: headerRow[i] ?? `(col ${colLetter(i + 1)})`,
        field: fieldName ?? '(unmapped)',
        source: displayValue(a), other: displayValue(b),
        sourceRaw: rawA ?? '', otherRaw: rawB ?? '',
        sourceType: cellType(rawA), otherType: cellType(rawB),
      });
    }
  }
  return diffs;
}
function reportDiffs(label, diffs) {
  say(`  ${label}: ${diffs.length === 0 ? 'MATCH' : `${diffs.length} difference(s)`}`);
  for (const d of diffs) {
    say(`    column "${d.column}" (field: ${d.field}) — source=${JSON.stringify(d.source)} archive=${JSON.stringify(d.other)}`);
  }
}

/**
 * Match each source row to exactly one row in `otherRows` by `keyFn`, not
 * by array position. A duplicate key consumes one candidate per match
 * (first-available), so two identical rows don't both match the same
 * target. Returns which source rows matched, which didn't, and which
 * target rows were never claimed.
 */
function matchByKey(sourceRows, otherRows, keyFn) {
  const pool = new Map(); // key -> array of {row, cells}
  for (const r of otherRows) {
    const k = keyFn(r.cells ?? r);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(r);
  }
  const matched = [];
  const unmatchedSource = [];
  for (const s of sourceRows) {
    const k = keyFn(s.cells);
    const bucket = pool.get(k);
    if (bucket && bucket.length) matched.push({ source: s, other: bucket.shift() });
    else unmatchedSource.push(s);
  }
  const unmatchedOther = [...pool.values()].flat();
  return { matched, unmatchedSource, unmatchedOther };
}

/**
 * Match Daily Logs rows. Full-row-identity matching can only ever find true
 * duplicates — a genuinely corrupted row has, by definition, a different
 * identity than its source, so it would show up as two separate "unmatched"
 * rows instead of one matched pair with a visible diff. That defeats the
 * point of verification, so Daily Logs are never matched this way.
 *
 * Instead: prefer Log ID when it's populated (a real, stable identifier).
 * For rows with a blank Log ID, group both sides by Job ID and require the
 * group sizes to match exactly; if they do, pair rows by occurrence order
 * within that Job ID group (for the current data this means TR-2026-012's
 * one row pairs with TR-2026-012's one row, and likewise for TR-2026-013 —
 * never a positional guess across the whole sheet). A group whose source
 * and archive counts disagree is left entirely unmatched and reported, not
 * guessed at.
 */
function matchDailyLogs(sourceRows, otherRows, logIdColIdx, jobIdColIdx) {
  const matched = [];
  const unmatchedSource = [];
  const unmatchedOther = [];

  const bucket = (rows) => {
    const byLogId = new Map();
    const blankByJob = new Map();
    for (const r of rows) {
      const logId = String(r.cells[logIdColIdx] ?? '').trim();
      if (logId) {
        if (!byLogId.has(logId)) byLogId.set(logId, []);
        byLogId.get(logId).push(r);
      } else {
        const jobId = String(r.cells[jobIdColIdx] ?? '').trim();
        if (!blankByJob.has(jobId)) blankByJob.set(jobId, []);
        blankByJob.get(jobId).push(r);
      }
    }
    return { byLogId, blankByJob };
  };

  const src = bucket(sourceRows);
  const oth = bucket(otherRows);

  // 1) Match by populated Log ID.
  for (const [logId, srcGroup] of src.byLogId) {
    const othGroup = oth.byLogId.get(logId) ?? [];
    oth.byLogId.delete(logId);
    const n = Math.min(srcGroup.length, othGroup.length);
    for (let i = 0; i < n; i++) matched.push({ source: srcGroup[i], other: othGroup[i] });
    if (srcGroup.length > n) unmatchedSource.push(...srcGroup.slice(n));
    if (othGroup.length > n) unmatchedOther.push(...othGroup.slice(n));
  }

  // 2) Blank Log ID — grouped by Job ID, counts must agree exactly.
  for (const [jobId, srcGroup] of src.blankByJob) {
    const othGroup = oth.blankByJob.get(jobId) ?? [];
    oth.blankByJob.delete(jobId);
    if (srcGroup.length !== othGroup.length) {
      unmatchedSource.push(...srcGroup);
      unmatchedOther.push(...othGroup);
      continue;
    }
    for (let i = 0; i < srcGroup.length; i++) matched.push({ source: srcGroup[i], other: othGroup[i] });
  }

  // Anything left on the "other" side had no source counterpart at all.
  for (const group of oth.byLogId.values()) unmatchedOther.push(...group);
  for (const group of oth.blankByJob.values()) unmatchedOther.push(...group);

  return { matched, unmatchedSource, unmatchedOther };
}

/**
 * Print every real difference for one Daily Logs row pair, with Job ID and
 * Log ID for context and the raw (untouched) value plus its JS type on both
 * sides — not just the normalized display form — so a type change (e.g. a
 * blank Notes cell replaced by the number 6) is never obscured.
 */
function reportLogDiffs(source, other, diffs, logIdColIdx, jobIdColIdx) {
  const jobId = source.cells[jobIdColIdx] ?? '';
  const logId = source.cells[logIdColIdx] ?? '';
  say(`  Daily Logs row — Job ID: ${JSON.stringify(jobId)}, Log ID: ${JSON.stringify(logId) || '(blank)'}: ` +
    `${diffs.length === 0 ? 'MATCH' : `${diffs.length} difference(s)`}`);
  for (const d of diffs) {
    say(`    column "${d.column}" (field: ${d.field}) — ` +
      `source=${JSON.stringify(d.sourceRaw)} [${d.sourceType}]  archive=${JSON.stringify(d.otherRaw)} [${d.otherType}]`);
  }
}

/**
 * Compare every matched Daily Logs row pair and report one check for
 * "every matched row identical to source". This can only PASS when every
 * source row was actually matched *and* every matched pair is identical —
 * a run that matched zero rows (e.g. because every Job ID group's counts
 * disagreed) reports FAIL with the shortfall, never a vacuous PASS.
 */
function verifyLogsContentMatch(label, matchResult, expectedRowCount, headerRow, fieldByIndex, width, logIdColIdx, jobIdColIdx) {
  const { matched, unmatchedSource, unmatchedOther } = matchResult;
  verifyCheck(`${label} — every source row matched`, unmatchedSource.length === 0,
    unmatchedSource.length ? `${unmatchedSource.length} unmatched: ${unmatchedSource
      .map((s) => `Job ${s.cells[jobIdColIdx] ?? ''}/Log ${s.cells[logIdColIdx] ?? '(blank)'}`).join(', ')}` : undefined);
  verifyCheck(`${label} — no unexpected extra rows`, unmatchedOther.length === 0,
    unmatchedOther.length ? `${unmatchedOther.length} row(s) in the archive matched no source row` : undefined);

  const complete = matched.length === expectedRowCount && unmatchedSource.length === 0 && unmatchedOther.length === 0;
  let allIdentical = complete;
  for (const { source, other } of matched) {
    const diffs = diffRow(source.cells, other.cells, headerRow, fieldByIndex, width);
    if (diffs.length) { allIdentical = false; reportLogDiffs(source, other, diffs, logIdColIdx, jobIdColIdx); }
  }
  verifyCheck(`${label} — every matched row identical to source`, allIdentical,
    complete ? undefined : `only ${matched.length} of ${expectedRowCount} row(s) were matched — cannot be complete`);
  return allIdentical;
}

/**
 * Job-ID-only pairing for the LEGACY DAILY LOGS ARCHIVE specifically (not
 * the backup — that keeps using matchDailyLogs/Log-ID-first matching
 * unchanged). Log ID is deliberately not used as a matching key here: if an
 * earlier flawed archive write corrupted the Log ID column itself, matching
 * by Log ID would hide that corruption behind two "unmatched" rows instead
 * of surfacing it as a visible diff on a correctly-paired row. For this
 * one-time migration there are exactly two legacy Daily Logs rows, each
 * with its own distinct Job ID, so Job ID alone is the trustworthy key —
 * every count/uniqueness/identity assumption below is hard-asserted via
 * verifyCheck before any pairing happens, so a real surprise in the data
 * is reported, never silently mis-paired.
 */
function matchLegacyLogsByJobId(sourceRows, otherRows, jobIdColIdx, label) {
  const srcIds = sourceRows.map((r) => String(r.cells[jobIdColIdx] ?? '').trim());
  const othIds = otherRows.map((r) => String(r.cells[jobIdColIdx] ?? '').trim());

  verifyCheck(`${label} — exactly ${EXPECTED_LEGACY_LOGS} source rows`, sourceRows.length === EXPECTED_LEGACY_LOGS,
    `found ${sourceRows.length}`);
  verifyCheck(`${label} — exactly ${EXPECTED_LEGACY_LOGS} archive rows`, otherRows.length === EXPECTED_LEGACY_LOGS,
    `found ${otherRows.length}`);
  verifyCheck(`${label} — source Job IDs unique`, new Set(srcIds).size === srcIds.length,
    new Set(srcIds).size !== srcIds.length ? `source Job IDs: ${srcIds.join(', ')}` : undefined);
  verifyCheck(`${label} — archive Job IDs unique`, new Set(othIds).size === othIds.length,
    new Set(othIds).size !== othIds.length ? `archive Job IDs: ${othIds.join(', ')}` : undefined);

  const expectedSet = new Set(EXPECTED_LEGACY_LOG_JOB_IDS);
  const isExactExpectedSet = (ids) =>
    ids.length === EXPECTED_LEGACY_LOG_JOB_IDS.length &&
    new Set(ids).size === EXPECTED_LEGACY_LOG_JOB_IDS.length &&
    ids.every((id) => expectedSet.has(id));
  const srcSetOk = isExactExpectedSet(srcIds);
  const othSetOk = isExactExpectedSet(othIds);
  verifyCheck(`${label} — source Job IDs are exactly {${EXPECTED_LEGACY_LOG_JOB_IDS.join(', ')}}`, srcSetOk,
    srcSetOk ? undefined : `found: ${srcIds.join(', ') || '(none)'}`);
  verifyCheck(`${label} — archive Job IDs are exactly {${EXPECTED_LEGACY_LOG_JOB_IDS.join(', ')}}`, othSetOk,
    othSetOk ? undefined : `found: ${othIds.join(', ') || '(none)'}`);

  if (!srcSetOk || !othSetOk) {
    return { matched: [], hardFailed: true };
  }

  const matched = EXPECTED_LEGACY_LOG_JOB_IDS.map((jobId) => ({
    jobId,
    source: sourceRows.find((r) => String(r.cells[jobIdColIdx] ?? '').trim() === jobId),
    other: otherRows.find((r) => String(r.cells[jobIdColIdx] ?? '').trim() === jobId),
  }));
  return { matched, hardFailed: false };
}

/**
 * Pair, print both sides' Log ID for every paired row (regardless of
 * whether they match), then compare all columns — including Log ID itself,
 * dates, times, Notes and Hours — and report every real difference.
 * "Identical" can only be true when the hard-asserts passed and both rows
 * of the pair were found.
 */
function compareLegacyLogsArchive(sourceRows, otherRows, jobIdColIdx, logIdColIdx, headerRow, fieldByIndex, width, label) {
  const { matched, hardFailed } = matchLegacyLogsByJobId(sourceRows, otherRows, jobIdColIdx, label);
  if (hardFailed) return { allIdentical: false, hardFailed: true };

  let allIdentical = true;
  for (const { jobId, source, other } of matched) {
    if (!source || !other) {
      allIdentical = false;
      say(`  Job ID ${jobId}: FAIL — missing on the ${source ? 'archive' : 'source'} side.`);
      continue;
    }
    const srcLogId = source.cells[logIdColIdx] ?? '';
    const othLogId = other.cells[logIdColIdx] ?? '';
    say(`  Job ID ${jobId} — source Log ID: ${srcLogId === '' ? '(blank)' : JSON.stringify(srcLogId)}, ` +
      `archive Log ID: ${othLogId === '' ? '(blank)' : JSON.stringify(othLogId)}`);
    const diffs = diffRow(source.cells, other.cells, headerRow, fieldByIndex, width);
    if (diffs.length) {
      allIdentical = false;
      reportLogDiffs(source, other, diffs, logIdColIdx, jobIdColIdx);
    } else {
      say(`    all ${width} columns match (Log ID included).`);
    }
  }
  return { allIdentical, hardFailed: false };
}

/* ==================================================================== *
 * PHASE 0 — snapshot the workbook's tab list, before anything else
 * ==================================================================== */
say('=== PHASE 0 — workbook snapshot ===');
say(`Mode: ${
  REPAIR_LEGACY_LOG_IDS_ONLY ? 'RESUME + REPAIR_LEGACY_LOG_IDS_ONLY'
  : REPAIR_ARCHIVES ? 'RESUME + REPAIR_ARCHIVES'
  : VERIFY_ONLY ? 'RESUME + VERIFY_ONLY'
  : DRY_RUN ? 'DRY_RUN'
  : RESUME ? 'RESUME' : 'FRESH'}`);
const metaBefore = await getMeta();
say(`Tabs present (${metaBefore.size}): ${[...metaBefore.keys()].join(', ')}`);

for (const wanted of [ALL_JOBS, DAILY_LOGS]) {
  if (!metaBefore.has(wanted)) fail(`Sheet "${wanted}" not found in the live workbook.`);
}
const allJobsMeta = metaBefore.get(ALL_JOBS);
const dailyLogsMeta = metaBefore.get(DAILY_LOGS);

const targetNames = [backupJobsName, backupLogsName, archiveJobsName, archiveLogsName];
if (RESUME) {
  const missing = targetNames.filter((n) => !metaBefore.has(n));
  if (missing.length) {
    fail(`RESUME=1 expects all four target sheets to already exist. Missing: ${missing.join(', ')}`);
  }
  say(REPAIR_LEGACY_LOG_IDS_ONLY
    ? 'RESUME=1 REPAIR_LEGACY_LOG_IDS_ONLY=1 — all four target sheets found; repairing only the Log ID cells of the Legacy Daily Logs Archive.'
    : REPAIR_ARCHIVES
      ? 'RESUME=1 REPAIR_ARCHIVES=1 — all four target sheets found; rebuilding the two legacy archives only.'
      : VERIFY_ONLY
        ? 'RESUME=1 VERIFY_ONLY=1 — all four target sheets found; will read and verify only, nothing will be written.'
        : 'RESUME=1 — all four target sheets found; will verify (and fill if still empty) rather than re-create.');
} else if (!DRY_RUN) {
  const collisions = targetNames.filter((n) => metaBefore.has(n));
  if (collisions.length) {
    fail(`These target sheet names already exist — run with RESUME=1 to continue that attempt, ` +
      `or rename/remove them first: ${collisions.join(', ')}`);
  }
}

/* ==================================================================== *
 * PHASE 1 — read All Jobs and Daily Logs raw, full width, real header row
 * ==================================================================== */
say('\n=== PHASE 1 — read All Jobs (raw) ===');
const allJobsRaw = await readRaw(ALL_JOBS, (allJobsMeta.grid?.rowCount ?? 160) + 10);

const jobsHeaderIdx = findHeaderRowIndex(allJobsRaw, /^job\s*id$|^id$/i);
if (jobsHeaderIdx < 0) fail('Could not locate the All Jobs header row (no cell in the first 15 rows matches "Job ID").');
const jobsHeaderRowNum = jobsHeaderIdx + 1;
const jobsFirstDataRow = jobsHeaderRowNum + 1;
const jobsHeaderRow = allJobsRaw[jobsHeaderIdx] ?? [];
const jobsWidth = realWidth(jobsHeaderRow);
if (jobsWidth === 0) fail('All Jobs header row is empty — refusing to proceed.');
say(`All Jobs header detected at row ${jobsHeaderRowNum} (by "Job ID"), data begins at row ${jobsFirstDataRow}.`);
say(`All Jobs header row width: ${jobsWidth} columns (A..${colLetter(jobsWidth)})`);
say(`All Jobs header: ${jobsHeaderRow.slice(0, jobsWidth).join(' | ')}`);
const allJobsFullWidth = Math.max(jobsWidth, allJobsMeta.grid?.columnCount ?? 0) || jobsWidth;

const jobsFieldByIndex = columnFieldMap(jobsHeaderRow.slice(0, jobsWidth), JOB_FIELDS);
const jobIdCol = jobsHeaderRow.findIndex((h) => /^job\s*id$|^id$/i.test(String(h ?? '').trim()));
if (jobIdCol < 0) fail('Could not find a "Job ID" column in All Jobs header row.');
const woCol = jobsHeaderRow.findIndex((h) => /^wo\s*#?|work\s*order/i.test(String(h ?? '').trim()));
const poCol = jobsHeaderRow.findIndex((h) => /^po\s*#?|purchase\s*order/i.test(String(h ?? '').trim()));

const jobRows = [];
for (let r = jobsFirstDataRow; r <= allJobsRaw.length; r++) {
  const cells = allJobsRaw[r - 1] ?? [];
  const jobId = String(cells[jobIdCol] ?? '').trim();
  if (!hasAnyValue(cells.slice(0, jobsWidth))) continue; // title/banner/instruction rows are never data
  jobRows.push({ row: r, jobId, cells: cells.slice(0, jobsWidth) });
}
say(`Populated All Jobs data rows found (below the header, Job ID or any field non-blank): ${jobRows.length}`);
say(jobRows.map((j) => `  row ${j.row}: ${j.jobId} | WO ${j.cells[woCol] ?? ''} | PO ${j.cells[poCol] ?? ''}`).join('\n'));

/* ---- identity + count checks ---- */
const targetRows = jobRows.filter((j) => j.jobId === KEEP_JOB_ID);
if (targetRows.length !== 1) fail(`Expected exactly one ${KEEP_JOB_ID}, found ${targetRows.length}.`);
const target = targetRows[0];
say(`\nConfirmed: ${KEEP_JOB_ID} exists exactly once, at row ${target.row}.`);

const legacyRows = jobRows.filter((j) => j.jobId !== KEEP_JOB_ID);
if (jobRows.length !== EXPECTED_TOTAL_JOBS) {
  fail(`Expected exactly ${EXPECTED_TOTAL_JOBS} total job rows, found ${jobRows.length}. Reported above for review.`);
}
if (legacyRows.length !== EXPECTED_LEGACY_JOBS) {
  fail(`Expected exactly ${EXPECTED_LEGACY_JOBS} legacy job rows, found ${legacyRows.length}.`);
}
const dupIds = legacyRows.map((j) => j.jobId).filter((id, i, arr) => arr.indexOf(id) !== i);
if (dupIds.length) fail(`Duplicate Job IDs found among legacy rows: ${dupIds.join(', ')}`);

say(`\nLegacy Job IDs (${legacyRows.length}): ${legacyRows.map((j) => j.jobId).join(', ')}`);

/* ---- Daily Logs raw ---- */
say('\n=== PHASE 1b — read Daily Logs (raw) ===');
const logsRaw = await readRaw(DAILY_LOGS, (dailyLogsMeta.grid?.rowCount ?? 310) + 10);

const logsHeaderIdx = findHeaderRowIndex(logsRaw, /^log\s*id/i);
if (logsHeaderIdx < 0) fail('Could not locate the Daily Logs header row (no cell in the first 15 rows matches "Log ID").');
const logsHeaderRowNum = logsHeaderIdx + 1;
const logsFirstDataRow = logsHeaderRowNum + 1;
const logsHeaderRow = logsRaw[logsHeaderIdx] ?? [];
const logsWidth = realWidth(logsHeaderRow);
say(`Daily Logs header detected at row ${logsHeaderRowNum} (by "Log ID"), data begins at row ${logsFirstDataRow}.`);
say(`Daily Logs header row width: ${logsWidth} columns`);
const dailyLogsFullWidth = Math.max(logsWidth, dailyLogsMeta.grid?.columnCount ?? 0) || logsWidth;

const logsFieldByIndex = columnFieldMap(logsHeaderRow.slice(0, logsWidth), LOG_FIELDS);
const logsJobIdCol = logsHeaderRow.findIndex((h) => /^job\s*id$/i.test(String(h ?? '').trim()));
if (logsWidth > 0 && logsJobIdCol < 0) fail('Could not find a "Job ID" column in Daily Logs header row.');
const logIdCol = logsHeaderRow.findIndex((h) => /^log\s*id/i.test(String(h ?? '').trim()));
if (logsWidth > 0 && logIdCol < 0) fail('Could not find a "Log ID" column in Daily Logs header row.');

const logRows = [];
if (logsWidth > 0) {
  for (let r = logsFirstDataRow; r <= logsRaw.length; r++) {
    const cells = logsRaw[r - 1] ?? [];
    if (!hasAnyValue(cells.slice(0, logsWidth))) continue;
    logRows.push({ row: r, jobId: String(cells[logsJobIdCol] ?? '').trim(), cells: cells.slice(0, logsWidth) });
  }
}
say(`Populated Daily Logs data rows found: ${logRows.length}`);
if (logRows.length !== EXPECTED_TOTAL_LOGS) {
  fail(`Expected exactly ${EXPECTED_TOTAL_LOGS} total Daily Logs rows, found ${logRows.length}.`);
}

const legacyIdSet = new Set(legacyRows.map((j) => j.jobId));
const legacyLogRows = logRows.filter((l) => legacyIdSet.has(l.jobId));
const keptLogRows = logRows.filter((l) => !legacyIdSet.has(l.jobId));
say(`Daily Logs linked to a legacy job (to archive+clear): ${legacyLogRows.length}`);
say(`Daily Logs NOT linked to a legacy job (left untouched): ${keptLogRows.length}` +
  (keptLogRows.length ? ` — ${keptLogRows.map((l) => `row ${l.row} (jobId="${l.jobId}")`).join(', ')}` : ''));
if (legacyLogRows.length !== EXPECTED_LEGACY_LOGS) {
  fail(`Expected exactly ${EXPECTED_LEGACY_LOGS} legacy Daily Logs rows, found ${legacyLogRows.length}.`);
}
if (legacyLogRows.length !== logRows.length) {
  fail(`Expected every Daily Logs row to be linked to a legacy job (2 of 2); ` +
    `${logRows.length - legacyLogRows.length} row(s) are not. See above.`);
}

say('\nAll pre-condition checks passed.');

if (DRY_RUN) {
  say('\nDRY_RUN=1 — stopping here before any write. Nothing was created, backed up, archived or cleared.');
  process.exit(0);
}

/* ==================================================================== *
 * VERIFY_ONLY — strictly read-only. No sheet is created, filled, cleared,
 * updated or formatted anywhere below this block. Every check Phase 5
 * would otherwise gate on is run here, each printed as its own PASS/FAIL
 * line, and the script always exits before Phase 2 — the same identical
 * UNFORMATTED_VALUE + SERIAL_NUMBER comparator (readRaw/diffRow) as every
 * other verification in this script, matched by identity (Job ID for
 * jobs, full-row identity for logs) rather than assumed row order.
 * ==================================================================== */
if (VERIFY_ONLY) {
  say('\n=== VERIFY_ONLY — checking the four existing sheets, read-only ===');

  async function readForVerify(label, sheetName, expectedCount, headerPattern, width) {
    let raw;
    try {
      raw = await readRaw(sheetName, expectedCount + 15);
    } catch (e) {
      verifyCheck(`${label} — sheet readable`, false, `could not read "${sheetName}": ${e.message}`);
      return null;
    }
    const headerIdx = findHeaderRowIndex(raw, headerPattern);
    const dataRows = (headerIdx >= 0 ? raw.slice(headerIdx + 1) : raw.slice(1)).filter(hasAnyValue);
    verifyCheck(`${label} — row count`, dataRows.length === expectedCount,
      `expected ${expectedCount}, found ${dataRows.length}`);
    return dataRows.map((cells, i) => ({ row: i, cells: cells.slice(0, width) }));
  }

  async function verifyJobsByKey(label, sheetName, expectedCount, sourceRows, headerRow, fieldByIndex, width, headerPattern, keyFn) {
    const otherRows = await readForVerify(label, sheetName, expectedCount, headerPattern, width);
    if (!otherRows) return null;
    const { matched, unmatchedSource, unmatchedOther } = matchByKey(sourceRows, otherRows, keyFn);
    verifyCheck(`${label} — every source row has a matching archive row`, unmatchedSource.length === 0,
      unmatchedSource.length ? `unmatched: ${unmatchedSource.map((s) => s.jobId ?? `row ${s.row}`).join(', ')}` : undefined);
    verifyCheck(`${label} — no unexpected extra rows`, unmatchedOther.length === 0,
      unmatchedOther.length ? `${unmatchedOther.length} row(s) in the archive matched no source row` : undefined);
    let allMatch = true;
    for (const { source, other } of matched) {
      const diffs = diffRow(source.cells, other.cells, headerRow, fieldByIndex, width);
      if (diffs.length) { allMatch = false; reportDiffs(`${label} — ${source.jobId ?? `source row ${source.row}`}`, diffs); }
    }
    verifyCheck(`${label} — every matched row identical to source`, allMatch);
    return otherRows;
  }

  // Backup Daily Logs: unchanged — Log-ID-first matching via matchDailyLogs.
  async function verifyLogsByMatch(label, sheetName, expectedCount, sourceRows, headerRow, fieldByIndex, width, headerPattern) {
    const otherRows = await readForVerify(label, sheetName, expectedCount, headerPattern, width);
    if (!otherRows) return null;
    const matchResult = matchDailyLogs(sourceRows, otherRows, logIdCol, logsJobIdCol);
    verifyLogsContentMatch(label, matchResult, expectedCount, headerRow, fieldByIndex, width, logIdCol, logsJobIdCol);
    return otherRows;
  }

  // Legacy Daily Logs Archive: Job-ID-only pairing (see matchLegacyLogsByJobId).
  async function verifyArchiveLogsByJobId(label, sheetName, expectedCount, sourceRows, headerRow, fieldByIndex, width, headerPattern) {
    const otherRows = await readForVerify(label, sheetName, expectedCount, headerPattern, width);
    if (!otherRows) return null;
    const { allIdentical } = compareLegacyLogsArchive(sourceRows, otherRows, logsJobIdCol, logIdCol, headerRow, fieldByIndex, width, label);
    verifyCheck(`${label} — every paired row identical to source (Job-ID pairing)`, allIdentical);
    return otherRows;
  }

  const jobKeyFn = (cells) => String(cells[jobIdCol] ?? '').trim();
  const JOB_HEADER_PATTERN = /^job\s*id$|^id$/i;
  const LOG_HEADER_PATTERN = /^log\s*id/i;

  await verifyJobsByKey(`"${backupJobsName}"`, backupJobsName, EXPECTED_TOTAL_JOBS, jobRows, jobsHeaderRow, jobsFieldByIndex, jobsWidth, JOB_HEADER_PATTERN, jobKeyFn);
  await verifyLogsByMatch(`"${backupLogsName}"`, backupLogsName, EXPECTED_TOTAL_LOGS, logRows, logsHeaderRow, logsFieldByIndex, logsWidth, LOG_HEADER_PATTERN);
  const archiveJobsRows = await verifyJobsByKey(`"${archiveJobsName}"`, archiveJobsName, EXPECTED_LEGACY_JOBS, legacyRows, jobsHeaderRow, jobsFieldByIndex, jobsWidth, JOB_HEADER_PATTERN, jobKeyFn);
  await verifyArchiveLogsByJobId(`"${archiveLogsName}"`, archiveLogsName, EXPECTED_LEGACY_LOGS, legacyLogRows, logsHeaderRow, logsFieldByIndex, logsWidth, LOG_HEADER_PATTERN);

  if (archiveJobsRows) {
    const archiveJobIds = archiveJobsRows.map((r) => String(r.cells[jobIdCol] ?? '').trim());
    verifyCheck(`${KEEP_JOB_ID} absent from "${archiveJobsName}"`, !archiveJobIds.includes(KEEP_JOB_ID));
    verifyCheck(`"${archiveJobsName}" — ${EXPECTED_LEGACY_JOBS} unique Job IDs`,
      new Set(archiveJobIds).size === EXPECTED_LEGACY_JOBS,
      `${new Set(archiveJobIds).size} unique of ${archiveJobIds.length} rows`);
  } else {
    verifyCheck(`${KEEP_JOB_ID} absent from "${archiveJobsName}"`, false, 'skipped — sheet unreadable above');
  }

  summarizeAndExit('VERIFY_ONLY');
}

/* ==================================================================== *
 * REPAIR_ARCHIVES — rebuild ONLY the two legacy archive sheets, using an
 * exact Sheets range copy (values + number formats, full row width) so
 * there is no hand-computed column width and no schema-field mapping on
 * the write path — the class of bug that can silently misalign a column.
 * All Jobs and Daily Logs are never written to in this mode. Exits before
 * Phase 2 and long before Phase 5.
 * ==================================================================== */
if (REPAIR_ARCHIVES) {
  say('\n=== REPAIR_ARCHIVES — rebuilding the two legacy archive sheets from source ===');

  const archiveJobsMeta = metaBefore.get(archiveJobsName);
  const archiveLogsMeta = metaBefore.get(archiveLogsName);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyJobsName = `${archiveJobsName} SAFETY ${stamp}`.slice(0, 100);
  const safetyLogsName = `${archiveLogsName} SAFETY ${stamp}`.slice(0, 100);
  await api.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [
      { duplicateSheet: { sourceSheetId: archiveJobsMeta.sheetId, newSheetName: safetyJobsName } },
      { duplicateSheet: { sourceSheetId: archiveLogsMeta.sheetId, newSheetName: safetyLogsName } },
    ] },
  });
  say(`Safety copy created: "${safetyJobsName}" (pre-repair snapshot of "${archiveJobsName}")`);
  say(`Safety copy created: "${safetyLogsName}" (pre-repair snapshot of "${archiveLogsName}")`);

  say('\nClearing only the data-body rows (row 2 downward — the header row is never touched)...');
  await api.spreadsheets.values.batchClear({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { ranges: [
      `${quote(archiveJobsName)}!A2:${colLetter(MAX_COL)}`,
      `${quote(archiveLogsName)}!A2:${colLetter(MAX_COL)}`,
    ] },
  });
  say(`Cleared data-body rows of "${archiveJobsName}" and "${archiveLogsName}".`);

  say('\nCopying source rows via exact Sheets range copy (values + number formats, full row width)...');
  const copyRequests = [];
  legacyRows.forEach((j, i) => {
    copyRequests.push({ copyPaste: {
      source: { sheetId: allJobsMeta.sheetId, startRowIndex: j.row - 1, endRowIndex: j.row,
        startColumnIndex: 0, endColumnIndex: allJobsFullWidth },
      destination: { sheetId: archiveJobsMeta.sheetId, startRowIndex: 1 + i, endRowIndex: 2 + i,
        startColumnIndex: 0, endColumnIndex: allJobsFullWidth },
      pasteType: 'PASTE_NORMAL',
    } });
  });
  legacyLogRows.forEach((l, i) => {
    copyRequests.push({ copyPaste: {
      source: { sheetId: dailyLogsMeta.sheetId, startRowIndex: l.row - 1, endRowIndex: l.row,
        startColumnIndex: 0, endColumnIndex: dailyLogsFullWidth },
      destination: { sheetId: archiveLogsMeta.sheetId, startRowIndex: 1 + i, endRowIndex: 2 + i,
        startColumnIndex: 0, endColumnIndex: dailyLogsFullWidth },
      pasteType: 'PASTE_NORMAL',
    } });
  });
  await api.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: copyRequests } });
  say(`Copied ${legacyRows.length} All Jobs row(s) and ${legacyLogRows.length} Daily Logs row(s) into the archives — ` +
    'no array reconstruction, no computed width, no field mapping: each row is an exact range copy of the source row, ' +
    'value-for-value and format-for-format, in original column order.');

  /* ---- strict re-verification, matched by identity, with the named TR-2026-012 assertion ---- */
  say('\n=== REPAIR_ARCHIVES — verifying the rebuilt archives ===');

  const jobKeyFn = (cells) => String(cells[jobIdCol] ?? '').trim();

  const freshArchiveJobsRaw = await readRaw(archiveJobsName, legacyRows.length + 5);
  const archiveJobsData = freshArchiveJobsRaw.slice(1).filter(hasAnyValue).map((cells) => cells.slice(0, jobsWidth));
  verifyCheck(`"${archiveJobsName}" — row count`, archiveJobsData.length === EXPECTED_LEGACY_JOBS,
    `expected ${EXPECTED_LEGACY_JOBS}, found ${archiveJobsData.length}`);

  const jobsMatch = matchByKey(legacyRows, archiveJobsData.map((cells, i) => ({ row: i, cells })), jobKeyFn);
  verifyCheck(`"${archiveJobsName}" — every legacy job matched by Job ID`, jobsMatch.unmatchedSource.length === 0,
    jobsMatch.unmatchedSource.length ? `missing: ${jobsMatch.unmatchedSource.map((s) => s.jobId).join(', ')}` : undefined);
  verifyCheck(`"${archiveJobsName}" — no unexpected extra rows`, jobsMatch.unmatchedOther.length === 0);
  let jobsAllMatch = true;
  for (const { source, other } of jobsMatch.matched) {
    const diffs = diffRow(source.cells, other.cells, jobsHeaderRow, jobsFieldByIndex, jobsWidth);
    if (diffs.length) { jobsAllMatch = false; reportDiffs(`${source.jobId} vs archive`, diffs); }
  }
  verifyCheck(`"${archiveJobsName}" — every matched row identical to source (values + types)`, jobsAllMatch);

  const archiveJobIds = archiveJobsData.map((cells) => String(cells[jobIdCol] ?? '').trim());
  verifyCheck(`${KEEP_JOB_ID} absent from "${archiveJobsName}"`, !archiveJobIds.includes(KEEP_JOB_ID));
  verifyCheck(`"${archiveJobsName}" — ${EXPECTED_LEGACY_JOBS} unique Job IDs`,
    new Set(archiveJobIds).size === EXPECTED_LEGACY_JOBS,
    `${new Set(archiveJobIds).size} unique of ${archiveJobIds.length} rows`);

  const freshArchiveLogsRaw = await readRaw(archiveLogsName, legacyLogRows.length + 5);
  const archiveLogsData = freshArchiveLogsRaw.slice(1).filter(hasAnyValue).map((cells) => cells.slice(0, logsWidth));
  const archiveLogsOther = archiveLogsData.map((cells, i) => ({ row: i, cells }));

  const archiveLogsLabel = `"${archiveLogsName}"`;
  const { allIdentical: logsAllIdentical } = compareLegacyLogsArchive(
    legacyLogRows, archiveLogsOther, logsJobIdCol, logIdCol, logsHeaderRow, logsFieldByIndex, logsWidth, archiveLogsLabel,
  );
  verifyCheck(`${archiveLogsLabel} — every paired row identical to source (Job-ID pairing)`, logsAllIdentical);

  /* ---- the specific, named regression check ---- */
  const notesColIdx = [...logsFieldByIndex.entries()].find(([, name]) => name === 'notes')?.[0];
  const tr012Source = legacyLogRows.find((l) => l.jobId === NOTES_CHECK_JOB_ID);
  const tr012Archive = archiveLogsOther.find((r) => String(r.cells[logsJobIdCol] ?? '').trim() === NOTES_CHECK_JOB_ID);
  if (notesColIdx === undefined) {
    verifyCheck('Notes column resolved in Daily Logs header', false, 'no column maps to the "notes" field');
  } else if (!tr012Source) {
    verifyCheck(`${NOTES_CHECK_JOB_ID} present among legacy Daily Logs`, false, 'not found in source legacy log rows');
  } else {
    const sourceNotes = normalizeCell(tr012Source.cells[notesColIdx], 'notes');
    verifyCheck(`${NOTES_CHECK_JOB_ID} source Notes is blank`, sourceNotes === '',
      `source Notes = ${JSON.stringify(displayValue(sourceNotes))}`);
    if (!tr012Archive) {
      verifyCheck(`${NOTES_CHECK_JOB_ID} archived Notes is blank (not 6)`, false, 'no archive row found with this Job ID');
    } else {
      const archivedNotes = normalizeCell(tr012Archive.cells[notesColIdx], 'notes');
      verifyCheck(`${NOTES_CHECK_JOB_ID} archived Notes is blank (not 6)`, archivedNotes === '',
        `archived Notes = ${JSON.stringify(displayValue(archivedNotes))} (raw: ${JSON.stringify(tr012Archive.cells[notesColIdx])})`);
    }
  }

  summarizeAndExit('REPAIR_ARCHIVES');
}

/* ==================================================================== *
 * REPAIR_LEGACY_LOG_IDS_ONLY — the narrowest possible write. Repairs
 * nothing but the Log ID cell(s) of LEGACY DAILY LOGS ARCHIVE 2026-08-25,
 * and only after confirming every other column already matches exactly.
 * Never touches All Jobs, Daily Logs, either backup, or the Legacy Jobs
 * Archive. Exits before Phase 2 and long before Phase 5.
 * ==================================================================== */
if (REPAIR_LEGACY_LOG_IDS_ONLY) {
  say('\n=== REPAIR_LEGACY_LOG_IDS_ONLY — repairing only the Log ID cell(s) ===');

  const archiveLogsMetaForRepair = metaBefore.get(archiveLogsName);
  if (!archiveLogsMetaForRepair) fail(`"${archiveLogsName}" not found.`);

  /* ---- detect the archive's own header row and columns independently ---- */
  const archiveRawForRepair = await readRaw(archiveLogsName, EXPECTED_LEGACY_LOGS + 15);
  const archiveHeaderIdx = findHeaderRowIndex(archiveRawForRepair, /^log\s*id/i);
  if (archiveHeaderIdx < 0) fail(`Could not locate the header row in "${archiveLogsName}" (no cell matches "Log ID").`);
  const archiveHeaderRow = archiveRawForRepair[archiveHeaderIdx] ?? [];
  const archiveLogIdCol = archiveHeaderRow.findIndex((h) => /^log\s*id/i.test(String(h ?? '').trim()));
  const archiveJobIdCol = archiveHeaderRow.findIndex((h) => /^job\s*id$/i.test(String(h ?? '').trim()));
  if (archiveLogIdCol < 0) fail(`Could not find a "Log ID" column in "${archiveLogsName}".`);
  if (archiveJobIdCol < 0) fail(`Could not find a "Job ID" column in "${archiveLogsName}".`);
  say(`Source Daily Logs: header at row ${logsHeaderRowNum}; Log ID column ${colLetter(logIdCol + 1)}, Job ID column ${colLetter(logsJobIdCol + 1)}.`);
  say(`"${archiveLogsName}": header detected at row ${archiveHeaderIdx + 1}; Log ID column ${colLetter(archiveLogIdCol + 1)}, Job ID column ${colLetter(archiveJobIdCol + 1)}.`);

  // The rest of this mode assumes columns line up positionally between
  // source and archive (same as every other archive comparison in this
  // script) — confirm that assumption explicitly rather than silently
  // relying on it.
  if (logIdCol !== archiveLogIdCol) {
    fail(`Log ID column position differs between source (${colLetter(logIdCol + 1)}) and archive ` +
      `(${colLetter(archiveLogIdCol + 1)}) — structural mismatch, refusing to proceed.`);
  }
  if (logsJobIdCol !== archiveJobIdCol) {
    fail(`Job ID column position differs between source (${colLetter(logsJobIdCol + 1)}) and archive ` +
      `(${colLetter(archiveJobIdCol + 1)}) — structural mismatch, refusing to proceed.`);
  }

  const archiveDataRowsForRepair = archiveRawForRepair.slice(archiveHeaderIdx + 1).filter(hasAnyValue)
    .map((cells, i) => ({ row: archiveHeaderIdx + 2 + i, cells: cells.slice(0, logsWidth) }));

  /* ---- hard-check + pair by Job ID only ---- */
  const repairLabel = `"${archiveLogsName}" (Log ID repair)`;
  const { matched: repairMatched, hardFailed: repairHardFailed } =
    matchLegacyLogsByJobId(legacyLogRows, archiveDataRowsForRepair, archiveJobIdCol, repairLabel);
  if (repairHardFailed) {
    fail('REPAIR_LEGACY_LOG_IDS_ONLY aborted: Job-ID hard-asserts failed — see PASS/FAIL lines above.');
  }

  /* ---- every existing difference must be confined to the Log ID column ---- */
  say('\nChecking that every existing difference between source and archive is confined to the Log ID column...');
  const toRepair = [];
  let onlyLogIdDiffers = true;
  for (const { jobId, source, other } of repairMatched) {
    const srcLogId = source.cells[logIdCol] ?? '';
    const othLogId = other.cells[archiveLogIdCol] ?? '';
    say(`  Job ID ${jobId} — source Log ID: ${srcLogId === '' ? '(blank)' : JSON.stringify(srcLogId)}, ` +
      `archive Log ID: ${othLogId === '' ? '(blank)' : JSON.stringify(othLogId)}`);

    const nonLogIdDiffs = [];
    for (let i = 0; i < logsWidth; i++) {
      if (i === logIdCol) continue;
      const fieldName = logsFieldByIndex.get(i) ?? null;
      const a = normalizeCell(source.cells[i], fieldName);
      const b = normalizeCell(other.cells[i], fieldName);
      if (a !== b) {
        nonLogIdDiffs.push({
          column: logsHeaderRow[i] ?? `(col ${colLetter(i + 1)})`, field: fieldName ?? '(unmapped)',
          source: displayValue(a), other: displayValue(b),
        });
      }
    }
    if (nonLogIdDiffs.length) {
      onlyLogIdDiffers = false;
      say(`    NON-Log-ID difference(s) found for Job ID ${jobId} — this mode refuses to touch anything but Log ID:`);
      for (const d of nonLogIdDiffs) {
        say(`      column "${d.column}" (field: ${d.field}) — source=${JSON.stringify(d.source)} archive=${JSON.stringify(d.other)}`);
      }
    }
    if (srcLogId !== othLogId) toRepair.push({ jobId, source, other });
  }
  if (!onlyLogIdDiffers) {
    fail('REPAIR_LEGACY_LOG_IDS_ONLY aborted: at least one paired row differs outside the Log ID column — see above. Nothing was written.');
  }
  say(toRepair.length
    ? `\n${toRepair.length} row(s) need their Log ID repaired: ${toRepair.map((r) => r.jobId).join(', ')}.`
    : '\nNo Log ID differences found — both rows already match. Proceeding to create the safety copy and verify anyway.');

  /* ---- timestamped safety copy of the archive, before any write ---- */
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyName = `${archiveLogsName} SAFETY ${stamp}`.slice(0, 100);
  await api.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [
      { duplicateSheet: { sourceSheetId: archiveLogsMetaForRepair.sheetId, newSheetName: safetyName } },
    ] },
  });
  say(`Safety copy created: "${safetyName}" (pre-repair snapshot of "${archiveLogsName}").`);

  /* ---- copy only the single Log ID cell per row that actually needs it ---- */
  if (toRepair.length) {
    const copyRequests = toRepair.map(({ source, other }) => ({
      copyPaste: {
        source: { sheetId: dailyLogsMeta.sheetId, startRowIndex: source.row - 1, endRowIndex: source.row,
          startColumnIndex: logIdCol, endColumnIndex: logIdCol + 1 },
        destination: { sheetId: archiveLogsMetaForRepair.sheetId, startRowIndex: other.row - 1, endRowIndex: other.row,
          startColumnIndex: archiveLogIdCol, endColumnIndex: archiveLogIdCol + 1 },
        pasteType: 'PASTE_NORMAL',
      },
    }));
    await api.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: copyRequests } });
    say(`Copied the Log ID cell for ${copyRequests.length} row(s) from "${DAILY_LOGS}" to "${archiveLogsName}" — ` +
      'a native single-cell range copy of the actual source cell, never typed or hardcoded.');
  }

  /* ---- re-read fresh and verify all columns, zero differences required ---- */
  say('\n=== REPAIR_LEGACY_LOG_IDS_ONLY — verifying the repaired archive ===');
  const freshArchiveRaw = await readRaw(archiveLogsName, EXPECTED_LEGACY_LOGS + 15);
  const freshHeaderIdx = findHeaderRowIndex(freshArchiveRaw, /^log\s*id/i);
  const freshDataRows = (freshHeaderIdx >= 0 ? freshArchiveRaw.slice(freshHeaderIdx + 1) : freshArchiveRaw.slice(1))
    .filter(hasAnyValue).map((cells, i) => ({ row: i, cells: cells.slice(0, logsWidth) }));

  const { matched: freshMatched, hardFailed: freshHardFailed } =
    matchLegacyLogsByJobId(legacyLogRows, freshDataRows, archiveJobIdCol, `"${archiveLogsName}" (post-repair)`);
  if (freshHardFailed) fail('Post-repair re-verification failed the Job-ID hard-asserts.');

  let allIdentical = true;
  for (const { jobId, source, other } of freshMatched) {
    const srcLogId = source.cells[logIdCol] ?? '';
    const othLogId = other.cells[archiveLogIdCol] ?? '';
    say(`  Job ID ${jobId} — source Log ID: ${srcLogId === '' ? '(blank)' : JSON.stringify(srcLogId)}, ` +
      `archive Log ID: ${othLogId === '' ? '(blank)' : JSON.stringify(othLogId)}`);
    const diffs = diffRow(source.cells, other.cells, logsHeaderRow, logsFieldByIndex, logsWidth);
    if (diffs.length) {
      allIdentical = false;
      reportLogDiffs(source, other, diffs, logIdCol, logsJobIdCol);
    } else {
      say(`    all ${logsWidth} columns match — zero differences.`);
    }
  }
  verifyCheck(`"${archiveLogsName}" — all ${logsWidth} columns identical for both rows after repair`,
    allIdentical && freshMatched.length === EXPECTED_LEGACY_LOGS);

  summarizeAndExit('REPAIR_LEGACY_LOG_IDS_ONLY');
}

/* ==================================================================== *
 * PHASE 2 — backup: full duplicate of All Jobs and Daily Logs
 * ==================================================================== */
say('\n=== PHASE 2 — backup sheets ===');
if (!RESUME) {
  await api.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [
      { duplicateSheet: { sourceSheetId: allJobsMeta.sheetId, newSheetName: backupJobsName } },
      { duplicateSheet: { sourceSheetId: dailyLogsMeta.sheetId, newSheetName: backupLogsName } },
    ] },
  });
  say(`Created "${backupJobsName}" (full duplicate of All Jobs, formulas/formatting/validation intact).`);
  say(`Created "${backupLogsName}" (full duplicate of Daily Logs).`);
} else {
  say(`RESUME=1 — reusing existing "${backupJobsName}" and "${backupLogsName}".`);
}

/* ---- verify backup: row counts + normalized cell-for-cell match, matched by identity ---- */
say('\n=== PHASE 2b — verify backup (identical read options both sides, matched by identity) ===');

async function verifyBackup(label, sheetName, sourceRows, headerRow, fieldByIndex, width, headerPattern, keyFn) {
  const raw = await readRaw(sheetName, sourceRows.length + 15);
  const headerIdx = findHeaderRowIndex(raw, headerPattern);
  if (headerIdx < 0) fail(`Backup verification failed: could not locate the header row in "${sheetName}".`);
  const dataRows = raw.slice(headerIdx + 1).filter(hasAnyValue).map((cells) => cells.slice(0, width));
  say(`"${sheetName}": header detected at row ${headerIdx + 1}, ${dataRows.length} data row(s) below it.`);
  if (dataRows.length !== sourceRows.length) {
    fail(`Backup verification failed: "${sheetName}" has ${dataRows.length} data rows, expected ${sourceRows.length}.`);
  }
  const { matched, unmatchedSource, unmatchedOther } = matchByKey(
    sourceRows, dataRows.map((cells, i) => ({ row: i, cells })), keyFn,
  );
  if (unmatchedSource.length) {
    fail(`Backup verification failed: "${sheetName}" is missing ${unmatchedSource.map((s) => s.jobId ?? `row ${s.row}`).join(', ')}.`);
  }
  if (unmatchedOther.length) {
    fail(`Backup verification failed: "${sheetName}" has ${unmatchedOther.length} row(s) that match no source row.`);
  }
  let ok = true;
  for (const { source, other } of matched) {
    const diffs = diffRow(source.cells, other.cells, headerRow, fieldByIndex, width);
    if (diffs.length) { ok = false; reportDiffs(`${label} ${source.jobId ?? `row ${source.row}`} vs backup`, diffs); }
  }
  if (!ok) fail(`Backup verification failed for "${sheetName}" — see differences above.`);
  say(`Backup verified: all ${sourceRows.length} row(s) present in "${sheetName}", matched by identity, identical to the source.`);
}

/**
 * Daily Logs counterpart of verifyBackup, using matchDailyLogs instead of a
 * single key function — never full-row identity. Same hard-abort semantics
 * as verifyBackup: this runs on the live-clearing-eligible path, so any
 * mismatch here still stops the script before anything is cleared.
 */
async function verifyLogsBackup(sheetName, sourceRows) {
  const raw = await readRaw(sheetName, sourceRows.length + 15);
  const headerIdx = findHeaderRowIndex(raw, /^log\s*id/i);
  if (headerIdx < 0) fail(`Backup verification failed: could not locate the header row in "${sheetName}".`);
  const dataRows = raw.slice(headerIdx + 1).filter(hasAnyValue).map((cells) => cells.slice(0, logsWidth));
  say(`"${sheetName}": header detected at row ${headerIdx + 1}, ${dataRows.length} data row(s) below it.`);
  if (dataRows.length !== sourceRows.length) {
    fail(`Backup verification failed: "${sheetName}" has ${dataRows.length} data rows, expected ${sourceRows.length}.`);
  }
  const matchResult = matchDailyLogs(sourceRows, dataRows.map((cells, i) => ({ row: i, cells })), logIdCol, logsJobIdCol);
  if (matchResult.unmatchedSource.length) {
    fail(`Backup verification failed: "${sheetName}" is missing ${matchResult.unmatchedSource
      .map((s) => `Job ${s.cells[logsJobIdCol] ?? ''}/Log ${s.cells[logIdCol] ?? '(blank)'}`).join(', ')}.`);
  }
  if (matchResult.unmatchedOther.length) {
    fail(`Backup verification failed: "${sheetName}" has ${matchResult.unmatchedOther.length} row(s) that match no source row.`);
  }
  if (matchResult.matched.length !== sourceRows.length) {
    fail(`Backup verification failed: "${sheetName}" matched only ${matchResult.matched.length} of ${sourceRows.length} rows.`);
  }
  let ok = true;
  for (const { source, other } of matchResult.matched) {
    const diffs = diffRow(source.cells, other.cells, logsHeaderRow, logsFieldByIndex, logsWidth);
    if (diffs.length) { ok = false; reportLogDiffs(source, other, diffs, logIdCol, logsJobIdCol); }
  }
  if (!ok) fail(`Backup verification failed for "${sheetName}" — see differences above.`);
  say(`Backup verified: all ${sourceRows.length} row(s) present in "${sheetName}", matched by Log ID / Job ID, identical to the source.`);
}

await verifyBackup('All Jobs', backupJobsName, jobRows, jobsHeaderRow, jobsFieldByIndex, jobsWidth,
  /^job\s*id$|^id$/i, (cells) => String(cells[jobIdCol] ?? '').trim());
await verifyLogsBackup(backupLogsName, logRows);

/* ==================================================================== *
 * Helper: ensure an archive sheet exists with the given content — create
 * it fresh, or (RESUME) fill it if it exists but is still empty, or
 * (RESUME) leave it alone if it already has data — then read it back.
 * ==================================================================== */
async function ensureArchiveSheet(sheetName, values) {
  if (!RESUME) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    say(`Created "${sheetName}".`);
    await api.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `${quote(sheetName)}!A1`,
      valueInputOption: 'RAW', requestBody: { values },
    });
    say(`Wrote header + ${values.length - 1} row(s) to "${sheetName}".`);
    return;
  }
  const existing = await readRaw(sheetName, values.length + 5);
  const existingData = existing.slice(1).filter(hasAnyValue);
  if (existingData.length === 0) {
    say(`RESUME=1 — "${sheetName}" exists but is empty; writing content now.`);
    await api.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `${quote(sheetName)}!A1`,
      valueInputOption: 'RAW', requestBody: { values },
    });
  } else {
    say(`RESUME=1 — "${sheetName}" already has ${existingData.length} data row(s); leaving content as-is, verifying only.`);
  }
}

/* ==================================================================== *
 * PHASE 3 — Legacy Jobs Archive: create/fill, verify
 * ==================================================================== */
say('\n=== PHASE 3 — Legacy Jobs Archive ===');
const provenanceHeaderJobs = 'Archived From Row (All Jobs)';
const archiveJobsValues = [
  [...jobsHeaderRow.slice(0, jobsWidth), provenanceHeaderJobs],
  ...legacyRows.map((j) => [...j.cells, j.row]),
];
await ensureArchiveSheet(archiveJobsName, archiveJobsValues);

const archiveJobsRaw = await readRaw(archiveJobsName, legacyRows.length + 5);
const archiveDataRows = archiveJobsRaw.slice(1).filter(hasAnyValue);
if (archiveDataRows.length !== EXPECTED_LEGACY_JOBS) {
  fail(`Legacy Jobs Archive verification failed: expected ${EXPECTED_LEGACY_JOBS} rows, found ${archiveDataRows.length}.`);
}
const archiveJobIds = archiveDataRows.map((r) => String(r[jobIdCol] ?? '').trim());
if (new Set(archiveJobIds).size !== EXPECTED_LEGACY_JOBS) {
  fail('Legacy Jobs Archive verification failed: duplicate Job IDs in the archive.');
}
if (archiveJobIds.includes(KEEP_JOB_ID)) {
  fail(`Legacy Jobs Archive verification failed: ${KEEP_JOB_ID} must not appear in the archive.`);
}

say('Comparing each archived job row against its source, matched by Job ID:');
const jobsArchiveMatch = matchByKey(legacyRows, archiveDataRows.map((cells, i) => ({ row: i, cells: cells.slice(0, jobsWidth) })),
  (cells) => String(cells[jobIdCol] ?? '').trim());
if (jobsArchiveMatch.unmatchedSource.length) {
  fail(`Legacy Jobs Archive verification failed: missing ${jobsArchiveMatch.unmatchedSource.map((s) => s.jobId).join(', ')}.`);
}
let archiveJobsOk = true;
for (const { source, other } of jobsArchiveMatch.matched) {
  const diffs = diffRow(source.cells, other.cells, jobsHeaderRow, jobsFieldByIndex, jobsWidth);
  if (diffs.length) { archiveJobsOk = false; reportDiffs(`${source.jobId} (source row ${source.row})`, diffs); }
}
if (!archiveJobsOk) fail(`Legacy Jobs Archive verification failed — see differences above.`);

say(`Verified: "${archiveJobsName}" holds exactly ${EXPECTED_LEGACY_JOBS} unique jobs, ${KEEP_JOB_ID} is absent, ` +
  'every field matches the source exactly.');
say(`Archived Job IDs (WO / PO): ${legacyRows.map((j) => `${j.jobId} (WO ${j.cells[woCol] ?? '—'} / PO ${j.cells[poCol] ?? '—'})`).join(', ')}`);

/* ==================================================================== *
 * PHASE 4 — Legacy Daily Logs Archive: create/fill, verify
 * ==================================================================== */
say('\n=== PHASE 4 — Legacy Daily Logs Archive ===');
const provenanceHeaderLogs = 'Archived From Row (Daily Logs)';
const archiveLogsValues = [
  [...logsHeaderRow.slice(0, logsWidth), provenanceHeaderLogs],
  ...legacyLogRows.map((l) => [...l.cells, l.row]),
];
await ensureArchiveSheet(archiveLogsName, archiveLogsValues);

const archiveLogsRaw = await readRaw(archiveLogsName, legacyLogRows.length + 5);
const archiveLogData = archiveLogsRaw.slice(1).filter(hasAnyValue);
if (archiveLogData.length !== EXPECTED_LEGACY_LOGS) {
  fail(`Legacy Daily Logs Archive verification failed: expected ${EXPECTED_LEGACY_LOGS} rows, found ${archiveLogData.length}.`);
}

say('Comparing each archived Daily Logs row against its source, paired by Job ID only (not Log ID — see matchLegacyLogsByJobId):');
const phase4ArchiveLogsOther = archiveLogData.map((cells, i) => ({ row: i, cells: cells.slice(0, logsWidth) }));
const { allIdentical: phase4LogsAllIdentical, hardFailed: phase4LogsHardFailed } = compareLegacyLogsArchive(
  legacyLogRows, phase4ArchiveLogsOther, logsJobIdCol, logIdCol, logsHeaderRow, logsFieldByIndex, logsWidth,
  `"${archiveLogsName}"`,
);
if (phase4LogsHardFailed) {
  fail(`Legacy Daily Logs Archive verification failed the Job-ID hard-asserts (count/uniqueness/expected IDs) — see PASS/FAIL lines above.`);
}
if (!phase4LogsAllIdentical) fail(`Legacy Daily Logs Archive verification failed — see differences above.`);
say(`Verified: "${archiveLogsName}" holds exactly ${EXPECTED_LEGACY_LOGS} rows, paired by Job ID, all matching the source exactly.`);

/* ==================================================================== *
 * PHASE 5 — CLEAR (values only) the legacy rows — the only destructive step
 *
 * Everything above this line is either read-only or additive (new sheets,
 * new rows elsewhere). This is the one step that changes All Jobs / Daily
 * Logs, and it only runs because every check above passed exactly.
 * ==================================================================== */
say('\n=== PHASE 5 — clearing legacy rows (values only; formatting/validation preserved) ===');
const jobClearRanges = legacyRows.map((j) => `${quote(ALL_JOBS)}!A${j.row}:${colLetter(jobsWidth)}${j.row}`);
await api.spreadsheets.values.batchClear({
  spreadsheetId: SPREADSHEET_ID,
  requestBody: { ranges: jobClearRanges },
});
say(`Cleared ${jobClearRanges.length} legacy rows from "${ALL_JOBS}" (values only — no rows/columns deleted).`);

const logClearRanges = legacyLogRows.map((l) => `${quote(DAILY_LOGS)}!A${l.row}:${colLetter(logsWidth)}${l.row}`);
await api.spreadsheets.values.batchClear({
  spreadsheetId: SPREADSHEET_ID,
  requestBody: { ranges: logClearRanges },
});
say(`Cleared ${logClearRanges.length} legacy rows from "${DAILY_LOGS}" (values only).`);

/* ==================================================================== *
 * PHASE 6 — audit trail
 * ==================================================================== */
say('\n=== PHASE 6 — audit trail ===');
const auditCtx = { user: 'ehsan00831@gmail.com (workbook owner — one-time authorized migration)', source: 'migration-script' };
await recordAudit({ ...auditCtx, action: 'legacy_migration_backup', sheet: ALL_JOBS, row: 0,
  field: 'backup', prev: '', next: `${backupJobsName} (${jobRows.length} rows verified)`, result: 'ok' });
await recordAudit({ ...auditCtx, action: 'legacy_migration_backup', sheet: DAILY_LOGS, row: 0,
  field: 'backup', prev: '', next: `${backupLogsName} (${logRows.length} rows verified)`, result: 'ok' });
await recordAudit({ ...auditCtx, action: 'legacy_migration_archive', sheet: ALL_JOBS, row: 0,
  field: 'archive', prev: `${jobRows.length} active jobs`,
  next: `${archiveJobsName} (${EXPECTED_LEGACY_JOBS} jobs); ${KEEP_JOB_ID} kept active`, result: 'ok' });
await recordAudit({ ...auditCtx, action: 'legacy_migration_clear', sheet: ALL_JOBS, row: 0,
  field: 'active_count', prev: String(jobRows.length), next: '1', result: 'ok' });
await recordAudit({ ...auditCtx, action: 'legacy_migration_archive', sheet: DAILY_LOGS, row: 0,
  field: 'archive', prev: `${logRows.length} log rows`,
  next: `${archiveLogsName} (${EXPECTED_LEGACY_LOGS} rows archived+cleared)`, result: 'ok' });
say('5 audit entries written to _TRT_AUDIT_LOG.');

/* ==================================================================== *
 * PHASE 7 — final re-verification against the live sheet
 * ==================================================================== */
say('\n=== PHASE 7 — final re-verification ===');
const finalJobsRaw = await readRaw(ALL_JOBS, jobsFirstDataRow + (allJobsMeta.grid?.rowCount ?? 160));
const finalRows = [];
for (let r = jobsFirstDataRow; r <= finalJobsRaw.length; r++) {
  const cells = (finalJobsRaw[r - 1] ?? []).slice(0, jobsWidth);
  if (hasAnyValue(cells)) finalRows.push({ row: r, cells });
}
say(`All Jobs active data rows after migration: ${finalRows.length}`);
if (finalRows.length !== 1) fail(`Expected exactly 1 active job after migration, found ${finalRows.length}.`);
const finalJobId = String(finalRows[0].cells[jobIdCol] ?? '').trim();
say(`Remaining Job ID: ${finalJobId}`);
if (finalJobId !== KEEP_JOB_ID) fail(`Remaining job is "${finalJobId}", expected "${KEEP_JOB_ID}".`);
const unchangedDiffs = diffRow(target.cells, finalRows[0].cells, jobsHeaderRow, jobsFieldByIndex, jobsWidth);
say(`${KEEP_JOB_ID} row unchanged vs. pre-migration snapshot: ${unchangedDiffs.length === 0}`);
if (unchangedDiffs.length) {
  reportDiffs(`${KEEP_JOB_ID} before vs after`, unchangedDiffs);
  fail(`${KEEP_JOB_ID}'s row content changed during the migration — this must not happen.`);
}

const finalLogsRaw = await readRaw(DAILY_LOGS, logsFirstDataRow + (dailyLogsMeta.grid?.rowCount ?? 310));
let finalLogCount = 0;
for (let r = logsFirstDataRow; r <= finalLogsRaw.length; r++) {
  if (hasAnyValue((finalLogsRaw[r - 1] ?? []).slice(0, logsWidth))) finalLogCount++;
}
say(`Daily Logs rows after migration: ${finalLogCount}`);
if (finalLogCount !== 0) fail(`Expected 0 Daily Logs rows after migration (NP-96742 has none yet), found ${finalLogCount}.`);

const metaAfter = await getMeta();
for (const t of ['Team & Fleet', 'Settings & Lists', 'Dashboard']) {
  const before = metaBefore.get(t), after = metaAfter.get(t);
  const same = before && after && before.sheetId === after.sheetId;
  say(`${t}: sheetId unchanged = ${same}`);
  if (!same) say(`  WARNING: could not confirm ${t} is unchanged (sheet not found or sheetId differs).`);
}

say('\nScanning formula-driven views for error tokens...');
const FORMULA_VIEWS = ['Upcoming', 'Tomorrow Plan', 'Ongoing', 'Done', 'Materials', 'Long Projects', 'ARCHIVE'];
let anyFormulaError = false;
for (const viewName of FORMULA_VIEWS) {
  if (!metaAfter.has(viewName)) { say(`  ${viewName}: NOT FOUND (unexpected)`); continue; }
  const raw = await readRaw(viewName, 260);
  const errors = [];
  raw.forEach((row, ri) => (row ?? []).forEach((cell, ci) => {
    const v = String(cell ?? '');
    if (RAW_ERRORS.some((e) => v.includes(e))) errors.push(`${colLetter(ci + 1)}${ri + 1}=${v}`);
  }));
  say(`  ${viewName}: ${errors.length === 0 ? 'no errors' : `ERRORS FOUND: ${errors.join(', ')}`}`);
  if (errors.length) anyFormulaError = true;
}
say(anyFormulaError
  ? '\nWARNING: one or more formula-driven views show an error value — see above.'
  : '\nNo #REF!, #VALUE!, #N/A or similar error tokens found in any formula-driven view.');

say('\n=== MIGRATION COMPLETE ===');
say(`Backup: ${backupJobsName} / ${backupLogsName}`);
say(`Legacy Jobs Archive: ${archiveJobsName} (${EXPECTED_LEGACY_JOBS} jobs)`);
say(`Legacy Daily Logs Archive: ${archiveLogsName} (${EXPECTED_LEGACY_LOGS} rows)`);
say(`All Jobs: ${EXPECTED_TOTAL_JOBS} -> 1 (${KEEP_JOB_ID})`);
say(`Daily Logs: ${EXPECTED_TOTAL_LOGS} -> 0`);
