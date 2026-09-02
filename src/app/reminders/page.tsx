'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Plus, SlidersHorizontal, X, GripVertical, MessageSquare, Trash2,
} from 'lucide-react';
import {
  Banner, Button, Card, CardHeader, Chip, Drawer, EmptyState, Field, Input, MultiSelect, Select,
  Skeleton, Textarea, useToast,
} from '@/components/ui';
import { PageTitle } from '../page';
import { useLang } from '@/components/shell/AppShell';
import { t, type Dict } from '@/lib/i18n';
import { apiPatch, apiPost, newIdempotencyKey, useApi } from '@/lib/client';
import { priorityTone } from '@/lib/brand';
import {
  REMINDER_PRIORITIES, REMINDER_STATUSES, groupReminders,
  type ReminderGroupKey,
} from '@/lib/core';
import type { Reminder } from '@/lib/reminders';
import type { ReminderComment } from '@/lib/reminder-comments';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type ReminderRow = Reminder & { commentCount: number; openMentions: number };
type Groups = Record<ReminderGroupKey, ReminderRow[]>;
type Res = {
  reminders: ReminderRow[]; count: number; overdue: number;
  groups: Groups | null; priorityOrder: ReminderRow[] | null;
};

const POLL_MS = 25_000;
const GROUP_ORDER: ReminderGroupKey[] = [
  'overdue', 'dueToday', 'dueTomorrow', 'scheduled', 'followUp', 'waiting', 'other',
];

function groupLabel(d: Dict, key: ReminderGroupKey): string {
  switch (key) {
    case 'overdue': return d.grpOverdue;
    case 'dueToday': return d.grpDueToday;
    case 'dueTomorrow': return d.grpDueTomorrow;
    case 'scheduled': return d.grpScheduled;
    case 'followUp': return d.grpFollowUp;
    case 'waiting': return d.grpWaiting;
    case 'other': return d.grpOther;
  }
}

export default function RemindersPage() {
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
  const [which, setWhich] = React.useState<'active' | 'archive' | 'estimate'>('active');
  const [viewMode, setViewMode] = React.useState<'smart' | 'priority'>('smart');
  const [creating, setCreating] = React.useState(params.get('new') === '1');
  const [editing, setEditing] = React.useState<Reminder | null>(null);
  const [prefillCustomer] = React.useState(params.get('customer') ?? '');
  const [showFilters, setShowFilters] = React.useState(false);
  const [category, setCategory] = React.useState('');
  const [assignedTo, setAssignedTo] = React.useState('');
  const [priority, setPriority] = React.useState('');
  const [status, setStatus] = React.useState('');

  React.useEffect(() => {
    const saved = window.localStorage.getItem('trt-reminders-view');
    if (saved === 'smart' || saved === 'priority') setViewMode(saved);
  }, []);
  const setView = (v: 'smart' | 'priority') => {
    setViewMode(v);
    window.localStorage.setItem('trt-reminders-view', v);
  };

  const drawerOpen = creating || Boolean(editing);
  const { data, error, loading, offline, reload } =
    useApi<Res>(`/api/reminders?which=${which}`, { pollMs: POLL_MS, pause: drawerOpen });

  const categoryOptions = React.useMemo(
    () => [...new Set((data?.reminders ?? []).map((r) => r.category).filter(Boolean))].sort(),
    [data],
  );
  const assigneeOptions = React.useMemo(
    () => [...new Set((data?.reminders ?? []).map((r) => r.assignedTo).filter(Boolean))].sort(),
    [data],
  );

  const filtered = React.useMemo(() => {
    let list = data?.reminders ?? [];
    if (category) list = list.filter((r) => r.category === category);
    if (assignedTo) list = list.filter((r) => r.assignedTo === assignedTo);
    if (priority) list = list.filter((r) => r.priority.toLowerCase() === priority.toLowerCase());
    if (status) list = list.filter((r) => r.status.toLowerCase() === status.toLowerCase());
    return list;
  }, [data, category, assignedTo, priority, status]);

  const activeFilters = [category, assignedTo, priority, status].filter(Boolean).length;
  const clearFilters = () => { setCategory(''); setAssignedTo(''); setPriority(''); setStatus(''); };

  // Grouping is recomputed over whatever the filters left, so a filtered
  // view still reads as Overdue / Due Today / ... rather than one flat list.
  const groups = React.useMemo(
    () => (which === 'active' ? groupReminders(filtered, new Date()) : null),
    [which, filtered],
  );

  const del = async (r: ReminderRow) => {
    if (!window.confirm(d.confirmDeleteReminder)) return;
    try {
      await apiPost('/api/reminders', { id: r.id, status: 'Removed' }, newIdempotencyKey());
      toast(`${r.id || r.customer} → ARCHIVE.`, 'success');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed.', 'danger');
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle
        title={d.reminders}
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
              <Plus size={14} /> {d.addReminder}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {(['active', 'archive', 'estimate'] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWhich(w)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              which === w
                ? 'border-brand bg-brand text-white'
                : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-brand hover:text-brand'
            }`}
          >
            {w === 'active' ? 'ACTIVE REMINDERS' : w === 'archive' ? 'ARCHIVE' : 'ESTIMATE CHECKLIST'}
          </button>
        ))}
        {data && which === 'active' && data.overdue > 0 && (
          <Chip tone="danger" className="self-center">{data.overdue} overdue</Chip>
        )}

        {which === 'active' && (
          <div className="ms-auto flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-0.5">
            {(['smart', 'priority'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  viewMode === v ? 'bg-brand text-white' : 'text-[var(--text-muted)] hover:text-brand'
                }`}
              >
                {v === 'smart' ? d.smartGroups : d.myPriorityOrder}
              </button>
            ))}
          </div>
        )}
      </div>

      {showFilters && (
        <Card className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={d.category}>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label={d.assignedTo}>
            <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">All</option>
              {assigneeOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </Field>
          <Field label={d.priority}>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">All</option>
              {REMINDER_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label={d.status}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {REMINDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          {activeFilters > 0 && (
            <div className="sm:col-span-2 lg:col-span-4">
              <Button variant="ghost" size="sm" onClick={clearFilters}><X size={14} /> {d.clear}</Button>
            </div>
          )}
        </Card>
      )}

      {error && <Banner tone="danger">{error}</Banner>}
      {offline && <Banner tone="warn">Offline — showing last synced data</Banner>}

      {which === 'estimate' ? (
        <Card>
          <EmptyState
            title="Estimate Checklist"
            hint="Checklist items for estimate preparation and tracking will appear here."
          />
        </Card>
      ) : loading && !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={which === 'active' ? d.noActiveReminders : 'Archive is empty.'}
            hint={which === 'active' ? d.noActiveRemindersHint : d.noActiveRemindersHint}
          />
        </Card>
      ) : viewMode === 'priority' ? (
        <PriorityBoard
          reminders={filtered}
          priorityOrder={data?.priorityOrder ?? filtered}
          locked={activeFilters > 0}
          onSelect={setEditing}
          onDelete={del}
          reload={reload}
        />
      ) : groups ? (
        <div className="space-y-4">
          {GROUP_ORDER.filter((key) => groups[key].length > 0).map((key) => (
            <div key={key}>
              <CardHeader
                title={groupLabel(d, key)}
                action={<Chip tone={key === 'overdue' ? 'danger' : 'muted'}>{groups[key].length}</Chip>}
              />
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {groups[key].map((r, i) => (
                  <ReminderCard key={`${r.sheet}-${r.row}`} r={r} number={i + 1} onSelect={setEditing} onDelete={del} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r, i) => (
            <ReminderCard key={`${r.sheet}-${r.row}`} r={r} number={i + 1} onSelect={setEditing} onDelete={del} />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ReminderDrawer
          reminder={editing}
          initialCustomer={editing ? undefined : prefillCustomer}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(m) => { toast(m, 'success'); setCreating(false); setEditing(null); reload(); }}
          onError={(m) => toast(m, 'danger')}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------- Priority board */

function PriorityBoard({
  reminders, priorityOrder, locked, onSelect, onDelete, reload,
}: {
  reminders: ReminderRow[]; priorityOrder: ReminderRow[]; locked: boolean;
  onSelect: (r: Reminder) => void; onDelete: (r: ReminderRow) => void; reload: () => void;
}) {
  const { lang } = useLang();
  const d = t(lang);
  const toast = useToast();
  // Re-seeds only when the server's saved order actually changes identity —
  // never on every poll — so a local optimistic drag is never clobbered by
  // the next background refresh. Adjusting state during render (rather than
  // in an effect) is React's documented pattern for this exact case.
  const seedKey = priorityOrder.map((r) => r.id).join('|');
  const [orderIds, setOrderIds] = React.useState<string[]>(() => priorityOrder.map((r) => r.id).filter(Boolean));
  const [seenKey, setSeenKey] = React.useState(seedKey);
  if (seedKey !== seenKey) {
    setSeenKey(seedKey);
    setOrderIds(priorityOrder.map((r) => r.id).filter(Boolean));
  }

  const byId = React.useMemo(() => new Map(reminders.map((r) => [r.id, r])), [reminders]);
  const filteredIds = React.useMemo(() => new Set(reminders.map((r) => r.id)), [reminders]);

  const ordered = React.useMemo(
    () => orderIds.map((id) => byId.get(id)).filter((r): r is ReminderRow => r !== undefined && filteredIds.has(r.id)),
    [orderIds, byId, filteredIds],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderIds.indexOf(String(active.id));
    const newIndex = orderIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(orderIds, oldIndex, newIndex);
    setOrderIds(next);
    try {
      await apiPost('/api/reminders/order', { order: next }, newIdempotencyKey());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to save the new order.', 'danger');
      reload();
    }
  };

  if (locked) {
    return (
      <div className="space-y-3">
        <Banner tone="info">{d.priorityOrderHint}</Banner>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ordered.map((r, i) => (
            <ReminderCard key={`${r.sheet}-${r.row}`} r={r} number={i + 1} onSelect={onSelect} onDelete={onDelete} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Banner tone="info">{d.priorityOrderHint}</Banner>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ordered.map((r) => r.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ordered.map((r, i) => (
              <SortableReminderCard key={r.id} r={r} number={i + 1} onSelect={onSelect} onDelete={onDelete} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableReminderCard({
  r, number, onSelect, onDelete,
}: { r: ReminderRow; number: number; onSelect: (r: Reminder) => void; onDelete: (r: ReminderRow) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <ReminderCard
        r={r} number={number} onSelect={onSelect} onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Card */

function ReminderCard({
  r, number, onSelect, onDelete, dragHandleProps,
}: {
  r: ReminderRow; number?: number; onSelect: (r: Reminder) => void; onDelete: (r: ReminderRow) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
}) {
  const { lang } = useLang();
  const d = t(lang);
  return (
    <Card className="flex h-full flex-col gap-2 p-3" onClick={() => onSelect(r)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {number !== undefined && (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-wash text-[10px] font-bold text-brand">
              {number}
            </span>
          )}
          {dragHandleProps && (
            <span
              {...dragHandleProps}
              onClick={(e) => e.stopPropagation()}
              className="flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-[var(--text-muted)] hover:bg-brand-wash hover:text-brand active:cursor-grabbing"
              aria-label="Drag to reorder"
            >
              <GripVertical size={16} />
            </span>
          )}
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{r.customer || '—'}</p>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(r); }}
          className="shrink-0 rounded p-1.5 text-[var(--text-muted)] transition hover:bg-bad/10 hover:text-bad"
          aria-label={d.deleteReminder}
          title={d.deleteReminder}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <p className="line-clamp-2 flex-1 text-xs text-[var(--text-muted)]">{r.requiredAction || '—'}</p>

      <div className="flex flex-wrap gap-1.5">
        {r.overdue && <Chip tone="danger">OVERDUE</Chip>}
        <Chip tone={priorityTone(r.priority)}>{r.priority || 'Normal'}</Chip>
        <Chip tone="info">{r.status || 'New'}</Chip>
        {r.category && <Chip tone="muted">{r.category}</Chip>}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-[11px] text-[var(--text-muted)]">
        <span className="truncate">
          {r.dueAt ? `Due ${r.dueAt}` : (r.assignedTo || '—')}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <MessageSquare size={12} />
          {r.commentCount}
          {r.openMentions > 0 && <span className="h-1.5 w-1.5 rounded-full bg-bad" />}
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- Drawer */

function ReminderDrawer({
  reminder, initialCustomer, onClose, onSaved, onError,
}: {
  reminder: Reminder | null;
  initialCustomer?: string;
  onClose: () => void;
  onSaved: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { lang } = useLang();
  const d = t(lang);
  const [saving, setSaving] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const [dueDate0, dueTime0] = splitDueAt(reminder?.dueAt ?? '');
  const [f, setF] = React.useState({
    id: reminder?.id ?? '',
    category: reminder?.category ?? '',
    customer: reminder?.customer ?? initialCustomer ?? '',
    requiredAction: reminder?.requiredAction ?? '',
    assignedTo: reminder?.assignedTo ?? '',
    priority: reminder?.priority ?? 'Normal',
    status: reminder?.status ?? 'New',
    dueDate: dueDate0,
    dueTime: dueTime0,
    nextFollowUp: toDateInput(reminder?.nextFollowUp ?? ''),
    contactAddress: reminder?.contactAddress ?? '',
    reference: reminder?.reference ?? '',
    amount: reminder?.amount ?? '',
    waitingFor: reminder?.waitingFor ?? '',
    notes: reminder?.notes ?? '',
  });

  const set = (k: keyof typeof f) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setF((x) => ({ ...x, [k]: e.target.value }));

  const needsFollowUpDate = f.status.toLowerCase() === 'follow-up required';

  const save = async () => {
    if (needsFollowUpDate && !f.nextFollowUp) {
      setValidationError(d.followUpRequiredHint);
      return;
    }
    setValidationError(null);
    setSaving(true);
    try {
      const { dueDate, dueTime, ...rest } = f;
      const payload = { ...rest, dueAt: [dueDate, dueTime].filter(Boolean).join(' ') };
      const res = await apiPost<{ result: { action: string; sheet: string; row: number; id: string } }>(
        '/api/reminders', payload, newIdempotencyKey(),
      );
      onSaved(`${res.result.action} ${res.result.id} → ${res.result.sheet} row ${res.result.row}.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={reminder ? `${reminder.id || 'Reminder'} · ${reminder.customer}` : d.addReminder}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>{d.cancel}</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? d.loading : d.save}</Button>
        </div>
      }
    >
      <div className="space-y-3">
        {reminder && (
          <Banner tone="info">
            Currently on <strong>{reminder.sheet}</strong> row {reminder.row}. Setting the
            status to Completed, Cancelled or Removed moves it to ARCHIVE automatically.
          </Banner>
        )}
        {validationError && <Banner tone="danger">{validationError}</Banner>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer / project"><Input value={f.customer} onChange={set('customer')} /></Field>
          <Field label={d.category}><Input value={f.category} onChange={set('category')} /></Field>
          <Field label={d.assignedTo}><Input value={f.assignedTo} onChange={set('assignedTo')} /></Field>
          <Field label={d.priority}>
            <Select value={f.priority} onChange={set('priority')}>
              {REMINDER_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label={d.status}>
            <Select value={f.status} onChange={set('status')}>
              {REMINDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <div />
          <Field label={d.dueDate}><Input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
          <Field label={d.dueTime}><Input type="time" value={f.dueTime} onChange={set('dueTime')} /></Field>
          <Field label={needsFollowUpDate ? `${d.followUpDateLabel} *` : d.followUpDateLabel}>
            <Input
              type="date" value={f.nextFollowUp} onChange={set('nextFollowUp')}
              className={needsFollowUpDate && !f.nextFollowUp ? 'border-bad' : undefined}
            />
          </Field>
          <Field label="Payment / amount (CAD)"><Input value={f.amount} onChange={set('amount')} /></Field>
          <Field label="Related file / reference"><Input value={f.reference} onChange={set('reference')} /></Field>
        </div>
        <Field label="Required action"><Textarea rows={3} value={f.requiredAction} onChange={set('requiredAction')} /></Field>
        <Field label="Contact & address"><Textarea rows={2} value={f.contactAddress} onChange={set('contactAddress')} /></Field>
        <Field label="Waiting for / latest response"><Textarea rows={2} value={f.waitingFor} onChange={set('waitingFor')} /></Field>
        <Field label="Notes / links"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>

        {reminder?.id && <CommentThread reminderId={reminder.id} />}
      </div>
    </Drawer>
  );
}

/* ----------------------------------------------------------- Comments */

function CommentThread({ reminderId }: { reminderId: string }) {
  const { lang } = useLang();
  const d = t(lang);
  const toast = useToast();
  const { data, loading, reload } = useApi<{ comments: ReminderComment[] }>(
    `/api/reminders/comments?reminderId=${encodeURIComponent(reminderId)}`, { pollMs: 15_000 },
  );
  const { data: team } = useApi<{ crewOptions: string[] }>('/api/team');
  const [text, setText] = React.useState('');
  const [mentions, setMentions] = React.useState<string[]>([]);
  const [posting, setPosting] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const post = async () => {
    const value = text.trim();
    if (!value) return;
    setPosting(true);
    try {
      await apiPost('/api/reminders/comments', { reminderId, text: value, mentions }, newIdempotencyKey());
      setText('');
      setMentions([]);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to post comment.', 'danger');
    } finally {
      setPosting(false);
    }
  };

  const toggleDone = async (commentId: string, actionDone: boolean) => {
    setBusyId(commentId);
    try {
      await apiPatch('/api/reminders/comments', { commentId, actionDone });
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update.', 'danger');
    } finally {
      setBusyId(null);
    }
  };

  const comments = data?.comments ?? [];

  return (
    <div className="space-y-3 border-t border-[var(--line)] pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{d.comments}</p>

      {loading && !data ? (
        <Skeleton className="h-16" />
      ) : comments.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{d.noComments}</p>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <div key={c.commentId} className="rounded-lg border border-[var(--line)] bg-[var(--canvas)] p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[var(--text)]">{c.author}</span>
                <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{formatWhen(c.createdAt, lang)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[var(--text)]">{c.text}</p>
              {c.mentions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {c.mentions.map((m) => <Chip key={m} tone="gold">@{m}</Chip>)}
                  {c.actionDone ? (
                    <Chip tone="success">✓ {d.doneBy}: {c.doneBy}</Chip>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === c.commentId}
                      onClick={() => toggleDone(c.commentId, true)}
                      className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)] transition hover:border-brand hover:text-brand disabled:opacity-50"
                    >
                      {d.markDone}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Textarea rows={2} placeholder={d.writeComment} value={text} onChange={(e) => setText(e.target.value)} />
        <MultiSelect
          options={team?.crewOptions ?? []}
          value={mentions}
          onChange={setMentions}
          placeholder={d.mentionTeammates}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={post} disabled={posting || !text.trim()}>
            {posting ? d.loading : d.postComment}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatWhen(iso: string, lang: 'en' | 'fa'): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-CA', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** The sheet stores "Due Date & Time" as one text cell; split it for the pickers. */
function splitDueAt(v: string): [string, string] {
  const s = String(v ?? '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T]?(\d{1,2}:\d{2})?/.exec(s);
  if (!m) return ['', ''];
  return [m[1], m[2] ?? ''];
}

function toDateInput(v: string): string {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
