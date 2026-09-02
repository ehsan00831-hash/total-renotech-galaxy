/**
 * Lead email notifier.
 * Sends each form submission to the business inbox so leads are never lost,
 * even on a free host with an ephemeral filesystem.
 *
 * Configure via environment (e.g. a .env file):
 *   MAIL_USER = your-gmail@gmail.com      (the sending Gmail account)
 *   MAIL_PASS = 16-char Google App Password
 *   LEAD_TO   = where to receive leads    (optional; defaults to MAIL_USER)
 *
 * If MAIL_USER / MAIL_PASS are not set, email is silently disabled and the
 * site keeps working (Excel remains the source of truth).
 */

const nodemailer = require('nodemailer');

const MAIL_USER = (process.env.MAIL_USER || '').trim();
const MAIL_PASS = (process.env.MAIL_PASS || '').trim();
const LEAD_TO = (process.env.LEAD_TO || MAIL_USER).trim();

let transporter = null;

function enabled() {
  return !!(MAIL_USER && MAIL_PASS);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: MAIL_USER, pass: MAIL_PASS },
    });
  }
  return transporter;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

// Friendly labels for the email subject line.
const TITLES = {
  Customers: 'New quote request',
  Comments: 'New comment',
  Specifications: 'New client specifications',
};

/**
 * @param {string} sheet   worksheet name (Customers / Comments / Specifications)
 * @param {string[]} headers  column headers
 * @param {Array} values   row values, aligned with headers (index 0 = timestamp)
 */
async function sendLead(sheet, headers, values) {
  if (!enabled()) return;

  const rows = headers
    .map(function (h, i) {
      return (
        '<tr>' +
        '<td style="padding:7px 14px;color:#7c89b0;border-bottom:1px solid #1e2748;white-space:nowrap;vertical-align:top">' +
        escapeHtml(h) +
        '</td>' +
        '<td style="padding:7px 14px;color:#0b1020;font-weight:600;border-bottom:1px solid #1e2748">' +
        escapeHtml(values[i]) +
        '</td></tr>'
      );
    })
    .join('');

  const html =
    '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">' +
    '<div style="background:linear-gradient(120deg,#43e7ff,#7c5cff 60%,#ffce5c);padding:18px 22px;border-radius:14px 14px 0 0">' +
    '<h2 style="margin:0;color:#05070f;font-size:18px">Total — Plomberie &amp; Construction</h2>' +
    '<p style="margin:4px 0 0;color:#0b1020;font-size:13px">' + escapeHtml(TITLES[sheet] || ('New ' + sheet)) + ' from your website</p>' +
    '</div>' +
    '<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e7f2;border-top:none;border-radius:0 0 14px 14px;font-size:14px">' +
    rows +
    '</table>' +
    '<p style="color:#9aa3bf;font-size:12px;margin:14px 2px">Sent automatically from your galaxy site. A copy is also stored in customers.xlsx.</p>' +
    '</div>';

  await getTransporter().sendMail({
    from: '"Total Réno-Tech Website" <' + MAIL_USER + '>',
    to: LEAD_TO,
    replyTo: pickEmail(headers, values),
    subject: (TITLES[sheet] || ('New ' + sheet)) + ' — Total Réno-Tech',
    html: html,
  });
}

// Use the submitter's email as Reply-To when present, so the business can reply directly.
function pickEmail(headers, values) {
  const idx = headers.findIndex(function (h) { return /email/i.test(h); });
  return idx > -1 ? values[idx] : LEAD_TO;
}

module.exports = { enabled, sendLead, LEAD_TO };
