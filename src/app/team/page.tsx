'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';
import {
  Banner, Button, Card, CardHeader, Chip, Drawer, EmptyState, Field, Input, Select,
  Skeleton, useToast,
} from '@/components/ui';
import { PageTitle } from '../page';
import { useLang } from '@/components/shell/AppShell';
import { t } from '@/lib/i18n';
import { apiPost, newIdempotencyKey, useApi } from '@/lib/client';
import type { Person, Truck } from '@/lib/team';

type Res = { people: Person[]; trucks: Truck[] };

function empTone(s: string) {
  const v = (s || '').toUpperCase();
  if (v === 'ACTIVE') return 'success' as const;
  if (v === 'ON LEAVE') return 'warn' as const;
  if (v === 'TEMPORARY') return 'info' as const;
  return 'muted' as const;
}
function opsTone(s: string) {
  const v = (s || '').toUpperCase();
  if (v === 'AVAILABLE') return 'success' as const;
  if (v === 'ASSIGNED' || v === 'IN SERVICE') return 'info' as const;
  if (v === 'MAINTENANCE') return 'warn' as const;
  if (v === 'OUT OF SERVICE') return 'danger' as const;
  return 'muted' as const;
}

export default function TeamPage() {
  const { lang } = useLang();
  const d = t(lang);
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Res>('/api/team');
  const [adding, setAdding] = React.useState(false);

  return (
    <div className="space-y-4">
      <PageTitle
        title={d.team}
        action={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> {d.newTeamMember}
          </Button>
        }
      />
      {error && <Banner tone="danger">{error}</Banner>}

      <Card>
        <CardHeader
          title="Team members"
          action={data && <Chip tone="success">{data.people.filter((p) => p.active).length} active</Chip>}
        />
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
          </div>
        ) : (data?.people.length ?? 0) === 0 ? (
          <EmptyState title="No personnel records." hint="They live on the Team & Fleet sheet." />
        ) : (
          <div className="table-scroll">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-4 py-2 text-start font-semibold">Name</th>
                  <th className="px-4 py-2 text-start font-semibold">Role</th>
                  <th className="px-4 py-2 text-start font-semibold">Phone</th>
                  <th className="px-4 py-2 text-start font-semibold">Default truck</th>
                  <th className="px-4 py-2 text-start font-semibold">Driver</th>
                  <th className="px-4 py-2 text-start font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data!.people.map((p) => (
                  <tr key={p.row} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-4 py-2.5 font-medium">{p.displayName || p.fullName}</td>
                    <td className="px-4 py-2.5 text-xs">{p.role || <Missing />}</td>
                    <td className="px-4 py-2.5 text-xs">{p.phone || <Missing />}</td>
                    <td className="px-4 py-2.5 text-xs">{p.defaultTruck || <Missing />}</td>
                    <td className="px-4 py-2.5 text-xs">{p.driverStatus || <Missing />}</td>
                    <td className="px-4 py-2.5"><Chip tone={empTone(p.status)}>{p.status || 'TBD'}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Trucks & fleet"
          action={data && <Chip tone="success">{data.trucks.filter((x) => x.available).length} available</Chip>}
        />
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
          </div>
        ) : (data?.trucks.length ?? 0) === 0 ? (
          <EmptyState title="No fleet records." hint="They live on the Team & Fleet sheet." />
        ) : (
          <div className="table-scroll">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-4 py-2 text-start font-semibold">Truck</th>
                  <th className="px-4 py-2 text-start font-semibold">Description</th>
                  <th className="px-4 py-2 text-start font-semibold">Plate</th>
                  <th className="px-4 py-2 text-start font-semibold">Primary driver</th>
                  <th className="px-4 py-2 text-start font-semibold">Next maintenance</th>
                  <th className="px-4 py-2 text-start font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data!.trucks.map((tk) => (
                  <tr key={tk.row} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-4 py-2.5 font-medium">
                      {tk.truckNumber}
                      {tk.isPlaceholder && <Chip tone="muted" className="ms-2">placeholder</Chip>}
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-2.5 text-xs">
                      {tk.description || <Missing />}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{tk.plate || <Missing />}</td>
                    <td className="px-4 py-2.5 text-xs">{tk.primaryDriver || <Missing />}</td>
                    <td className="px-4 py-2.5 text-xs">{tk.nextMaintenance || <Missing />}</td>
                    <td className="px-4 py-2.5"><Chip tone={opsTone(tk.status)}>{tk.status || 'TBD'}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[11px] text-[var(--text-muted)]">
        Blank cells are genuinely unknown — nothing here is invented. Fill them in on the
        Team &amp; Fleet sheet and every crew and truck selector updates automatically.
      </p>

      {adding && (
        <NewTeamMemberDrawer
          onClose={() => setAdding(false)}
          onSaved={(msg) => { toast(msg, 'success'); setAdding(false); reload(); }}
          onError={(msg) => toast(msg, 'danger')}
        />
      )}
    </div>
  );
}

function Missing() {
  return <span className="text-[var(--text-muted)] opacity-60">—</span>;
}

/* --------------------------------------------------------------- Drawer */

function NewTeamMemberDrawer({
  onClose, onSaved, onError,
}: { onClose: () => void; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const { lang } = useLang();
  const d = t(lang);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    fullName: '', role: '', department: '', phone: '', email: '', status: 'ACTIVE', notes: '',
  });

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.fullName.trim()) return;
    setSaving(true);
    try {
      const res = await apiPost<{ person: { fullName: string; row: number } }>(
        '/api/team', form, newIdempotencyKey(),
      );
      onSaved(`Added ${res.person.fullName} to Team & Fleet (row ${res.person.row}).`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add this person.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={d.newTeamMember}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>{d.cancel}</Button>
          <Button size="sm" onClick={save} disabled={saving || !form.fullName.trim()}>
            {saving ? d.loading : d.save}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Full name"><Input value={form.fullName} onChange={set('fullName')} autoFocus /></Field>
        <Field label="Role"><Input value={form.role} onChange={set('role')} placeholder="e.g. Technician, Manager" /></Field>
        <Field label="Department"><Input value={form.department} onChange={set('department')} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set('phone')} inputMode="tel" /></Field>
        <Field label="Email"><Input value={form.email} onChange={set('email')} type="email" /></Field>
        <Field label="Status">
          <Select value={form.status} onChange={set('status')}>
            <option value="ACTIVE">ACTIVE</option>
            <option value="TEMPORARY">TEMPORARY</option>
            <option value="ON LEAVE">ON LEAVE</option>
          </Select>
        </Field>
      </div>
    </Drawer>
  );
}
