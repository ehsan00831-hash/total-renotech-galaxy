'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import {
  SlidersHorizontal, Plus, X, Bell, CalendarDays, Package, User, HardHat,
} from 'lucide-react';
import {
  Button, Card, Chip, Drawer, EmptyState, Field, Input, MultiSelect,
  Select, Skeleton, Textarea, Banner, useToast,
} from '@/components/ui';
import { PageTitle } from '../page';
import { useLang } from '@/components/shell/AppShell';
import { t, type Dict } from '@/lib/i18n';
import { apiPatch, apiPost, newIdempotencyKey, useApi } from '@/lib/client';
import {
  JOB_STATUSES, PRIORITIES, PROJECT_TYPES, MATERIAL_STATUSES, statusTone, priorityTone,
} from '@/lib/brand';
import { businessDay, parseSheetDate } from '@/lib/business-time';
import type { Job } from '@/lib/jobs';
import type { DailyLog, ProjectRollup } from '@/lib/logs';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter,
  useDroppable, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type JobConfirmationLite = {
  confirmed: boolean; customerConfirmed: boolean; crewConfirmed: boolean;
  customerConfirmedBy: string; crewConfirmedBy: string;
};
const DEFAULT_CONFIRMATION: JobConfirmationLite = {
  confirmed: false, customerConfirmed: false, crewConfirmed: false,
  customerConfirmedBy: '', crewConfirmedBy: '',
};
/** Confirmed but the two-step coordination isn't finished — the blink case. */
function needsCoordination(c: JobConfirmationLite): boolean {
  return c.confirmed && !(c.customerConfirmed && c.crewConfirmed);
}
const TOMORROW_PLAN = 'TOMORROW PLAN';

type JobTagsLite = { needsApproval: boolean; needsEstimate: boolean };
const DEFAULT_TAGS: JobTagsLite = { needsApproval: false, needsEstimate: false };

type JobsRes = {
  jobs: Job[]; count: number; view: string; order: string[];
  confirmations: Record<string, JobConfirmationLite>;
  tags: Record<string, JobTagsLite>;
};
type TeamRes = { crewOptions: string[]; truckOptions: string[] };
type JobDetailRes = { job: Job; logs: DailyLog[]; rollup: ProjectRollup | null };

const POLL_MS = 25_000;

/** The eight saved views the coordinator actually works from, in that order. */
const VIEW_KEYS_SHOWN = [
  'all', 'upcoming', 'tomorrow', 'scheduled', 'ongoing', 'waiting', 'urgent', 'completed',
] as const;

function viewLabel(d: Dict, key: string): string {
  switch (key) {
    case 'all': return 'All Jobs';
    case 'upcoming': return d.upcoming;
    case 'tomorrow': return d.tomorrow;
    case 'scheduled': return d.scheduledView;
    case 'ongoing': return d.ongoing;
    case 'waiting': return d.waiting;
    case 'urgent': return d.urgent.split(' /')[0];
    case 'completed': return d.completed;
    default: return key;
  }
}

export default function JobsPage() {
  return (
    <React.Suspense fallback={<div className="space-y-2"><Skeleton className="h-8" /><Skeleton className="h-64" /></div>}>
      <JobsInner />
    </React.Suspense>
  );
}

function JobsInner() {
  const { lang } = useLang();
  const d = t(lang);
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const [view, setView] = React.useState(params.get('view') ?? 'all');
  const [viewMode, setViewMode] = React.useState<'table' | 'board'>('table');
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const [status, setStatus] = React.useState(params.get('status') ?? '');
  const [priority, setPriority] = React.useState(params.get('priority') ?? '');
  const [projectType, setProjectType] = React.useState('');
  const [tech, setTech] = React.useState('');
  const [truck, setTruck] = React.useState('');
  const [dateFilter, setDateFilter] = React.useState('');
  const [showFilters, setShowFilters] = React.useState(false);
  // ?open=<jobId> deep-links straight into that job's drawer — e.g. from a
  // Materials or Completed row. Read once; the drawer's own open/close state
  // takes over from there so a later close doesn't reopen it.
  const [selectedId, setSelectedId] = React.useState<string | null>(params.get('open'));
  const [creating, setCreating] = React.useState(params.get('new') === '1');

  const today = React.useMemo(() => businessDay(new Date()), []);

  // The Dashboard's "Scheduled Today" tile links here with ?date=today —
  // resolve that once, on load, into the real date so the filter control
  // shows and behaves exactly like a manually picked date.
  React.useEffect(() => {
    const dp = params.get('date');
    if (dp === 'today') setDateFilter(today);
    else if (dp) setDateFilter(dp);
    // Only the initial URL matters; the filter is owned by this page from
    // here on, same as every other filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const saved = window.localStorage.getItem('trt-jobs-view');
    if (saved === 'table' || saved === 'board') setViewMode(saved);
  }, []);
  const setMode = (v: 'table' | 'board') => {
    setViewMode(v);
    window.localStorage.setItem('trt-jobs-view', v);
  };

  const url = React.useMemo(() => {
    const s = new URLSearchParams({ view });
    if (q) s.set('q', q);
    if (status) s.set('status', status);
    if (priority) s.set('priority', priority);
    if (projectType) s.set('projectType', projectType);
    if (tech) s.set('tech', tech);
    if (truck) s.set('truck', truck);
    return `/api/jobs?${s.toString()}`;
  }, [view, q, status, priority, projectType, tech, truck]);

  // Background refresh keeps the list current without a reload; it's held
  // back (not stopped — just not applied) while a drawer is open, so an
  // in-progress edit or create can never be overwritten mid-keystroke.
  const drawerOpen = Boolean(selectedId) || creating;
  const { data, error, loading, reload } = useApi<JobsRes>(url, { pollMs: POLL_MS, pause: drawerOpen });
  const team = useApi<TeamRes>('/api/team');

  const jobs = React.useMemo(() => {
    const all = data?.jobs ?? null;
    if (!all || !dateFilter) return all;
    return all.filter((j) => parseSheetDate(j.scheduledDate) === dateFilter);
  }, [data, dateFilter]);

  const selected = React.useMemo(
    () => (selectedId ? (jobs ?? data?.jobs ?? []).find((j) => j.jobId === selectedId) ?? null : null),
    [selectedId, jobs, data],
  );

  const activeFilters =
    [status, priority, projectType, tech, truck].filter(Boolean).length + (dateFilter ? 1 : 0);

  const clearAll = () => {
    setStatus(''); setPriority(''); setProjectType(''); setTech(''); setTruck(''); setQ(''); setDateFilter('');
    router.replace('/jobs');
  };

  return (
    <div className="space-y-4">
      <PageTitle
        title={d.jobs}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowFilters((v) => !v)}>
              <SlidersHorizontal size={14} /> {d.filters}
              {activeFilters > 0 && (
                <span className="ms-1 rounded-full bg-brand px-1.5 text-[10px] text-white">
                  {activeFilters}
                </span>
              )}
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> {d.newJob}
            </Button>
          </div>
        }
      />

      {/* Saved views */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="table-scroll -mx-1 flex-1 px-1">
          <div className="flex gap-1.5 pb-1">
            {VIEW_KEYS_SHOWN.map((key) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  view === key
                    ? 'border-brand bg-brand text-white'
                    : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-brand hover:text-brand'
                }`}
              >
                {viewLabel(d, key)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-0.5">
          {(['table', 'board'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setMode(v)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                viewMode === v ? 'bg-brand text-white' : 'text-[var(--text-muted)] hover:text-brand'
              }`}
            >
              {v === 'table' ? d.tableView : d.boardView}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={d.search}
          aria-label={d.search}
          className="min-w-[200px] flex-1"
        />
        <Input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          aria-label={d.scheduled}
          className="w-auto"
        />
        {(q || activeFilters > 0) && (
          <Button variant="ghost" size="sm" onClick={clearAll}><X size={14} /> {d.clear}</Button>
        )}
      </div>

      {showFilters && (
        <Card className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label={d.status}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {JOB_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label={d.priority}>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">All</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label={d.projectType}>
            <Select value={projectType} onChange={(e) => setProjectType(e.target.value)}>
              <option value="">All</option>
              {PROJECT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label={d.crew}>
            <Select value={tech} onChange={(e) => setTech(e.target.value)}>
              <option value="">All</option>
              {(team.data?.crewOptions ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label={d.truck}>
            <Select value={truck} onChange={(e) => setTruck(e.target.value)}>
              <option value="">All</option>
              {(team.data?.truckOptions ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </Card>
      )}

      {error && <Banner tone="danger">{error}</Banner>}

      {viewMode === 'board' ? (
        loading && !data ? (
          <div className="table-scroll -mx-1 flex gap-3 px-1 pb-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-64 w-[260px] shrink-0" />)}
          </div>
        ) : (jobs?.length ?? 0) === 0 ? (
          <Card><EmptyState title={d.noResults} hint={d.noResultsHint} /></Card>
        ) : (
          <JobsBoard
            jobs={jobs!} order={data?.order ?? []} confirmations={data?.confirmations ?? {}}
            tags={data?.tags ?? {}}
            onSelect={(j) => setSelectedId(j.jobId)} reload={reload}
          />
        )
      ) : (
      <Card>
        {loading && !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
          </div>
        ) : (jobs?.length ?? 0) === 0 ? (
          <EmptyState title={d.noResults} hint={d.noResultsHint} />
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2">
              <p className="text-xs font-semibold text-[var(--text-muted)]">
                {jobs!.length} {jobs!.length === 1 ? 'job' : 'jobs'}
              </p>
            </div>

            {/* Desktop table */}
            <div className="table-scroll hidden md:block">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-start text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    <Th>Job</Th><Th>{d.customer}</Th><Th>{d.address}</Th>
                    <Th>{d.status}</Th><Th>{d.priority}</Th>
                    <Th>{d.scheduled}</Th><Th>{d.crew}</Th><Th>{d.truck}</Th>
                  </tr>
                </thead>
                <tbody>
                  {jobs!.map((j) => (
                    <tr
                      key={j.row}
                      onClick={() => setSelectedId(j.jobId)}
                      className="cursor-pointer border-b border-[var(--line)] last:border-0 hover:bg-brand-wash"
                    >
                      <Td className="font-mono text-xs">{j.jobId || '—'}</Td>
                      <Td className="max-w-[220px] truncate font-medium">{j.customer || '—'}</Td>
                      <Td className="max-w-[240px] truncate text-xs text-[var(--text-muted)]">
                        {j.fullAddress || '—'}
                      </Td>
                      <Td><Chip tone={statusTone(j.status)}>{j.status || '—'}</Chip></Td>
                      <Td><Chip tone={priorityTone(j.priority)}>{j.priority || '—'}</Chip></Td>
                      <Td className="whitespace-nowrap text-xs">
                        {j.scheduledDate || '—'}{j.arrivalWindow ? ` · ${j.arrivalWindow}` : ''}
                      </Td>
                      <Td className="max-w-[180px] truncate text-xs">{j.teamSummary || '—'}</Td>
                      <Td className="whitespace-nowrap text-xs">{j.truck || '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y divide-[var(--line)] md:hidden">
              {jobs!.map((j) => (
                <button
                  key={j.row}
                  onClick={() => setSelectedId(j.jobId)}
                  className="block w-full px-4 py-3 text-start hover:bg-brand-wash"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {j.customer || j.jobId || '—'}
                    </p>
                    <Chip tone={statusTone(j.status)}>{j.status || '—'}</Chip>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                    {j.fullAddress || '—'}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Chip tone={priorityTone(j.priority)}>{j.priority || 'NORMAL'}</Chip>
                    {j.scheduledDate && (
                      <Chip tone="info">{j.scheduledDate}{j.arrivalWindow ? ` · ${j.arrivalWindow}` : ''}</Chip>
                    )}
                    {j.truck && <Chip tone="muted">{j.truck}</Chip>}
                  </div>
                  {j.teamSummary && (
                    <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
                      {j.teamSummary}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </Card>
      )}

      {selected && (
        <JobDrawer
          job={selected}
          crew={team.data?.crewOptions ?? []}
          trucks={team.data?.truckOptions ?? []}
          confirmation={data?.confirmations?.[selected.jobId]}
          tags={data?.tags?.[selected.jobId]}
          onReload={reload}
          onClose={() => setSelectedId(null)}
          onSaved={(msg) => { toast(msg, 'success'); setSelectedId(null); reload(); }}
          onError={(msg) => toast(msg, 'danger')}
        />
      )}

      {creating && (
        <JobDrawer
          job={null}
          crew={team.data?.crewOptions ?? []}
          trucks={team.data?.truckOptions ?? []}
          onClose={() => setCreating(false)}
          onSaved={(msg) => { toast(msg, 'success'); setCreating(false); reload(); }}
          onError={(msg) => toast(msg, 'danger')}
        />
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 text-start font-semibold">{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>;
}

/* --------------------------------------------------------------- Board */

const JOB_STATUS_SET: readonly string[] = JOB_STATUSES;

/** Saved order first, then anything not yet in it, in its existing order. */
function seedOrder(jobs: Job[], saved: string[]): string[] {
  const have = new Set(jobs.map((j) => j.jobId));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of saved) {
    if (have.has(id) && !seen.has(id)) { out.push(id); seen.add(id); }
  }
  for (const j of jobs) {
    if (!seen.has(j.jobId)) { out.push(j.jobId); seen.add(j.jobId); }
  }
  return out;
}

function JobsBoard({
  jobs, order, confirmations, tags, onSelect, reload,
}: {
  jobs: Job[]; order: string[]; confirmations: Record<string, JobConfirmationLite>;
  tags: Record<string, JobTagsLite>;
  onSelect: (j: Job) => void; reload: () => void;
}) {
  const { lang } = useLang();
  const d = t(lang);
  const toast = useToast();

  // Re-seeds only when the server's job/status pairs actually change — never
  // on every poll — so a card mid-drag (or just optimistically moved) is
  // never snapped back by the next background refresh. Adjusting state during
  // render, rather than in an effect, is React's documented pattern for this.
  const seedKey = jobs.map((j) => `${j.jobId}:${j.status}`).join('|');
  const [board, setBoard] = React.useState<Job[]>(jobs);
  const [seenKey, setSeenKey] = React.useState(seedKey);
  if (seedKey !== seenKey) {
    setSeenKey(seedKey);
    setBoard(jobs);
  }

  const orderSeedKey = `${seedKey}::${order.join(',')}`;
  const [orderIds, setOrderIds] = React.useState<string[]>(() => seedOrder(jobs, order));
  const [orderSeenKey, setOrderSeenKey] = React.useState(orderSeedKey);
  if (orderSeedKey !== orderSeenKey) {
    setOrderSeenKey(orderSeedKey);
    setOrderIds(seedOrder(board, order));
  }

  const byId = React.useMemo(() => new Map(board.map((j) => [j.jobId, j] as const)), [board]);
  const statusOf = React.useCallback(
    (jobId: string) => (byId.get(jobId)?.status ?? '').toUpperCase().trim(),
    [byId],
  );

  const columns = React.useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of JOB_STATUSES) m.set(s, []);
    for (const id of orderIds) {
      const s = statusOf(id);
      if (!m.has(s)) m.set(s, []);
      m.get(s)!.push(id);
    }
    return m;
  }, [orderIds, statusOf]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persistOrder = (ids: string[]) => {
    apiPost('/api/jobs/order', { order: ids }, newIdempotencyKey()).catch((e) => {
      toast(e instanceof Error ? e.message : 'Failed to save board order.', 'danger');
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const jobId = String(active.id);
    const overId = String(over.id);
    if (jobId === overId) return;

    const job = byId.get(jobId);
    if (!job) return;

    // The drop landed either on another card (join that card's column, at
    // its position) or directly on a column's empty area (its id IS the
    // status — append to the end of that column).
    const targetStatus = JOB_STATUS_SET.includes(overId) ? overId : statusOf(overId);
    const prevStatus = job.status;
    const statusChanged = targetStatus.toUpperCase().trim() !== prevStatus.toUpperCase().trim();

    if (statusChanged && ['DONE', 'COMPLETED'].includes(targetStatus) &&
        !window.confirm(d.confirmComplete.replace('{job}', `${job.jobId} — ${job.customer}`))) {
      return;
    }

    const oldIndex = orderIds.indexOf(jobId);
    let newIndex: number;
    if (JOB_STATUS_SET.includes(overId)) {
      // Dropped on the column's own empty area, not on a card — join the
      // end of that column's cards, not the very end of the whole board.
      const lastInColumn = (columns.get(targetStatus) ?? []).at(-1);
      newIndex = lastInColumn ? orderIds.indexOf(lastInColumn) + 1 : orderIds.length;
    } else {
      newIndex = orderIds.indexOf(overId);
    }
    const nextOrder = oldIndex === -1 || newIndex === -1 ? orderIds : arrayMove(orderIds, oldIndex, newIndex);

    setOrderIds(nextOrder);
    if (statusChanged) setBoard((list) => list.map((j) => (j.jobId === jobId ? { ...j, status: targetStatus } : j)));
    persistOrder(nextOrder);

    if (statusChanged) {
      try {
        await apiPatch(`/api/jobs/${encodeURIComponent(jobId)}`, { status: targetStatus }, newIdempotencyKey());
        toast(`${jobId} ${d.movedTo} ${targetStatus}.`, 'success');
        reload();
      } catch (e) {
        setBoard((list) => list.map((j) => (j.jobId === jobId ? { ...j, status: prevStatus } : j)));
        toast(e instanceof Error ? e.message : 'Failed to update status.', 'danger');
      }
    }
  };

  return (
    <div className="space-y-2">
      <Banner tone="info">{d.boardHint}</Banner>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="table-scroll -mx-1 flex items-start gap-3 px-1 pb-2">
          {JOB_STATUSES.map((status) => (
            <BoardColumn
              key={status} status={status} jobIds={columns.get(status) ?? []} byId={byId}
              confirmations={confirmations} tags={tags} onSelect={onSelect} emptyLabel={d.emptyColumn}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function BoardColumn({
  status, jobIds, byId, confirmations, tags, onSelect, emptyLabel,
}: {
  status: string; jobIds: string[]; byId: Map<string, Job>;
  confirmations: Record<string, JobConfirmationLite>;
  tags: Record<string, JobTagsLite>;
  onSelect: (j: Job) => void; emptyLabel: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex w-[260px] shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="truncate text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
          {status}
        </p>
        <Chip tone={jobIds.length > 0 ? 'info' : 'muted'}>{jobIds.length}</Chip>
      </div>
      <div
        ref={setNodeRef}
        className={clsx(
          'flex min-h-[100px] flex-col gap-2 rounded-xl border border-dashed p-2 transition',
          isOver ? 'border-brand bg-brand-wash' : 'border-[var(--line)]',
        )}
      >
        <SortableContext items={jobIds} strategy={verticalListSortingStrategy}>
          {jobIds.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11px] text-[var(--text-muted)]">{emptyLabel}</p>
          ) : (
            jobIds.map((id) => {
              const job = byId.get(id);
              return job ? (
                <BoardCard
                  key={id} job={job} confirmation={confirmations[id]} tags={tags[id]} onSelect={onSelect}
                />
              ) : null;
            })
          )}
        </SortableContext>
      </div>
    </div>
  );
}

function BoardCard({
  job, confirmation, tags, onSelect,
}: {
  job: Job; confirmation?: JobConfirmationLite; tags?: JobTagsLite; onSelect: (j: Job) => void;
}) {
  const { lang } = useLang();
  const d = t(lang);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.jobId });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.6 : 1,
  };

  const isTomorrowPlan = job.status.toUpperCase().trim() === TOMORROW_PLAN;
  const conf = confirmation ?? DEFAULT_CONFIRMATION;
  const attention = isTomorrowPlan && needsCoordination(conf);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none">
      <Card
        className={clsx('flex flex-col gap-1.5 p-2.5', attention && 'animate-pulse ring-2 ring-[#F9A825]')}
        style={isTomorrowPlan ? {
          backgroundColor: conf.confirmed ? '#E7F2E8' : '#EAF5FC',
          borderColor: conf.confirmed ? '#C6E0C8' : '#C5E3F5',
        } : undefined}
        onClick={() => onSelect(job)}
      >
        <div className="flex items-start justify-between gap-1.5">
          <p className="min-w-0 flex-1 truncate text-xs font-semibold">
            {job.customer || job.jobId || '—'}
          </p>
          <Chip tone={priorityTone(job.priority)} className="shrink-0">{job.priority || '—'}</Chip>
        </div>
        <p className="truncate text-[10px] text-[var(--text-muted)]">{job.fullAddress || '—'}</p>
        {(tags?.needsApproval || tags?.needsEstimate) && (
          <div className="flex flex-wrap gap-1">
            {tags.needsApproval && <Chip tone="warn">{d.tagApproval}</Chip>}
            {tags.needsEstimate && <Chip tone="gold">{d.tagEstimate}</Chip>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-[var(--text-muted)]">
          {job.scheduledDate && <span>{job.scheduledDate}{job.arrivalWindow ? ` · ${job.arrivalWindow}` : ''}</span>}
          {job.truck && <span>· {job.truck}</span>}
        </div>
        {job.teamSummary && (
          <p className="truncate text-[10px] text-[var(--text-muted)]">{job.teamSummary}</p>
        )}
        {isTomorrowPlan && (
          <div className="flex items-center gap-2 border-t border-black/10 pt-1">
            <span className={clsx(
              'text-[9px] font-bold uppercase tracking-wide',
              conf.confirmed ? 'text-[#1B5E20]' : 'text-[#00548C]',
            )}>
              {conf.confirmed ? d.confirmedForTomorrow : d.proposedForTomorrow}
            </span>
            {conf.confirmed && (
              <span className="ms-auto flex items-center gap-1">
                <span title={d.customerConfirmedLabel}>
                  <User size={11} className={conf.customerConfirmed ? 'text-[#1B5E20]' : 'text-[var(--text-muted)]'} />
                </span>
                <span title={d.crewConfirmedLabel}>
                  <HardHat size={11} className={conf.crewConfirmed ? 'text-[#1B5E20]' : 'text-[var(--text-muted)]'} />
                </span>
              </span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="border-b border-[var(--line)] pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
      {children}
    </h3>
  );
}

/* ------------------------------------------------------------- Drawer */

function JobDrawer({
  job, crew, trucks, confirmation, tags, onReload, onClose, onSaved, onError,
}: {
  job: Job | null;
  crew: string[];
  trucks: string[];
  confirmation?: JobConfirmationLite;
  tags?: JobTagsLite;
  onReload?: () => void;
  onClose: () => void;
  onSaved: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { lang } = useLang();
  const d = t(lang);
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [completing, setCompleting] = React.useState(false);

  // The list view already has enough to edit every field; the detail
  // endpoint additionally carries this job's own daily-log history and
  // roll-up, which only matters once someone opens the drawer.
  const { data: detail } = useApi<JobDetailRes>(
    job ? `/api/jobs/${encodeURIComponent(job.jobId)}` : null,
  );

  const [form, setForm] = React.useState({
    customer: job?.customer ?? '',
    projectType: job?.projectType ?? '',
    fullAddress: job?.fullAddress ?? '',
    contactName: job?.contactName ?? '',
    phone: job?.phone ?? '',
    email: job?.email ?? '',
    woNumber: job?.woNumber ?? '',
    poNumber: job?.poNumber ?? '',
    scope: job?.scope ?? '',
    priority: job?.priority ?? 'NORMAL',
    status: job?.status ?? 'NEED INFO',
    scheduledDate: job?.scheduledDate ?? '',
    arrivalWindow: job?.arrivalWindow ?? '',
    truck: job?.truck ?? '',
    materials: job?.materials ?? '',
    materialStatus: job?.materialStatus ?? '',
    followUpDate: job?.followUpDate ?? '',
    notes: job?.notes ?? '',
  });
  const [technicians, setTechnicians] = React.useState<string[]>(job?.technicians ?? []);

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, technicians };
      if (job) {
        await apiPatch(`/api/jobs/${encodeURIComponent(job.jobId)}`, payload, newIdempotencyKey());
        onSaved(`Saved ${job.jobId} to All Jobs.`);
      } else {
        const res = await apiPost<{ result: { action: string; jobId: string; row: number } }>(
          '/api/jobs', payload, newIdempotencyKey(),
        );
        onSaved(`${res.result.action === 'created' ? 'Created' : 'Matched and updated'} ${res.result.jobId} (row ${res.result.row}).`);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const markComplete = async () => {
    if (!job) return;
    if (!window.confirm(d.confirmComplete.replace('{job}', `${job.jobId} — ${job.customer}`))) return;
    setCompleting(true);
    try {
      await apiPatch(`/api/jobs/${encodeURIComponent(job.jobId)}`, { status: 'COMPLETED' }, newIdempotencyKey());
      onSaved(`${job.jobId} marked Completed; Project End stamped today.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not complete the job.');
    } finally {
      setCompleting(false);
    }
  };

  const isLongProject = (job?.longProject ?? '').toUpperCase().startsWith('YES');
  const isClosed = ['DONE', 'COMPLETED'].includes((job?.status ?? '').toUpperCase().trim());

  return (
    <Drawer
      open
      onClose={onClose}
      title={job ? `${job.jobId} · ${job.customer}` : d.newJob}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>{d.cancel}</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? d.loading : d.save}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {job && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone={statusTone(job.status)}>{job.status}</Chip>
              <Chip tone={priorityTone(job.priority)}>{job.priority}</Chip>
              {job.woNumber && <Chip tone="muted">WO {job.woNumber}</Chip>}
              {job.poNumber && <Chip tone="muted">PO {job.poNumber}</Chip>}
              <Chip tone="gold">row {job.row}</Chip>
            </div>

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm" variant="secondary" disabled={isClosed || completing}
                onClick={markComplete}
              >
                {completing ? d.loading : d.complete}
              </Button>
              {isLongProject && (
                <Button
                  size="sm" variant="secondary"
                  onClick={() => router.push(`/logs?jobId=${encodeURIComponent(job.jobId)}&new=1`)}
                >
                  <CalendarDays size={13} /> {d.addDailyLog}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => router.push('/materials')}>
                <Package size={13} /> {d.viewMaterials}
              </Button>
              <Button
                size="sm" variant="secondary"
                onClick={() => router.push(`/reminders?new=1&customer=${encodeURIComponent(job.customer)}`)}
              >
                <Bell size={13} /> {d.addReminder}
              </Button>
            </div>
          </>
        )}

        {/* Overview */}
        <div className="space-y-3">
          <SectionTitle>{d.overview}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={d.customer}>
              <Input value={form.customer} onChange={set('customer')} />
            </Field>
            <Field label={d.projectType}>
              <Select value={form.projectType} onChange={set('projectType')}>
                <option value="">—</option>
                {PROJECT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={d.address}>
                <Input
                  value={form.fullAddress}
                  onChange={set('fullAddress')}
                  placeholder="Unit 4, 225 Rue Peel, Montreal, QC"
                />
              </Field>
            </div>
            <Field label="WO #">
              <Input value={form.woNumber} onChange={set('woNumber')} />
            </Field>
            <Field label="PO #">
              <Input value={form.poNumber} onChange={set('poNumber')} />
            </Field>
          </div>
        </div>

        {/* Contact */}
        <div className="space-y-3">
          <SectionTitle>{d.contact}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact name">
              <Input value={form.contactName} onChange={set('contactName')} />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={set('phone')} inputMode="tel" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Email">
                <Input value={form.email} onChange={set('email')} type="email" />
              </Field>
            </div>
          </div>
        </div>

        {/* Schedule & Crew */}
        <div className="space-y-3">
          <SectionTitle>{d.scheduleAndCrew}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={d.status}>
              <Select value={form.status} onChange={set('status')}>
                {JOB_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label={d.priority}>
              <Select value={form.priority} onChange={set('priority')}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
            <Field label="Scheduled date">
              <Input type="date" value={toDateInput(form.scheduledDate)} onChange={set('scheduledDate')} />
            </Field>
            <Field label="Arrival window">
              <Input type="time" value={toTimeInput(form.arrivalWindow)} onChange={set('arrivalWindow')} />
            </Field>
            <Field label={d.truck}>
              <Select value={form.truck} onChange={set('truck')}>
                <option value="">—</option>
                {trucks.map((tr) => <option key={tr} value={tr}>{tr}</option>)}
              </Select>
            </Field>
            <Field label="Follow-up date">
              <Input type="date" value={toDateInput(form.followUpDate)} onChange={set('followUpDate')} />
            </Field>
          </div>
          <Field label={`${d.crew} (max 5)`}>
            <MultiSelect options={crew} value={technicians} onChange={setTechnicians} max={5} />
          </Field>
        </div>

        {/* Work & Materials */}
        <div className="space-y-3">
          <SectionTitle>{d.materials}</SectionTitle>
          <Field label="Scope of work">
            <Textarea rows={3} value={form.scope} onChange={set('scope')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Material status">
              <Select value={form.materialStatus} onChange={set('materialStatus')}>
                <option value="">—</option>
                {MATERIAL_STATUSES.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Materials">
            <Textarea rows={2} value={form.materials} onChange={set('materials')} />
          </Field>
          <Field label="Internal notes">
            <Textarea rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
        </div>

        {/* History — only for an existing job, once the detail call lands */}
        {job && detail?.rollup && (
          <div className="space-y-2">
            <SectionTitle>{d.history}</SectionTitle>
            <div className="grid grid-cols-3 gap-2 text-center">
              <HistoryStat label={d.workingDays} value={detail.rollup.workingDays} />
              <HistoryStat label={d.totalHours} value={detail.rollup.totalPersonHours} />
              <HistoryStat label={d.avgCrew} value={detail.rollup.avgCrew} />
            </div>
            {detail.logs.length > 0 && (
              <p className="text-xs text-[var(--text-muted)]">
                {d.latestNote}: {detail.logs[0].workDate} — {detail.logs[0].workCompleted || detail.logs[0].nextStep || '—'}
              </p>
            )}
          </div>
        )}

        {job && job.status.toUpperCase().trim() === TOMORROW_PLAN && (
          <TomorrowConfirmation
            job={job} confirmation={confirmation}
            onReload={() => onReload?.()}
            onError={onError}
          />
        )}

        {job && (
          <JobTagsToggle job={job} tags={tags} onReload={() => onReload?.()} onError={onError} />
        )}

        {job && (
          <p className="text-[11px] text-[var(--text-muted)]">
            Last updated {job.lastUpdated || '—'}{job.updatedBy ? ` by ${job.updatedBy}` : ''}.
            Writes go to All Jobs row {job.row}; the Upcoming / Ongoing / Done views follow automatically.
          </p>
        )}
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------- Tomorrow confirmation */

function TomorrowConfirmation({
  job, confirmation, onReload, onError,
}: {
  job: Job; confirmation?: JobConfirmationLite; onReload: () => void; onError: (m: string) => void;
}) {
  const { lang } = useLang();
  const d = t(lang);

  // Reseeds only when the server's own confirmation record actually changes
  // — never on every poll — so a toggle mid-flight is never snapped back.
  const seedKey = JSON.stringify(confirmation ?? null);
  const [local, setLocal] = React.useState<JobConfirmationLite>(confirmation ?? DEFAULT_CONFIRMATION);
  const [seenKey, setSeenKey] = React.useState(seedKey);
  if (seedKey !== seenKey) {
    setSeenKey(seedKey);
    setLocal(confirmation ?? DEFAULT_CONFIRMATION);
  }

  const [busy, setBusy] = React.useState<'confirmed' | 'customerConfirmed' | 'crewConfirmed' | null>(null);

  const toggle = async (
    field: 'confirmed' | 'customerConfirmed' | 'crewConfirmed', value: boolean,
  ) => {
    setBusy(field);
    const prev = local;
    setLocal((l) => ({ ...l, [field]: value }));
    try {
      const res = await apiPost<{ confirmation: JobConfirmationLite }>(
        '/api/jobs/confirmation', { jobId: job.jobId, [field]: value }, newIdempotencyKey(),
      );
      setLocal(res.confirmation);
      onReload();
    } catch (e) {
      setLocal(prev);
      onError(e instanceof Error ? e.message : 'Failed to update confirmation.');
    } finally {
      setBusy(null);
    }
  };

  const attention = needsCoordination(local);

  return (
    <div className="space-y-2">
      <SectionTitle>{d.tomorrowConfirmation}</SectionTitle>
      <Banner tone={local.confirmed ? (attention ? 'warn' : 'success') : 'info'}>
        {local.confirmed
          ? (attention ? d.confirmedNeedsCoordination : d.confirmedForTomorrow)
          : d.proposedForTomorrow}
      </Banner>
      <Button
        size="sm" variant={local.confirmed ? 'secondary' : 'primary'}
        disabled={busy === 'confirmed'}
        onClick={() => toggle('confirmed', !local.confirmed)}
      >
        {local.confirmed ? d.revertToProposed : d.confirmForTomorrow}
      </Button>

      {local.confirmed && (
        <div className="space-y-1.5 pt-1">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox" checked={local.customerConfirmed} disabled={busy === 'customerConfirmed'}
              onChange={(e) => toggle('customerConfirmed', e.target.checked)}
            />
            <User size={13} />
            {d.customerConfirmedLabel}
            {local.customerConfirmedBy ? ` — ${local.customerConfirmedBy}` : ''}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox" checked={local.crewConfirmed}
              disabled={!local.customerConfirmed || busy === 'crewConfirmed'}
              onChange={(e) => toggle('crewConfirmed', e.target.checked)}
            />
            <HardHat size={13} />
            {d.crewConfirmedLabel}
            {local.crewConfirmedBy ? ` — ${local.crewConfirmedBy}` : ''}
          </label>
          {!local.customerConfirmed && (
            <p className="text-[10px] text-[var(--text-muted)]">{d.customerFirstHint}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Tags */

function JobTagsToggle({
  job, tags, onReload, onError,
}: { job: Job; tags?: JobTagsLite; onReload: () => void; onError: (m: string) => void }) {
  const { lang } = useLang();
  const d = t(lang);

  const seedKey = JSON.stringify(tags ?? null);
  const [local, setLocal] = React.useState<JobTagsLite>(tags ?? DEFAULT_TAGS);
  const [seenKey, setSeenKey] = React.useState(seedKey);
  if (seedKey !== seenKey) {
    setSeenKey(seedKey);
    setLocal(tags ?? DEFAULT_TAGS);
  }

  const [busy, setBusy] = React.useState<'needsApproval' | 'needsEstimate' | null>(null);

  const toggle = async (field: 'needsApproval' | 'needsEstimate', value: boolean) => {
    setBusy(field);
    const prev = local;
    setLocal((l) => ({ ...l, [field]: value }));
    try {
      const res = await apiPost<{ tags: JobTagsLite }>(
        '/api/jobs/tags', { jobId: job.jobId, [field]: value }, newIdempotencyKey(),
      );
      setLocal(res.tags);
      onReload();
    } catch (e) {
      setLocal(prev);
      onError(e instanceof Error ? e.message : 'Failed to update tags.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-1.5">
      <SectionTitle>{d.jobTags}</SectionTitle>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox" checked={local.needsApproval} disabled={busy === 'needsApproval'}
          onChange={(e) => toggle('needsApproval', e.target.checked)}
        />
        {d.needsApprovalLabel}
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox" checked={local.needsEstimate} disabled={busy === 'needsEstimate'}
          onChange={(e) => toggle('needsEstimate', e.target.checked)}
        />
        {d.needsEstimateLabel}
      </label>
    </div>
  );
}

function HistoryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--line)] p-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-brand">{value}</p>
    </div>
  );
}

/** The sheet stores dates as display text; inputs need ISO. */
function toDateInput(v: string): string {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

function toTimeInput(v: string): string {
  const s = String(v ?? '').trim().toLowerCase().replace(/\./g, '');
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/.exec(s);
  if (!m) return '';
  let h = Number(m[1]);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
