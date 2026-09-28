'use client';
// lib/client/use-api.ts
// ─────────────────────────────────────────────────────────────────────────────
// Tiny stale-while-revalidate GET hook for our own /api routes.
//
//   const { data, loading, refresh } = useApi<MyResponse>('/api/employee/attendance');
//
//   • Returns the last response for that URL immediately (module-level cache),
//     so going back to a page renders instantly instead of a spinner, then
//     refetches in the background and swaps in fresh data.
//   • Identical requests in flight at the same time share one network call.
//   • `loading` is true only when there is nothing cached to show yet.
//   • `refresh()` refetches (e.g. after a mutation). invalidateApi(prefix)
//     drops cached entries so the next mount refetches.
//   • Pass `null` as the URL to skip fetching (dependent / conditional data).
//
// The cache lives in memory only (per tab) and is cleared on sign-out reload.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';

type Entry = { data: unknown; at: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

async function fetchJson(url: string): Promise<unknown> {
  const pending = inflight.get(url);
  if (pending) return pending;

  const p = fetch(url, { cache: 'no-store' })
    .then(async (res) => {
      const json = await res.json().catch(() => null);
      if (!res.ok && json == null) throw new Error(`HTTP ${res.status}`);
      cache.set(url, { data: json, at: Date.now() });
      return json;
    })
    .finally(() => inflight.delete(url));

  inflight.set(url, p);
  return p;
}

/** Warm the cache ahead of navigation (e.g. on link hover / idle). */
export function prefetchApi(url: string) {
  if (!cache.has(url)) fetchJson(url).catch(() => {});
}

/** Drop cached responses whose URL starts with `prefix` (all when omitted). */
export function invalidateApi(prefix?: string) {
  for (const key of cache.keys()) if (!prefix || key.startsWith(prefix)) cache.delete(key);
}

export function useApi<T = unknown>(url: string | null) {
  const cached = url ? (cache.get(url)?.data as T | undefined) : undefined;
  const [data, setData] = useState<T | undefined>(cached);
  const [updatedAt, setUpdatedAt] = useState<number | undefined>(url ? cache.get(url)?.at : undefined);
  const [error, setError] = useState<Error | null>(null);
  const [validating, setValidating] = useState<boolean>(!!url);
  const urlRef = useRef(url);
  urlRef.current = url;

  const run = useCallback(async (target: string) => {
    setValidating(true);
    try {
      const json = (await fetchJson(target)) as T;
      if (urlRef.current === target) {
        setData(json);
        setUpdatedAt(cache.get(target)?.at ?? Date.now());
        setError(null);
      }
    } catch (err) {
      if (urlRef.current === target) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (urlRef.current === target) setValidating(false);
    }
  }, []);

  useEffect(() => {
    if (!url) {
      setValidating(false);
      return;
    }
    // Show whatever we have for the new URL right away, then revalidate.
    setData(cache.get(url)?.data as T | undefined);
    setUpdatedAt(cache.get(url)?.at);
    run(url);
  }, [url, run]);

  const refresh = useCallback(async () => {
    const target = urlRef.current;
    if (!target) return;
    inflight.delete(target);
    await run(target);
  }, [run]);

  return {
    data,
    error,
    /** When `data` was fetched (ms epoch). */
    updatedAt,
    /** Nothing to show yet (first load for this URL). */
    loading: data === undefined && validating,
    /** A (background) request is running. */
    validating,
    refresh,
    /** Optimistically replace the cached value (e.g. after a successful POST). */
    mutate: useCallback((next: T) => {
      const target = urlRef.current;
      const at = Date.now();
      if (target) cache.set(target, { data: next, at });
      setData(next);
      setUpdatedAt(at);
    }, []),
  };
}
