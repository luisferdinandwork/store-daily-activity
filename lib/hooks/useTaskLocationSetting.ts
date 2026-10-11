'use client';
// lib/hooks/useTaskLocationSetting.ts
//
// Reads the OPS-configured "does this task type require location?" map from
// /api/employee/task-settings. A short-lived module cache is shared across
// task pages; failed requests are retried and IT changes are refreshed.

import { useEffect, useState } from 'react';
import { TASK_CATALOG } from '@/lib/shift-tasks';

type SettingsMap = Record<string, boolean>;

let cache: SettingsMap | null = null;
let inflight: Promise<SettingsMap | null> | null = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

async function loadSettings(): Promise<SettingsMap | null> {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  if (!inflight) {
    inflight = fetch('/api/employee/task-settings', { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      .then((r) => { if (!r.ok) throw new Error('Task settings unavailable'); return r.json(); })
      .then((json) => {
        if (!json?.success || !json.settings) throw new Error('Task settings unavailable');
        cache = json.settings as SettingsMap;
        cachedAt = Date.now();
        return cache;
      })
      .catch(() => {
        // A transient failure must never become a permanent location policy.
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Returns whether `taskCode` requires location, per OPS's Task Management
 * settings. Uses the task catalog default while unavailable; successful
 * settings are refreshed every 30 seconds and failures are retried.
 */
export function useTaskLocationSetting(taskCode: string) {
  // Lazy initial state already reflects a warm cache — the effect below only
  // needs to handle the cold-cache (first task page in the session) case.
  const [settings, setSettings] = useState<SettingsMap>(() => cache ?? {});
  const [ready, setReady] = useState(() => cache !== null);

  useEffect(() => {
    if (!taskCode) return;
    let cancelled = false;
    const refresh = () => loadSettings().then((s) => {
      if (!cancelled && s) {
        setSettings(s);
        setReady(true);
      }
    });
    void refresh();
    // Retry failed loads and pick up IT changes while a task remains open.
    const timer = setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [taskCode]);

  const requiresLocation = ready && taskCode in settings ? settings[taskCode]
    : TASK_CATALOG.find((task) => task.code === taskCode)?.requiresLocation ?? true;

  return { requiresLocation, ready };
}
