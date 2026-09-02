'use client';

import * as React from 'react';

export type ReminderAlerts = { dueCount: number; mentionCount: number; total: number };

const POLL_MS = 60_000;

/**
 * In-app "day before" reminder channel: polls due-soon counts and open
 * @mentions in the background so the bell badge stays current from any page,
 * not just the Reminders view itself.
 */
export function useReminderAlerts(enabled: boolean): ReminderAlerts {
  const [dueCount, setDueCount] = React.useState(0);
  const [mentionCount, setMentionCount] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      try {
        const [remRes, mentionRes] = await Promise.all([
          fetch('/api/reminders?which=active', { cache: 'no-store' }),
          fetch('/api/reminders/comments?mentionsFor=me', { cache: 'no-store' }),
        ]);
        const rem = await remRes.json().catch(() => null);
        const mention = await mentionRes.json().catch(() => null);
        if (cancelled) return;
        if (rem?.ok && rem.groups) {
          setDueCount(
            (rem.groups.overdue?.length ?? 0) +
            (rem.groups.dueToday?.length ?? 0) +
            (rem.groups.dueTomorrow?.length ?? 0),
          );
        }
        if (mention?.ok) setMentionCount(mention.count ?? 0);
      } catch {
        // A failed background alert poll must never surface as an error banner.
      }
    };

    load();
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      load();
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);

  return { dueCount, mentionCount, total: dueCount + mentionCount };
}
