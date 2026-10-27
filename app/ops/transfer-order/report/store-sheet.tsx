'use client';
// app/ops/transfer-order/report/store-sheet.tsx
//
// One store's processes (of the report's kind) for the period, in a slide-over:
// the ones still open first (longest-waiting on top), then the finished ones.
// Opened from a row / a day square of the TO Report.

import { useMemo, useState } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, Loader2, Truck, Warehouse } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONES, TONE_HEX, rateTone } from '@/lib/status-theme';
import { useApi } from '@/lib/client/use-api';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { OpsChipTabs } from '@/components/ops/layout/OpsToolbar';
import { RateBar } from '@/components/tasks/MetricTile';
import { formatMinutes, formatStamp, minutesBetween } from '@/lib/transfer-order-metrics';
import {
  PROCESS_META,
  avgMinutes,
  pct,
  type Process,
  type ReportItem,
  type StoreReport,
  type TransferReportStoreResponse,
} from '@/lib/transfer-order-report';

export interface StoreSheetTarget {
  process: Process;
  /** The store's row from the list — shown instantly while its processes load. */
  store: StoreReport;
  from: string;
  to: string;
  /** "Senin, 20 Oktober 2026" / "19 Okt – 25 Okt 2026". */
  label: string;
}

type StatusTab = 'all' | 'open' | 'done';

const ICON: Record<Process, typeof ArrowUpFromLine> = {
  return: ArrowUpFromLine,
  receiving: ArrowDownToLine,
  delivery: Truck,
};

function ProgressRing({ value, size = 64, stroke = 6 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = TONE_HEX[rateTone(value)];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${(Math.min(100, Math.max(0, value)) / 100) * c} ${c}`} strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-black tabular-nums" style={{ color }}>{value}%</span>
      </div>
    </div>
  );
}

function Counterpart({ item }: { item: ReportItem }) {
  const meta = PROCESS_META[item.process];
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-xs text-slate-500">
      <span className="shrink-0">{meta.directionLabel}</span>
      {item.counterpartIsWarehouse && <Warehouse className="h-3 w-3 shrink-0 text-slate-400" />}
      <span className="truncate font-semibold text-slate-700">
        {item.counterpartIsWarehouse ? 'Gudang' : (item.counterpartName ?? item.counterpartCode)}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-slate-400">({item.counterpartCode})</span>
    </span>
  );
}

// What the big duration on the right of a card measures, per process: the whole
// timeline (Item Return: TO Dibuat → Foto Serah Terima; Item Receiving: Terima Fisik →
// WR Diposting). `none` = it has no clock — an Item Receiving the store hasn't
// photographed yet, or one BC closed with no store photo.
const DURATION_NOTE: Record<Process, { done: string; open: string; noneDone: string; noneOpen: string }> = {
  return: { done: 'total proses', open: 'berjalan', noneDone: '', noneOpen: '' },
  receiving: { done: 'terima fisik → WR', open: 'sejak terima fisik', noneDone: 'tanpa foto toko', noneOpen: 'belum diterima fisik' },
  delivery: { done: 'durasi', open: 'berjalan', noneDone: '', noneOpen: '' },
};

/**
 * The item's recorded moments, in order, with the time between each pair on the
 * connector: TO Dibuat → WS Diposting → Foto Serah Terima (Item Return),
 * Terima Fisik Barang di Toko → WR Diposting (Item Receiving).
 */
function Timeline({ steps }: { steps: ReportItem['steps'] }) {
  return (
    <ol className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5">
      {steps.map((step, i) => {
        const prev = i > 0 ? steps[i - 1] : null;
        const gap = prev?.at && step.at ? minutesBetween(prev.at, step.at, { signed: step.signed }) : null;
        const early = gap != null && gap < 0;
        // A step with no time that a LATER step already has (WR closed in BC with no store
        // photo; the hand-off photo taken before the WS was posted) was skipped, not awaited.
        const skipped = !step.at && steps.slice(i + 1).some((s) => s.at);
        // The step being waited on: the first one without a time whose predecessor happened.
        const waitingOn = !step.at && !skipped && (!prev || prev.at != null);
        return (
          <li key={step.label}>
            {prev && (
              <div className="ml-[4px] flex flex-wrap items-center gap-x-2 gap-y-0.5 border-l-2 border-slate-200 py-1 pl-[15px] text-[10px]">
                {gap != null ? (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-px font-semibold tabular-nums',
                      early ? TONES.warning.chip + ' border' : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200',
                    )}
                  >
                    {formatMinutes(gap)}
                  </span>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
                {early && <span className={TONES.warning.strong}>lebih awal dari {prev.label}</span>}
              </div>
            )}
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  'mt-[3px] h-[10px] w-[10px] shrink-0 rounded-full',
                  step.at ? TONES.success.dot : cn('border-2 bg-white', waitingOn ? TONES.warning.border : 'border-slate-200'),
                )}
              />
              <span className={cn('min-w-0 flex-1 text-xs font-medium', step.at ? 'text-slate-700' : 'text-slate-400')}>
                {step.label}
              </span>
              <span
                className={cn(
                  'shrink-0 text-[11px] tabular-nums',
                  step.at ? 'text-slate-500' : waitingOn ? cn('font-semibold', TONES.warning.strong) : 'text-slate-300',
                )}
              >
                {step.at ? formatStamp(step.at) : skipped ? 'belum ada' : 'menunggu'}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ItemCard({ item }: { item: ReportItem }) {
  const Icon = ICON[item.process];
  const tone = item.done ? TONES.success : TONES.warning;
  const note = DURATION_NOTE[item.process];
  return (
    <li className="rounded-xl border border-slate-100 bg-white px-3.5 py-3 shadow-[0_1px_0_rgba(15,23,42,0.02)]">
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone.soft)}>
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-sm font-bold text-slate-900">{item.toaNo}</span>
            <span className="text-[11px] tabular-nums text-slate-400">Qty {item.qty}</span>
          </div>
          <div className="mt-0.5"><Counterpart item={item} /></div>
          {/* Item Receiving is listed from the WS but timed from the photo, so say when it arrived. */}
          {item.process === 'receiving' && (
            <p className="mt-0.5 text-[11px] text-slate-400">WS diposting {formatStamp(item.anchorAt)}</p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold', tone.chip)}>
            {item.done ? 'Selesai' : 'Belum'}
          </span>
          {item.minutes != null ? (
            <>
              <p className={cn('mt-1.5 text-sm font-bold tabular-nums', tone.strong)}>{formatMinutes(item.minutes)}</p>
              <p className="text-[10px] text-slate-400">{item.done ? note.done : note.open}</p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-sm font-bold text-slate-300">—</p>
              <p className="text-[10px] text-slate-400">{item.done ? note.noneDone : note.noneOpen}</p>
            </>
          )}
        </div>
      </div>

      <Timeline steps={item.steps} />
    </li>
  );
}

/**
 * Everything below the header. Mounted per process + store + range (the `key` in
 * StoreSheet), so its tabs start fresh every time a different one opens.
 */
function SheetBody({ target }: { target: StoreSheetTarget }) {
  const api = useApi<TransferReportStoreResponse>(
    `/api/ops/item-transfers/report?process=${target.process}&startDate=${target.from}&endDate=${target.to}&storeId=${target.store.id}`,
  );
  const [status, setStatus] = useState<StatusTab>('all');

  // The freshly loaded numbers win over the list's copy (same data, just newer).
  const store = (api.data?.success ? api.data.store : null) ?? target.store;
  const items = useMemo(() => (api.data?.success ? api.data.items : []), [api.data]);
  const error = api.data && !api.data.success ? (api.data.error ?? 'Gagal memuat data.') : api.error?.message ?? null;

  const shown = useMemo(
    () => items.filter((i) => status === 'all' || (status === 'done') === i.done),
    [items, status],
  );
  const counts = useMemo(
    () => ({ all: items.length, open: items.filter((i) => !i.done).length, done: items.filter((i) => i.done).length }),
    [items],
  );

  const p = pct(store.done, store.total);
  const open = store.total - store.done;
  const avg = avgMinutes(store);
  const loading = !api.data && !error;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="space-y-4">
        {/* Summary */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {store.total === 0 ? (
            <p className="py-2 text-center text-sm text-slate-400">Tidak ada proses pada periode ini.</p>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <ProgressRing value={p} />
                <div className="grid min-w-0 flex-1 grid-cols-3 gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">Selesai</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                      {store.done}<span className="text-sm font-medium text-slate-400">/{store.total}</span>
                    </p>
                    <p className="truncate text-[10px] text-slate-400">{avg != null ? `rata-rata ${formatMinutes(avg)}` : ' '}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">Belum selesai</p>
                    <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', open > 0 ? TONES.warning.strong : TONES.success.strong)}>{open}</p>
                    <p className="truncate text-[10px] text-slate-400">
                      {open === 0 ? 'semua selesai' : store.notStarted > 0 ? `${store.notStarted} belum diterima fisik` : 'perlu ditindak'}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">Terlama</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                      {store.oldestOpenMinutes != null ? formatMinutes(store.oldestOpenMinutes) : <span className="text-slate-300">—</span>}
                    </p>
                    <p className="truncate text-[10px] text-slate-400">{store.oldestOpenMinutes != null ? 'menunggu' : ' '}</p>
                  </div>
                </div>
              </div>
              <RateBar rate={p} className="mt-4" />
            </>
          )}
        </div>

        {/* Filter */}
        {store.total > 0 && (
          <OpsChipTabs<StatusTab>
            value={status}
            onChange={setStatus}
            items={[
              { key: 'all', label: 'Semua', count: counts.all },
              { key: 'open', label: 'Belum selesai', count: counts.open, tone: 'amber' },
              { key: 'done', label: 'Selesai', count: counts.done, tone: 'emerald' },
            ]}
          />
        )}

        {/* The processes */}
        {error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div><p className="text-sm font-bold">Gagal memuat daftar TO</p><p className="mt-0.5 text-xs">{error}</p></div>
          </div>
        ) : loading ? (
          <div className="flex min-h-[160px] items-center justify-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat daftar TO…
          </div>
        ) : store.total > 0 && shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
            Tidak ada proses yang cocok dengan filter.
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((item) => <ItemCard key={`${item.rowId}-${item.process}`} item={item} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function StoreSheet({ target, onClose }: { target: StoreSheetTarget | null; onClose: () => void }) {
  return (
    <Sheet open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 bg-slate-50 p-0 sm:max-w-xl">
        <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 pr-12">
          <SheetTitle className="truncate text-base font-bold text-slate-900">{target?.store.name ?? 'Toko'}</SheetTitle>
          <SheetDescription className="truncate text-xs text-slate-500">
            {target && (
              <>
                <span className="font-semibold text-slate-700">{PROCESS_META[target.process].label}</span>
                {' · '}
                <span className="font-mono font-semibold text-slate-600">{target.store.storeNo}</span>
                {target.store.areaName && <> · {target.store.areaName}</>} · {target.label}
              </>
            )}
          </SheetDescription>
        </div>
        {target && <SheetBody key={`${target.process}|${target.store.id}|${target.from}|${target.to}`} target={target} />}
      </SheetContent>
    </Sheet>
  );
}
