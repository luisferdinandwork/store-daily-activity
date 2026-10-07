'use client';
// app/it/setoran-correction/page.tsx — IT only.
//
// "Koreksi Setoran": pick a store and see every day — submitted, draft, or nothing
// at all. Fix the amounts of a submitted day, or fill in a day that has no setoran.
// The sisa (unpaid) of a day is the next day's sisa kemarin, so a wrong or missing
// figure keeps distorting every later day — a change recalculates that whole tail
// and shows exactly what will change before anything is saved. The original
// figures and the reason stay in the history (and on Finance's daily review).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Check, History, Loader2, Pencil, Plus, Shield, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn, formatRupiah } from '@/lib/utils';
import { StoreCombobox } from '@/components/shared/store-combobox';
import { KpiStrip } from '@/components/finance/shared/sheet-kit';
import { StatusBadge } from '@/components/finance/setoran/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SETORAN_SHORT_THRESHOLD, type ReviewStatus } from '@/lib/setoran-review';
import {
  CORRECTION_REASON_MAX,
  CORRECTION_REASON_MIN,
  correctionChain,
  createChain,
  planSetoranCorrection,
  SETORAN_MAX_AMOUNT,
  suggestedDeposit,
  type CorrectableStore,
  type SetoranCorrectionEntry,
  type SetoranDayRow,
} from '@/lib/setoran-correction';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_DAYS = 45;

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error ?? 'Request gagal');
  return json;
}

const rp = (n: number) => formatRupiah(n);

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });

const fmtDayShort = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
  });

const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

/** "1.250.000" → 1250000 (digits only; empty → 0). */
const parseMoney = (raw: string): number => {
  const digits = raw.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
};

/** A setoran was expected that day but there is no submitted one. */
const isMissing = (r: SetoranDayRow) =>
  r.kind === 'draft' || r.kind === 'orphan' || (r.kind === 'empty' && r.scheduled);

// ─── Money input ──────────────────────────────────────────────────────────────

function MoneyField({
  label, hint, action, value, onChange,
}: {
  label: string;
  hint?: string;
  /** Small control shown next to the label (e.g. "Hitung otomatis"). */
  action?: React.ReactNode;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-2 text-xs font-bold text-slate-600">
        {label}
        {action}
      </span>
      <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 focus-within:border-cyan-400">
        <span className="mr-2 text-sm font-semibold text-slate-400">Rp</span>
        <input
          inputMode="numeric"
          value={value.toLocaleString('id-ID')}
          onChange={(e) => onChange(Math.min(SETORAN_MAX_AMOUNT, parseMoney(e.target.value)))}
          className="w-full bg-transparent text-right text-sm font-semibold tabular-nums text-slate-900 focus:outline-none"
        />
      </div>
      {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

/** A figure, or "old → new" (old struck through) when the change alters it. */
function Delta({ before, after }: { before: number; after: number }) {
  if (before === after) return <span className="tabular-nums text-slate-600">{rp(after)}</span>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5 tabular-nums">
      <span className="text-slate-400 line-through">{rp(before)}</span>
      <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" />
      <span className="font-bold text-cyan-700">{rp(after)}</span>
    </span>
  );
}

// ─── Correct / add dialog ─────────────────────────────────────────────────────

type DialogMode = 'correct' | 'add';

function SetoranDialog({
  mode, store, day, days, onClose, onSaved,
}: {
  mode: DialogMode;
  store: CorrectableStore;
  day: SetoranDayRow;
  /** Every day in the list (date ascending) — the chain for the preview is cut from it. */
  days: SetoranDayRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isAdd = mode === 'add';
  // The parent mounts this dialog per day (`key`), so state starts from the row.
  // A draft may already hold some figures — start from those.
  const [received, setReceived] = useState(day.received ?? 0);
  const [stored, setStored] = useState(day.stored ?? 0);
  // Like the employee page: once the deposit is typed by hand it stops following
  // the suggestion. When adding, it follows uang diterima until then; a recorded
  // deposit being corrected is left alone until "Hitung otomatis" is pressed.
  const [storedManual, setStoredManual] = useState(!isAdd || day.stored != null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // The deposit comes out of the whole drawer: uang diterima + sisa kemarin.
  const autoStored = suggestedDeposit(received + day.carryIn);

  function changeReceived(n: number) {
    setReceived(n);
    if (!storedManual) setStored(suggestedDeposit(n + day.carryIn));
  }
  function changeStored(n: number) {
    setStored(n);
    setStoredManual(true);
  }
  function useAutoStored() {
    setStored(autoStored);
    setStoredManual(false);
  }

  const chain = useMemo(
    () => (isAdd ? createChain(days, day.date) : correctionChain(days, day.taskId ?? -1)),
    [isAdd, days, day.date, day.taskId],
  );
  const plan = useMemo(
    () => planSetoranCorrection(chain, { received, stored }, { isNew: isAdd }),
    [chain, received, stored, isAdd],
  );

  const reasonLen = reason.trim().length;
  const canSave = plan.ok && !plan.noChange && reasonLen >= CORRECTION_REASON_MIN && !busy;
  const required = received + day.carryIn;

  const affected = plan.ok ? plan.rows.filter((r) => !r.isTarget && r.changed) : [];
  const clampedRows = plan.ok ? plan.rows.filter((r) => r.clamped) : [];

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const amounts = { received, stored, reason: reason.trim() };
      const json = await api('/api/ops/setoran-correction', {
        method: 'POST',
        body: JSON.stringify(
          isAdd
            ? { storeId: store.id, date: day.date, ...amounts }
            : { taskId: day.taskId, ...amounts },
        ),
      });
      const n: number = json.data.affectedDays;
      const verb = isAdd ? 'ditambahkan' : 'dikoreksi';
      toast.success(
        n > 0
          ? `Setoran ${fmtDay(day.date)} ${verb} · ${n} hari setelahnya dihitung ulang`
          : `Setoran ${fmtDay(day.date)} ${verb}`,
      );
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl border-slate-200 bg-white sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-slate-900">{isAdd ? 'Tambah setoran' : 'Koreksi setoran'}</DialogTitle>
          <DialogDescription className="text-slate-500">
            {store.storeNo} · {store.name} — {fmtDay(day.date)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isAdd && day.verifiedAt && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              Setoran ini sudah diverifikasi Finance. Verifikasi akan direset agar Finance memeriksa ulang angka baru.
            </p>
          )}
          {isAdd && (
            <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>
                {day.kind === 'draft'
                  ? 'Task hari ini belum disubmit — akan diselesaikan dengan nominal ini (foto yang sudah ada tetap). '
                  : 'Belum ada setoran di tanggal ini — akan dicatat sebagai setoran selesai. '}
                Setoran yang ditambahkan IT tidak punya foto bukti; Finance melihatnya sebagai “Bukti belum lengkap”.
              </span>
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyField
              label="Uang diterima"
              value={received}
              onChange={changeReceived}
              hint={isAdd ? undefined : `Sebelumnya ${rp(day.received ?? 0)}`}
            />
            <MoneyField
              label="Disetor"
              value={stored}
              onChange={changeStored}
              action={
                <button
                  type="button"
                  onClick={useAutoStored}
                  disabled={stored === autoStored && !storedManual}
                  title="Seluruh uang di laci (diterima + sisa kemarin), dibulatkan ke bawah kelipatan Rp 50.000"
                  className="text-[11px] font-bold text-cyan-600 hover:underline disabled:text-slate-300 disabled:no-underline"
                >
                  Hitung otomatis · {rp(autoStored)}
                </button>
              }
              hint={`Termasuk sisa kemarin — maks. ${rp(required)}${isAdd ? '' : ` · sebelumnya ${rp(day.stored ?? 0)}`}`}
            />
          </div>

          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-center">
            {[
              { k: 'Sisa kemarin', v: rp(day.carryIn), note: 'tidak berubah' },
              { k: 'Wajib disetor', v: rp(required), note: 'diterima + sisa kemarin' },
              { k: 'Sisa hari ini', v: plan.ok ? rp(plan.rows[0].unpaid) : '–', note: 'wajib − disetor' },
            ].map((c) => (
              <div key={c.k} className="bg-slate-50 px-2 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{c.k}</dt>
                <dd className="text-sm font-bold tabular-nums text-slate-900">{c.v}</dd>
                <p className="text-[10px] text-slate-400">{c.note}</p>
              </div>
            ))}
          </dl>

          {!plan.ok && (
            <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              {plan.error}
            </p>
          )}

          {plan.ok && isAdd && received === 0 && stored === 0 && (
            <p className="text-xs text-slate-500">Rp 0 diterima dan disetor dicatat sebagai “Tanpa setoran”.</p>
          )}

          {plan.ok && !plan.noChange && (
            <section className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-cyan-50 px-3 py-2">
                <span className="text-xs font-bold text-cyan-800">Sisa terakhir (belum disetor)</span>
                <span className="text-sm">
                  <Delta before={plan.closingBefore} after={plan.closingAfter} />
                </span>
              </div>

              {affected.length > 0 ? (
                <>
                  <p className="text-xs text-slate-500">
                    {affected.length} hari setelahnya ikut dihitung ulang (uang diterima &amp; disetor hari-hari itu tidak diubah):
                  </p>
                  <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-1.5 text-left font-semibold">Tanggal</th>
                          <th className="px-3 py-1.5 text-right font-semibold">Sisa kemarin</th>
                          <th className="px-3 py-1.5 text-right font-semibold">Sisa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {affected.map((r) => (
                          <tr key={r.date}>
                            <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{fmtDay(r.date)}</td>
                            <td className="px-3 py-1.5 text-right"><Delta before={r.before.carryIn} after={r.carryIn} /></td>
                            <td className="px-3 py-1.5 text-right"><Delta before={r.before.unpaid} after={r.unpaid} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500">Tidak ada hari setelahnya yang terpengaruh.</p>
              )}

              {clampedRows.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  Setelah dihitung ulang, nominal disetor pada {clampedRows.map((r) => fmtDay(r.date)).join(', ')} melebihi
                  wajib disetor — sisa hari itu dibulatkan ke Rp 0. Koreksi hari tersebut juga bila perlu.
                </p>
              )}
            </section>
          )}

          <label className="block space-y-1.5">
            <span className="flex items-center justify-between text-xs font-bold text-slate-600">
              {isAdd ? 'Alasan penambahan' : 'Alasan koreksi'}
              <span className="font-semibold tabular-nums text-slate-400">{reason.length}/{CORRECTION_REASON_MAX}</span>
            </span>
            <textarea
              value={reason}
              maxLength={CORRECTION_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={
                isAdd
                  ? 'mis. PIC lupa submit setoran hari ini; nominal sesuai resi bank yang dikirim via WhatsApp.'
                  : 'mis. Kasir memasukkan total laci (sudah termasuk sisa kemarin) sebagai uang diterima.'
              }
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none"
            />
          </label>

          {!isAdd && (
            <p className="text-[11px] text-slate-400">
              Foto bukti (resi, selfie ATM, foto sisa setoran) tidak diubah. Angka lama tersimpan di riwayat koreksi.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Batal
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={save}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {isAdd ? 'Simpan setoran' : 'Simpan koreksi'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Day list ─────────────────────────────────────────────────────────────────

/** One status pill per day: what the day looks like and whether it needs attention. */
function DayStatus({ row, today }: { row: SetoranDayRow; today: string }) {
  const past = row.date < today;
  const pill = (status: ReviewStatus, label?: string) => <StatusBadge status={status} label={label} />;

  switch (row.kind) {
    case 'submitted':
      if (row.isNoSetoran) return pill('tanpa_setoran');
      return pill((row.unpaid ?? 0) > SETORAN_SHORT_THRESHOLD ? 'kurang' : 'selesai');
    case 'draft':
      return past ? pill('belum_setor', 'Task belum selesai') : pill('draft', 'Draft');
    case 'orphan':
      return (
        <span
          title="Task ditandai selesai tetapi tidak punya data ledger — tidak bisa diedit dari sini."
          className="inline-flex whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200"
        >
          Data tak lengkap
        </span>
      );
    default:
      if (!row.scheduled) {
        return (
          <span className="inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 ring-1 ring-inset ring-slate-200">
            Tanpa jadwal
          </span>
        );
      }
      return past ? pill('belum_setor') : pill('belum_mulai');
  }
}

function DayList({
  rows, today, onCorrect, onAdd,
}: {
  rows: SetoranDayRow[];
  today: string;
  onCorrect: (row: SetoranDayRow) => void;
  onAdd: (row: SetoranDayRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left font-semibold">Tanggal</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
            <th className="hidden px-3 py-2 text-right font-semibold md:table-cell">Sisa kemarin</th>
            <th className="px-3 py-2 text-right font-semibold">Diterima</th>
            <th className="px-3 py-2 text-right font-semibold">Disetor</th>
            <th className="px-3 py-2 text-right font-semibold">Sisa</th>
            <th className="w-20 px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const submitted = r.kind === 'submitted';
            const missed = isMissing(r) && r.date < today;
            const quiet = r.kind === 'empty' && !r.scheduled;
            const dash = <span className="text-slate-300">–</span>;

            return (
              <tr key={r.date} className={cn('hover:bg-slate-50/70', missed && 'bg-rose-50/40')}>
                <td
                  title={fmtDay(r.date)}
                  className={cn('whitespace-nowrap px-4 py-1.5 font-medium', quiet ? 'text-slate-400' : 'text-slate-800')}
                >
                  {fmtDayShort(r.date)}
                  {r.date === today && <span className="ml-1.5 rounded bg-cyan-50 px-1 py-px text-[10px] font-bold text-cyan-700">Hari ini</span>}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <DayStatus row={r} today={today} />
                    {r.verifiedAt && (
                      <span
                        title={`Diverifikasi ${r.verifiedBy ?? 'Finance'} · ${fmtStamp(r.verifiedAt)}`}
                        className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-bold text-emerald-700"
                      >
                        <BadgeCheck className="h-3 w-3" /> Terverifikasi
                      </span>
                    )}
                    {r.correctionCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-bold text-amber-700">
                        {r.addedByIt ? <Plus className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                        {r.addedByIt ? 'Ditambah IT' : 'Dikoreksi'}{r.correctionCount > 1 ? ` ×${r.correctionCount}` : ''}
                      </span>
                    )}
                  </div>
                </td>
                <td className="hidden px-3 py-1.5 text-right tabular-nums text-slate-400 md:table-cell">
                  {rp(r.carryIn)}
                </td>
                <td className={cn('px-3 py-1.5 text-right tabular-nums', submitted ? 'text-slate-800' : 'italic text-slate-400')}>
                  {r.received != null ? rp(r.received) : dash}
                </td>
                <td className={cn('px-3 py-1.5 text-right tabular-nums', submitted ? 'text-slate-800' : 'italic text-slate-400')}>
                  {r.stored != null ? rp(r.stored) : dash}
                </td>
                <td
                  className={cn(
                    'px-3 py-1.5 text-right tabular-nums',
                    submitted ? 'font-bold' : 'text-slate-400',
                    submitted && r.balance > SETORAN_SHORT_THRESHOLD ? 'text-amber-600' : submitted && 'text-slate-900',
                  )}
                  title={submitted ? undefined : 'Sisa yang dibawa — belum ada setoran hari ini'}
                >
                  {rp(r.balance)}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {submitted ? (
                    <button
                      type="button"
                      title="Koreksi nominal setoran hari ini"
                      aria-label={`Koreksi setoran ${fmtDay(r.date)}`}
                      onClick={() => onCorrect(r)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-cyan-50 text-cyan-600 transition hover:bg-cyan-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  ) : r.kind === 'orphan' ? null : (
                    <button
                      type="button"
                      title="Tambah setoran untuk tanggal ini"
                      aria-label={`Tambah setoran ${fmtDay(r.date)}`}
                      onClick={() => onAdd(r)}
                      className={cn(
                        'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-bold transition',
                        quiet
                          ? 'border-slate-200 text-slate-400 hover:bg-slate-50'
                          : 'border-cyan-200 bg-white text-cyan-700 hover:bg-cyan-50',
                      )}
                    >
                      <Plus className="h-3 w-3" /> Tambah
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Change history ───────────────────────────────────────────────────────────

function HistoryList({ corrections }: { corrections: SetoranCorrectionEntry[] }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
      {corrections.map((c) => (
        <li key={c.id} className="space-y-1 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              {fmtDay(c.date)}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                {c.kind === 'create' ? 'Ditambahkan' : 'Dikoreksi'}
              </span>
            </p>
            <p className="text-[11px] text-slate-400">{c.correctedBy} · {fmtStamp(c.createdAt)}</p>
          </div>
          <p className="text-xs text-slate-500">
            {c.kind === 'create' ? (
              <>
                Diterima <span className="tabular-nums text-slate-700">{rp(c.after.received)}</span>
                <span className="mx-1.5 text-slate-300">·</span>
                Disetor <span className="tabular-nums text-slate-700">{rp(c.after.stored)}</span>
                <span className="mx-1.5 text-slate-300">·</span>
                Sisa <span className="tabular-nums text-slate-700">{rp(c.after.unpaid)}</span>
              </>
            ) : (
              <>
                Diterima <Delta before={c.before.received} after={c.after.received} />
                <span className="mx-1.5 text-slate-300">·</span>
                Disetor <Delta before={c.before.stored} after={c.after.stored} />
                <span className="mx-1.5 text-slate-300">·</span>
                Sisa <Delta before={c.before.unpaid} after={c.after.unpaid} />
              </>
            )}
          </p>
          <p className="text-xs text-slate-700">“{c.reason}”</p>
          {(c.affectedDays > 0 || c.wasVerified) && (
            <p className="text-[11px] text-slate-400">
              {c.affectedDays > 0 && `${c.affectedDays} hari setelahnya dihitung ulang`}
              {c.affectedDays > 0 && c.wasVerified && ' · '}
              {c.wasVerified && 'verifikasi Finance direset'}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Filter = 'all' | 'submitted' | 'missing' | 'unscheduled';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'submitted', label: 'Ada setoran' },
  { key: 'missing', label: 'Belum setor' },
  { key: 'unscheduled', label: 'Tanpa jadwal' },
];

const matches = (r: SetoranDayRow, f: Filter) =>
  f === 'all' ||
  (f === 'submitted' && r.kind === 'submitted') ||
  (f === 'missing' && isMissing(r)) ||
  (f === 'unscheduled' && r.kind === 'empty' && !r.scheduled);

export default function ItSetoranCorrectionPage() {
  const { status: authStatus, data: session } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [stores, setStores] = useState<CorrectableStore[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [days, setDays] = useState(PAGE_DAYS);
  const [ledger, setLedger] = useState<{
    store: CorrectableStore;
    today: string;
    rows: SetoranDayRow[];
    corrections: SetoranCorrectionEntry[];
  } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [loadingStores, setLoadingStores] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [dialog, setDialog] = useState<{ mode: DialogMode; date: string } | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt) router.replace('/it');
  }, [authStatus, session, isIt, router]);

  useEffect(() => {
    if (!isIt) return;
    let cancelled = false;
    (async () => {
      try {
        const json = await api('/api/ops/setoran-correction');
        if (!cancelled) setStores(json.stores);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Gagal memuat daftar toko');
      } finally {
        if (!cancelled) setLoadingStores(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isIt]);

  const loadLedger = useCallback(async () => {
    if (storeId == null) return;
    setLoadingLedger(true);
    try {
      const json = await api(`/api/ops/setoran-correction?storeId=${storeId}&days=${days}`);
      setLedger(json.ledger);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat setoran');
    } finally {
      setLoadingLedger(false);
    }
  }, [storeId, days]);

  useEffect(() => { void loadLedger(); }, [loadLedger]);

  function pickStore(id: number | null) {
    setStoreId(id);
    setLedger(null);
    setDays(PAGE_DAYS);
    setFilter('all');
  }

  const rows = useMemo(() => ledger?.rows ?? [], [ledger]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, submitted: 0, missing: 0, unscheduled: 0 };
    for (const r of rows) {
      if (r.kind === 'submitted') c.submitted += 1;
      if (isMissing(r)) c.missing += 1;
      if (matches(r, 'unscheduled')) c.unscheduled += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(() => rows.filter((r) => matches(r, filter)).reverse(), [rows, filter]);
  const dialogDay = dialog ? rows.find((r) => r.date === dialog.date) : undefined;

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can correct setoran.</p>
    </div>
  );

  const today = ledger?.today ?? '';
  const latest = rows[rows.length - 1];
  const submittedRows = rows.filter((r) => r.kind === 'submitted');
  const totalReceived = submittedRows.reduce((s, r) => s + (r.received ?? 0), 0);
  const totalStored = submittedRows.reduce((s, r) => s + (r.stored ?? 0), 0);

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-5 lg:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">IT</p>
            <h1 className="text-xl font-bold text-slate-900">Koreksi Setoran</h1>
            <p className="mt-0.5 text-xs text-slate-400">
              Perbaiki nominal satu hari, atau isi hari yang belum ada setorannya — sisa hari-hari berikutnya dihitung ulang otomatis.
            </p>
          </div>
          <Link
            href="/it"
            className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <div className="space-y-1.5">
          <span className="block text-xs font-bold text-slate-600">Toko</span>
          <StoreCombobox stores={stores} value={storeId} loading={loadingStores} onChange={pickStore} />
        </div>

        {storeId == null ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <Pencil className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Pilih toko untuk melihat setorannya per hari</p>
            <p className="mt-1 text-xs text-slate-400">
              Klik pensil untuk mengoreksi nominal, atau “Tambah” pada tanggal yang belum ada setorannya.
            </p>
          </div>
        ) : !ledger ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />)}
          </div>
        ) : (
          <>
            <KpiStrip
              items={[
                {
                  label: 'Sisa saat ini',
                  value: rp(latest?.balance ?? 0),
                  sub: 'belum disetor',
                  warn: (latest?.balance ?? 0) > SETORAN_SHORT_THRESHOLD,
                },
                { label: 'Ada setoran', value: `${counts.submitted}/${rows.length}`, sub: 'hari' },
                { label: 'Belum setor', value: String(counts.missing), sub: 'hari terjadwal', warn: counts.missing > 0 },
                { label: 'Total diterima', value: rp(totalReceived) },
                { label: 'Total disetor', value: rp(totalStored) },
              ]}
            />

            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter hari">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'h-8 rounded-full border px-3 text-xs font-bold transition',
                    filter === f.key
                      ? 'border-cyan-600 bg-cyan-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {f.label} <span className={cn('tabular-nums', filter === f.key ? 'text-cyan-100' : 'text-slate-400')}>{counts[f.key]}</span>
                </button>
              ))}
              {loadingLedger && <Loader2 className="ml-1 h-4 w-4 animate-spin text-cyan-500" />}
            </div>

            {visible.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                Tidak ada hari untuk filter ini dalam {days} hari terakhir.
              </div>
            ) : (
              <div className={cn('transition-opacity', loadingLedger && 'opacity-60')}>
                <DayList
                  rows={visible}
                  today={today}
                  onCorrect={(r) => setDialog({ mode: 'correct', date: r.date })}
                  onAdd={(r) => setDialog({ mode: 'add', date: r.date })}
                />
              </div>
            )}

            <div className="flex justify-center">
              <button
                type="button"
                disabled={loadingLedger}
                onClick={() => setDays((d) => d + 30)}
                className="text-xs font-bold text-cyan-600 hover:underline disabled:opacity-50"
              >
                Muat 30 hari lebih lama
              </button>
            </div>

            {ledger.corrections.length > 0 && (
              <section className="space-y-2 pt-2">
                <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <History className="h-3.5 w-3.5" /> Riwayat perubahan
                </h2>
                <HistoryList corrections={ledger.corrections} />
              </section>
            )}
          </>
        )}
      </div>

      {ledger && dialog && dialogDay && (
        <SetoranDialog
          key={`${dialog.mode}-${dialog.date}`}
          mode={dialog.mode}
          store={ledger.store}
          day={dialogDay}
          days={rows}
          onClose={() => setDialog(null)}
          onSaved={() => void loadLedger()}
        />
      )}
    </div>
  );
}
