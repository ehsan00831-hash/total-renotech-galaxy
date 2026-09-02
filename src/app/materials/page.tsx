'use client';

/**
 * Materials — a read-mostly workflow derived entirely from All Jobs. "Materials"
 * in the live workbook is a formula view of All Jobs, exactly like Upcoming or
 * Ongoing, so there is no separate materials record to create, and nothing here
 * is ever written to that view directly — the one write this page makes (the
 * status Select) targets All Jobs' own Material Status column, through the same
 * job-update path the Jobs drawer uses.
 *
 * The live sheet does not carry quantity, buyer, supplier or a material-specific
 * due date — only a free-text Materials description and a Material Status enum.
 * Rather than invent columns, this page shows exactly those two fields (plus
 * the job's own scheduled date as the closest real timing reference) and says
 * so in the UI instead of rendering blank fields that look broken.
 */

import * as React from 'react';
import Link from 'next/link';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  Banner, Button, Card, Chip, EmptyState, Field, Input, Select, Skeleton, useToast,
} from '@/components/ui';
import { PageTitle } from '../page';
import { useLang } from '@/components/shell/AppShell';
import { t } from '@/lib/i18n';
import { apiPatch, newIdempotencyKey, useApi } from '@/lib/client';
import { statusTone, priorityTone, MATERIAL_STATUSES } from '@/lib/brand';

type Row = {
  jobId: string; customer: string; fullAddress: string; material: string;
  materialStatus: string; jobStatus: string; priority: string;
  scheduledDate: string; truck: string; crew: string; notes: string;
  row: number; active: boolean;
};
type Res = { materials: Row[]; count: number; toBuy: number };

const POLL_MS = 25_000;

/** The six-stage procurement workflow, mapped onto the sheet's real enum. */
const VIEWS: Array<{ key: string; statuses: string[] }> = [
  { key: 'matNeeded', statuses: ['NEED LIST'] },
  { key: 'matToBuy', statuses: ['NEED PURCHASE'] },
  { key: 'matOrdered', statuses: ['ORDERED'] },
  { key: 'matReady', statuses: ['READY'] },
  { key: 'matDelivered', statuses: ['DELIVERED'] },
  // The sheet's terminal state is "USED" — materials consumed on the job.
  { key: 'matCompleted', statuses: ['USED'] },
];

function matTone(s: string) {
  const v = (s || '').toUpperCase();
  if (v === 'NEED PURCHASE') return 'danger' as const;
  if (v === 'NEED LIST' || v === 'ORDERED') return 'warn' as const;
  if (v === 'READY' || v === 'DELIVERED' || v === 'USED') return 'success' as const;
  return 'muted' as const;
}

export default function MaterialsPage() {
  const { lang } = useLang();
  const d = t(lang);
  const toast = useToast();

  const [view, setView] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [dateFilter, setDateFilter] = React.useState('');
  const [showFilters, setShowFilters] = React.useState(false);
  const [pendingRow, setPendingRow] = React.useState<number | null>(null);

  const { data, error, loading, offline, reload } =
    useApi<Res>('/api/materials', { pollMs: POLL_MS, pause: pendingRow !== null });

  const rows = React.useMemo(() => {
    let all = data?.materials ?? [];
    if (view) {
      const statuses = VIEWS.find((v) => v.key === view)?.statuses ?? [];
      all = all.filter((r) => statuses.includes(r.materialStatus.toUpperCase()));
    }
    if (q) {
      const needle = q.toLowerCase();
      all = all.filter((r) =>
        [r.jobId, r.customer, r.material].join(' ').toLowerCase().includes(needle));
    }
    if (status) all = all.filter((r) => r.materialStatus.toUpperCase() === status.toUpperCase());
    if (dateFilter) all = all.filter((r) => r.scheduledDate === dateFilter);
    return all;
  }, [data, view, q, status, dateFilter]);

  const activeFilters = [status, dateFilter].filter(Boolean).length;
  const clearFilters = () => { setStatus(''); setDateFilter(''); setQ(''); setView(null); };

  const updateStatus = async (row: Row, next: string) => {
    setPendingRow(row.row);
    try {
      await apiPatch(`/api/jobs/${encodeURIComponent(row.jobId)}`, { materialStatus: next }, newIdempotencyKey());
      toast(`${row.jobId} material status → ${next}.`, 'success');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed.', 'danger');
    } finally {
      setPendingRow(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle
        title={d.materials}
        action={data && <Chip tone="warn">{data.toBuy} to purchase</Chip>}
      />

      <div className="table-scroll -mx-1 px-1">
        <div className="flex gap-1.5 pb-1">
          <button
            onClick={() => setView(null)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              view === null
                ? 'border-brand bg-brand text-white'
                : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-brand hover:text-brand'
            }`}
          >
            All
          </button>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                view === v.key
                  ? 'border-brand bg-brand text-white'
                  : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-brand hover:text-brand'
              }`}
            >
              {d[v.key as keyof typeof d] as string}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search job, customer, material…" className="min-w-[200px] flex-1"
        />
        <Button size="sm" variant="secondary" onClick={() => setShowFilters((v) => !v)}>
          <SlidersHorizontal size={14} /> {d.filters}
          {activeFilters > 0 && (
            <span className="ms-1 rounded-full bg-brand px-1.5 text-[10px] text-white">{activeFilters}</span>
          )}
        </Button>
        {(q || activeFilters > 0) && (
          <Button variant="ghost" size="sm" onClick={clearFilters}><X size={14} /> {d.clear}</Button>
        )}
      </div>

      {showFilters && (
        <Card className="grid gap-3 p-3 sm:grid-cols-2">
          <Field label={d.status}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {MATERIAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Job scheduled date">
            <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
          </Field>
        </Card>
      )}

      <Banner tone="muted">
        Buyer, supplier and a material-specific due date are not columns in the live sheet —
        only a description and status exist. Showing the job&apos;s own scheduled date as the
        closest real timing reference instead of inventing one.
      </Banner>

      {error && <Banner tone="danger">{error}</Banner>}
      {offline && <Banner tone="warn">Offline — showing last synced data</Banner>}

      <Card>
        {loading && !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No material requirements."
            hint="A job appears here as soon as its Materials field is filled on All Jobs."
          />
        ) : (
          <>
            <div className="table-scroll hidden md:block">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-4 py-2 text-start font-semibold">Job</th>
                    <th className="px-4 py-2 text-start font-semibold">{d.customer}</th>
                    <th className="px-4 py-2 text-start font-semibold">Material</th>
                    <th className="px-4 py-2 text-start font-semibold">Material status</th>
                    <th className="px-4 py-2 text-start font-semibold">Job status</th>
                    <th className="px-4 py-2 text-start font-semibold">{d.scheduled}</th>
                    <th className="px-4 py-2 text-start font-semibold">{d.updateStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.row} className="border-b border-[var(--line)] last:border-0 hover:bg-brand-wash">
                      <td className="px-4 py-2.5 font-mono text-xs">
                        <Link href={`/jobs?open=${encodeURIComponent(r.jobId)}`} className="text-brand hover:underline">
                          {r.jobId || '—'}
                        </Link>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2.5 font-medium">{r.customer}</td>
                      <td className="max-w-[280px] px-4 py-2.5 text-xs">{r.material || '—'}</td>
                      <td className="px-4 py-2.5"><Chip tone={matTone(r.materialStatus)}>{r.materialStatus || 'NONE'}</Chip></td>
                      <td className="px-4 py-2.5"><Chip tone={statusTone(r.jobStatus)}>{r.jobStatus}</Chip></td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">{r.scheduledDate || '—'}</td>
                      <td className="px-4 py-2.5">
                        <select
                          value={r.materialStatus || 'NONE'}
                          disabled={pendingRow === r.row}
                          onChange={(e) => updateStatus(r, e.target.value)}
                          className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-xs focus:border-brand focus:outline-none disabled:opacity-50"
                        >
                          {MATERIAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[var(--line)] md:hidden">
              {rows.map((r) => (
                <div key={r.row} className="px-4 py-3">
                  <Link href={`/jobs?open=${encodeURIComponent(r.jobId)}`} className="block hover:bg-brand-wash">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{r.customer}</p>
                      <Chip tone={matTone(r.materialStatus)}>{r.materialStatus || 'NONE'}</Chip>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">{r.material || '—'}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Chip tone={statusTone(r.jobStatus)}>{r.jobStatus}</Chip>
                      <Chip tone={priorityTone(r.priority)}>{r.priority}</Chip>
                      {r.scheduledDate && <Chip tone="muted">{r.scheduledDate}</Chip>}
                    </div>
                  </Link>
                  <select
                    value={r.materialStatus || 'NONE'}
                    disabled={pendingRow === r.row}
                    onChange={(e) => updateStatus(r, e.target.value)}
                    className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-xs focus:border-brand focus:outline-none disabled:opacity-50"
                  >
                    {MATERIAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <p className="text-[11px] text-[var(--text-muted)]">
        Every line stays attached to its originating job — editing the material on the
        job (or the status control above) updates this list.
      </p>
    </div>
  );
}
