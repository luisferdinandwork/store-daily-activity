'use client';

// components/setoran-correction/SetoranCorrectionPage.tsx
//
// Shared by IT (/it/setoran-correction) and Finance (/finance/setoran-correction):
// the same ledger and the same correction logic, only the endpoint, the wording
// and who the correction is recorded against differ (see PANELS below).
//
// "Koreksi Setoran": pick a store and see every day — submitted, draft, or nothing
// at all. Fix the amounts of a submitted day, or fill in a day that has no setoran.
// The sisa (unpaid) of a day is the next day's sisa kemarin, so a wrong or missing
// figure keeps distorting every later day — a change recalculates that whole tail
// and shows exactly what will change before anything is saved. The original
// figures and the reason stay in the history (and on Finance's daily review).

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronDown, History, ImageOff, Loader2, Pencil, Plus, Shield, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn, formatRupiah } from '@/lib/utils';
import { StoreCombobox } from '@/components/shared/store-combobox';
import { KpiStrip, PhotoLightbox, type LightboxPhoto } from '@/components/finance/shared/sheet-kit';
import { StatusBadge } from '@/components/finance/setoran/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { SETORAN_SHORT_THRESHOLD, evidenceSlots, type ReviewStatus } from '@/lib/setoran-review';
import {
  CORRECTION_REASON_MAX,
  CORRECTION_REASON_MIN,
  correctionChain,
  correctorLabel,
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

export type CorrectionPanel = 'it' | 'finance';

const PANELS: Record<CorrectionPanel, {
  api: string;
  scope: string;
  /** Who a correction made here is recorded as. */
  label: string;
  home: string;
  roles: readonly string[];
  denied: string;
}> = {
  it: {
    api: '/api/ops/setoran-correction',
    scope: 'IT',
    label: 'IT',
    home: '/it',
    roles: ['it'],
    denied: 'Only IT can correct setoran.',
  },
  finance: {
    api: '/api/finance/setoran-correction',
    scope: 'Finance',
    label: 'Finance',
    home: '/finance',
    roles: ['finance', 'it'],
    denied: 'Only Finance can correct setoran.',
  },
};

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
  mode, store, day, days, apiBase, byLabel, onClose, onSaved,
}: {
  apiBase: string;
  /** "IT" / "Finance" — who the correction will be recorded as. */
  byLabel: string;
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
      const json = await api(apiBase, {
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
    // A panel that slides in from the left; the figures scroll, the buttons stay in view.
    <Sheet open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <SheetContent
        side="left"
        className="flex w-full flex-col gap-0 border-slate-200 bg-white p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-slate-100 px-5 py-4 pr-12">
          <SheetTitle className="text-base text-slate-900">{isAdd ? 'Tambah setoran' : 'Koreksi setoran'}</SheetTitle>
          <SheetDescription className="text-slate-500">
            {store.storeNo} · {store.name} — {fmtDay(day.date)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!isAdd && day.verifiedAt && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              Setoran ini sudah diverifikasi Finance. Verifikasi akan direset agar angka baru diperiksa ulang.
            </p>
          )}
          {isAdd && (
            <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>
                {day.kind === 'draft'
                  ? 'Task hari ini belum disubmit — akan diselesaikan dengan nominal ini (foto yang sudah ada tetap). '
                  : 'Belum ada setoran di tanggal ini — akan dicatat sebagai setoran selesai. '}
                Setoran yang ditambahkan {byLabel} tidak punya foto bukti; di Setoran Review tampil sebagai “Bukti belum lengkap”.
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

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
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
      </SheetContent>
    </Sheet>
  );
}

// ─── Correction detail ────────────────────────────────────────────────────────

/** Evidence photo that degrades to an icon when the stored URL no longer loads. */
function PhotoImg({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span title="Foto gagal dimuat" className="flex h-full w-full items-center justify-center text-slate-400">
        <ImageOff className="h-1/3 w-1/3" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
  );
}

function FigureRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="font-semibold text-slate-500">{label}</span>
      <span className="text-[13px] font-semibold tabular-nums text-slate-800">{children}</span>
    </div>
  );
}

/**
 * What a setoran day looks like now and everything changed on it — the
 * figures before the first correction included — with the note written for
 * each change (newest first).
 */
function CorrectionDetail({
  store, day, corrections, onClose, onCorrect,
}: {
  store: CorrectableStore;
  day: SetoranDayRow;
  /** Every correction of the store — this day's are picked out here. */
  corrections: SetoranCorrectionEntry[];
  onClose: () => void;
  onCorrect: () => void;
}) {
  const history = corrections.filter((c) => c.date === day.date);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // Small thumbnails; a click opens the photo full size (arrows step through the rest).
  const slots = evidenceSlots(day);
  const present = slots.filter((s): s is typeof s & { url: string } => Boolean(s.url));
  const photos: LightboxPhoto[] = present.map((s) => ({ url: s.url, label: s.label }));
  // Figures before the first correction (none when the day was filled in).
  const original = history.length > 0 && history[history.length - 1].kind === 'correct'
    ? history[history.length - 1].before
    : null;

  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent
        side="left"
        className="flex w-full flex-col gap-0 border-slate-200 bg-white p-0 sm:max-w-xl"
        // While a photo is open full size, Esc / clicks belong to the viewer, not this panel.
        onEscapeKeyDown={(e) => { if (lightbox != null) e.preventDefault(); }}
        onInteractOutside={(e) => { if (lightbox != null) e.preventDefault(); }}
      >
        <SheetHeader className="border-b border-slate-100 px-5 py-4 pr-12">
          <SheetTitle className="text-base text-slate-900">Detail setoran</SheetTitle>
          <SheetDescription className="text-slate-500">
            {store.storeNo} · {store.name} — {fmtDay(day.date)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Bukti foto</h3>
            {slots.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                Tidak ada foto bukti{day.kind === 'submitted' ? ' — setoran ini diisi tanpa foto.' : '.'}
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {slots.map((s) => (
                  <figure key={s.key} className="w-20">
                    {s.url ? (
                      <button
                        type="button"
                        title={`Lihat ${s.label}`}
                        onClick={() => setLightbox(present.findIndex((p) => p.key === s.key))}
                        className="block h-20 w-20 overflow-hidden rounded-lg border border-slate-300 bg-slate-100 transition hover:border-cyan-500"
                      >
                        <PhotoImg src={s.url} alt={s.label} />
                      </button>
                    ) : (
                      <div className="flex h-20 w-20 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-amber-400 bg-amber-50 text-amber-700">
                        <ImageOff className="h-4 w-4" />
                        <span className="text-[10px] font-semibold">Belum ada</span>
                      </div>
                    )}
                    <figcaption className="mt-1 text-[10px] leading-tight text-slate-500">{s.label}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>

          {(day.submittedBy || day.receivedBy || day.storedBy || day.verifiedAt) && (
            <section>
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Petugas toko</h3>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">
                {([
                  ['Disetor / disubmit oleh', day.submittedBy, day.submittedAt],
                  ['Uang diterima dicatat', day.receivedBy, day.receivedAt],
                  ['Nominal disetor dicatat', day.storedBy, day.storedAt],
                  ['Diverifikasi', day.verifiedAt ? day.verifiedBy ?? 'Finance' : null, day.verifiedAt],
                ] as const).map(([label, who, at]) => who && (
                  <div key={label} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                    <span className="font-semibold text-slate-500">{label}</span>
                    <span className="text-right text-slate-800">
                      <span className="font-semibold">{who}</span>
                      {at && <span className="text-slate-400"> · {fmtStamp(at)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Saat ini</h3>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">
              <FigureRow label="Sisa kemarin">{rp(day.carryIn)}</FigureRow>
              <FigureRow label="Uang diterima">{day.received != null ? rp(day.received) : '–'}</FigureRow>
              <FigureRow label="Disetor">{day.stored != null ? rp(day.stored) : '–'}</FigureRow>
              <FigureRow label="Sisa">{day.unpaid != null ? rp(day.unpaid) : '–'}</FigureRow>
            </div>
          </section>

          {original && (
            <section>
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Setoran awal (sebelum dikoreksi)</h3>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50 px-4">
                <FigureRow label="Uang diterima">{rp(original.received)}</FigureRow>
                <FigureRow label="Disetor">{rp(original.stored)}</FigureRow>
                <FigureRow label="Sisa">{rp(original.unpaid)}</FigureRow>
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <History className="h-3.5 w-3.5" />
              Riwayat koreksi
              <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] tabular-nums text-slate-500">{history.length}</span>
            </h3>
            {history.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                Setoran ini belum pernah dikoreksi.
              </p>
            ) : (
              <ol className="space-y-3">
                {history.map((c) => (
                  <li key={c.id} className="rounded-xl border border-slate-200 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          c.kind === 'create' ? 'bg-cyan-50 text-cyan-700' : 'bg-amber-50 text-amber-700',
                        )}
                      >
                        {c.kind === 'create' ? 'Ditambahkan' : 'Dikoreksi'}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        <span className="font-medium text-slate-700">{c.correctedBy}</span> ({correctorLabel(c.correctedByRole)}) · {fmtStamp(c.createdAt)}
                      </span>
                    </div>

                    <div className="mt-2 divide-y divide-slate-100 text-xs">
                      {([
                        ['Uang diterima', c.before.received, c.after.received],
                        ['Disetor', c.before.stored, c.after.stored],
                        ['Sisa', c.before.unpaid, c.after.unpaid],
                      ] as const).map(([label, before, after]) => (
                        <div key={label} className="flex items-center justify-between gap-3 py-1.5">
                          <span className="font-semibold text-slate-500">{label}</span>
                          {c.kind === 'create'
                            ? <span className="tabular-nums text-slate-700">{rp(after)}</span>
                            : <Delta before={before} after={after} />}
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <span className="font-semibold">Catatan: </span>
                      <span className="whitespace-pre-wrap">{c.reason}</span>
                    </div>

                    {(c.affectedDays > 0 || c.wasVerified) && (
                      <p className="mt-1.5 text-[11px] text-slate-400">
                        {c.affectedDays > 0 && `${c.affectedDays} hari setelahnya dihitung ulang`}
                        {c.affectedDays > 0 && c.wasVerified && ' · '}
                        {c.wasVerified && 'verifikasi Finance direset'}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500"
          >
            <X className="h-3.5 w-3.5" /> Tutup
          </button>
          {day.kind === 'submitted' && (
            <button
              type="button"
              onClick={onCorrect}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-xs font-bold text-white"
            >
              <Pencil className="h-3.5 w-3.5" /> Koreksi nominal
            </button>
          )}
        </div>
      </SheetContent>

      {/* Full-size viewer — outside the panel so it covers the whole screen. */}
      {lightbox != null && photos.length > 0 && typeof document !== 'undefined' &&
        createPortal(
          <div style={{ pointerEvents: 'auto' }}>
            <PhotoLightbox
              title={`${store.storeNo} · ${fmtDayShort(day.date)}`}
              photos={photos}
              index={Math.min(lightbox, photos.length - 1)}
              onIndex={setLightbox}
              onClose={() => setLightbox(null)}
            />
          </div>,
          document.body,
        )}
    </Sheet>
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
  rows, today, onOpen, onCorrect, onAdd,
}: {
  rows: SetoranDayRow[];
  today: string;
  /** Open the day's detail: its figures and every correction made to it. */
  onOpen: (row: SetoranDayRow) => void;
  onCorrect: (row: SetoranDayRow) => void;
  onAdd: (row: SetoranDayRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-[13px]">
        <thead className="text-[11px] font-semibold text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="px-5 py-3 text-left font-semibold">Tanggal</th>
            <th className="px-3 py-3 text-left font-semibold">Status</th>
            <th className="hidden px-3 py-3 text-right font-semibold md:table-cell">Sisa kemarin</th>
            <th className="px-3 py-3 text-right font-semibold">Diterima</th>
            <th className="px-3 py-3 text-right font-semibold">Disetor</th>
            <th className="px-3 py-3 text-right font-semibold">Sisa</th>
            <th className="w-24 px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const submitted = r.kind === 'submitted';
            const missed = isMissing(r) && r.date < today;
            const quiet = r.kind === 'empty' && !r.scheduled;
            const dash = <span className="text-slate-300">–</span>;
            const openable = submitted || r.correctionCount > 0;

            return (
              <tr
                key={r.date}
                onClick={openable ? () => onOpen(r) : undefined}
                className={cn(
                  'group transition-colors hover:bg-slate-50',
                  missed && 'bg-rose-50/50 hover:bg-rose-50',
                  openable && 'cursor-pointer',
                )}
              >
                <td
                  title={fmtDay(r.date)}
                  className={cn('whitespace-nowrap px-5 py-3 font-medium', quiet ? 'text-slate-400' : 'text-slate-900')}
                >
                  {fmtDayShort(r.date)}
                  {r.date === today && <span className="ml-2 rounded-full bg-cyan-50 px-1.5 py-px text-[10px] font-bold text-cyan-700">Hari ini</span>}
                </td>
                <td className="px-3 py-3">
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
                        {r.addedByIt ? 'Ditambahkan' : 'Dikoreksi'}{r.correctionCount > 1 ? ` ×${r.correctionCount}` : ''}
                      </span>
                    )}
                  </div>
                </td>
                <td className="hidden px-3 py-3 text-right tabular-nums text-slate-400 md:table-cell">
                  {rp(r.carryIn)}
                </td>
                <td className={cn('px-3 py-3 text-right tabular-nums', submitted ? 'text-slate-800' : 'italic text-slate-400')}>
                  {r.received != null ? rp(r.received) : dash}
                </td>
                <td className={cn('px-3 py-3 text-right tabular-nums', submitted ? 'text-slate-800' : 'italic text-slate-400')}>
                  {r.stored != null ? rp(r.stored) : dash}
                </td>
                <td
                  className={cn(
                    'px-3 py-3 text-right tabular-nums',
                    submitted ? 'font-semibold' : 'text-slate-400',
                    submitted && r.balance > SETORAN_SHORT_THRESHOLD ? 'text-amber-600' : submitted && 'text-slate-900',
                  )}
                  title={submitted ? undefined : 'Sisa yang dibawa — belum ada setoran hari ini'}
                >
                  {rp(r.balance)}
                </td>
                <td className="px-5 py-3 text-right">
                  {submitted ? (
                    <button
                      type="button"
                      title="Koreksi nominal setoran hari ini"
                      aria-label={`Koreksi setoran ${fmtDay(r.date)}`}
                      onClick={(e) => { e.stopPropagation(); onCorrect(r); }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-cyan-50 text-cyan-600 transition hover:bg-cyan-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  ) : r.kind === 'orphan' ? null : (
                    <button
                      type="button"
                      title="Tambah setoran untuk tanggal ini"
                      aria-label={`Tambah setoran ${fmtDay(r.date)}`}
                      onClick={(e) => { e.stopPropagation(); onAdd(r); }}
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

/** Every correction / addition made for the store, newest first, as a table at the bottom of the page. */
function HistoryPanel({
  corrections, onOpen,
}: {
  corrections: SetoranCorrectionEntry[];
  /** Open the detail of the corrected day (YYYY-MM-DD). */
  onOpen: (date: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <History className="h-4 w-4 text-slate-400" />
          Riwayat koreksi
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
            {corrections.length}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        corrections.length === 0 ? (
          <p className="border-t border-slate-100 p-8 text-center text-sm text-slate-500">
            Belum ada koreksi atau penambahan setoran untuk toko ini.
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto border-t border-slate-100">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="sticky top-0 bg-white text-[11px] font-semibold text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Tanggal setoran</th>
                  <th className="px-3 py-3 text-left font-semibold">Jenis</th>
                  <th className="px-3 py-3 text-right font-semibold">Diterima</th>
                  <th className="px-3 py-3 text-right font-semibold">Disetor</th>
                  <th className="px-3 py-3 text-right font-semibold">Sisa</th>
                  <th className="px-3 py-3 text-left font-semibold">Alasan</th>
                  <th className="px-5 py-3 text-left font-semibold">Oleh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {corrections.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => onOpen(c.date)}
                    title="Klik untuk melihat detail koreksi"
                    className="cursor-pointer align-top hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-slate-900">{fmtDay(c.date)}</td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          c.kind === 'create' ? 'bg-cyan-50 text-cyan-700' : 'bg-amber-50 text-amber-700',
                        )}
                      >
                        {c.kind === 'create' ? 'Ditambahkan' : 'Dikoreksi'}
                      </span>
                    </td>
                    {c.kind === 'create' ? (
                      <>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">{rp(c.after.received)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">{rp(c.after.stored)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">{rp(c.after.unpaid)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-3 text-right"><Delta before={c.before.received} after={c.after.received} /></td>
                        <td className="px-3 py-3 text-right"><Delta before={c.before.stored} after={c.after.stored} /></td>
                        <td className="px-3 py-3 text-right"><Delta before={c.before.unpaid} after={c.after.unpaid} /></td>
                      </>
                    )}
                    <td className="min-w-56 max-w-sm px-3 py-3 text-slate-700">
                      <p>{c.reason}</p>
                      {(c.affectedDays > 0 || c.wasVerified) && (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {c.affectedDays > 0 && `${c.affectedDays} hari setelahnya dihitung ulang`}
                          {c.affectedDays > 0 && c.wasVerified && ' · '}
                          {c.wasVerified && 'verifikasi Finance direset'}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">
                      <p className="font-medium text-slate-700">
                        {c.correctedBy} <span className="font-normal text-slate-400">({correctorLabel(c.correctedByRole)})</span>
                      </p>
                      <p>{fmtStamp(c.createdAt)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
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

export default function SetoranCorrectionPage({ panel }: { panel: CorrectionPanel }) {
  const cfg = PANELS[panel];
  const { status: authStatus, data: session } = useSession();
  const router = useRouter();
  const allowed = cfg.roles.includes(session?.user?.role ?? '');

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
  const [detailDate, setDetailDate] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!allowed) router.replace(cfg.home);
  }, [authStatus, session, allowed, router, cfg.home]);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      try {
        const json = await api(cfg.api);
        if (!cancelled) setStores(json.stores);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Gagal memuat daftar toko');
      } finally {
        if (!cancelled) setLoadingStores(false);
      }
    })();
    return () => { cancelled = true; };
  }, [allowed, cfg.api]);

  const loadLedger = useCallback(async () => {
    if (storeId == null) return;
    setLoadingLedger(true);
    try {
      const json = await api(`${cfg.api}?storeId=${storeId}&days=${days}`);
      setLedger(json.ledger);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat setoran');
    } finally {
      setLoadingLedger(false);
    }
  }, [storeId, days, cfg.api]);

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
  const detailDay = detailDate ? rows.find((r) => r.date === detailDate) : undefined;

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
    </div>
  );

  if (!allowed) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">{cfg.denied}</p>
    </div>
  );

  const today = ledger?.today ?? '';
  const latest = rows[rows.length - 1];
  const submittedRows = rows.filter((r) => r.kind === 'submitted');
  const totalReceived = submittedRows.reduce((s, r) => s + (r.received ?? 0), 0);
  const totalStored = submittedRows.reduce((s, r) => s + (r.stored ?? 0), 0);

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope={cfg.scope}
        title="Koreksi Setoran"
        subtitle="Perbaiki nominal satu hari, atau isi hari yang belum ada setorannya — sisa hari-hari berikutnya dihitung ulang otomatis."
        actions={
          <Link
            href={cfg.home}
            className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        }
      />

      <div className="space-y-4 px-4 py-5 sm:px-6 lg:px-8">
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

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
                <h2 className="text-sm font-bold text-slate-900">
                  Setoran per hari
                  <span className="ml-2 text-xs font-medium text-slate-400">{days} hari terakhir</span>
                </h2>
                <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter hari">
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      role="tab"
                      aria-selected={filter === f.key}
                      onClick={() => setFilter(f.key)}
                      className={cn(
                        'h-7 rounded-full px-3 text-xs font-semibold transition',
                        filter === f.key
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                      )}
                    >
                      {f.label} <span className={cn('tabular-nums', filter === f.key ? 'text-slate-300' : 'text-slate-400')}>{counts[f.key]}</span>
                    </button>
                  ))}
                  {loadingLedger && <Loader2 className="ml-1 h-4 w-4 animate-spin text-cyan-500" />}
                </div>
              </div>

              {visible.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">
                  Tidak ada hari untuk filter ini dalam {days} hari terakhir.
                </p>
              ) : (
                <div className={cn('transition-opacity', loadingLedger && 'opacity-60')}>
                  <DayList
                    rows={visible}
                    today={today}
                    onOpen={(r) => setDetailDate(r.date)}
                    onCorrect={(r) => setDialog({ mode: 'correct', date: r.date })}
                    onAdd={(r) => setDialog({ mode: 'add', date: r.date })}
                  />
                </div>
              )}

              <div className="border-t border-slate-100 px-5 py-2.5 text-center">
                <button
                  type="button"
                  disabled={loadingLedger}
                  onClick={() => setDays((d) => d + 30)}
                  className="text-xs font-bold text-cyan-600 hover:underline disabled:opacity-50"
                >
                  Muat 30 hari lebih lama
                </button>
              </div>
            </section>

            {/* History of every correction made for this store — always at the bottom. */}
            <HistoryPanel corrections={ledger.corrections} onOpen={setDetailDate} />
          </>
        )}
      </div>

      {ledger && detailDay && !dialog && (
        <CorrectionDetail
          key={detailDay.date}
          store={ledger.store}
          day={detailDay}
          corrections={ledger.corrections}
          onClose={() => setDetailDate(null)}
          onCorrect={() => {
            setDetailDate(null);
            setDialog({ mode: 'correct', date: detailDay.date });
          }}
        />
      )}

      {ledger && dialog && dialogDay && (
        <SetoranDialog
          key={`${dialog.mode}-${dialog.date}`}
          mode={dialog.mode}
          store={ledger.store}
          day={dialogDay}
          days={rows}
          apiBase={cfg.api}
          byLabel={cfg.label}
          onClose={() => setDialog(null)}
          onSaved={() => void loadLedger()}
        />
      )}
    </div>
  );
}
