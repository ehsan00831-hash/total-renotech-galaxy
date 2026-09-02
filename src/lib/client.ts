'use client';

import * as React from 'react';

export type ApiState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True once at least one successful response has landed. */
  isStale: boolean;
  lastSyncedAt: Date | null;
  offline: boolean;
  reload: () => void;
};

export type UseApiOptions = {
  /**
   * Background refresh interval in ms. The request still fires on this
   * cadence while `pause` is true — pausing only holds back applying the
   * result, so a poll due mid-edit isn't lost, just deferred until the form
   * closes. Omit for a one-shot fetch (the original behaviour).
   */
  pollMs?: number;
  /** Hold background updates — e.g. while the user is editing a form. */
  pause?: boolean;
};

/**
 * Small typed fetcher with a reload handle, optional polling and offline
 * detection. Every list page uses this; passing no options keeps the
 * original one-shot-fetch behaviour exactly.
 */
export function useApi<T>(url: string | null, options: UseApiOptions = {}): ApiState<T> {
  const { pollMs, pause = false } = options;
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(Boolean(url));
  const [nonce, setNonce] = React.useState(0);
  const [lastSyncedAt, setLastSyncedAt] = React.useState<Date | null>(null);
  // Node 22+ ships a built-in `navigator` global with no `onLine` property, so
  // a plain `typeof navigator !== 'undefined'` check reads `true` on the
  // server and `false` in a real browser — a sitewide hydration mismatch.
  // Only trust it once `onLine` is actually a boolean.
  const [offline, setOffline] = React.useState(
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? !navigator.onLine : false,
  );
  const pauseRef = React.useRef(pause);
  pauseRef.current = pause;
  const pendingRef = React.useRef<T | null>(null);

  React.useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => { setOffline(false); setNonce((n) => n + 1); };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  React.useEffect(() => {
    if (!url) { setLoading(false); return; }
    let cancelled = false;
    const isBackground = pollMs !== undefined && nonce > 0;
    if (!isBackground) setLoading(true);
    if (!isBackground) setError(null);

    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || body.ok === false) {
          // A background poll that fails leaves the last good data on screen
          // rather than blanking a working page over a transient hiccup.
          if (!isBackground) { setError(body.error ?? `Request failed (${res.status}).`); setData(null); }
          return;
        }
        setError(null);
        if (pauseRef.current) {
          // Editing in progress: hold the fresher data rather than yank the
          // form's context out from under the user mid-keystroke.
          pendingRef.current = body as T;
        } else {
          setData(body as T);
          setLastSyncedAt(new Date());
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (!isBackground) setError(e instanceof Error ? e.message : 'Network error.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [url, nonce, pollMs]);

  // The moment editing stops, apply whatever arrived while paused.
  React.useEffect(() => {
    if (!pause && pendingRef.current !== null) {
      setData(pendingRef.current);
      setLastSyncedAt(new Date());
      pendingRef.current = null;
    }
  }, [pause]);

  React.useEffect(() => {
    if (!url || !pollMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setNonce((n) => n + 1);
    }, pollMs);
    return () => clearInterval(id);
  }, [url, pollMs]);

  return {
    data, error, loading, offline,
    isStale: lastSyncedAt !== null,
    lastSyncedAt,
    reload: () => setNonce((n) => n + 1),
  };
}

export async function apiPost<T>(
  url: string, body: unknown, idempotencyKey?: string,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `Request failed (${res.status}).`);
  }
  return json as T;
}

export async function apiPatch<T>(
  url: string, body: unknown, idempotencyKey?: string,
): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `Request failed (${res.status}).`);
  }
  return json as T;
}

export function newIdempotencyKey(): string {
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
