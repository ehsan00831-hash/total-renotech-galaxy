'use client';

/**
 * Completed work in three windows plus the full archive.
 *
 * The window and the totals are computed on the server, against Project End
 * and the Daily Logs person-hours — the page only renders them, so the browser
 * cannot disagree with the API about what "this month" means.
 */

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Banner, Card, Chip, EmptyState, Skeleton } from '@/components/ui';
import { PageTitle } from '../page';
import { useLang } from '@/components/shell/AppShell';
import { t } from '@/lib/i18n';
import { useApi } from '@/lib/client';
import type { Job } from '@/lib/jobs';

type Range = 'today' | 'week' | 'month' | 'archive';

const POLL_MS = 25_000;

type Totals = {
  projects: number;
  technicians: number;
  personHours: number;
  loggedDays: number;
  withMaterials: number;
};

type Res = {
  range: Range;
  jobs: Array<Job & { completedOn: string | null }>;
  count: number;
  totals: Totals;
};

export default function CompletedPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-64" />}>
      <Inner />
    </React.Suspense>
  );
}

function Inner() {
  const { lang } = useLang();
  const d = t(lang);
  const params = useSearchParams();
  const [range, setRange] = React.useState<Range>((params.get('range') as Range) ?? 'month');
  const { data, error, loading, offline } =
    useApi<Res>(`/api/completed?range=${range}`, { pollMs: POLL_MS });

  const totals = data?.totals;
  const jobs = data?.jobs ?? [];

  const TABS: Array<[Range, string]> = [
    ['today', d.completedToday],
    ['week', d.completedWeek],
    ['month', d.completedMonth],
    ['archive', 'Completed Archive'],
  ];

  return (
    <div className="space-y-4">
      <PageTitle title={d.completed} />

      <div className="table-scroll -mx-1 px-1">
        <div className="flex gap-1.5 pb-1">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                range === key
                  ? 'border-brand bg-brand text-white'
                  : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-brand hover:text-brand'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}
      {offline && <Banner tone="warn">Offline — showing last synced data</Banner>}

      {range === 'archive' && (
        <p className="text-xs text-[var(--text-muted)]">
          Every job completed before this calendar month. Nothing here is ever deleted or
          moved out of All Jobs — this is a read view over the same records.
        </p>
      )}

      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {[
          ['Projects', totals?.projects],
          ['Technicians', totals?.technicians],
          ['Person-hours', totals?.personHours],
          ['Logged days', totals?.loggedDays],
          ['With materials', totals?.withMaterials],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {label}
            </p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-ok">
              {loading ? '—' : (value ?? 0)}
            </p>
          </Card>
        ))}
      </section>

      {loading ? (
        <Card>
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        </Card>
      ) : jobs.length === 0 ? (
        <Card>
          <EmptyState
            title="No completed work in this window."
            hint="Nothing is ever deleted — widen the range to see earlier records."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {groupByDay(jobs).map(([dayKey, dayJobs]) => (
            <Card key={dayKey}>
              <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
                <p className="text-xs font-semibold text-[var(--text)]">
                  {d.completedOn} — {formatDayHeader(dayKey, lang)}
                </p>
                <Chip tone="success">{dayJobs.length} {dayJobs.length === 1 ? d.jobSingular : d.jobsPlural}</Chip>
              </div>
              <div className="divide-y divide-[var(--line)]">
                {dayJobs.map((j) => (
                  <div key={j.row} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {j.customer || j.jobId}
                      </p>
                      <Chip tone="success">{j.status}</Chip>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                      {j.fullAddress || '—'}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                      {j.teamSummary && <span>{j.teamSummary}</span>}
                      {j.materials && <span>· {j.materials.slice(0, 60)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-[11px] text-[var(--text-muted)]">
        Completion is measured on <strong>Project End</strong>, falling back to Last
        Updated. Person-hours come from Daily Logs, where Total Labor Hours is already
        a person-hour figure.
      </p>
    </div>
  );
}

/** Most recent day first; jobs with no known completion date form their own trailing group. */
function groupByDay(
  jobs: Array<Job & { completedOn: string | null }>,
): Array<[string, Array<Job & { completedOn: string | null }>]> {
  const map = new Map<string, Array<Job & { completedOn: string | null }>>();
  for (const j of jobs) {
    const key = j.completedOn ?? '';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(j);
  }
  return [...map.entries()].sort(([a], [b]) => {
    if (!a) return 1;
    if (!b) return -1;
    return a < b ? 1 : a > b ? -1 : 0;
  });
}

function formatDayHeader(iso: string, lang: 'en' | 'fa'): string {
  if (!iso) return lang === 'fa' ? 'تاریخ نامشخص' : 'Unknown date';
  const dt = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-CA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}
