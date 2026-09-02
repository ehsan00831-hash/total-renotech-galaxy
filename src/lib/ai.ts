/**
 * Message → structured intent.
 *
 * Two stages:
 *  1. A deterministic pre-pass pulls the things regex does better than a model
 *     (WO/PO numbers, dates, known crew names, truck numbers) and supplies them
 *     to the model as verified hints.
 *  2. The model maps the remaining free text onto one action.
 *
 * The model is instructed never to invent a value. Anything it is unsure of
 * comes back null and the UI asks a human.
 */

import Anthropic from '@anthropic-ai/sdk';
import { INTAKE_ACTIONS, type IntakeAction } from './schema';
import { addDays, businessDay } from './business-time';

export type ParsedIntent = {
  action: IntakeAction;
  confidence: number;
  fields: Record<string, string | string[] | undefined>;
  missing: string[];
  reasoning: string;
  needsConfirmation: boolean;
};

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

/* ------------------------------------------------------------------ *
 * Deterministic hints
 * ------------------------------------------------------------------ */

export type Hints = {
  woNumbers: string[];
  poNumbers: string[];
  dates: string[];
  relativeDay?: 'today' | 'tomorrow';
  crew: string[];
  trucks: string[];
  times: string[];
};

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

export function extractHints(message: string, knownCrew: string[], knownTrucks: string[]): Hints {
  const text = message ?? '';
  const lower = text.toLowerCase();

  const woNumbers = [...text.matchAll(/\bwo\s*#?\s*[:\-]?\s*(\d{4,})/gi)].map((m) => m[1]);
  const poNumbers = [...text.matchAll(/\bpo\s*#?\s*[:\-]?\s*(\d{4,})/gi)].map((m) => m[1]);

  const dates: string[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    dates.push(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/](\d{1,2})[/](\d{4})\b/g)) {
    dates.push(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{4})?\b/gi)) {
    const yr = m[3] ?? businessDay(new Date()).slice(0, 4);
    dates.push(`${yr}-${MONTHS[m[2].toLowerCase().slice(0, 3)]}-${m[1].padStart(2, '0')}`);
  }

  let relativeDay: Hints['relativeDay'];
  if (/\btomorrow\b|\bفردا\b|\bfarda\b/i.test(lower)) relativeDay = 'tomorrow';
  else if (/\btoday\b|\bامروز\b|\bemruz\b/i.test(lower)) relativeDay = 'today';

  const crew = knownCrew.filter((n) => {
    const parts = n.toLowerCase().split(/\s+/).filter((p) => p.length > 2);
    return parts.length > 0 && parts.some((p) => lower.includes(p));
  });

  const trucks: string[] = [];
  for (const m of text.matchAll(/\btruck\s*#?\s*(\d+)/gi)) {
    const match = knownTrucks.find((t) => t.replace(/\D/g, '') === m[1]);
    trucks.push(match ?? `TRUCK #${m[1]}`);
  }

  const times = [...text.matchAll(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/gi)].map((m) => m[1].toUpperCase());

  return {
    woNumbers: [...new Set(woNumbers)],
    poNumbers: [...new Set(poNumbers)],
    dates: [...new Set(dates)],
    relativeDay,
    crew: [...new Set(crew)],
    trucks: [...new Set(trucks)],
    times: [...new Set(times)],
  };
}

/* ------------------------------------------------------------------ *
 * Model pass
 * ------------------------------------------------------------------ */

const SYSTEM = `You convert short operations messages from a Quebec plumbing and
construction company into one structured action for their job tracker.

Absolute rules:
- NEVER invent a value. If the message does not state it, return null.
- Do not guess addresses, phone numbers, WO/PO numbers, prices or dates.
- "fullAddress" is one line and already includes the city, e.g.
  "225 Rue Peel, Montreal, QC". Do not split it and do not repeat the city.
- Messages may be in English, French, Persian (Farsi) or Finglish (Persian in
  Latin letters). Understand all of them; always emit English field values.
- Customer names are often store brands with a number, e.g. "Winners #451",
  "MARSHALLS MEGA #777", "H&M JOLIETTE #53". Preserve them verbatim.
- The verified_hints given to you were extracted deterministically and are
  reliable. Prefer them over your own reading.
- "confidence" is your honest probability that committing this action without
  human review would be correct. Be conservative.

Return ONLY a JSON object, no prose, shaped:
{
  "action": one of ${INTAKE_ACTIONS.join(' | ')},
  "confidence": 0..1,
  "reasoning": "one short sentence",
  "missing": ["field names a human still needs to supply"],
  "fields": {
    "jobId": string|null, "customer": string|null, "projectType": string|null,
    "fullAddress": string|null,
    "contactName": string|null, "phone": string|null, "email": string|null,
    "woNumber": string|null, "poNumber": string|null, "scope": string|null,
    "requiredAction": string|null, "priority": string|null, "status": string|null,
    "scheduledDate": string|null, "arrivalWindow": string|null,
    "actualStart": string|null, "actualEnd": string|null,
    "truck": string|null, "technicians": string[]|null,
    "materials": string|null, "materialStatus": string|null,
    "followUpDate": string|null, "notes": string|null,
    "workDate": string|null, "clockIn": string|null, "clockOut": string|null,
    "breakMin": string|null, "workCompleted": string|null,
    "assignedTo": string|null, "dueAt": string|null, "amount": string|null,
    "category": string|null, "reference": string|null
  }
}

Valid status values: NEW LEAD, NEED INFO, NEED SCHEDULING, UPCOMING, TOMORROW PLAN,
SCHEDULED, ONGOING, WAITING MATERIAL, WAITING APPROVAL, NEED FOLLOW-UP, ON HOLD,
DONE, COMPLETED, CANCELLED.
Valid priority values: LOW, NORMAL, HIGH, URGENT, EMERGENCY.

Reminders use their OWN vocabulary, spelled exactly like this:
reminder priority: Critical | High | Normal | Low
reminder status: New | Action Required | In Progress | Scheduled | Follow-Up Required | Waiting for Response | Waiting for Payment | Waiting for Approval | Completed — Check Required | Completed | On Hold | Cancelled | Removed
Note the em dash in "Completed — Check Required". Never uppercase these values.`;

/** Day after an ISO date, on the business calendar. */
function nextDay(iso: string): string {
  return addDays(iso, 1);
}

export async function parseMessage(
  message: string,
  opts: { knownCrew: string[]; knownTrucks: string[]; today: string; requestedAction?: IntakeAction },
): Promise<ParsedIntent> {
  const hints = extractHints(message, opts.knownCrew, opts.knownTrucks);

  if (!aiConfigured()) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. The AI Inbox needs it to read free-text messages.',
    );
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const resolvedDate =
    hints.relativeDay === 'tomorrow'
      ? nextDay(opts.today)
      : hints.relativeDay === 'today'
        ? opts.today
        : hints.dates[0] ?? null;

  const userContent = JSON.stringify({
    message,
    today: opts.today,
    requested_action: opts.requestedAction ?? null,
    verified_hints: {
      wo_numbers: hints.woNumbers,
      po_numbers: hints.poNumbers,
      explicit_dates: hints.dates,
      relative_day: hints.relativeDay ?? null,
      resolved_date: resolvedDate,
      crew_matched_against_roster: hints.crew,
      trucks: hints.trucks,
      times: hints.times,
    },
    known_crew: opts.knownCrew,
    known_trucks: opts.knownTrucks,
  });

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  const json = extractJson(text);
  if (!json) throw new Error('The model did not return usable JSON.');

  const rawAction = String(json.action ?? '');
  const action: IntakeAction = (INTAKE_ACTIONS as readonly string[]).includes(rawAction)
    ? (rawAction as IntakeAction)
    : 'update_job';

  const fields = cleanFields(json.fields ?? {});

  // Deterministic hints win over the model.
  if (hints.woNumbers[0] && !fields.woNumber) fields.woNumber = hints.woNumbers[0];
  if (hints.poNumbers[0] && !fields.poNumber) fields.poNumber = hints.poNumbers[0];
  if (resolvedDate && !fields.scheduledDate && action !== 'add_daily_log') {
    fields.scheduledDate = resolvedDate;
  }
  if (resolvedDate && action === 'add_daily_log' && !fields.workDate) {
    fields.workDate = resolvedDate;
  }
  if (hints.crew.length && !fields.technicians) fields.technicians = hints.crew;
  if (hints.trucks[0] && !fields.truck) fields.truck = hints.trucks[0];

  const confidence = clamp(Number(json.confidence ?? 0.5));
  const missing = Array.isArray(json.missing) ? json.missing.map(String) : [];

  return {
    action,
    confidence,
    fields,
    missing,
    reasoning: String(json.reasoning ?? ''),
    needsConfirmation: confidence < 0.8 || missing.length > 0,
  };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

type LooseJson = { action?: string; confidence?: unknown; reasoning?: unknown;
                   missing?: unknown; fields?: Record<string, unknown> };

function extractJson(text: string): LooseJson | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as LooseJson;
  } catch {
    return null;
  }
}

/** Drop nulls and empty strings so nothing blank is ever written to a cell. */
function cleanFields(raw: Record<string, unknown>): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      const arr = v.map(String).map((s) => s.trim()).filter(Boolean);
      if (arr.length) out[k] = arr;
      continue;
    }
    const s = String(v).trim();
    if (s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'n/a') out[k] = s;
  }
  return out;
}
