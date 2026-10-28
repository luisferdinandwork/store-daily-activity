'use client';
// components/finance/store-sheet/DayDetailPanel.tsx
//
// The detail of one row of "Daily Report All Store", in a panel on the right: the day's totals, the
// Setoran filed the next morning (who, the cash figures, proof photos, notes, verification) and
// the Store Closing of the sales day (who, each bank's total, OP/ME/VOUCHER,
// the Z-Report and Indodana photos). Photos open in the shared lightbox, ‹ › step through the
// days that have data. Only what Finance checks a day against — see lib/store-money-detail.ts.

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Camera, ChevronLeft, ChevronRight, CheckCircle2, Loader2, PauseCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { PhotoLightbox } from '@/components/finance/shared/sheet-kit';
import { num, rp } from '@/components/finance/petty-cash/shared';
import { fmtDateLong, fmtDateTime, fmtDateShort } from '@/lib/finance/dates';
import { EDC_BANKS, OP_ME_VOUCHER_LABEL } from '@/lib/store-closing-edc';
import {
  CLOSING_STATE_LABEL,
  type DayClosingDetail,
  type DaySetoranDetail,
  type DetailPerson,
  type DetailPhoto,
  type StoreDayDetail,
} from '@/lib/store-money-detail';

// ─── Small pieces ────────────────────────────────────────────────────────────

function Section({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-slate-200 px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

function Badge({ tone, icon, children }: { tone: 'ok' | 'warn' | 'muted'; icon?: ReactNode; children: ReactNode }) {
  const cls = {
    ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-800 ring-amber-200',
    muted: 'bg-slate-100 text-slate-600 ring-slate-200',
  }[tone];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset', cls)}>
      {icon}
      {children}
    </span>
  );
}

/** "Disubmit oleh Budi · NIK 1234 · 22 Okt, 06.12" */
function Who({ label, person, at }: { label: string; person: DetailPerson | null; at: string | null }) {
  if (!person) return <p className="text-sm text-slate-400">{label} — tidak tercatat</p>;
  return (
    <div className="text-sm">
      <span className="text-slate-500">{label} </span>
      <span className="font-semibold text-slate-900">{person.name}</span>
      {person.nik && <span className="text-slate-400"> · NIK {person.nik}</span>}
      {at && <span className="block text-xs text-slate-500">{fmtDateTime(at)}</span>}
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-1.5 last:border-b-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className={cn('text-sm tabular-nums', strong ? 'font-bold text-slate-900' : 'text-slate-800', tone === 'warn' && 'font-semibold text-amber-700')}>
        {value}
      </dd>
    </div>
  );
}

function Thumb({ photo, onOpen }: { photo: DetailPhoto; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="w-28">
      <button
        type="button"
        onClick={onOpen}
        title={`Lihat ${photo.label}`}
        className="block h-28 w-28 overflow-hidden rounded-md border border-slate-300 bg-slate-100 transition hover:border-emerald-500"
      >
        {failed ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] text-slate-400">
            <Camera className="h-5 w-5" />
            Gagal dimuat
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt={photo.label} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        )}
      </button>
      <figcaption className="mt-1 text-[11px] font-medium leading-tight text-slate-700">{photo.label}</figcaption>
      {photo.at && <p className="text-[11px] text-slate-400">{fmtDateTime(photo.at)}</p>}
    </figure>
  );
}

function MissingPhoto({ label, note }: { label: string; note: string }) {
  return (
    <figure className="w-28">
      <div className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 text-center text-slate-400">
        <Camera className="h-5 w-5" />
        <span className="text-[11px] leading-tight">{note}</span>
      </div>
      <figcaption className="mt-1 text-[11px] font-medium leading-tight text-slate-700">{label}</figcaption>
    </figure>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function Summary({ detail }: { detail: StoreDayDetail }) {
  const { setoran, closing } = detail;
  const cash = setoran?.received ?? null;
  // A dash when no bank was filled in, not a Rp 0 the store never typed.
  const filledBanks = closing ? Object.values(closing.banks).filter((v): v is number => v !== null) : [];
  const banks = filledBanks.length > 0 ? filledBanks.reduce((sum, v) => sum + v, 0) : null;
  const op = closing?.opMeVoucher ?? null;
  const total = (cash ?? 0) + (banks ?? 0) + (op ?? 0);
  const any = setoran !== null || closing !== null;

  const cell = (label: string, value: number | null, strong?: boolean) => (
    <div className={cn('bg-white px-3 py-2.5', strong && 'col-span-3')}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cn('mt-0.5 whitespace-nowrap tabular-nums', strong ? 'text-xl font-bold text-slate-900' : 'text-sm font-semibold text-slate-800')}>
        {value === null ? <span className="text-slate-300">–</span> : rp(value)}
      </dd>
    </div>
  );

  return (
    <dl className="mx-5 mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200">
      {cell('Total Sales', any ? total : null, true)}
      {cell('Sales Cash', cash)}
      {cell('Bank', banks)}
      {cell(OP_ME_VOUCHER_LABEL, op)}
    </dl>
  );
}

function SetoranSection({ setoran, detail, onOpenPhoto }: { setoran: DaySetoranDetail | null; detail: StoreDayDetail; onOpenPhoto: (key: string) => void }) {
  const badge = !setoran ? null : setoran.isNoSetoran ? (
    <Badge tone="muted">Tanpa setoran</Badge>
  ) : setoran.verifiedAt ? (
    <Badge tone="ok" icon={<CheckCircle2 className="h-3 w-3" />}>Terverifikasi</Badge>
  ) : (
    <Badge tone="muted">Belum diverifikasi</Badge>
  );

  return (
    <Section title={`Setoran · ${fmtDateShort(detail.setoranDate)}`} badge={badge}>
      {!setoran ? (
        <p className="text-sm text-slate-500">Belum ada setoran yang disubmit pada {fmtDateShort(detail.setoranDate)}.</p>
      ) : (
        <div className="space-y-4">
          <Who label="Disubmit oleh" person={setoran.submittedBy} at={setoran.submittedAt} />

          <dl>
            <Row label="Sales Cash" value={num(setoran.received)} />
            <Row label="Sisa kemarin" value={num(setoran.carryIn)} />
            <Row label="Harus Disetor" value={num(setoran.required)} strong />
            <Row label="Setoran Tunai" value={num(setoran.stored)} />
            <Row label="Tidak Disetor (Sisa)" value={num(setoran.unpaid)} tone={setoran.unpaid > 0 ? 'warn' : undefined} />
          </dl>

          {setoran.notes && (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Catatan</span>
              {setoran.notes}
            </div>
          )}

          {setoran.verifiedBy && (
            <p className="text-xs text-slate-500">
              Diverifikasi Finance oleh <span className="font-semibold text-slate-700">{setoran.verifiedBy.name}</span>
              {setoran.verifiedAt && <> · {fmtDateTime(setoran.verifiedAt)}</>}
            </p>
          )}

          {setoran.correction && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                {setoran.correction.kind === 'create' ? 'Diisi' : 'Dikoreksi'} oleh IT ({setoran.correction.by}) · {fmtDateTime(setoran.correction.at)}
                <span className="block text-amber-800/80">{setoran.correction.reason}</span>
              </p>
            </div>
          )}

          {setoran.photos.length > 0 && (
            <div className="flex flex-wrap gap-4">
              {setoran.photos.map((p) => (
                <Thumb key={p.key} photo={p} onOpen={() => onOpenPhoto(p.key)} />
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function ClosingSection({ closing, detail, onOpenPhoto }: { closing: DayClosingDetail | null; detail: StoreDayDetail; onOpenPhoto: (key: string) => void }) {
  const badge = !closing ? null : (
    <Badge
      tone={closing.state === 'posted' ? 'ok' : closing.state === 'on_hold' ? 'warn' : 'muted'}
      icon={closing.state === 'on_hold' ? <PauseCircle className="h-3 w-3" /> : closing.state === 'posted' ? <CheckCircle2 className="h-3 w-3" /> : undefined}
    >
      {CLOSING_STATE_LABEL[closing.state]}
    </Badge>
  );

  return (
    <Section title={`Store Closing · ${fmtDateShort(detail.salesDate)}`} badge={badge}>
      {!closing ? (
        <p className="text-sm text-slate-500">Belum ada Store Closing untuk {fmtDateShort(detail.salesDate)}.</p>
      ) : (
        <div className="space-y-4">
          <Who label={closing.state === 'draft' ? 'Terakhir diisi oleh' : 'Disubmit oleh'} person={closing.submittedBy} at={closing.submittedAt} />

          {closing.holdReason && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-amber-700">Alasan On Hold</span>
              {closing.holdReason}
            </div>
          )}

          <EdcTable closing={closing} />

          <div className="flex flex-wrap gap-4">
            {closing.zReportPhoto ? (
              <Thumb photo={closing.zReportPhoto} onOpen={() => onOpenPhoto(closing.zReportPhoto!.key)} />
            ) : closing.state !== 'draft' ? (
              <MissingPhoto label="Z-Report & EDC Settlement" note="Belum ada foto" />
            ) : null}
            {closing.indodanaPhoto ? (
              <Thumb photo={closing.indodanaPhoto} onOpen={() => onOpenPhoto(closing.indodanaPhoto!.key)} />
            ) : closing.banks.indodana !== null ? (
              <MissingPhoto label="Dashboard Indodana" note="Tidak dilampirkan" />
            ) : null}
          </div>
        </div>
      )}
    </Section>
  );
}

/** Each bank's total for the day (all methods added up); a bank left blank is a dash. */
function EdcTable({ closing }: { closing: DayClosingDetail }) {
  const filled = Object.values(closing.banks).filter((v): v is number => v !== null);
  const grandTotal = filled.length > 0 || closing.opMeVoucher !== null
    ? filled.reduce((sum, v) => sum + v, 0) + (closing.opMeVoucher ?? 0)
    : null;
  const th = 'px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500';

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="bg-slate-50">
            <th className={cn(th, 'text-left')}>Bank</th>
            <th className={th}>Total</th>
          </tr>
        </thead>
        <tbody>
          {EDC_BANKS.map((bank) => {
            const total = closing.banks[bank.code];
            return (
              <tr key={bank.code} className={cn('border-t border-slate-100', total === null && 'text-slate-400')}>
                <td className="px-2 py-1.5 text-left font-medium text-slate-800">{bank.label}</td>
                <td className="px-2 py-1.5 text-right font-semibold text-slate-900">{total === null ? <span className="text-slate-300">–</span> : num(total)}</td>
              </tr>
            );
          })}
          <tr className="border-t border-slate-200">
            <td className="px-2 py-1.5 font-medium text-slate-800">{OP_ME_VOUCHER_LABEL}</td>
            <td className="px-2 py-1.5 text-right font-semibold text-slate-900">
              {closing.opMeVoucher === null ? <span className="text-slate-300">–</span> : num(closing.opMeVoucher)}
            </td>
          </tr>
          <tr className="border-t-2 border-slate-300 bg-slate-50">
            <td className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">Total bank + {OP_ME_VOUCHER_LABEL}</td>
            <td className="px-2 py-1.5 text-right font-bold text-slate-900">
              {grandTotal === null ? <span className="font-normal text-slate-300">–</span> : num(grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

interface Result {
  key: string;
  detail: StoreDayDetail | null;
  error: string | null;
}

export default function DayDetailPanel({
  storeId,
  date,
  onClose,
  onStep,
  hasPrev,
  hasNext,
}: {
  storeId: number;
  /** Sales day to show; null = closed. */
  date: string | null;
  onClose: () => void;
  /** Step to the previous / next day that has data. */
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const key = date ? `${storeId}:${date}` : null;
  const loading = key !== null && result?.key !== key;

  useEffect(() => {
    if (!key || !date) return;
    let stale = false;

    fetch(`/api/finance/store-sheet/day?storeId=${storeId}&date=${date}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (stale) return;
        setResult(body.success ? { key, detail: body.detail, error: null } : { key, detail: null, error: body.error ?? 'Gagal memuat detail.' });
      })
      .catch(() => { if (!stale) setResult({ key, detail: null, error: 'Network error.' }); });

    return () => { stale = true; };
  }, [key, date, storeId]);

  // Keep showing the last day while the panel slides out.
  const detail = result?.detail ?? null;
  const error = loading ? null : result?.error ?? null;

  // Every photo of the day, in the order they are drawn — the lightbox steps through them.
  const photos = detail
    ? [...(detail.setoran?.photos ?? []), ...[detail.closing?.zReportPhoto, detail.closing?.indodanaPhoto].filter((p): p is DetailPhoto => Boolean(p))]
    : [];
  const openPhoto = (photoKey: string) => setLightbox(Math.max(0, photos.findIndex((p) => p.key === photoKey)));

  return (
    <Sheet open={date !== null} onOpenChange={(open) => { if (!open) { setLightbox(null); onClose(); } }}>
      <SheetContent
        className="w-full gap-0 p-0 sm:max-w-[34rem]"
        // Esc closes the photo first, the panel only on the next press.
        onEscapeKeyDown={(e) => { if (lightbox !== null) e.preventDefault(); }}
        // Don't pull focus onto the ‹ button (it would show a focus ring the moment the panel opens).
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-start gap-3 px-5 pb-4 pt-4 pr-12">
          <div className="min-w-0 flex-1">
            <SheetTitle className="flex items-baseline gap-2 text-base">
              <span className="font-mono text-xs font-semibold text-emerald-700">{detail?.storeNo}</span>
              <span className="truncate">{detail?.storeName ?? 'Detail hari'}</span>
            </SheetTitle>
            <SheetDescription className="mt-0.5 text-sm text-slate-600">
              {date ? fmtDateLong(date) : ''}
            </SheetDescription>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => onStep(-1)}
              disabled={!hasPrev}
              aria-label="Hari sebelumnya"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onStep(1)}
              disabled={!hasNext}
              aria-label="Hari berikutnya"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Memuat detail…
            </div>
          ) : error ? (
            <div className="mx-5 flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
              <p className="text-sm font-medium text-rose-700">{error}</p>
            </div>
          ) : detail ? (
            <>
              <Summary detail={detail} />
              <SetoranSection setoran={detail.setoran} detail={detail} onOpenPhoto={openPhoto} />
              <ClosingSection closing={detail.closing} detail={detail} onOpenPhoto={openPhoto} />
            </>
          ) : null}
        </div>

        {lightbox !== null && photos[lightbox] && detail && (
          <PhotoLightbox
            title={`${detail.storeNo} · ${fmtDateShort(detail.salesDate)}`}
            photos={photos}
            index={lightbox}
            onIndex={setLightbox}
            onClose={() => setLightbox(null)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
