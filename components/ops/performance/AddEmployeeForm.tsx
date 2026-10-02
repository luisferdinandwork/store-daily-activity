'use client';
// components/ops/performance/AddEmployeeForm.tsx
//
// Add one employee to the store's Team for the month. Position decides the slot
// (PIC1 / PIC2 / SA#); the % share is split automatically by the server from the
// IT-managed allocation defaults.

import { useState } from 'react';
import { X } from 'lucide-react';

import type { EligibleEmployee } from '@/lib/performance/target-view';
import { MicroLabel } from './atoms';

const ROLE_OPTIONS = ['PIC1', 'PIC2', 'SA'] as const;

const FIELD =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

export default function AddEmployeeForm({
  storeId,
  yearMonth,
  eligible,
  onCreated,
  onCancel,
}: {
  storeId: number;
  yearMonth: string;
  eligible: EligibleEmployee[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const available = eligible.filter((e) => !e.hasTarget);

  const [userId, setUserId] = useState(available[0]?.id ?? '');
  const [targetRoleCode, setTargetRoleCode] = useState<(typeof ROLE_OPTIONS)[number]>('SA');
  const [sortOrder, setSortOrder] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!userId) {
      setError('Pilih karyawan.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          yearMonth,
          targetRoleCode,
          sortOrder: targetRoleCode === 'SA' ? Number(sortOrder) || 0 : 0,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menambah karyawan.');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah karyawan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
      <div className="flex items-center justify-between">
        <MicroLabel className="text-indigo-600">Tambah ke Team</MicroLabel>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Tutup"
          className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {available.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">Semua karyawan toko ini sudah ada di Team.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
            Karyawan
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className={FIELD}>
              {available.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.nik})</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold text-slate-600">
            Posisi
            <select
              value={targetRoleCode}
              onChange={(e) => setTargetRoleCode(e.target.value as (typeof ROLE_OPTIONS)[number])}
              className={FIELD}
            >
              {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>

          {targetRoleCode === 'SA' && (
            <label className="text-xs font-semibold text-slate-600 sm:col-span-3">
              Urutan SA (SA1, SA2, …)
              <input
                type="number"
                min={1}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className={`${FIELD} w-32`}
              />
            </label>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}

      {available.length > 0 && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      )}
    </div>
  );
}
