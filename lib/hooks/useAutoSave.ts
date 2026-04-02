// lib/hooks/useAutoSave.ts
// ─────────────────────────────────────────────────────────────────────────────
// Generic auto-save hook.
//
// Usage:
//   const { saving, lastSaved, error, save } = useAutoSave({
//     url:       '/api/employee/tasks/store_opening',
//     baseBody:  { scheduleId: 5, storeId: 2 },
//     debounceMs: 800,     // default: 800 ms
//   });
//
//   // Call `save(patch)` any time a field changes.
//   // The hook debounces calls so rapid changes (e.g. typing notes) only
//   // fire one request after the user stops for debounceMs.
//   // Photo uploads fire immediately (pass immediate: true).
//
// The hook accumulates patches between debounce windows so no field is lost.
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useState, useCallback, useEffect } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutoSaveOptions {
  /** PATCH endpoint, e.g. /api/employee/tasks/store_opening */
  url:        string;
  /** Fields that are always included in every PATCH body (scheduleId, storeId). */
  baseBody:   Record<string, unknown>;
  /** Debounce delay in milliseconds. Default: 800. */
  debounceMs?: number;
}

export interface AutoSaveResult {
  status:    SaveStatus;
  lastSaved: Date | null;
  error:     string | null;
  /** Queue a partial save. Pass `immediate: true` to skip debounce (use for photos). */
  save: (patch: Record<string, unknown>, opts?: { immediate?: boolean }) => void;
}

export function useAutoSave({
  url,
  baseBody,
  debounceMs = 800,
}: AutoSaveOptions): AutoSaveResult {
  const [status,    setStatus]    = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  // Accumulated patch waiting to be flushed
  const pending = useRef<Record<string, unknown>>({});
  const timer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving  = useRef(false);

  // Keep latest baseBody without re-creating flush on every render
  const baseBodyRef = useRef(baseBody);
  useEffect(() => { baseBodyRef.current = baseBody; }, [baseBody]);

  const flush = useCallback(async () => {
    if (saving.current) return;
    const patch = { ...pending.current };
    if (!Object.keys(patch).length) return;

    // Clear the accumulated patch before the request so new changes
    // that arrive mid-flight accumulate into the next batch.
    pending.current = {};
    saving.current  = true;
    setStatus('saving');
    setError(null);

    try {
      const res = await fetch(url, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...baseBodyRef.current, ...patch }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        json = await res.json();
      }

      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        console.warn('[useAutoSave] save failed:', msg);
        // Put the patch back so it retries on the next save call
        pending.current = { ...patch, ...pending.current };
        setStatus('error');
        setError(msg);
      } else {
        setStatus('saved');
        setLastSaved(new Date());
        setError(null);
        // Fade back to idle after 2 s
        setTimeout(() => setStatus(s => s === 'saved' ? 'idle' : s), 2000);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      console.warn('[useAutoSave] fetch error:', msg);
      pending.current = { ...patch, ...pending.current };
      setStatus('error');
      setError(msg);
    } finally {
      saving.current = false;
      // If new changes arrived while we were saving, flush them now
      if (Object.keys(pending.current).length) {
        timer.current = setTimeout(flush, debounceMs);
      }
    }
  }, [url, debounceMs]);

  const save = useCallback(
    (patch: Record<string, unknown>, opts?: { immediate?: boolean }) => {
      // Merge into pending accumulator
      pending.current = { ...pending.current, ...patch };

      if (opts?.immediate) {
        // Cancel any pending debounce and flush now
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        flush();
      } else {
        // Debounce
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, debounceMs);
      }
    },
    [flush, debounceMs],
  );

  // Flush on unmount so in-flight changes aren't silently dropped
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (Object.keys(pending.current).length && !saving.current) {
        // Best-effort fire-and-forget on unmount
        fetch(url, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ...baseBodyRef.current, ...pending.current }),
        }).catch(() => {});
      }
    };
  }, [url]);

  return { status, lastSaved, error, save };
}