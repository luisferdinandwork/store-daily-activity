'use client';
// components/employee/tasks/SaveIndicator.tsx

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
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
        status === 'saving' && 'bg-blue-50 text-blue-600',
        status === 'saved' && 'bg-green-50 text-green-700',
        status === 'error' && 'bg-red-50 text-red-600',
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
          Tersimpan
          {lastSaved &&
            ` ${new Date(lastSaved).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
            })}`}
        </>
      )}

      {status === 'error' && (
        <>
          <CloudOff className="h-3 w-3" />
          Simpan gagal
        </>
      )}
    </div>
  );
}
