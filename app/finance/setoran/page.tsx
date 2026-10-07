'use client';
// app/finance/setoran/page.tsx
//
// Finance · Setoran Review (daily)
//
// Laid out like the Petty Cash Report sheet: one row per store that opened on
// the chosen day — uang diterima, sisa kemarin, wajib disetor, disetor, sisa —
// with its evidence photos and Finance's verification. Click a row for the
// calculation, full-size photos and who did what.
//
//   • "All Stores"    — a single flat sheet.
//   • "By Store Code" — subtotal per store code, then the sheet grouped by code.
//
// Verify a store's setoran on its row, or tick several and verify them at once
// (only rows with complete photo evidence can be ticked). "Download Excel"
// exports the day (and the current code filter) as .xlsx.
//
// Status rules live in lib/setoran-review.ts; the remainder ("sisa") is normal
// daily rounding up to Rp 100.000 and only flagged "Kurang setor" above that.

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Camera,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Download,
  FileSpreadsheet,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SETORAN_SHORT_THRESHOLD,
  STATUS_META,
  STATUS_ORDER,
  deriveReviewStatus,
  evidenceSlots,
  fmtDateLong,
  fmtDateTime,
  groupRowsByCode,
  missingEvidence,
  sumDay,
  todayJakarta,
  type CodeGroup,
  type ReviewStatus,
  type SetoranStoreRow,
} from '@/lib/setoran-review';
import {
  SHEET_ROW_HEAD as ROW_HEAD,
  SHEET_TD as TD,
  SHEET_TH as TH,
  num,
  rp,
} from '@/components/finance/petty-cash/shared';
import {
  CodeChips,
  DayNavigator,
  GroupHeaderRow,
  KpiStrip,
  PhotoLightbox,
  SetoranTabs,
  StatusBadge,
  ViewToggle,
  downloadXlsx,
  type LightboxPhoto,
} from '@/components/finance/setoran/shared';

type View = 'all' | 'code';

/** Column count of the sheet — group headers and totals span it. */
const COLS = 13;

interface Line {
  row: SetoranStoreRow;
  status: ReviewStatus;
}

/** Only rows whose photo evidence is complete can be ticked for bulk verify. */
const isSelectable = (r: SetoranStoreRow) => r.canVerify && missingEvidence(r).length === 0;

// ─── Cells ───────────────────────────────────────────────────────────────────

function Amount({ value, tone }: { value: number | null; tone?: 'teal' | 'amber' | 'bold' }) {
  if (value == null || value === 0) return <span className="tabular-nums text-slate-300">–</span>;
  return (
    <span
      className={cn(
        'tabular-nums',
        tone === 'teal' && 'text-teal-700',
        tone === 'amber' && 'font-semibold text-amber-700',
        tone === 'bold' && 'font-semibold text-slate-900',
        !tone && 'text-slate-900',
      )}
    >
      {num(value)}
    </span>
  );
}

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

function EvidenceThumbs({
  row,
  onOpen,
}: {
  row: SetoranStoreRow;
  onOpen: (photos: LightboxPhoto[], index: number) => void;
}) {
  const slots = evidenceSlots(row);
  if (slots.length === 0) return <span className="text-slate-300">–</span>;

  const present = slots.filter((s): s is typeof s & { url: string } => Boolean(s.url));
  const missing = row.status === 'completed';

  return (
    <div className="flex items-center gap-1">
      {slots.map((s) =>
        s.url ? (
          <button
            key={s.key}
            type="button"
            title={`Lihat ${s.label}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(present, present.findIndex((p) => p.key === s.key));
            }}
            className="h-7 w-7 shrink-0 overflow-hidden rounded border border-slate-300 bg-slate-100 transition hover:border-emerald-500"
          >
            <PhotoImg src={s.url} alt={s.label} />
          </button>
        ) : missing ? (
          <span
            key={s.key}
            title={`${s.label} belum ada`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-dashed border-amber-400 bg-amber-50"
          >
            <ImageOff className="h-3 w-3 text-amber-600" />
          </span>
        ) : null,
      )}
    </div>
  );
}

function VerifyCell({
  row,
  verifying,
  onVerify,
}: {
  row: SetoranStoreRow;
  verifying: boolean;
  onVerify: () => void;
}) {
  if (row.verifiedAt) {
    return (
      <span
        title={`${row.verifiedBy ?? 'Finance'} · ${fmtDateTime(row.verifiedAt) ?? ''}`}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        Terverifikasi
      </span>
    );
  }
  if (row.canVerify) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onVerify(); }}
        disabled={verifying}
        className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <CircleCheck className="h-3 w-3" />}
        Verifikasi
      </button>
    );
  }
  return <span className="text-slate-300">–</span>;
}

// ─── Detail panel ────────────────────────────────────────────────────────────

function CalcLine({
  op,
  label,
  value,
  tone,
  strong,
}: {
  op?: string;
  label: string;
  value: number | null;
  tone?: 'teal' | 'amber';
  strong?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline gap-2 py-1', strong && 'border-t border-slate-300 pt-1.5')}>
      <span className="w-3 text-center text-xs text-slate-400">{op}</span>
      <span className={cn('flex-1 text-xs text-slate-600', strong && 'font-semibold text-slate-800')}>{label}</span>
      <span
        className={cn(
          'text-[13px] tabular-nums',
          strong && 'font-bold',
          tone === 'teal' && 'text-teal-700',
          tone === 'amber' && 'text-amber-700',
        )}
      >
        {value == null ? '–' : rp(value)}
      </span>
    </div>
  );
}

function TrailLine({ label, who, at }: { label: string; who: string | null; at: string | null }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-xs">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-800">
        {who ? (
          <>
            <span className="font-medium">{who}</span>
            {at && <span className="text-slate-500"> · {fmtDateTime(at)}</span>}
          </>
        ) : (
          <span className="text-slate-300">–</span>
        )}
      </dd>
    </div>
  );
}

function DetailPanel({
  line,
  verifying,
  onVerify,
  onOpen,
}: {
  line: Line;
  verifying: boolean;
  onVerify: () => void;
  onOpen: (photos: LightboxPhoto[], index: number) => void;
}) {
  const { row, status } = line;
  const slots = evidenceSlots(row);
  const present = slots.filter((s): s is typeof s & { url: string } => Boolean(s.url));
  const gaps = missingEvidence(row);

  const unpaidTone = status === 'kurang' ? 'amber' : row.unpaid ? 'teal' : undefined;
  const unpaidHint =
    row.status !== 'completed' || !row.unpaid
      ? null
      : status === 'kurang'
        ? `Melebihi batas pembulatan Rp ${SETORAN_SHORT_THRESHOLD.toLocaleString('id-ID')} — perlu ditindaklanjuti.`
        : 'Pembulatan normal — dibawa ke setoran besok.';

  return (
    <div className="grid gap-px bg-slate-300 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Calculation */}
      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Perhitungan</h3>
        <CalcLine label="Uang diterima" value={row.received} />
        <CalcLine op="+" label="Sisa kemarin" value={row.carryIn || null} tone="teal" />
        <CalcLine op="=" label="Wajib disetor" value={row.required} strong />
        <CalcLine op="−" label="Disetor" value={row.stored} />
        <CalcLine op="=" label="Sisa (dibawa besok)" value={row.status === 'completed' ? row.unpaid : null} tone={unpaidTone} strong />
        {unpaidHint && (
          <p className={cn('mt-2 text-[11px]', status === 'kurang' ? 'text-amber-700' : 'text-teal-700')}>
            {unpaidHint}
          </p>
        )}
        {row.isNoSetoran && <p className="mt-2 text-[11px] text-slate-500">Toko melaporkan tidak ada setoran hari ini.</p>}
      </section>

      {/* Evidence */}
      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bukti foto</h3>
        {slots.length === 0 && row.status !== 'completed' ? (
          <p className="text-xs text-slate-500">Belum ada foto yang diupload.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {slots.map((s) => (
              <figure key={s.key} className="w-28">
                {s.url ? (
                  <button
                    type="button"
                    onClick={() => onOpen(present, present.findIndex((p) => p.key === s.key))}
                    className="group relative block h-28 w-28 overflow-hidden rounded-md border border-slate-300 bg-slate-100 hover:border-emerald-500"
                  >
                    <PhotoImg src={s.url} alt={s.label} />
                  </button>
                ) : (
                  <div className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-amber-400 bg-amber-50 text-amber-700">
                    <Camera className="h-5 w-5" />
                    <span className="text-[11px] font-semibold">Belum ada</span>
                  </div>
                )}
                <figcaption className="mt-1 text-[11px] leading-tight text-slate-600">{s.label}</figcaption>
              </figure>
            ))}
          </div>
        )}
        {gaps.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-700">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            Bukti belum lengkap: {gaps.join(', ')}.
          </p>
        )}
      </section>

      {/* Trail */}
      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Riwayat</h3>
        <dl className="divide-y divide-slate-100">
          <div className="flex justify-between gap-3 py-1 text-xs">
            <dt className="text-slate-500">Jadwal buka</dt>
            <dd className="text-right font-medium text-slate-800">
              {row.scheduledStaff.length > 0 ? row.scheduledStaff.map((s) => s.name).join(', ') : <span className="font-normal text-slate-300">–</span>}
            </dd>
          </div>
          <TrailLine label="Uang diterima" who={row.receivedBy} at={row.receivedAt} />
          <TrailLine label="Disetor" who={row.storedBy} at={row.storedAt} />
          <TrailLine label="Disubmit" who={row.submittedBy} at={row.submittedAt} />
          <TrailLine label="Diverifikasi" who={row.verifiedAt ? row.verifiedBy ?? 'Finance' : null} at={row.verifiedAt} />
          {row.correction && (
            <TrailLine
              label={row.correction.kind === 'create' ? 'Ditambahkan IT' : 'Dikoreksi IT'}
              who={row.correction.by}
              at={row.correction.at}
            />
          )}
        </dl>

        {row.correction && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="font-semibold">
              {row.correction.kind === 'create' ? 'Setoran diisi IT (tanpa foto bukti): ' : 'Nominal dikoreksi: '}
            </span>
            {row.correction.reason}
          </div>
        )}

        {row.notes && (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <span className="font-semibold text-slate-800">Catatan: </span>
            {row.notes}
          </div>
        )}

        {row.canVerify && (
          <button
            type="button"
            onClick={onVerify}
            disabled={verifying}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleCheck className="h-3.5 w-3.5" />}
            Verifikasi setoran ini
          </button>
        )}
      </section>
    </div>
  );
}

// ─── Sheet rows ──────────────────────────────────────────────────────────────

function StoreLine({
  line,
  index,
  expanded,
  selected,
  verifying,
  onToggle,
  onSelect,
  onVerify,
  onOpen,
}: {
  line: Line;
  index: number;
  expanded: boolean;
  selected: boolean;
  verifying: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onVerify: () => void;
  onOpen: (photos: LightboxPhoto[], index: number) => void;
}) {
  const { row, status } = line;
  const selectable = isSelectable(row);
  const tint =
    selected ? 'bg-emerald-50'
    : status === 'belum_setor' || status === 'pending' ? 'bg-rose-50/60 hover:bg-rose-50'
    : status === 'kurang' ? 'bg-amber-50/50 hover:bg-amber-50'
    : 'bg-white hover:bg-emerald-50/40';

  return (
    <>
      <tr onClick={onToggle} className={cn('cursor-pointer text-[13px]', tint)}>
        <td className={cn(TD, 'w-9 text-center')} onClick={(e) => e.stopPropagation()}>
          {row.canVerify && (
            <input
              type="checkbox"
              checked={selected}
              disabled={!selectable}
              onChange={onSelect}
              title={selectable ? 'Pilih untuk verifikasi massal' : 'Bukti foto belum lengkap — verifikasi manual'}
              aria-label={`Pilih ${row.storeName}`}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600 disabled:opacity-40"
            />
          )}
        </td>
        <td className={cn(ROW_HEAD, 'w-11')}>{index}</td>
        <td className={cn(TD, 'w-24 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>{row.storeNo}</td>
        <td className={cn(TD, 'min-w-48')}>
          <p className="font-medium text-slate-900">{row.storeName}</p>
          <p className="text-[11px] text-slate-500">
            {row.areaName}
            {row.scheduledStaff.length > 0 && ` · ${row.scheduledStaff.map((s) => s.name).join(', ')}`}
          </p>
        </td>
        <td className={cn(TD, 'w-[104px] text-right')}><Amount value={row.received} /></td>
        <td className={cn(TD, 'w-[104px] text-right')}><Amount value={row.carryIn} tone="teal" /></td>
        <td className={cn(TD, 'w-[104px] text-right')}><Amount value={row.required} /></td>
        <td className={cn(TD, 'w-[104px] text-right')}><Amount value={row.stored} tone="bold" /></td>
        <td className={cn(TD, 'w-[104px] text-right')}>
          <Amount
            value={row.status === 'completed' ? row.unpaid : null}
            tone={status === 'kurang' ? 'amber' : 'teal'}
          />
        </td>
        <td className={cn(TD, 'w-28')}><StatusBadge status={status} /></td>
        <td className={cn(TD, 'w-20')}><EvidenceThumbs row={row} onOpen={onOpen} /></td>
        <td className={cn(TD, 'w-32 whitespace-nowrap')}>
          <VerifyCell row={row} verifying={verifying} onVerify={onVerify} />
        </td>
        <td className={cn(TD, 'w-9 text-center text-slate-400')}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? 'Tutup detail' : 'Buka detail'}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100 hover:text-slate-700"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={COLS} className="border-b border-slate-300 bg-slate-100 p-0">
            {/* The sheet scrolls sideways — pin the panel to the visible width so it never hides off-screen. */}
            <div className="sticky left-0 w-[100cqw]">
              <DetailPanel line={line} verifying={verifying} onVerify={onVerify} onOpen={onOpen} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TotalLine({ label, rows, tone }: { label: string; rows: SetoranStoreRow[]; tone: 'sub' | 'grand' }) {
  const t = sumDay(rows);
  // Row borders don't render in a border-separate table, so the rule above the
  // total goes on its cells.
  const cls = tone === 'grand'
    ? 'bg-emerald-50 text-slate-900 [&>td]:border-t-2 [&>td]:border-t-slate-400'
    : 'bg-slate-50 text-slate-700 [&>td]:border-t [&>td]:border-t-slate-300';
  const money = cn(TD, 'border-slate-300 text-right tabular-nums');

  return (
    <tr className={cn('text-[13px] font-semibold', cls)}>
      <td colSpan={4} className={cn(TD, 'border-slate-300 text-right text-xs uppercase tracking-wide')}>{label}</td>
      <td className={money}>{num(t.received)}</td>
      <td className={money}>{num(t.carryIn)}</td>
      <td className={money}>{num(t.required)}</td>
      <td className={money}>{num(t.stored)}</td>
      <td className={money}>{num(t.unpaid)}</td>
      <td colSpan={4} className={cn(TD, 'border-slate-300')} />
    </tr>
  );
}

// ─── Store-code summary ──────────────────────────────────────────────────────

function CodeSummary({
  groups,
  statusOf,
  activeCode,
  onPick,
}: {
  groups: CodeGroup<SetoranStoreRow>[];
  statusOf: (r: SetoranStoreRow) => ReviewStatus;
  activeCode: string | null;
  onPick: (code: string | null) => void;
}) {
  const all = groups.flatMap((g) => g.rows);
  const total = sumDay(all);
  const attention = (rows: SetoranStoreRow[]) => rows.filter((r) => STATUS_META[statusOf(r)].attention).length;

  return (
    <div className="overflow-x-auto rounded-md border border-slate-300 bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {['Code', 'Brand', 'Stores', 'Diterima (Rp)', 'Disetor (Rp)', 'Sisa (Rp)', 'Perlu Perhatian'].map((h, i) => (
              <th
                key={h}
                className={cn(
                  'border border-slate-300 bg-slate-100 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600',
                  i >= 2 ? 'text-right' : 'text-left',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const t = sumDay(g.rows);
            const n = attention(g.rows);
            return (
              <tr
                key={g.code}
                onClick={() => onPick(activeCode === g.code ? null : g.code)}
                className={cn('cursor-pointer', activeCode === g.code ? 'bg-emerald-50' : 'bg-white hover:bg-slate-50')}
              >
                <td className={cn(TD, 'font-mono text-xs font-bold text-emerald-700')}>{g.display}</td>
                <td className={cn(TD, 'text-slate-700')}>{g.brand ?? <span className="text-slate-300">–</span>}</td>
                <td className={cn(TD, 'text-right tabular-nums')}>{g.rows.length}</td>
                <td className={cn(TD, 'text-right')}><Amount value={t.received} /></td>
                <td className={cn(TD, 'text-right')}><Amount value={t.stored} /></td>
                <td className={cn(TD, 'text-right')}><Amount value={t.unpaid} tone="teal" /></td>
                <td className={cn(TD, 'text-right tabular-nums', n > 0 ? 'bg-amber-50 font-semibold text-amber-800' : 'text-slate-300')}>
                  {n > 0 ? n : '–'}
                </td>
              </tr>
            );
          })}
          <tr className="border-y-2 border-slate-400 bg-emerald-50 font-semibold text-slate-900">
            <td className={TD} />
            <td className={cn(TD, 'text-right text-xs uppercase tracking-wide')}>Total</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{all.length}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{num(total.received)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{num(total.stored)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{num(total.unpaid)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{attention(all)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FinanceSetoranPage() {
  const [date, setDate] = useState(todayJakarta);
  const [rows, setRows] = useState<SetoranStoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [view, setView] = useState<View>('all');
  const [code, setCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | ''>('');
  const [onlyUnverified, setOnlyUnverified] = useState(false);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [verifying, setVerifying] = useState<Set<number>>(new Set());
  const [lightbox, setLightbox] = useState<{ title: string; photos: LightboxPhoto[]; index: number } | null>(null);

  const [downloading, setDownloading] = useState(false);

  const today = todayJakarta();
  const isPast = date < today;

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);

    fetch(`/api/finance/setoran?date=${date}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (stale) return;
        if (body.success) {
          const data: SetoranStoreRow[] = body.data;
          setRows(data);
          // Keep ticks only for rows that are still verifiable after a reload.
          const ok = new Set(data.filter(isSelectable).map((r) => r.taskId));
          setSelected((prev) => new Set([...prev].filter((id) => ok.has(id))));
        } else {
          setError(body.error ?? 'Gagal memuat data.');
        }
      })
      .catch(() => { if (!stale) setError('Network error.'); })
      .finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
  }, [date, reloadKey]);

  function changeDate(next: string) {
    setDate(next);
    setExpanded(new Set());
    setSelected(new Set());
    setConfirmBulk(false);
  }

  const lines: Line[] = useMemo(
    () => rows.map((row) => ({ row, status: deriveReviewStatus(row, isPast) })),
    [rows, isPast],
  );
  const statusOf = useMemo(() => {
    const map = new Map(lines.map((l) => [l.row.storeId, l.status]));
    return (r: SetoranStoreRow) => map.get(r.storeId) ?? 'belum_mulai';
  }, [lines]);

  // Chips + counts come from every store, so they don't shrink as you search.
  const allGroups = useMemo(() => groupRowsByCode(rows), [rows]);
  const statusCounts = useMemo(() => {
    const counts = new Map<ReviewStatus, number>();
    for (const l of lines) counts.set(l.status, (counts.get(l.status) ?? 0) + 1);
    return counts;
  }, [lines]);

  // Search / status / verification filters run before the code filter — the
  // by-code summary still lists every code so you can switch between them.
  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter(({ row, status }) => {
      if (statusFilter && status !== statusFilter) return false;
      if (onlyUnverified && !row.canVerify) return false;
      if (!q) return true;
      return [row.storeNo, row.storeName, row.areaName, row.submittedBy, ...row.scheduledStaff.map((s) => s.name)]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [lines, statusFilter, onlyUnverified, search]);

  const summaryGroups = useMemo(() => groupRowsByCode(matching.map((l) => l.row)), [matching]);
  const visible = useMemo(() => (code ? matching.filter((l) => l.row.code === code) : matching), [matching, code]);
  const visibleRows = useMemo(() => visible.map((l) => l.row), [visible]);
  const lineByStore = useMemo(() => new Map(lines.map((l) => [l.row.storeId, l])), [lines]);
  const visibleGroups = useMemo(() => groupRowsByCode(visibleRows), [visibleRows]);

  const totals = sumDay(visibleRows);
  const submitted = visibleRows.filter((r) => r.status === 'completed').length;
  const attention = visible.filter((l) => STATUS_META[l.status].attention).length;
  const unverified = visibleRows.filter((r) => r.canVerify).length;
  const verified = visibleRows.filter((r) => r.verifiedAt).length;

  const selectableIds = visibleRows.filter(isSelectable).map((r) => r.taskId as number);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const selectedTotal = visibleRows
    .filter((r) => r.taskId != null && selected.has(r.taskId))
    .reduce((s, r) => s + (r.stored ?? 0), 0);

  const filtered = Boolean(code || search || statusFilter || onlyUnverified);

  // ── Actions ──

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const toggleSelected = (taskId: number) => {
    setConfirmBulk(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(taskId)) next.add(taskId);
      return next;
    });
  };

  const toggleAll = () => {
    setConfirmBulk(false);
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  };

  async function verifyOne(row: SetoranStoreRow) {
    if (row.taskId == null) return;
    const id = row.taskId;
    setVerifying((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/finance/setoran/${id}/verify`, { method: 'POST' });
      const body = await res.json();
      if (body.success) toast.success(`Setoran ${row.storeName} diverifikasi.`);
      else toast.error(body.error ?? 'Verifikasi gagal.');
      setReloadKey((k) => k + 1);
    } catch {
      toast.error('Network error.');
    } finally {
      setVerifying((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  async function verifySelected() {
    const taskIds = [...selected];
    if (taskIds.length === 0) return;
    setVerifying(new Set(taskIds));
    try {
      const res = await fetch('/api/finance/setoran/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds }),
      });
      const body = await res.json();
      if (body.success) {
        toast.success(
          `${body.verified} setoran diverifikasi${body.skipped ? ` · ${body.skipped} dilewati (sudah diverifikasi)` : ''}.`,
        );
        setSelected(new Set());
      } else {
        toast.error(body.error ?? 'Verifikasi gagal.');
      }
      setReloadKey((k) => k + 1);
    } catch {
      toast.error('Network error.');
    } finally {
      setVerifying(new Set());
      setConfirmBulk(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const qs = new URLSearchParams({ date });
      if (code) qs.set('code', code);
      if (onlyUnverified) qs.set('unverified', '1');
      await downloadXlsx(`/api/finance/setoran/export?${qs}`, `setoran-harian_${date}.xlsx`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download gagal.');
    } finally {
      setDownloading(false);
    }
  }

  const openPhotos = (row: SetoranStoreRow) => (photos: LightboxPhoto[], index: number) =>
    setLightbox({ title: `${row.storeNo} · ${row.storeName}`, photos, index });

  const renderLine = (l: Line, index: number) => (
    <StoreLine
      key={l.row.storeId}
      line={l}
      index={index}
      expanded={expanded.has(l.row.storeId)}
      selected={l.row.taskId != null && selected.has(l.row.taskId)}
      verifying={l.row.taskId != null && verifying.has(l.row.taskId)}
      onToggle={() => toggleExpanded(l.row.storeId)}
      onSelect={() => l.row.taskId != null && toggleSelected(l.row.taskId)}
      onVerify={() => void verifyOne(l.row)}
      onOpen={openPhotos(l.row)}
    />
  );

  return (
    <div className="min-h-full bg-slate-50">
      {lightbox && (
        <PhotoLightbox
          title={lightbox.title}
          photos={lightbox.photos}
          index={lightbox.index}
          onIndex={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1400px] px-6 pt-4 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Setoran
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Setoran Review</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <DayNavigator date={date} onChange={changeDate} />

              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                disabled={loading}
                className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                Refresh
              </button>

              <button
                type="button"
                onClick={handleDownload}
                disabled={loading || downloading || rows.length === 0}
                className="flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Download Excel{code ? ` (${allGroups.find((g) => g.code === code)?.display ?? code})` : ''}
              </button>
            </div>
          </div>

          <div className="mt-3">
            <SetoranTabs />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers */}
        {!loading && !error && (
          <KpiStrip
            items={[
              { label: 'Uang diterima', value: rp(totals.received), sub: `${visibleRows.length} toko buka` },
              { label: 'Disetor', value: rp(totals.stored), sub: `${submitted} dari ${visibleRows.length} sudah submit` },
              { label: 'Sisa belum disetor', value: rp(totals.unpaid), sub: 'dibawa ke hari berikutnya' },
              { label: 'Perlu perhatian', value: String(attention), sub: 'belum setor / pending / kurang', warn: attention > 0 },
              { label: 'Belum diverifikasi', value: String(unverified), sub: `${verified} sudah diverifikasi`, warn: unverified > 0 },
            ]}
          />
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <ViewToggle value={view} onChange={setView} />
          <CodeChips groups={allGroups} total={rows.length} active={code} onPick={setCode} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search store, area, staff…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ReviewStatus | '')}
            aria-label="Filter status"
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">Semua status</option>
            {STATUS_ORDER.filter((s) => statusCounts.has(s)).map((s) => (
              <option key={s} value={s}>{STATUS_META[s].label} ({statusCounts.get(s)})</option>
            ))}
          </select>

          <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={onlyUnverified}
              onChange={(e) => setOnlyUnverified(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600"
            />
            Only not yet verified
          </label>

          {filtered && (
            <button
              type="button"
              onClick={() => { setCode(null); setSearch(''); setStatusFilter(''); setOnlyUnverified(false); }}
              className="text-xs font-semibold text-slate-500 underline hover:text-slate-700"
            >
              Clear
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {/* Bulk verify bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm">
            <CheckCheck className="h-4 w-4 text-emerald-700" />
            <span className="font-semibold text-emerald-900">
              {selected.size} setoran dipilih
              <span className="ml-2 font-normal text-emerald-800">· disetor {rp(selectedTotal)}</span>
            </span>
            <div className="ml-auto flex items-center gap-2">
              {confirmBulk ? (
                <>
                  <span className="text-xs font-medium text-emerald-900">Yakin verifikasi {selected.size} setoran?</span>
                  <button
                    type="button"
                    onClick={() => void verifySelected()}
                    disabled={verifying.size > 0}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {verifying.size > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Ya, verifikasi
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulk(false)}
                    className="h-8 rounded-md border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                  >
                    Batal
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="text-xs font-semibold text-emerald-800 underline"
                  >
                    Batal pilih
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulk(true)}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Verifikasi {selected.size}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Sheet */}
        {loading ? (
          <div className="overflow-hidden rounded-md border border-slate-300 bg-white">
            <div className="h-9 animate-pulse bg-slate-100" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse border-t border-slate-100 bg-white even:bg-slate-50/60" />
            ))}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white py-16 text-center">
            <FileSpreadsheet className="mx-auto mb-3 h-9 w-9 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">
              {filtered ? 'No stores match your filter.' : `Tidak ada toko dengan jadwal shift pembuka pada ${fmtDateLong(date)}.`}
            </p>
          </div>
        ) : (
          <>
            {view === 'code' && (
              <CodeSummary groups={summaryGroups} statusOf={statusOf} activeCode={code} onPick={setCode} />
            )}

            <div className="@container max-h-[68vh] overflow-auto [scrollbar-gutter:stable] rounded-md border border-slate-300 bg-white">
              <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-9 text-center')}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        disabled={selectableIds.length === 0}
                        onChange={toggleAll}
                        title="Pilih semua yang siap diverifikasi (bukti lengkap)"
                        aria-label="Pilih semua yang siap diverifikasi"
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600 disabled:opacity-40"
                      />
                    </th>
                    <th className={cn(TH, 'w-11 text-center')}>No</th>
                    <th className={cn(TH, 'text-left')}>Kode</th>
                    <th className={cn(TH, 'text-left')}>Nama Toko</th>
                    <th className={cn(TH, 'text-right')}>Diterima (Rp)</th>
                    <th className={cn(TH, 'text-right')}>Sisa Kemarin (Rp)</th>
                    <th className={cn(TH, 'text-right')}>Wajib Disetor (Rp)</th>
                    <th className={cn(TH, 'text-right')}>Disetor (Rp)</th>
                    <th className={cn(TH, 'text-right')}>Sisa (Rp)</th>
                    <th className={cn(TH, 'text-left')}>Status</th>
                    <th className={cn(TH, 'text-left')}>Bukti</th>
                    <th className={cn(TH, 'text-left')}>Verifikasi</th>
                    <th className={cn(TH, 'w-9')} />
                  </tr>
                </thead>

                <tbody>
                  {view === 'all'
                    ? visible.map((l, i) => renderLine(l, i + 1))
                    : visibleGroups.map((g) => (
                        <GroupBlock
                          key={g.code}
                          group={g}
                          lineByStore={lineByStore}
                          renderLine={renderLine}
                        />
                      ))}
                  <TotalLine label="Total" rows={visibleRows} tone="grand" />
                </tbody>
              </table>
            </div>

            <div className="space-y-1 text-[11px] text-slate-500">
              <p>
                Menampilkan toko yang punya jadwal shift pembuka pada {fmtDateLong(date)}. Sisa = wajib disetor − disetor,
                dibawa ke setoran berikutnya. Sisa sampai Rp {SETORAN_SHORT_THRESHOLD.toLocaleString('id-ID')} dianggap
                pembulatan normal; di atas itu ditandai <span className="font-semibold text-amber-700">Kurang setor</span>.
              </p>
              <p>
                {isPast ? 'Toko yang belum submit pada hari yang sudah lewat' : 'Toko yang belum submit hari ini'} ditandai{' '}
                <span className="font-semibold text-rose-700">Belum setor</span>
                {isPast ? '.' : ' setelah hari berganti.'} Kotak centang hanya aktif untuk setoran dengan bukti foto lengkap;
                yang bukti fotonya kurang diverifikasi satu per satu.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GroupBlock({
  group,
  lineByStore,
  renderLine,
}: {
  group: CodeGroup<SetoranStoreRow>;
  lineByStore: Map<number, Line>;
  renderLine: (l: Line, index: number) => React.ReactNode;
}) {
  return (
    <>
      <GroupHeaderRow colSpan={COLS} group={group} />
      {group.rows.map((row, i) => renderLine(lineByStore.get(row.storeId)!, i + 1))}
      <TotalLine label={`Subtotal ${group.display}`} rows={group.rows} tone="sub" />
    </>
  );
}
