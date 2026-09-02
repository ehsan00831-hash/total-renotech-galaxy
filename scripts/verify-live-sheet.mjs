/**
 * Read-only verification against the real live Google Sheet.
 *
 * Confirms connectivity, tab count, spreadsheet identity, timezone and job
 * count before anything is deployed. Never prints the private key or any
 * other credential material.
 */
import { __setSheetsClientForTests } from '../.test-build/sheets.js';
void __setSheetsClientForTests; // ensure the test seam is not left engaged

const { listSheets, SPREADSHEET_ID, sheetsClient } = await import('../.test-build/sheets.js');
const { listJobs } = await import('../.test-build/jobs.js');

console.log('SPREADSHEET_ID:', SPREADSHEET_ID);

const api = await sheetsClient();
const meta = await api.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
console.log('title:', meta.data.properties?.title);
console.log('timeZone:', meta.data.properties?.timeZone);

const sheets = await listSheets();
console.log('tab count:', sheets.length);
console.log('tabs:', sheets.map((s) => `${s.sheetId}:${JSON.stringify(s.title)}`).join(', '));

const jobs = await listJobs();
console.log('job count:', jobs.length);
console.log('sample job ids:', jobs.slice(0, 5).map((j) => j.jobId).join(', '));
