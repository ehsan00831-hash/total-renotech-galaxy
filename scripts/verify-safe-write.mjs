/**
 * Safe write-and-cleanup verification.
 *
 * Writes to the designated scratch cell _TRT_RUN!Z1000 only if it is
 * currently empty, reads the value back, clears it, and confirms it is
 * empty again. Never touches any other cell or sheet.
 */
const { sheetsClient, SPREADSHEET_ID } = await import('../.test-build/sheets.js');

const RANGE = "'_TRT_RUN'!Z1000";
const api = await sheetsClient();

const before = await api.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
const beforeValue = before.data.values?.[0]?.[0] ?? '';
console.log('Z1000 before:', JSON.stringify(beforeValue));

if (beforeValue !== '') {
  console.log('ABORT: Z1000 is not empty — refusing to write.');
  process.exit(1);
}

const probe = `trt-ops-deploy-verify-${Date.now()}`;
await api.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID, range: RANGE, valueInputOption: 'RAW',
  requestBody: { values: [[probe]] },
});

const after = await api.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
const afterValue = after.data.values?.[0]?.[0] ?? '';
console.log('Z1000 after write:', JSON.stringify(afterValue));
const wrote = afterValue === probe;

await api.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: RANGE });

const cleared = await api.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
const clearedValue = cleared.data.values?.[0]?.[0] ?? '';
console.log('Z1000 after clear:', JSON.stringify(clearedValue));
const cleanedUp = clearedValue === '';

console.log('RESULT:', wrote && cleanedUp ? 'PASS' : 'FAIL');
process.exit(wrote && cleanedUp ? 0 : 1);
