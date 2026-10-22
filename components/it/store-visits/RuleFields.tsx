'use client';
// Category + interval + minimum visits, shared by the single-store sheet and the
// bulk sheet. With `keep` (bulk) every field can also stay "Tidak diubah" (null).

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { INTERVAL_PRESETS, MINIMUM_PRESETS } from '@/lib/store-visit/settings-view';
import { VISIT_CATEGORY_LABELS, type VisitCategory } from '@/lib/store-visit/types';

export interface RuleValue {
  category: VisitCategory | null;
  intervalDays: number | null;
  minimumVisits: number | null;
}

const field = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-cyan-200 md:text-sm';

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn('min-h-10 rounded-full px-3.5 text-xs font-bold ring-1 ring-inset transition-colors', active ? 'bg-cyan-700 text-white ring-cyan-700' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}
    >
      {children}
    </button>
  );
}

export default function RuleFields({ value, onChange, keep = false }: {
  value: RuleValue;
  onChange: (next: RuleValue) => void;
  keep?: boolean;
}) {
  const { category, intervalDays, minimumVisits } = value;
  const set = (change: Partial<RuleValue>) => onChange({ ...value, ...change });
  const setInterval = (d: number | null) => set({ intervalDays: d, minimumVisits: d !== null && minimumVisits !== null && d > 0 ? Math.min(minimumVisits, d) : minimumVisits });
  const parse = (raw: string) => (raw === '' ? (keep ? null : 0) : Number(raw));
  const tooMany = intervalDays !== null && minimumVisits !== null && minimumVisits > intervalDays;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-slate-800">Kategori</p>
        <div className={cn('mt-1.5 grid gap-2', keep ? 'grid-cols-3' : 'grid-cols-2')}>
          {keep && <Chip active={category === null} onClick={() => set({ category: null })}>Tidak diubah</Chip>}
          {(['in_city', 'out_city'] as const).map((c) => <Chip key={c} active={category === c} onClick={() => set({ category: c })}>{VISIT_CATEGORY_LABELS[c]}</Chip>)}
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-800">Interval <span className="font-normal text-slate-500">(hari)</span></p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {keep && <Chip active={intervalDays === null} onClick={() => setInterval(null)}>Tidak diubah</Chip>}
          {INTERVAL_PRESETS.map((d) => <Chip key={d} active={intervalDays === d} onClick={() => setInterval(d)}>{d} hari</Chip>)}
        </div>
        <input
          className={cn(field, 'mt-2')}
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          aria-label="Interval, isi sendiri (hari)"
          placeholder={keep ? 'Tidak diubah — atau isi sendiri (1–365)' : 'Isi sendiri (1–365)'}
          value={intervalDays || ''}
          onChange={(e) => setInterval(parse(e.target.value))}
        />
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-800">Minimum visit <span className="font-normal text-slate-500">per interval</span></p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {keep && <Chip active={minimumVisits === null} onClick={() => set({ minimumVisits: null })}>Tidak diubah</Chip>}
          {MINIMUM_PRESETS.map((n) => <Chip key={n} active={minimumVisits === n} onClick={() => set({ minimumVisits: n })}>{n}×</Chip>)}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button type="button" aria-label="Kurangi minimum visit" disabled={!minimumVisits || minimumVisits <= 1} onClick={() => set({ minimumVisits: Math.max(1, (minimumVisits ?? 2) - 1) })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
          <input
            className={cn(field, 'text-center')}
            type="number"
            inputMode="numeric"
            min={1}
            max={intervalDays ?? 365}
            aria-label="Minimum visit per interval"
            placeholder={keep ? 'Tidak diubah' : undefined}
            value={minimumVisits || ''}
            onChange={(e) => set({ minimumVisits: parse(e.target.value) })}
          />
          <button type="button" aria-label="Tambah minimum visit" disabled={intervalDays !== null && (minimumVisits ?? 0) >= intervalDays} onClick={() => set({ minimumVisits: (minimumVisits ?? 0) + 1 })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
        </div>
        {tooMany && <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">Minimum visit tidak boleh melebihi jumlah hari interval.</p>}
      </div>
    </div>
  );
}
