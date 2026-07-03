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
// keyGenerator: prefer CF-Connecting-IP when requests are routed through Cloudflare.
// This gives a stable client key behind the Cloudflare → Render proxy chain.
// Fall back to normalized req.ip for local/dev and non-Cloudflare traffic.
// Note: CF-Connecting-IP can be spoofed if the Render origin URL is reached directly.
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

// ---- Google Reviews ----
// Priority: live Google Places API -> owner-provided data/reviews.json -> static fallback.
// Never fabricates live numbers: `live:false` means the frontend shows the
// owner-claimed 5.0 badge without a review count.
// GOOGLE_API_KEY is the primary name; GOOGLE_PLACES_API_KEY is kept as an alias
// for backward compatibility with earlier deploys.
const PLACES_KEY = (process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY || '').trim();
const PLACE_ID = (process.env.GOOGLE_PLACE_ID || '').trim();
// Optional direct link overrides — set these to skip the Places API entirely
// and just point "Read Reviews" / "Leave a Review" at real Google URLs
// (e.g. a g.page/r/... short link) while still using the safe rating fallback.
const REVIEWS_URL_OVERRIDE = (process.env.GOOGLE_REVIEWS_URL || '').trim();
const LEAVE_URL_OVERRIDE = (process.env.GOOGLE_LEAVE_REVIEW_URL || '').trim();
const REVIEWS_JSON = path.join(DATA_DIR, 'reviews.json');
const FALLBACK_REVIEWS_URL = 'https://www.google.com/search?q=Total+R%C3%A9no-Tech+Inc.+reviews';

let reviewsCache = { at: 0, payload: null };
const REVIEWS_TTL = 10 * 60 * 1000; // 10 min

async function fetchLiveReviews() {
  const url = 'https://places.googleapis.com/v1/places/' + encodeURIComponent(PLACE_ID);
  const r = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': PLACES_KEY,
      'X-Goog-FieldMask': 'rating,userRatingCount,googleMapsUri,reviews.rating,reviews.text.text,reviews.authorAttribution.displayName,reviews.relativePublishTimeDescription',
    },
  });
  if (!r.ok) throw new Error('Places API HTTP ' + r.status);
  const d = await r.json();
  return {
    live: true,
    rating: d.rating || null,
    count: d.userRatingCount || null,
    url: REVIEWS_URL_OVERRIDE || d.googleMapsUri || FALLBACK_REVIEWS_URL,
    writeUrl: LEAVE_URL_OVERRIDE || (PLACE_ID ? 'https://search.google.com/local/writereview?placeid=' + encodeURIComponent(PLACE_ID) : FALLBACK_REVIEWS_URL),
    reviews: (d.reviews || []).slice(0, 8).map((rv) => ({
      name: (rv.authorAttribution && rv.authorAttribution.displayName) || 'Google user',
      rating: rv.rating || 5,
      text: clean((rv.text && rv.text.text) || '', 220),
      when: rv.relativePublishTimeDescription || '',
    })),
  };
}

function readOwnerReviews() {
  // Owner can paste real Google reviews into data/reviews.json:
  // { "rating": 5.0, "count": 27, "url": "...", "writeUrl": "...", "reviews": [{ "name": "...", "rating": 5, "text": "..." }] }
  if (!fs.existsSync(REVIEWS_JSON)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(REVIEWS_JSON, 'utf8'));
    return {
      live: false,
      source: 'owner-file',
      rating: d.rating || 5.0,
      count: d.count || null,
      url: REVIEWS_URL_OVERRIDE || d.url || FALLBACK_REVIEWS_URL,
      writeUrl: LEAVE_URL_OVERRIDE || d.writeUrl || d.url || FALLBACK_REVIEWS_URL,
      reviews: Array.isArray(d.reviews) ? d.reviews.slice(0, 8) : [],
    };
  } catch (e) {
    console.error('Bad data/reviews.json:', e.message);
    return null;
  }
}

app.get('/api/reviews', async (_req, res) => {
  if (reviewsCache.payload && Date.now() - reviewsCache.at < REVIEWS_TTL) {
    return res.json(reviewsCache.payload);
  }
  let payload = null;
  if (PLACES_KEY && PLACE_ID) {
    try {
      payload = await fetchLiveReviews();
    } catch (err) {
      console.error('Live reviews failed, falling back:', err.message);
    }
  }
  if (!payload) payload = readOwnerReviews();
  if (!payload) {
    payload = {
      live: false,
      source: 'static',
      rating: 5.0, // owner-claimed (business card: "Google 5.0 Reviews")
      count: null, // unknown — do not fake
      url: REVIEWS_URL_OVERRIDE || FALLBACK_REVIEWS_URL,
      writeUrl: LEAVE_URL_OVERRIDE || FALLBACK_REVIEWS_URL,
      reviews: [],
    };
  }
  reviewsCache = { at: Date.now(), payload };
  res.json(payload);
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log('\n  Total — Plomberie & Construction galaxy is live:  http://localhost:' + PORT);
  console.log('  Form submissions are saved to:  ' + XLSX_PATH);
  console.log('  Lead emails: ' + (mailer.enabled() ? 'ENABLED -> ' + mailer.LEAD_TO : 'disabled (set MAIL_USER / MAIL_PASS in .env to enable)'));
  console.log('  Google reviews: ' + (PLACES_KEY && PLACE_ID
    ? 'LIVE (Places API)'
    : 'fallback (set GOOGLE_API_KEY + GOOGLE_PLACE_ID for live data)'
  ) + (REVIEWS_URL_OVERRIDE || LEAVE_URL_OVERRIDE ? ' + manual URL override(s) active' : '') + '\n');
});
