'use client';

import * as React from 'react';
import { Undo2 } from 'lucide-react';
import { Banner, Button, Card, Chip, EmptyState, Skeleton, useToast } from '@/components/ui';
import { PageTitle } from '../page';
import { useLang } from '@/components/shell/AppShell';
import { t } from '@/lib/i18n';
import { apiPost, useApi } from '@/lib/client';
import type { AuditRow } from '@/lib/audit';

type Res = { entries: AuditRow[]; count: number };

export default function AuditPage() {
  const { lang } = useLang();
  const d = t(lang);
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Res>('/api/audit?limit=150');
  const [busy, setBusy] = React.useState<string | null>(null);

  const undo = async (auditId: string) => {
    setBusy(auditId);
    try {
      const r = await apiPost<{ message: string }>('/api/audit', { auditId });
      toast(r.message, 'success');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Undo failed.', 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle title={d.audit} />
      {error && <Banner tone="danger">{error}</Banner>}

      <Banner tone="info">
        Every write from the web app, ChatGPT and Claude is recorded here with its
        previous and new value. Field-level changes can be reverted.
      </Banner>

      <Card>
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
          </div>
        ) : (data?.entries.length ?? 0) === 0 ? (
          <EmptyState title="No changes recorded yet." hint="The log fills as soon as the first write happens." />
        ) : (
          <div className="table-scroll">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-3 py-2 text-start font-semibold">When</th>
                  <th className="px-3 py-2 text-start font-semibold">Who</th>
                  <th className="px-3 py-2 text-start font-semibold">Source</th>
                  <th className="px-3 py-2 text-start font-semibold">Action</th>
                  <th className="px-3 py-2 text-start font-semibold">Target</th>
                  <th className="px-3 py-2 text-start font-semibold">Change</th>
                  <th className="px-3 py-2 text-start font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {data!.entries.map((e) => (
                  <tr key={e.auditId} className="border-b border-[var(--line)] last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-[11px] text-[var(--text-muted)]">
                      {e.timestamp?.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2 text-xs">{e.user}</td>
                    <td className="px-3 py-2"><Chip tone="muted">{e.source}</Chip></td>
                    <td className="px-3 py-2 text-xs font-medium">{e.action}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px]">
                      {e.sheet}!{e.row}
                    </td>
                    <td className="max-w-[280px] px-3 py-2 text-[11px]">
                      {e.field ? (
                        <span>
                          <strong>{e.field}</strong>{': '}
                          <span className="text-[var(--text-muted)] line-through">{e.prev || '∅'}</span>
                          {' → '}
                          <span className="text-brand">{e.next || '∅'}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {e.undone ? (
                        <Chip tone="muted">undone</Chip>
                      ) : e.field ? (
                        <Button
                          size="sm" variant="ghost"
                          disabled={busy === e.auditId}
                          onClick={() => undo(e.auditId)}
                        >
                          <Undo2 size={13} /> Undo
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
