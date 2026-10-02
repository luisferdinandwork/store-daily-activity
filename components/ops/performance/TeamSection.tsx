'use client';
// components/ops/performance/TeamSection.tsx
//
// A store's Team for the month: one row per employee with actual vs target
// sales and transactions, their fixed % share of the store target (editable —
// everyone else rebalances around an override) and the day-by-day history.
// Mount it with a `key` per store so its local state never leaks between stores.

import { useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarOff,
  CheckCircle2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { OpsFilterSelect } from '@/components/ops/layout/OpsToolbar';
import {
  classifyProgress,
  fmtCount,
  fmtMonthLabel,
  fmtRpCompact,
  HEALTH_META,
  pctOf,
  sortTeam,
  TEAM_SORT_OPTIONS,
  type DetailResponse,
  type EligibleEmployee,
  type EmployeeTargetRow,
  type MonthPhase,
  type TeamSortKey,
  type Tone,
  type ViewPeriod,
} from '@/lib/performance/target-view';
import { ActualOfTarget, Initials, MicroLabel, TargetBar, TONE } from './atoms';
import AddEmployeeForm from './AddEmployeeForm';
import EmployeeCalendarModal from './EmployeeCalendarModal';

const ROLE_STYLE: Record<string, { avatar: string; chip: string }> = {
  PIC1: { avatar: 'bg-violet-100 text-violet-700', chip: 'bg-violet-50 text-violet-700 ring-violet-200' },
  PIC2: { avatar: 'bg-fuchsia-100 text-fuchsia-700', chip: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200' },
  SA: { avatar: 'bg-indigo-100 text-indigo-700', chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
};
const FALLBACK_ROLE = { avatar: 'bg-slate-100 text-slate-600', chip: 'bg-slate-50 text-slate-600 ring-slate-200' };

function employeeTone(pct: number, target: number, period: ViewPeriod, phase: MonthPhase): Tone {
  if (target <= 0) return 'slate';
  if (period === 'monthly') {
    return phase.phase === 'future' ? 'slate' : HEALTH_META[classifyProgress(pct, phase)].tone;
  }
  return pct >= 100 ? 'emerald' : pct > 0 ? 'indigo' : 'slate';
}

const fmtShare = (n: number) => n.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ─── One employee ─────────────────────────────────────────────────────────────

function EmployeeRow({
  row,
  storeId,
  period,
  yearMonth,
  phase,
  actualsAvailable,
  onChanged,
}: {
  row: EmployeeTargetRow;
  storeId: number;
  period: ViewPeriod;
  yearMonth: string;
  phase: MonthPhase;
  actualsAvailable: boolean;
  onChanged: () => void;
}) {
  const [editingPct, setEditingPct] = useState(false);
  const [pctInput, setPctInput] = useState(String(row.percentage));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const style = ROLE_STYLE[row.targetRoleCode] ?? FALLBACK_ROLE;
  const salesPct = pctOf(row.actualSales, row.displaySalesTarget);
  const txPct = pctOf(row.actualTransactionCount, row.displayTransactionTarget);
  const dayOff = period === 'daily' && !row.isScheduledToday;
  const salesTone = employeeTone(salesPct, row.displaySalesTarget, period, phase);
  const txTone = employeeTone(txPct, row.displayTransactionTarget, period, phase);

  const patch = async (body: Record<string, unknown>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/employees/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? failure);
      setEditingPct(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  };

  const removeFromTeam = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/employees/${row.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menghapus dari Team.');
      setConfirmDelete(false);
      onChanged();
    } catch (err) {
      setConfirmDelete(false);
      setError(err instanceof Error ? err.message : 'Gagal menghapus dari Team.');
      setBusy(false);
    }
  };

  return (
    <li className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5 @3xl:flex-nowrap', dayOff && 'opacity-55')}>
      <Initials name={row.name} className={style.avatar} />

      <div className="min-w-0 flex-1 basis-44">
        <p className="truncate text-sm font-bold text-slate-900">{row.name}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset', style.chip)}>
            {row.slotCode}
          </span>
          <span className="truncate font-mono text-[11px]">{row.nik}</span>
          {dayOff && (
            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold">
              <CalendarOff className="h-3 w-3" /> Libur
            </span>
          )}
        </div>
      </div>

      <div className="min-w-[9.5rem] flex-1 @3xl:w-44 @3xl:flex-none">
        <ActualOfTarget
          actual={actualsAvailable ? row.actualSales : null}
          target={row.displaySalesTarget}
          format={fmtRpCompact}
          dim={!actualsAvailable}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <TargetBar pct={salesPct} tone={salesTone} className="flex-1" />
          <span className={cn('w-9 text-right text-[10px] font-black tabular-nums', TONE[salesTone].text)}>
            {row.displaySalesTarget > 0 ? `${salesPct}%` : ''}
          </span>
        </div>
      </div>

      <div className="hidden w-28 shrink-0 @4xl:block">
        <ActualOfTarget
          actual={actualsAvailable ? row.actualTransactionCount : null}
          target={row.displayTransactionTarget}
          format={fmtCount}
          dim={!actualsAvailable}
        />
        <TargetBar pct={txPct} tone={txTone} thin className="mt-2" />
      </div>

      <div className="shrink-0 @3xl:w-36">
        {editingPct ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.1"
              value={pctInput}
              onChange={(e) => setPctInput(e.target.value)}
              autoFocus
              aria-label="Porsi %"
              className="w-16 rounded-lg border border-indigo-300 bg-white px-2 py-1 text-right text-xs font-bold tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <span className="text-xs font-semibold text-slate-400">%</span>
            <button
              type="button"
              onClick={() => void patch({ percentage: Number(pctInput) || 0 }, 'Gagal menyimpan porsi.')}
              disabled={busy}
              aria-label="Simpan porsi"
              className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditingPct(false)}
              disabled={busy}
              aria-label="Batal"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="min-w-0">
              <p className="text-sm font-black tabular-nums text-slate-800">{fmtShare(row.percentage)}%</p>
              <p className="text-[10px] tabular-nums text-slate-400">{row.scheduledDays} hari</p>
            </div>
            {row.isPercentageOverridden && (
              <span
                className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-700"
                title="Porsi diubah manual"
              >
                M
              </span>
            )}
            <button
              type="button"
              onClick={() => { setPctInput(String(row.percentage)); setError(null); setEditingPct(true); }}
              aria-label="Ubah porsi"
              title="Ubah porsi"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {row.isPercentageOverridden && (
              <button
                type="button"
                onClick={() => void patch({ resetPercentage: true }, 'Gagal mereset porsi.')}
                disabled={busy}
                aria-label="Kembalikan ke default"
                title="Kembalikan ke default"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        {error && <p className="mt-1 text-[10px] font-semibold text-rose-600">{error}</p>}
      </div>

      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={() => setShowCalendar(true)}
          aria-label="Riwayat harian"
          title="Riwayat harian"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-indigo-600"
        >
          <Calendar className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={busy}
          aria-label="Hapus dari Team"
          title="Hapus dari Team"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {showCalendar && (
        <EmployeeCalendarModal
          storeId={storeId}
          targetId={row.id}
          employeeName={row.name}
          yearMonth={yearMonth}
          dailyTarget={row.dailySalesTarget}
          onClose={() => setShowCalendar(false)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="danger"
        title={`Hapus ${row.name} dari Team?`}
        description={
          <>
            {row.name} ({row.slotCode}) tidak lagi punya target di {fmtMonthLabel(yearMonth)}. Porsi anggota
            lain (kecuali yang diubah manual) dihitung ulang.
          </>
        }
        confirmLabel="Hapus"
        busy={busy}
        onConfirm={() => void removeFromTeam()}
      />
    </li>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

type ApplyResult = { tone: 'success' | 'warning' | 'error'; text: string };

export default function TeamSection({
  detail,
  eligible,
  yearMonth,
  period,
  phase,
  onRefresh,
}: {
  detail: DetailResponse;
  eligible: EligibleEmployee[];
  yearMonth: string;
  period: ViewPeriod;
  phase: MonthPhase;
  onRefresh: () => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [applyingAll, setApplyingAll] = useState(false);
  const [confirmApplyAll, setConfirmApplyAll] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [sortKey, setSortKey] = useState<TeamSortKey>('slot');

  const storeId = detail.store.id;
  const unrostered = eligible.filter((e) => !e.hasTarget);
  const team = sortTeam(detail.employeeTargets, sortKey);
  const empty = team.length === 0;
  const shareTotal = detail.employeeTargets.reduce((sum, e) => sum + e.percentage, 0);
  const shareOff = !empty && Math.abs(shareTotal - 100) > 0.5;

  // Every store employee not on the Team yet, in one go: positions follow their
  // employee type, the % split follows the default allocation (server:
  // addAllStoreStaffToRoster).
  const applyToAllStaff = async () => {
    if (unrostered.length === 0) return;
    setApplyingAll(true);
    setApplyResult(null);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/employees/apply-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearMonth }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menambahkan semua staff.');
      setShowAddForm(false);
      setApplyResult({
        tone: json.meta?.usedFallbackEqualSplit ? 'warning' : 'success',
        text: json.meta?.usedFallbackEqualSplit
          ? `${json.added} ditambahkan · belum ada pola untuk ${json.meta.headcount} orang, porsi dibagi rata.`
          : `${json.added} ditambahkan · porsi dibagi otomatis untuk ${json.meta?.headcount ?? json.added} orang.`,
      });
      onRefresh();
    } catch (err) {
      setApplyResult({ tone: 'error', text: err instanceof Error ? err.message : 'Gagal menambahkan semua staff.' });
    } finally {
      setApplyingAll(false);
      setConfirmApplyAll(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Users className="h-3.5 w-3.5" />
          </span>
          <MicroLabel>Team</MicroLabel>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black tabular-nums text-slate-600">
            {detail.employeeTargets.length}
          </span>
          {shareOff && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200"
              title="Total porsi Team tidak 100%"
            >
              <AlertCircle className="h-3 w-3" /> Σ {fmtShare(shareTotal)}%
            </span>
          )}
          {detail.rosterMeta?.usedFallbackEqualSplit && !empty && (
            <span
              className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200"
              title={`Belum ada pola pembagian untuk ${detail.rosterMeta.headcount} orang — dibagi rata`}
            >
              Dibagi rata
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!empty && (
            <OpsFilterSelect
              label="Urutkan Team"
              value={sortKey}
              onChange={(v) => setSortKey(v as TeamSortKey)}
              highlight={false}
            >
              {TEAM_SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>Urut: {o.label}</option>
              ))}
            </OpsFilterSelect>
          )}
          {!empty && unrostered.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmApplyAll(true)}
              disabled={applyingAll}
              title="Tambahkan semua staff toko yang belum ada di Team"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
            >
              <Users className="h-3.5 w-3.5" />
              Tambah semua ({unrostered.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 text-xs font-bold text-white hover:bg-indigo-500"
          >
            <Plus className="h-3.5 w-3.5" /> Tambah
          </button>
        </div>
      </div>

      {applyResult && (
        <div
          className={cn(
            'mx-4 mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 sm:mx-5',
            applyResult.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
            applyResult.tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-700',
            applyResult.tone === 'error' && 'border-rose-200 bg-rose-50 text-rose-600',
          )}
        >
          {applyResult.tone === 'success'
            ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <p className="min-w-0 flex-1 text-[11px] font-semibold">{applyResult.text}</p>
          <button type="button" aria-label="Tutup" onClick={() => setApplyResult(null)} className="shrink-0 opacity-60 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {showAddForm && (
        <div className="px-4 pt-3 sm:px-5">
          <AddEmployeeForm
            storeId={storeId}
            yearMonth={yearMonth}
            eligible={eligible}
            onCreated={() => { setShowAddForm(false); onRefresh(); }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {empty ? (
        <div className="px-4 py-10 text-center sm:px-5">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500">
            <Users className="h-5 w-5" />
          </div>
          <p className="text-sm font-bold text-slate-700">Team {fmtMonthLabel(yearMonth)} kosong</p>
          {unrostered.length > 0 ? (
            <button
              type="button"
              onClick={() => setConfirmApplyAll(true)}
              disabled={applyingAll}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              <Users className="h-3.5 w-3.5" />
              {applyingAll ? 'Menambahkan…' : `Tambah semua staff (${unrostered.length})`}
            </button>
          ) : (
            <p className="mt-1 text-xs text-slate-400">Belum ada karyawan aktif di toko ini.</p>
          )}
        </div>
      ) : (
        <ul className="@container divide-y divide-slate-100">
          {team.map((row) => (
            <EmployeeRow
              key={row.id}
              row={row}
              storeId={storeId}
              period={period}
              yearMonth={yearMonth}
              phase={phase}
              actualsAvailable={detail.actuals.available}
              onChanged={onRefresh}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmApplyAll}
        onOpenChange={setConfirmApplyAll}
        icon={Users}
        title={`Tambah ${unrostered.length} staff ke Team?`}
        description={
          <div className="space-y-2">
            <p>
              Semua staff {detail.store.name} yang belum ada di Team ditambahkan sekaligus. Posisi mengikuti tipe
              karyawan, porsi dibagi otomatis untuk {detail.employeeTargets.length + unrostered.length} orang.
            </p>
            {!empty && (
              <p className="text-xs text-amber-700">
                Porsi {detail.employeeTargets.length} anggota yang ada (kecuali yang diubah manual) ikut dihitung ulang.
              </p>
            )}
          </div>
        }
        confirmLabel={`Tambah ${unrostered.length} staff`}
        busy={applyingAll}
        onConfirm={() => void applyToAllStaff()}
      />
    </section>
  );
}
