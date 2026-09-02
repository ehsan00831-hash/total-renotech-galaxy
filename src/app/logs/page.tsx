'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  Banner, Button, Card, CardHeader, Chip, Drawer, EmptyState, Field, Input,
  MultiSelect, Skeleton, Textarea, useToast,
} from '@/components/ui';
import { PageTitle } from '../page';
import { useLang } from '@/components/shell/AppShell';
import { t } from '@/lib/i18n';
import { apiPost, newIdempotencyKey, useApi } from '@/lib/client';
import { businessDay } from '@/lib/business-time';
import type { DailyLog, ProjectRollup } from '@/lib/logs';

type Res = { logs: DailyLog[]; count: number; rollup: ProjectRollup | null };
type TeamRes = { crewOptions: string[]; truckOptions: string[] };
type JobsRes = { jobs: Array<{ jobId: string; customer: string; longProject: string }> };

export default function LogsPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-64" />}>
      <Inner />
    </React.Suspense>
  );
}

function Inner() {
  const { lang } = useLang();
  const d = t(lang);
  const toast = useToast();
  const params = useSearchParams();
  const [jobId, setJobId] = React.useState('');
  const [creating, setCreating] = React.useState(params.get('new') === '1');
  // Set once, from the URL a caller (the Jobs drawer's "Daily Log" action,
  // or a bookmarked link) arrived with — not tied to the filter dropdown, so
  // clearing that filter later doesn't reopen or re-target this drawer.
  const [prefillJobId] = React.useState(params.get('jobId') ?? '');

  const { data, error, loading, reload } = useApi<Res>(
    jobId ? `/api/logs?jobId=${encodeURIComponent(jobId)}` : '/api/logs',
  );
  const team = useApi<TeamRes>('/api/team');
  const long = useApi<JobsRes>('/api/jobs?view=long-projects');

  const totals = React.useMemo(() => {
    const logs = data?.logs ?? [];
    return {
      days: new Set(logs.map((l) => l.workDate)).size,
      workers: new Set(logs.flatMap((l) => l.technicians)).size,
      personHours: Math.round(logs.reduce((s, l) => s + l.totalHours, 0) * 10) / 10,
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <PageTitle
        title={d.dailyLogs}
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> {d.addLog}
          </Button>
        }
      />

      <Card className="p-3">
        <Field label="Filter by project">
          <select
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-brand focus:outline-none"
          >
            <option value="">All projects</option>
            {(long.data?.jobs ?? []).map((j) => (
              <option key={j.jobId} value={j.jobId}>{j.jobId} — {j.customer}</option>
            ))}
          </select>
        </Field>
      </Card>

      <section className="grid grid-cols-3 gap-2.5">
        {[
          ['Working days', totals.days],
          ['Workers', totals.workers],
          ['Person-hours', totals.personHours],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {label}
            </p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-brand">{value}</p>
          </Card>
        ))}
      </section>

      {error && <Banner tone="danger">{error}</Banner>}

      {data?.rollup && (
        <Card>
          <CardHeader title={`Project roll-up · ${data.rollup.project || data.rollup.jobId}`} />
          <div className="grid gap-x-6 gap-y-1.5 p-4 text-xs sm:grid-cols-2">
            <Row k="Working days" v={data.rollup.workingDays} />
            <Row k="Distinct workers" v={data.rollup.workers} />
            <Row k="Total person-hours" v={data.rollup.totalPersonHours} />
            <Row k="Average crew" v={data.rollup.avgCrew} />
            <Row k="Start date" v={data.rollup.startDate || '—'} />
            <Row k="Latest day" v={data.rollup.endDate || '—'} />
            <Row k="Distinct materials" v={data.rollup.materials.length} />
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : (data?.logs.length ?? 0) === 0 ? (
          <EmptyState
            title="No daily logs yet."
            hint="Add one working day at a time; person-hours are computed for you."
          />
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {data!.logs.map((l) => (
              <div key={l.row} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {l.workDate} · {l.project || l.jobId || '—'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip tone="info">{l.crewCount} crew</Chip>
                    <Chip tone="gold">{l.hoursPerPerson} h/person</Chip>
                    <Chip tone="success">{l.totalHours} person-h</Chip>
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {l.teamSummary || '—'}{l.truck ? ` · ${l.truck}` : ''}
                  {l.clockIn ? ` · ${l.clockIn}–${l.clockOut}` : ''}
                  {l.breakMin ? ` · ${l.breakMin} min break` : ''}
                </p>
                {l.workCompleted && (
                  <p className="mt-1 text-xs text-[var(--text)]">{l.workCompleted}</p>
                )}
                {l.issues && <p className="mt-1 text-xs text-bad">Issue: {l.issues}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {creating && (
        <LogDrawer
          crew={team.data?.crewOptions ?? []}
          trucks={team.data?.truckOptions ?? []}
          projects={long.data?.jobs ?? []}
          initialJobId={prefillJobId}
          onClose={() => setCreating(false)}
          onSaved={(m) => { toast(m, 'success'); setCreating(false); reload(); }}
          onError={(m) => toast(m, 'danger')}
        />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--line)] py-1 last:border-0">
      <span className="text-[var(--text-muted)]">{k}</span>
      <span className="font-semibold tabular-nums">{v}</span>
    </div>
  );
}

function LogDrawer({
  crew, trucks, projects, initialJobId, onClose, onSaved, onError,
}: {
  crew: string[]; trucks: string[];
  projects: Array<{ jobId: string; customer: string }>;
  initialJobId?: string;
  onClose: () => void; onSaved: (m: string) => void; onError: (m: string) => void;
}) {
  const { lang } = useLang();
  const d = t(lang);
  const [saving, setSaving] = React.useState(false);
  const [technicians, setTechnicians] = React.useState<string[]>([]);
  const [f, setF] = React.useState({
    jobId: initialJobId ?? '', project: '', workDate: businessDay(new Date()),
    location: '', truck: '', clockIn: '', clockOut: '', breakMin: '',
    workCompleted: '', materialsUsed: '', issues: '', nextStep: '', supervisor: '', notes: '',
  });

  // The project list loads asynchronously; fill in the customer name for a
  // pre-selected job as soon as it becomes available.
  React.useEffect(() => {
    if (!f.jobId || f.project) return;
    const p = projects.find((x) => x.jobId === f.jobId);
    if (p) setF((x) => ({ ...x, project: p.customer }));
  }, [projects, f.jobId, f.project]);

  const set = (k: keyof typeof f) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setF((x) => ({ ...x, [k]: e.target.value }));

  const hpp = React.useMemo(() => {
    const p = (v: string) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(v);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const a = p(f.clockIn), b = p(f.clockOut);
    if (a === null || b === null) return 0;
    const span = (b - a + 1440) % 1440;
    return Math.max(0, Math.round(((span - Number(f.breakMin || 0)) / 60) * 100) / 100);
  }, [f.clockIn, f.clockOut, f.breakMin]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiPost<{ result: { row: number; totalHours: number } }>(
        '/api/logs',
        { ...f, breakMin: f.breakMin ? Number(f.breakMin) : undefined, technicians },
        newIdempotencyKey(),
      );
      onSaved(`Daily log written to row ${res.result.row} · ${res.result.totalHours} person-hours.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open onClose={onClose} title={d.addLog}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-muted)]">
            {technicians.length} × {hpp} h = <strong>{Math.round(technicians.length * hpp * 100) / 100}</strong> person-h
          </span>
          <span className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>{d.cancel}</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? d.loading : d.save}</Button>
          </span>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project">
            <select
              value={f.jobId}
              onChange={(e) => {
                const p = projects.find((x) => x.jobId === e.target.value);
                setF((x) => ({ ...x, jobId: e.target.value, project: p?.customer ?? '' }));
              }}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-brand focus:outline-none"
            >
              <option value="">— pick a long project —</option>
              {projects.map((p) => (
                <option key={p.jobId} value={p.jobId}>{p.jobId} — {p.customer}</option>
              ))}
            </select>
          </Field>
          <Field label="Work date"><Input type="date" value={f.workDate} onChange={set('workDate')} /></Field>
          <Field label="Clock in"><Input type="time" value={f.clockIn} onChange={set('clockIn')} /></Field>
          <Field label="Clock out"><Input type="time" value={f.clockOut} onChange={set('clockOut')} /></Field>
          <Field label="Break (minutes)">
            <Input type="number" min={0} max={600} value={f.breakMin} onChange={set('breakMin')} />
          </Field>
          <Field label={d.truck}>
            <select
              value={f.truck} onChange={set('truck')}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-brand focus:outline-none"
            >
              <option value="">—</option>
              {trucks.map((tr) => <option key={tr} value={tr}>{tr}</option>)}
            </select>
          </Field>
          <Field label="Location"><Input value={f.location} onChange={set('location')} /></Field>
          <Field label="Supervisor"><Input value={f.supervisor} onChange={set('supervisor')} /></Field>
        </div>

        <Field label={`${d.crew} (max 5)`}>
          <MultiSelect options={crew} value={technicians} onChange={setTechnicians} max={5} />
        </Field>

        <Field label="Work completed"><Textarea rows={3} value={f.workCompleted} onChange={set('workCompleted')} /></Field>
        <Field label="Materials used"><Textarea rows={2} value={f.materialsUsed} onChange={set('materialsUsed')} /></Field>
        <Field label="Problems / delays"><Textarea rows={2} value={f.issues} onChange={set('issues')} /></Field>
        <Field label="Next required action"><Textarea rows={2} value={f.nextStep} onChange={set('nextStep')} /></Field>
      </div>
    </Drawer>
  );
}
