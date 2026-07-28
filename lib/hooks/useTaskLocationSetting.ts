'use client';
// lib/hooks/useTaskLocationSetting.ts
//
// Reads the OPS-configured "does this task type require location?" map from
// /api/employee/task-settings. Fetched once per session (module-level cache
// shared across every task page that mounts) rather than once per page.

import { useEffect, useState } from 'react';

type SettingsMap = Record<string, boolean>;

let cache: SettingsMap | null = null;
let inflight: Promise<SettingsMap> | null = null;

async function loadSettings(): Promise<SettingsMap> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch('/api/employee/task-settings')
      .then((r) => r.json())
      .then((json) => {
        cache = json?.success && json.settings ? (json.settings as SettingsMap) : {};
        return cache;
      })
      .catch(() => {
        cache = {};
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
 * settings. Defaults to `true` (require location) until the setting has
 * loaded, so a slow fetch never causes a page to under-enforce a check it
 * should have had.
 */
export function useTaskLocationSetting(taskCode: string) {
  // Lazy initial state already reflects a warm cache — the effect below only
  // needs to handle the cold-cache (first task page in the session) case.
  const [settings, setSettings] = useState<SettingsMap>(() => cache ?? {});
  const [ready, setReady] = useState(() => cache !== null);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    loadSettings().then((s) => {
      if (!cancelled) {
        setSettings(s);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const requiresLocation = ready && taskCode in settings ? settings[taskCode] : true;

  return { requiresLocation, ready };
}
