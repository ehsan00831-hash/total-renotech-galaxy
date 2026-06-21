/**
 * Total — Plomberie & Construction — galactic digital business card
 * Lightweight Express server:
 *   - serves the static galaxy site from /public
 *   - saves form submissions into a single real Excel workbook (data/customers.xlsx)
 *     with one worksheet per form type: Customers / Comments / Specifications.
 */

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const ExcelJS = require('exceljs');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const mailer = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Render (and most hosting platforms) sit behind a reverse proxy.
// Trust the first hop so express-rate-limit sees the real client IP.
app.set('trust proxy', 1);

// 10 requests per 15 minutes per IP, applied only to the form endpoints.
// keyGenerator: prefer CF-Connecting-IP (set by Cloudflare's edge, unforgeable by clients)
// so the limiter tracks the real client even behind Cloudflare → Render's two-hop proxy chain.
// Falls back to req.ip (works in local dev where Cloudflare is not present).
const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || ipKeyGenerator(req.ip),
  handler: (_req, res) => {
    res.status(429).json({ ok: false, error: 'rate_limited', retryAfter: 15 });
  },
});

// DATA_DIR can be overridden (e.g. a mounted persistent disk on a cloud host)
// so the Excel file survives restarts/redeploys.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const XLSX_PATH = path.join(DATA_DIR, 'customers.xlsx');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serialize all writes so concurrent submits never corrupt the .xlsx file.
let writeChain = Promise.resolve();

// Each form type maps to a worksheet + ordered column headers.
const FORMS = {
  quote: {
    sheet: 'Customers',
    headers: ['Date / Time', 'First Name', 'Last Name', 'Location', 'Email', 'Phone'],
    order: ['firstName', 'lastName', 'location', 'email', 'phone'],
  },
  comment: {
    sheet: 'Comments',
    headers: ['Date / Time', 'Name', 'Email', 'Comment'],
    order: ['name', 'email', 'comment'],
  },
  specification: {
    sheet: 'Specifications',
    headers: ['Date / Time', 'Name', 'Email', 'Phone', 'Project Type', 'Details'],
    order: ['name', 'email', 'phone', 'projectType', 'details'],
  },
};

function clean(v, max) {
  const limit = max || 500;
  return String(v == null ? '' : v)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1437' } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.height = 22;
}

async function appendRow(form, values) {
  const workbook = new ExcelJS.Workbook();
  if (fs.existsSync(XLSX_PATH)) await workbook.xlsx.readFile(XLSX_PATH);

  let sheet = workbook.getWorksheet(form.sheet);
  if (!sheet) {
    sheet = workbook.addWorksheet(form.sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
    const header = sheet.addRow(form.headers);
    styleHeader(header);
    // Reasonable column widths.
    form.headers.forEach((h, i) => { sheet.getColumn(i + 1).width = Math.max(16, h.length + 6); });
  }

  // Always add positionally (by array) — column keys are not persisted in .xlsx,
  // so a key-based addRow() on a re-read workbook would write a blank row.
  sheet.addRow(values).commit();
  await workbook.xlsx.writeFile(XLSX_PATH);
}

function handle(form, extractAndValidate) {
  return (req, res) => {
    const body = req.body || {};
    // Honeypot: bots fill the hidden "website" field; real browsers leave it empty.
    // Return a fake success so the bot does not know it was caught.
    if (body.website) return res.json({ ok: true });
    const result = extractAndValidate(body);
    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error, fields: result.fields });
    }
    const stamp = new Date().toLocaleString('en-CA', { hour12: false });
    const values = [stamp].concat(form.order.map((k) => result.data[k]));

    writeChain = writeChain.then(() => appendRow(form, values));
    writeChain
      .then(() => {
        res.json({ ok: true });
        // Best-effort email notification — never blocks or fails the submission.
        mailer.sendLead(form.sheet, form.headers, values).catch((err) => {
          console.error('Lead email failed (saved to Excel anyway):', err.message);
        });
      })
      .catch((err) => {
        console.error('Failed to write ' + form.sheet + ':', err);
        res.status(500).json({ ok: false, error: 'write_failed' });
      });
  };
}

const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const phoneOk = (p) => /[0-9]{6,}/.test(String(p).replace(/[^0-9]/g, ''));

// ---- Quote / Contact ----
app.post('/api/lead', formLimiter, handle(FORMS.quote, (b) => {
  const data = {
    firstName: clean(b.firstName, 80),
    lastName: clean(b.lastName, 80),
    location: clean(b.location, 160),
    email: clean(b.email, 160),
    phone: clean(b.phone, 60),
  };
  const missing = FORMS.quote.order.filter((k) => !data[k]);
  if (missing.length) return { error: 'missing_fields', fields: missing };
  if (!emailOk(data.email)) return { error: 'invalid_email' };
  if (!phoneOk(data.phone)) return { error: 'invalid_phone' };
  return { data };
}));

// ---- Comments ----
app.post('/api/comment', formLimiter, handle(FORMS.comment, (b) => {
  const data = {
    name: clean(b.name, 100),
    email: clean(b.email, 160),
    comment: clean(b.comment, 1500),
  };
  const missing = FORMS.comment.order.filter((k) => !data[k]);
  if (missing.length) return { error: 'missing_fields', fields: missing };
  if (!emailOk(data.email)) return { error: 'invalid_email' };
  return { data };
}));

// ---- Client Specifications ----
app.post('/api/specification', formLimiter, handle(FORMS.specification, (b) => {
  const data = {
    name: clean(b.name, 100),
    email: clean(b.email, 160),
    phone: clean(b.phone, 60),
    projectType: clean(b.projectType, 80),
    details: clean(b.details, 2000),
  };
  const missing = ['name', 'email', 'phone', 'details'].filter((k) => !data[k]);
  if (missing.length) return { error: 'missing_fields', fields: missing };
  if (!emailOk(data.email)) return { error: 'invalid_email' };
  if (!phoneOk(data.phone)) return { error: 'invalid_phone' };
  return { data };
}));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log('\n  Total — Plomberie & Construction galaxy is live:  http://localhost:' + PORT);
  console.log('  Form submissions are saved to:  ' + XLSX_PATH);
  console.log('  Lead emails: ' + (mailer.enabled() ? 'ENABLED -> ' + mailer.LEAD_TO : 'disabled (set MAIL_USER / MAIL_PASS in .env to enable)') + '\n');
});
