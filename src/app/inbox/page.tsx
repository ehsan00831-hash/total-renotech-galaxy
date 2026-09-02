'use client';

/**
 * AI Inbox — paste a message, see exactly what will be written, then commit.
 * Nothing reaches the workbook until the parsed summary is accepted.
 */

import * as React from 'react';
import { Sparkles, ArrowRight, ShieldCheck, AlertTriangle } from 'lucide-react';
import {
  Banner, Button, Card, CardHeader, Chip, Field, Select, Skeleton, Textarea, useToast,
} from '@/components/ui';
import { PageTitle } from '../page';
import { useLang } from '@/components/shell/AppShell';
import { t } from '@/lib/i18n';
import { apiPost, newIdempotencyKey, useApi } from '@/lib/client';

type Preview = {
  action: string;
  confidence: number;
  reasoning: string;
  missing: string[];
  fields: Record<string, unknown>;
  duplicate?: { jobId: string; customer: string; row: number; reason: string };
  willCreate: boolean;
  blockers: string[];
};

type IntakeRes = {
  committed: boolean;
  duplicate?: boolean;
  message?: string;
  preview?: Preview;
  result?: { sheet: string; row: number; recordId: string; changed: string[]; note?: string };
};

const EXAMPLES = [
  'Winners #451 at 225 Rue Peel is upcoming. Assign Meisam and Pirooz tomorrow with Truck 7.',
  'H&M Joliette #53 WO 96214 is done today, 2 techs, 8:00 to 14:30, 30 min break.',
  'یادآوری: برای MARSHALLS MEGA #777 برآورد فرستاده شد، پیگیری لازم است.',
  'Marshalls #777 needs материал — flush valve Sloan 111-ES, need purchase.',
];

export default function InboxPage() {
  const { lang } = useLang();
  const d = t(lang);
  const toast = useToast();

  const [message, setMessage] = React.useState('');
  const [action, setAction] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [res, setRes] = React.useState<IntakeRes | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const keyRef = React.useRef<string>('');

  const health = useApi<{ status: { ai: boolean } }>('/api/health');
  // Missing ANTHROPIC_API_KEY does not block the rest of the app — jobs,
  // reminders, logs, the dashboard and sign-in all work without it. Only
  // this page needs to know, so it can disable itself instead of letting a
  // technician type a message that will fail on submit.
  const aiDisabled = health.data ? !health.data.status.ai : false;

  const analyse = async () => {
    if (!message.trim() || aiDisabled) return;
    setBusy(true); setError(null); setRes(null);
    keyRef.current = newIdempotencyKey();
    try {
      const r = await apiPost<IntakeRes>('/api/ai/intake', {
        source: 'webapp',
        message,
        requestedAction: action || undefined,
        idempotencyKey: keyRef.current,
        confirm: false,
      });
      setRes(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed.');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiPost<IntakeRes>('/api/ai/intake', {
        source: 'webapp',
        message,
        requestedAction: action || undefined,
        idempotencyKey: keyRef.current,
        confirm: true,
      });
      setRes(r);
      if (r.committed && r.result) {
        toast(`Written to ${r.result.sheet} row ${r.result.row}.`, 'success');
        setMessage('');
      } else if (r.duplicate) {
        toast('Already applied — no second write.', 'warn');
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Commit failed.';
      setError(m); toast(m, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const p = res?.preview;
  const canCommit = p && p.blockers.length === 0 && !res?.committed;

  return (
    <div className="space-y-4">
      <PageTitle title={d.inbox} />

      {aiDisabled && (
        <Banner tone="warn">
          AI Inbox is unavailable — ANTHROPIC_API_KEY is not configured on this deployment.
          Jobs, reminders, daily logs, the dashboard and sign-in are unaffected; only
          free-text message parsing is disabled. Use the Jobs, Reminders and Logs pages
          to enter records directly.
        </Banner>
      )}

      <Card>
        <CardHeader title={d.parseMessage} />
        <div className="space-y-3 p-4">
          <Textarea
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={d.aiPlaceholder}
            disabled={aiDisabled}
          />

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[190px] flex-1">
              <Field label="Force action (optional)">
                <Select value={action} onChange={(e) => setAction(e.target.value)}>
                  <option value="">Let the model decide</option>
                  <option value="create_job">Create job</option>
                  <option value="update_job">Update job</option>
                  <option value="schedule_job">Schedule job</option>
                  <option value="assign_crew">Assign crew</option>
                  <option value="assign_truck">Assign truck</option>
                  <option value="change_status">Change status</option>
                  <option value="complete_job">Complete job</option>
                  <option value="add_material">Add material</option>
                  <option value="upsert_reminder">Add / update reminder</option>
                  <option value="add_daily_log">Add daily log</option>
                </Select>
              </Field>
            </div>
            <Button onClick={analyse} disabled={busy || !message.trim() || aiDisabled}>
              <Sparkles size={14} /> {busy ? d.loading : d.review}
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => setMessage(ex)}
                className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] hover:border-brand hover:text-brand"
              >
                Example {i + 1}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {error && <Banner tone="danger">{error}</Banner>}
      {busy && !res && <Card className="p-4"><Skeleton className="h-24" /></Card>}

      {p && (
        <Card>
          <CardHeader
            title={d.parsed}
            action={
              <span className="flex items-center gap-2">
                <Chip tone={p.confidence >= 0.85 ? 'success' : p.confidence >= 0.6 ? 'warn' : 'danger'}>
                  {d.confidence} {(p.confidence * 100).toFixed(0)}%
                </Chip>
                <Chip tone="info">{p.action}</Chip>
              </span>
            }
          />
          <div className="space-y-3 p-4">
            {p.reasoning && (
              <p className="text-xs text-[var(--text-muted)]">{p.reasoning}</p>
            )}

            {p.duplicate ? (
              <Banner tone="info">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck size={13} />
                  {d.duplicateFound}: <strong>{p.duplicate.jobId}</strong> — {p.duplicate.customer}
                  {' '}(row {p.duplicate.row}, matched on {p.duplicate.reason}). It will be updated, not duplicated.
                </span>
              </Banner>
            ) : p.willCreate ? (
              <Banner tone="warn">{d.willCreate}</Banner>
            ) : null}

            {p.missing.length > 0 && (
              <Banner tone="warn">
                Missing: {p.missing.join(', ')}. These stay blank — nothing is invented.
              </Banner>
            )}

            {p.blockers.map((b, i) => (
              <Banner key={i} tone="danger">
                <span className="flex items-center gap-1.5"><AlertTriangle size={13} />{b}</span>
              </Banner>
            ))}

            <div className="table-scroll rounded-lg border border-[var(--line)]">
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(p.fields).map(([k, v]) => (
                    <tr key={k} className="border-b border-[var(--line)] last:border-0">
                      <td className="w-44 bg-[var(--canvas)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        {k}
                      </td>
                      <td className="px-3 py-1.5">
                        {Array.isArray(v) ? v.join(', ') : String(v)}
                      </td>
                    </tr>
                  ))}
                  {Object.keys(p.fields).length === 0 && (
                    <tr><td className="px-3 py-3 text-xs text-[var(--text-muted)]">
                      Nothing could be extracted from that message.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {res?.committed && res.result ? (
              <Banner tone="success">
                Written to <strong>{res.result.sheet}</strong> row <strong>{res.result.row}</strong>
                {res.result.recordId ? ` · ${res.result.recordId}` : ''}
                {res.result.note ? ` · ${res.result.note}` : ''}
              </Banner>
            ) : (
              <div className="flex justify-end">
                <Button onClick={commit} disabled={!canCommit || busy}>
                  <ArrowRight size={14} /> {d.commit}
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Connected assistants" />
        <div className="space-y-2 p-4 text-xs text-[var(--text-muted)]">
          <p>
            The same endpoint backs the web app, a ChatGPT Custom GPT Action and the
            Claude MCP server, so all three behave identically and share one audit trail.
          </p>
          <p>
            OpenAPI specification:{' '}
            <a href="/api/openapi" className="font-semibold text-brand underline">/api/openapi</a>
          </p>
        </div>
      </Card>
    </div>
  );
}
