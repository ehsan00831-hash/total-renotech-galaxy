/**
 * Google Sheets sync for form submissions.
 *
 * Every lead that is saved to Excel is also appended to a Google Sheet, in the
 * background, so the owner can see leads live from any phone/computer.
 *
 * Fast by design:
 *   - no heavy `googleapis` dependency — a signed JWT (Node crypto) + fetch
 *   - the OAuth access token is cached and reused until shortly before expiry
 *   - tabs that already exist are remembered, so metadata is fetched only once
 *   - rows are queued and flushed in ONE batch request (values:batchUpdate-style
 *     append per tab), so a burst of submissions costs a single API round-trip
 *   - never blocks the HTTP response; failures are retried with backoff
 *
 * Configure via environment:
 *   GOOGLE_SHEETS_ID            = the spreadsheet id (from its URL /d/<ID>/edit)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL = xxx@yyy.iam.gserviceaccount.com
 *   GOOGLE_PRIVATE_KEY          = the service account private key (PEM; "\n" escapes OK)
 *   (or GOOGLE_SERVICE_ACCOUNT_JSON = the whole service-account JSON key file)
 *
 * Share the spreadsheet with the service account email as "Editor".
 * If not configured, sync is silently disabled and the site keeps working.
 */

const crypto = require('crypto');

function loadCreds() {
  const json = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (json) {
    try {
      const d = JSON.parse(json);
      return { email: d.client_email || '', key: d.private_key || '' };
    } catch (e) {
      console.error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON:', e.message);
    }
  }
  return {
    email: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim(),
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim(),
  };
}

const SHEET_ID = (process.env.GOOGLE_SHEETS_ID || '').trim();
const CREDS = loadCreds();
const API = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(SHEET_ID);
const FLUSH_DELAY_MS = 300; // coalesce bursts into one request
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 10000;

function enabled() {
  return !!(SHEET_ID && CREDS.email && CREDS.key);
}

// ---------- auth (cached access token) ----------
let token = { value: '', exp: 0 };
let tokenPromise = null;

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function getToken() {
  if (token.value && Date.now() < token.exp - 60 * 1000) return token.value;
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({
      iss: CREDS.email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }));
    const signature = b64url(crypto.createSign('RSA-SHA256').update(header + '.' + claim).sign(CREDS.key));
    const r = await timedFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: header + '.' + claim + '.' + signature,
      }),
    });
    if (!r.ok) throw new Error('Google token HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const d = await r.json();
    token = { value: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
    return token.value;
  })().finally(() => { tokenPromise = null; });
  return tokenPromise;
}

function timedFetch(url, opts) {
  return fetch(url, Object.assign({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }, opts));
}

async function api(method, path, body) {
  const r = await timedFetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + (await getToken()), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) token = { value: '', exp: 0 }; // force refresh on next try
  if (!r.ok) {
    const err = new Error('Sheets API HTTP ' + r.status + ': ' + (await r.text()).slice(0, 300));
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// ---------- tabs (created once, then cached) ----------
let knownTabs = null; // Set of tab titles

async function ensureTabs(tabs) {
  if (!knownTabs) {
    const meta = await api('GET', '?fields=sheets.properties.title');
    knownTabs = new Set((meta.sheets || []).map((s) => s.properties.title));
  }
  const missing = Object.keys(tabs).filter((t) => !knownTabs.has(t));
  if (!missing.length) return;

  await api('POST', ':batchUpdate', {
    requests: missing.map((title) => ({
      addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } },
    })),
  });
  // Header rows for the new tabs, in one request.
  await api('POST', '/values:batchUpdate', {
    valueInputOption: 'RAW',
    data: missing.map((title) => ({ range: "'" + title + "'!A1", values: [tabs[title]] })),
  });
  missing.forEach((t) => knownTabs.add(t));
}

// ---------- queue + batched flush ----------
const queue = []; // { tab, headers, values, tries }
let timer = null;
let flushing = false;

function append(tab, headers, values) {
  if (!enabled()) return;
  queue.push({ tab, headers, values, tries: 0 });
  schedule(FLUSH_DELAY_MS);
}

function schedule(ms) {
  if (timer || flushing) return;
  timer = setTimeout(() => { timer = null; flush(); }, ms);
}

async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  try {
    const headersByTab = {};
    const rowsByTab = {};
    batch.forEach((item) => {
      headersByTab[item.tab] = item.headers;
      (rowsByTab[item.tab] = rowsByTab[item.tab] || []).push(item.values);
    });
    await ensureTabs(headersByTab);
    // One append per tab, all fired in parallel.
    await Promise.all(Object.keys(rowsByTab).map((tab) => api(
      'POST',
      '/values/' + encodeURIComponent("'" + tab + "'!A1") +
        ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      { values: rowsByTab[tab].map((row) => row.map(safeCell)) }
    )));
  } catch (err) {
    if (err.status === 400 || err.status === 404) knownTabs = null; // tab may have been deleted/renamed
    const retry = batch.filter((item) => ++item.tries <= MAX_RETRIES);
    const dropped = batch.length - retry.length;
    if (dropped) console.error('Google Sheets: gave up on ' + dropped + ' row(s) (still in Excel + email):', err.message);
    else console.error('Google Sheets sync failed, will retry:', err.message);
    queue.unshift(...retry);
    flushing = false;
    if (queue.length) schedule(Math.min(60000, 2000 * 2 ** (retry[0] ? retry[0].tries : 0)));
    return;
  }
  flushing = false;
  if (queue.length) schedule(FLUSH_DELAY_MS);
}

// Read the last `limit` rows of a tab (used to look up the latest check-in
// after a server restart, since the free host forgets memory and disk).
async function readRows(tab, limit) {
  if (!enabled()) return [];
  const d = await api('GET', '/values/' + encodeURIComponent("'" + tab + "'!A:F") +
    '?valueRenderOption=FORMATTED_VALUE');
  const rows = (d.values || []).slice(1); // drop header
  return rows.slice(-(limit || 500));
}

// USER_ENTERED lets dates/phones format nicely; neutralise formula injection.
function safeCell(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

module.exports = { enabled, append, flush, readRows };
