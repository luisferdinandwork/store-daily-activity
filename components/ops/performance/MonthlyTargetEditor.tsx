'use client';
// components/ops/performance/MonthlyTargetEditor.tsx
//
// The store's monthly sales + transaction target — the one number Ops sets;
// everything per employee is split from it. A compact summary by default, an
// inline form on "Ubah" / "Isi target". Mount it with a `key` per store+month
// so an open form never carries one month's numbers into another.

import { useState } from 'react';
import { Check, Pencil, Plus, Target } from 'lucide-react';

import { cn } from '@/lib/utils';
import { daysInMonthKey } from '@/lib/day-bucket';
import { fmtCount, fmtMonthShort, fmtRp, fmtRpCompact } from '@/lib/performance/target-view';
import { MicroLabel } from './atoms';

/** Digits-only text input shown with thousand separators, so a missing zero is visible. */
function GroupedField({
  label,
  value,
  onChange,
  prefix,
  hint,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  prefix?: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  const shown = value ? Number(value).toLocaleString('id-ID') : '';
  return (
    <label className="block text-xs font-semibold text-slate-600">
      {label}
      <div className="relative mt-1">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
            {prefix}
          </span>
        )}
        <input
          inputMode="numeric"
          value={shown}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 13))}
          placeholder="0"
          className={cn(
            'w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 text-sm font-bold tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100',
            prefix ? 'pl-9' : 'pl-3',
          )}
        />
      </div>
      <span className="mt-1 block h-4 text-[11px] font-normal tabular-nums text-slate-400">{hint}</span>
    </label>
  );
}

function Preview({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <MicroLabel>{label}</MicroLabel>
      <p className="mt-0.5 truncate text-sm font-black tabular-nums text-indigo-600">{value}</p>
    </div>
  );
}

export default function MonthlyTargetEditor({
  storeId,
  yearMonth,
  salesTarget,
  transactionTarget,
  onSaved,
}: {
  storeId: number;
  yearMonth: string;
  salesTarget: number;
  transactionTarget: number;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [salesInput, setSalesInput] = useState(salesTarget > 0 ? String(Math.round(salesTarget)) : '');
  const [txInput, setTxInput] = useState(transactionTarget > 0 ? String(Math.round(transactionTarget)) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = daysInMonthKey(yearMonth);
  const notSet = salesTarget <= 0 && transactionTarget <= 0;
  const monthLabel = fmtMonthShort(yearMonth);

  const sales = Number(salesInput) || 0;
  const tx = Number(txInput) || 0;

  const startEdit = () => {
    setSalesInput(salesTarget > 0 ? String(Math.round(salesTarget)) : '');
    setTxInput(transactionTarget > 0 ? String(Math.round(transactionTarget)) : '');
    setError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearMonth, monthlySalesTarget: sales, monthlyTransactionTarget: tx }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menyimpan target.');
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan target.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border px-4 py-3.5 sm:px-5',
          notSet ? 'border-dashed border-amber-300 bg-amber-50/50' : 'border-slate-200 bg-white shadow-sm',
        )}
      >
        <div className="flex items-center gap-2.5">
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', notSet ? 'bg-amber-100 text-amber-600' : 'bg-indigo-50 text-indigo-600')}>
            <Target className="h-4 w-4" />
          </span>
          <div>
            <MicroLabel>Target {monthLabel}</MicroLabel>
            {notSet && <p className="text-sm font-bold text-slate-700">Belum diisi</p>}
          </div>
        </div>

        {!notSet && (
          <div className="flex flex-1 flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <MicroLabel>Sales</MicroLabel>
              <p className="text-base font-black tabular-nums text-slate-900" title={fmtRp(salesTarget)}>
                {fmtRpCompact(salesTarget)}
              </p>
            </div>
            <div>
              <MicroLabel>Transaksi</MicroLabel>
              <p className="text-base font-black tabular-nums text-slate-900">{fmtCount(transactionTarget)}</p>
            </div>
            <div>
              <MicroLabel>ATV</MicroLabel>
              <p className="text-base font-black tabular-nums text-slate-900">
                {fmtRpCompact(transactionTarget > 0 ? salesTarget / transactionTarget : 0)}
              </p>
            </div>
            <div className="hidden sm:block">
              <MicroLabel>Per hari</MicroLabel>
              <p className="text-base font-black tabular-nums text-slate-500">{fmtRpCompact(salesTarget / days)}</p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={startEdit}
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition',
            notSet
              ? 'bg-indigo-600 text-white hover:bg-indigo-500'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
          )}
        >
          {notSet ? <Plus className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          {notSet ? 'Isi target' : 'Ubah'}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 p-4 sm:p-5">
      <MicroLabel className="text-indigo-600">Target {monthLabel}</MicroLabel>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <GroupedField
          label="Sales / bulan"
          prefix="Rp"
          value={salesInput}
          onChange={setSalesInput}
          hint={sales >= 1_000_000 ? `≈ ${fmtRpCompact(sales)}` : undefined}
          autoFocus
        />
        <GroupedField label="Transaksi / bulan" value={txInput} onChange={setTxInput} />
      </div>

      <div className="mt-1 grid grid-cols-3 gap-3 rounded-xl bg-white px-4 py-3">
        <Preview label={`Sales / hari`} value={fmtRpCompact(sales / days)} />
        <Preview label="Transaksi / hari" value={fmtCount(tx / days)} />
        <Preview label="ATV" value={fmtRpCompact(tx > 0 ? sales / tx : 0)} />
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          <Check className="h-3.5 w-3.5" />
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </div>
  );
}
