'use client';
// components/employee/tasks/SaveIndicator.tsx
//
// Autosave state, sized to sit on the purple app bar's meta line (TaskHeader).

import { Cloud, CloudOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveIndicatorProps {
  status: SaveStatus;
  lastSaved: Date | null;
}

export function SaveIndicator({ status, lastSaved }: SaveIndicatorProps) {
  if (status === 'idle') return null;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold',
        status === 'error' ? 'rounded-full bg-red-400 px-1.5 py-px text-white' : 'text-primary-foreground/80',
      )}
    >
      {status === 'saving' && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          Menyimpan…
        </>
      )}

      {status === 'saved' && (
        <>
          <Cloud className="h-3 w-3" />
          {lastSaved
            ? new Date(lastSaved).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            : 'Tersimpan'}
        </>
      )}

      {status === 'error' && (
        <>
          <CloudOff className="h-3 w-3" />
          Gagal simpan
        </>
      )}
    </span>
  );
}
