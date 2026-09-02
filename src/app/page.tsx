'use client';

/**
 * Executive dashboard. Every KPI card and every chart segment is a link into
 * the matching filtered module — nothing here is a dead end.
 *
 * The KPI grid is curated to the numbers a coordinator actually checks every
 * morning, in the order they'd ask for them, rather than every count the API
 * can produce — a wall of 20+ near-identical tiles reads as noise, not signal.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Plus, Bell, CalendarPlus, Inbox as InboxIcon, AlertTriangle,
  RefreshCw, WifiOff, Clock, MapPin, CheckCircle2, AtSign,
} from 'lucide-react';
import { Card, CardHeader, Chip, Skeleton, EmptyState, Banner, Button } from '@/components/ui';
import { useLang } from '@/components/shell/AppShell';
import { t } from '@/lib/i18n';
import { useApi } from '@/lib/client';
import { CHART_COLORS, statusTone, priorityTone } from '@/lib/brand';
import type { Job } from '@/lib/jobs';
import type { Reminder } from '@/lib/reminders';
import type { ReminderComment } from '@/lib/reminder-comments';

type TomorrowPlanSummary = {
  proposed: number; confirmed: number; needsCoordination: number; needsCoordinationJobs: Job[];
};
type ReminderAlerts = {
  overdue: number; dueToday: number; dueTomorrow: number; items: Reminder[];
};

type Dash = {
  generatedAt: string;
  kpis: Record<string, number>;
  charts: {
    byStatus: Array<{ name: string; value: number }>;
    byPriority: Array<{ name: string; value: number }>;
    byType: Array<{ name: string; value: number }>;
  };
  todayOperations: Job[];
  urgent: Job[];
  waitingMaterials: Job[];
  overdueReminders: Reminder[];
  tomorrowPlan: TomorrowPlanSummary;
  reminderAlerts: ReminderAlerts;
  myMentions: ReminderComment[];
};

type KpiDef = { key: string; label: string; href: string; tone?: 'plain' | 'good' | 'warn' | 'bad' };

const POLL_MS = 25_000;

export default function DashboardPage() {
  const { lang } = useLang();
  const d = t(lang);
  const router = useRouter();
  const { data, error, loading, offline, lastSyncedAt, reload } =
    useApi<Dash>('/api/dashboard', { pollMs: POLL_MS });

  // The order operations actually work a day: what's happening now, what's
  // blocked, what's done, then the standing-capacity numbers.
  const KPIS: KpiDef[] = [
    { key: 'scheduledToday', label: d.scheduledToday, href: '/jobs?view=all&date=today' },
    { key: 'tomorrow', label: d.tomorrow, href: '/jobs?view=tomorrow' },
    { key: 'ongoing', label: d.ongoing, href: '/jobs?view=ongoing' },
    { key: 'urgent', label: d.urgent, href: '/jobs?view=all&priority=URGENT', tone: 'bad' },
    { key: 'waitingScheduling', label: d.waitingScheduling, href: '/jobs?status=' + encodeURIComponent('NEED SCHEDULING'), tone: 'warn' },
    { key: 'waitingMaterials', label: d.waitingMaterials, href: '/jobs?view=waiting-materials', tone: 'warn' },
    { key: 'waitingApproval', label: d.waitingApproval, href: '/jobs?view=waiting-approval', tone: 'warn' },
    { key: 'overdueFollowUps', label: d.overdueFollowUps, href: '/jobs?status=' + encodeURIComponent('NEED FOLLOW-UP'), tone: 'bad' },
    { key: 'openReminders', label: d.openReminders, href: '/reminders', tone: 'warn' },
    { key: 'completedToday', label: d.completedToday, href: '/completed?range=today', tone: 'good' },
    { key: 'completedWeek', label: d.completedWeek, href: '/completed?range=week', tone: 'good' },
    { key: 'completedMonth', label: d.completedMonth, href: '/completed?range=month', tone: 'good' },
    { key: 'hoursToday', label: d.hoursToday, href: '/logs' },
    { key: 'hoursWeek', label: d.hoursWeek, href: '/logs' },
    { key: 'activeTechs', label: d.activeTechs, href: '/team' },
    { key: 'availableTrucks', label: d.availableTrucks, href: '/team' },
  ];

  if (error) {
    return (
      <div className="space-y-4">
        <PageTitle title={d.dashboard} />
        <Banner tone="danger">{error}</Banner>
        <p className="text-xs text-[var(--text-muted)]">
          The dashboard reads live from the operations workbook. If this mentions
          credentials, the Google service account has not been wired up yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageTitle
        title={d.dashboard}
        extra={<SyncStatus offline={offline} lastSyncedAt={lastSyncedAt} loading={loading} onRefresh={reload} d={d} />}
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => router.push('/jobs?new=1')}>
              <Plus size={14} /> {d.newJob}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => router.push('/reminders?new=1')}>
              <Bell size={14} /> {d.addReminder}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => router.push('/logs?new=1')}>
              <CalendarPlus size={14} /> {d.addLog}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => router.push('/inbox')}>
              <InboxIcon size={14} /> {d.parseMessage}
            </Button>
          </div>
        }
      />

      {offline && <Banner tone="warn"><WifiOff size={13} className="me-1.5 inline" />{d.offline}</Banner>}

      {/* KPI grid */}
      <section
        aria-label={d.dashboard}
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8"
      >
        {loading && !data
          ? Array.from({ length: 16 }).map((_, i) => (
              <Card key={i} className="p-3"><Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-7 w-12" /></Card>
            ))
          : KPIS.map((k) => (
              <Link key={k.key} href={k.href} className="block">
                <Card className="h-full p-3 transition hover:border-brand">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    {k.label}
                  </p>
                  <p className={`mt-1.5 text-2xl font-bold tabular-nums ${
                    k.tone === 'good' ? 'text-ok'
                    : k.tone === 'warn' ? 'text-warn'
                    : k.tone === 'bad' ? 'text-bad'
                    : 'text-brand'}`}
                  >
                    {formatKpi(k.key, data?.kpis?.[k.key])}
                  </p>
                </Card>
              </Link>
            ))}
      </section>

      {/* Today's Operations */}
      <Card>
        <CardHeader
          title={d.todayOperations}
          action={<Link href="/jobs?view=all&date=today" className="text-xs font-semibold text-brand">→</Link>}
        />
        {loading && !data ? (
          <div className="space-y-2 p-4"><Skeleton /><Skeleton /><Skeleton /></div>
        ) : (data?.todayOperations?.length ?? 0) === 0 ? (
          <EmptyState title={d.noOperationsToday} hint={d.noOperationsTodayHint} />
        ) : (
          <TodayOperations jobs={data!.todayOperations} d={d} />
        )}
      </Card>

      {/* Tomorrow Plan Coordination */}
      {(loading && !data) ? (
        <Card><div className="p-4"><Skeleton className="h-20" /></div></Card>
      ) : (data?.tomorrowPlan && (data.tomorrowPlan.proposed + data.tomorrowPlan.confirmed) > 0) ? (
        <Card>
          <CardHeader
            title={d.tomorrowCoordination}
            action={<Link href="/jobs?view=tomorrow" className="text-xs font-semibold text-brand">→</Link>}
          />
          <div className="grid grid-cols-3 gap-2 p-3">
            <TomorrowStat label={d.proposedCount} value={data!.tomorrowPlan.proposed} tone="info" />
            <TomorrowStat label={d.confirmedCount} value={data!.tomorrowPlan.confirmed} tone="good" />
            <TomorrowStat
              label={d.needsCoordinationCount} value={data!.tomorrowPlan.needsCoordination}
              tone={data!.tomorrowPlan.needsCoordination > 0 ? 'bad' : 'good'}
              pulse={data!.tomorrowPlan.needsCoordination > 0}
            />
          </div>
          {data!.tomorrowPlan.needsCoordinationJobs.length > 0 ? (
            <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
              {data!.tomorrowPlan.needsCoordinationJobs.map((j) => (
                <Link
                  key={j.row} href={`/jobs?q=${encodeURIComponent(j.jobId || j.customer)}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-brand-wash"
                >
                  <AlertTriangle size={15} className="shrink-0 text-warn" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{j.customer || j.jobId}</p>
                    <p className="truncate text-xs text-[var(--text-muted)]">{j.fullAddress || '—'}</p>
                  </div>
                  <Chip tone="warn">{d.needsCoordinationCount}</Chip>
                </Link>
              ))}
            </div>
          ) : (
            <p className="border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--text-muted)]">
              {d.allCoordinated}
            </p>
          )}
        </Card>
      ) : null}

      {/* Charts */}
      <section className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader title={d.byStatus} />
          <div className="h-56 p-2">
            {loading && !data ? <Skeleton className="h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data?.charts.byStatus ?? []}
                  margin={{ top: 8, right: 8, bottom: 42, left: -18 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="name" angle={-38} textAnchor="end" interval={0}
                    tick={{ fontSize: 9, fill: 'var(--text-muted)' }} height={60} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar
                    dataKey="value"
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(p: { name?: string }) =>
                      p?.name && router.push(`/jobs?status=${encodeURIComponent(p.name)}`)}
                  >
                    {(data?.charts.byStatus ?? []).map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={d.byPriority} />
          <div className="h-56 p-2">
            {loading && !data ? <Skeleton className="h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data?.charts.byPriority ?? []}
                    dataKey="value" nameKey="name"
                    innerRadius={40} outerRadius={70} paddingAngle={2}
                    cursor="pointer"
                    onClick={(p: { name?: string }) =>
                      p?.name && router.push(`/jobs?priority=${encodeURIComponent(p.name)}`)}
                  >
                    {(data?.charts.byPriority ?? []).map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <Legend items={data?.charts.byPriority ?? []} />
        </Card>

        <Card>
          <CardHeader title={d.byType} />
          <div className="h-56 p-2">
            {loading && !data ? <Skeleton className="h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data?.charts.byType ?? []}
                    dataKey="value" nameKey="name"
                    innerRadius={40} outerRadius={70} paddingAngle={2}
                  >
                    {(data?.charts.byType ?? []).map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <Legend items={data?.charts.byType ?? []} />
        </Card>
      </section>

      {/* Escalations */}
      {((data?.urgent?.length ?? 0) + (data?.waitingMaterials?.length ?? 0) > 0 || (loading && !data)) && (
        <Card>
          <CardHeader title={`${d.urgent} · ${d.waitingMaterials}`} />
          {loading && !data ? <div className="space-y-2 p-4"><Skeleton /><Skeleton /><Skeleton /></div> : (
            <div className="divide-y divide-[var(--line)]">
              {(data?.urgent ?? []).map((j) => (
                <AlertRow key={`u-${j.row}`} job={j} tone="danger" />
              ))}
              {(data?.waitingMaterials ?? []).map((j) => (
                <AlertRow key={`m-${j.row}`} job={j} tone="warn" />
              ))}
            </div>
          )}
        </Card>
      )}

      {data?.reminderAlerts && (data.reminderAlerts.overdue + data.reminderAlerts.dueToday + data.reminderAlerts.dueTomorrow) > 0 && (
        <Card>
          <CardHeader
            title={d.remindersDueSoon}
            action={<Link href="/reminders" className="text-xs font-semibold text-brand">→</Link>}
          />
          <div className="flex flex-wrap gap-1.5 border-b border-[var(--line)] px-4 py-2.5">
            {data.reminderAlerts.overdue > 0 && <Chip tone="danger">{d.grpOverdue}: {data.reminderAlerts.overdue}</Chip>}
            {data.reminderAlerts.dueToday > 0 && <Chip tone="warn">{d.grpDueToday}: {data.reminderAlerts.dueToday}</Chip>}
            {data.reminderAlerts.dueTomorrow > 0 && <Chip tone="info">{d.grpDueTomorrow}: {data.reminderAlerts.dueTomorrow}</Chip>}
          </div>
          <div className="divide-y divide-[var(--line)]">
            {data.reminderAlerts.items.map((r) => (
              <Link key={r.row} href="/reminders"
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-brand-wash">
                <AlertTriangle size={15} className={`shrink-0 ${r.overdue ? 'text-bad' : 'text-warn'}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.customer || '—'}</p>
                  <p className="truncate text-xs text-[var(--text-muted)]">{r.requiredAction}</p>
                </div>
                <Chip tone={r.overdue ? 'danger' : 'warn'}>{r.dueAt || '—'}</Chip>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {(data?.myMentions?.length ?? 0) > 0 && (
        <Card>
          <CardHeader
            title={d.mentionedYouSection}
            action={<Link href="/reminders" className="text-xs font-semibold text-brand">→</Link>}
          />
          <div className="divide-y divide-[var(--line)]">
            {data!.myMentions.map((c) => (
              <Link key={c.commentId} href="/reminders"
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-brand-wash">
                <AtSign size={15} className="shrink-0 text-brand" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.author}</p>
                  <p className="truncate text-xs text-[var(--text-muted)]">{c.text}</p>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- helpers */

function formatKpi(key: string, v: number | undefined): string {
  if (v === undefined || v === null) return '—';
  return key.startsWith('hours') ? v.toFixed(1) : String(v);
}

export function PageTitle({
  title, action, extra,
}: { title: string; action?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold tracking-tight text-[var(--text)]">{title}</h1>
        {action}
      </div>
      {extra}
    </div>
  );
}

/** "Last synced" + manual refresh, shared by the header. */
function SyncStatus({
  offline, lastSyncedAt, loading, onRefresh, d,
}: {
  offline: boolean; lastSyncedAt: Date | null; loading: boolean;
  onRefresh: () => void; d: ReturnType<typeof t>;
}) {
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const id = setInterval(forceTick, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
      <span className={offline ? 'text-bad' : ''}>
        {d.lastSynced}: {lastSyncedAt ? relativeTime(lastSyncedAt) : d.justNow}
      </span>
      <button
        onClick={onRefresh}
        disabled={loading}
        title={d.refresh}
        aria-label={d.refresh}
        className="rounded-md p-1 text-[var(--text-muted)] transition hover:bg-brand-wash hover:text-brand disabled:opacity-50"
      >
        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

function relativeTime(d: Date): string {
  const secs = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Legend({ items }: { items: Array<{ name: string; value: number }> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--line)] px-4 py-2">
      {items.slice(0, 8).map((i, idx) => (
        <span key={i.name} className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          <span className="h-2 w-2 rounded-full"
            style={{ background: CHART_COLORS[idx % CHART_COLORS.length] }} />
          {i.name} · {i.value}
        </span>
      ))}
    </div>
  );
}

/** Desktop: compact table. Mobile: stacked cards. Same data, same click target. */
function TodayOperations({ jobs, d }: { jobs: Job[]; d: ReturnType<typeof t> }) {
  const crewOf = (j: Job) => j.teamSummary || (j.technicians.length ? j.technicians.join(', ') : '—');

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-start text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <th className="px-4 py-2 text-start">{d.customer}</th>
              <th className="px-2 py-2 text-start">{d.crew}</th>
              <th className="px-2 py-2 text-start">{d.truck}</th>
              <th className="px-2 py-2 text-start">{d.time}</th>
              <th className="px-4 py-2 text-start">{d.status}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {jobs.map((j) => (
              <tr key={j.row}
                className="cursor-pointer hover:bg-brand-wash"
                onClick={() => window.location.assign(`/jobs?q=${encodeURIComponent(j.jobId || j.customer)}`)}
              >
                <td className="max-w-[240px] truncate px-4 py-2.5">
                  <p className="truncate font-medium">{j.customer || j.jobId}</p>
                  <p className="truncate text-xs text-[var(--text-muted)]">{j.fullAddress || '—'}</p>
                </td>
                <td className="max-w-[160px] truncate px-2 py-2.5 text-[var(--text-muted)]">{crewOf(j)}</td>
                <td className="max-w-[100px] truncate px-2 py-2.5 text-[var(--text-muted)]">{j.truck || '—'}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-[var(--text-muted)]">{j.arrivalWindow || '—'}</td>
                <td className="px-4 py-2.5"><Chip tone={statusTone(j.status)}>{j.status || '—'}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="divide-y divide-[var(--line)] md:hidden">
        {jobs.map((j) => (
          <Link key={j.row} href={`/jobs?q=${encodeURIComponent(j.jobId || j.customer)}`}
            className="block px-4 py-3 hover:bg-brand-wash">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-medium">{j.customer || j.jobId}</p>
              <Chip tone={statusTone(j.status)}>{j.status || '—'}</Chip>
            </div>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--text-muted)]">
              <MapPin size={11} className="shrink-0" /> {j.fullAddress || '—'}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-muted)]">
              <span>{crewOf(j)}</span>
              {j.truck && <span>{j.truck}</span>}
              {j.arrivalWindow && (
                <span className="flex items-center gap-1"><Clock size={11} /> {j.arrivalWindow}</span>
              )}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}

function TomorrowStat({
  label, value, tone, pulse,
}: { label: string; value: number; tone: 'info' | 'good' | 'bad'; pulse?: boolean }) {
  const colors = tone === 'good'
    ? { bg: '#E7F2E8', border: '#C6E0C8', text: '#1B5E20' }
    : tone === 'bad'
    ? { bg: '#FBE6E6', border: '#F1C4C4', text: '#C62828' }
    : { bg: '#EAF5FC', border: '#C5E3F5', text: '#00548C' };
  return (
    <div
      className={pulse ? 'animate-pulse rounded-lg border p-2.5 text-center' : 'rounded-lg border p-2.5 text-center'}
      style={{ backgroundColor: colors.bg, borderColor: colors.border }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.text }}>{label}</p>
      <p className="mt-1 flex items-center justify-center gap-1 text-xl font-bold tabular-nums" style={{ color: colors.text }}>
        {tone === 'good' && value > 0 && <CheckCircle2 size={14} />}
        {value}
      </p>
    </div>
  );
}

function AlertRow({ job, tone }: { job: Job; tone: 'danger' | 'warn' }) {
  return (
    <Link href={`/jobs?q=${encodeURIComponent(job.jobId || job.customer)}`}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-brand-wash">
      <AlertTriangle size={15} className={`shrink-0 ${tone === 'danger' ? 'text-bad' : 'text-warn'}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{job.customer || job.jobId}</p>
        <p className="truncate text-xs text-[var(--text-muted)]">{job.fullAddress || job.scope}</p>
      </div>
      <Chip tone={tone === 'danger' ? priorityTone(job.priority) : 'warn'}>
        {tone === 'danger' ? job.priority : job.materialStatus || 'MATERIAL'}
      </Chip>
    </Link>
  );
}
