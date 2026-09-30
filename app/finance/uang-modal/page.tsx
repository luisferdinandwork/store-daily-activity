'use client';
// app/finance/uang-modal/page.tsx
//
// Finance · Uang Modal Review (daily)
//
// Uang modal is the cashier's opening float, capped at Rp 500.000 a day. So
// unlike a deposit there is nothing to reconcile — the review is about HOW FULL
// each store's float is: the cash counted, what is missing from the cap, and
// the denominations behind it.
//
// Same sheet layout as Petty Cash / Setoran: one row per store that opened on
// the chosen day, "All Stores" or "By Store Code" (subtotals), click a row for
// the denomination breakdown and audit trail.
//
//   • Penuh        — float is at the cap
//   • Belum penuh  — counted, but below the cap (the shortfall is shown)
//   • Kosong       — reported with nothing counted
//   • Belum lapor  — the day is over and the store never reported
//
// Verify a store's count on its row, or tick several and verify them together —
// only floats that are FULL can be ticked; a short or empty one is reviewed and
// verified one at a time.

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  STATUS_META,
  STATUS_ORDER,
  UANG_MODAL_DENOMINATIONS,
  deriveReviewStatus,
  fillPct,
  fmtDateLong,
  fmtDateTime,
  groupRowsByCode,
  shortfallOf,
  sumDay,
  todayJakarta,
  type CodeGroup,
  type ReviewStatus,
  type UangModalRow,
} from '@/lib/uang-modal-review';
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
  ViewToggle,
  downloadXlsx,
} from '@/components/finance/shared/sheet-kit';
import { UangModalTabs } from '@/components/finance/uang-modal/shared';

type View = 'all' | 'code';

/** Column count of the sheet — group headers and totals span it. */
const COLS = 11;

interface Line {
  row: UangModalRow;
  status: ReviewStatus;
}

/** Only a FULL, unverified float can be ticked for bulk verify. */
const isSelectable = (r: UangModalRow) => r.canVerify && (r.total ?? 0) >= r.max;

// ─── Cells ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ReviewStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        meta.badge,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

function FillBar({ pct, status }: { pct: number | null; status: ReviewStatus }) {
  if (pct == null) return <span className="text-slate-300">–</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <span
          className={cn(
            'block h-full rounded-full',
            status === 'penuh' ? 'bg-emerald-500' : status === 'kosong' ? 'bg-rose-400' : 'bg-amber-400',
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-9 text-right text-xs tabular-nums text-slate-600">{pct}%</span>
    </span>
  );
}

function Amount({ value, tone }: { value: number | null; tone?: 'amber' | 'bold' }) {
  if (value == null || value === 0) return <span className="tabular-nums text-slate-300">–</span>;
  return (
    <span
      className={cn(
        'tabular-nums',
        tone === 'amber' ? 'font-semibold text-amber-700' : tone === 'bold' ? 'font-semibold text-slate-900' : 'text-slate-900',
      )}
    >
      {num(value)}
    </span>
  );
}

function VerifyCell({ row, verifying, onVerify }: { row: UangModalRow; verifying: boolean; onVerify: () => void }) {
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

function TrailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-xs">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-800">{children}</dd>
    </div>
  );
}

function DetailPanel({
  line,
  verifying,
  onVerify,
}: {
  line: Line;
  verifying: boolean;
  onVerify: () => void;
}) {
  const { row, status } = line;
  const submitted = row.status === 'completed';
  const short = shortfallOf(row);
  const byValue = new Map(row.denominations.map((d) => [d.value, d]));

  return (
    <div className="grid gap-px bg-slate-300 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
      {/* Denominations */}
      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rincian pecahan</h3>
        {submitted ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                <th className="pb-1 text-left font-semibold">Pecahan</th>
                <th className="pb-1 text-right font-semibold">Lembar / keping</th>
                <th className="pb-1 text-right font-semibold">Jumlah (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {UANG_MODAL_DENOMINATIONS.map((value) => {
                const d = byValue.get(value);
                return (
                  <tr key={value} className={cn('border-t border-slate-100', !d && 'text-slate-300')}>
                    <td className="py-1 tabular-nums">{value.toLocaleString('id-ID')}</td>
                    <td className="py-1 text-right tabular-nums">{d ? `× ${d.quantity}` : '–'}</td>
                    <td className="py-1 text-right tabular-nums font-medium">{d ? num(d.amount) : '–'}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-slate-400 font-semibold text-slate-900">
                <td className="py-1.5 text-xs uppercase tracking-wide" colSpan={2}>Total terhitung</td>
                <td className="py-1.5 text-right tabular-nums">{num(row.total ?? 0)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-slate-500">Belum ada pecahan yang disubmit.</p>
        )}
      </section>

      {/* Fill */}
      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Isi modal</h3>
        <dl className="divide-y divide-slate-100">
          <TrailLine label="Terhitung"><span className="font-semibold tabular-nums">{submitted ? rp(row.total ?? 0) : '–'}</span></TrailLine>
          <TrailLine label="Batas harian"><span className="tabular-nums">{rp(row.max)}</span></TrailLine>
          <TrailLine label="Kurang dari batas">
            <span className={cn('font-semibold tabular-nums', short > 0 ? 'text-amber-700' : 'text-slate-400')}>
              {submitted ? rp(short) : '–'}
            </span>
          </TrailLine>
        </dl>
        <div className="mt-3">
          <FillBar pct={fillPct(row)} status={status} />
        </div>
        <p
          className={cn(
            'mt-3 text-[11px]',
            status === 'penuh' ? 'text-emerald-700' : status === 'kurang' ? 'text-amber-700' : status === 'kosong' || status === 'belum_lapor' ? 'text-rose-700' : 'text-slate-500',
          )}
        >
          {status === 'penuh' && 'Modal kasir sudah penuh sesuai batas harian.'}
          {status === 'kurang' && `Modal kasir belum penuh — kurang ${rp(short)} dari batas ${rp(row.max)}.`}
          {status === 'kosong' && 'Toko melapor tetapi tidak ada uang yang dihitung.'}
          {status === 'belum_lapor' && 'Hari sudah lewat dan toko belum melaporkan uang modal.'}
          {status === 'draft' && 'Toko sedang menghitung uang modal hari ini.'}
          {status === 'belum_mulai' && 'Toko belum memulai hitung uang modal.'}
        </p>
      </section>

      {/* Trail */}
      <section className="bg-white p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Riwayat</h3>
        <dl className="divide-y divide-slate-100">
          <TrailLine label="Jadwal buka">
            {row.scheduledStaff.length > 0 ? row.scheduledStaff.map((s) => s.name).join(', ') : <span className="text-slate-300">–</span>}
          </TrailLine>
          <TrailLine label="Disubmit">
            {row.submittedBy && submitted ? (
              <>
                <span className="font-medium">{row.submittedBy}</span>
                {row.completedAt && <span className="text-slate-500"> · {fmtDateTime(row.completedAt)}</span>}
              </>
            ) : (
              <span className="text-slate-300">–</span>
            )}
          </TrailLine>
          <TrailLine label="Diverifikasi">
            {row.verifiedAt ? (
              <>
                <span className="font-medium">{row.verifiedBy ?? 'Finance'}</span>
                <span className="text-slate-500"> · {fmtDateTime(row.verifiedAt)}</span>
              </>
            ) : (
              <span className="text-slate-300">–</span>
            )}
          </TrailLine>
        </dl>

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
            Verifikasi hitungan ini
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
}: {
  line: Line;
  index: number;
  expanded: boolean;
  selected: boolean;
  verifying: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onVerify: () => void;
}) {
  const { row, status } = line;
  const submitted = row.status === 'completed';
  const selectable = isSelectable(row);
  const tint =
    selected ? 'bg-emerald-50'
    : status === 'belum_lapor' || status === 'kosong' ? 'bg-rose-50/60 hover:bg-rose-50'
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
              title={selectable ? 'Pilih untuk verifikasi massal' : 'Modal belum penuh — verifikasi manual satu per satu'}
              aria-label={`Pilih ${row.storeName}`}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600 disabled:opacity-40"
            />
          )}
        </td>
        <td className={cn(ROW_HEAD, 'w-11')}>{index}</td>
        <td className={cn(TD, 'w-20 whitespace-nowrap font-mono text-xs font-semibold text-slate-600')}>{row.storeNo}</td>
        <td className={cn(TD, 'min-w-48')}>
          <p className="font-medium text-slate-900">{row.storeName}</p>
          <p className="text-[11px] text-slate-500">
            {row.areaName}
            {row.scheduledStaff.length > 0 && ` · ${row.scheduledStaff.map((s) => s.name).join(', ')}`}
          </p>
        </td>
        <td className={cn(TD, 'w-[112px] text-right')}><Amount value={submitted ? row.total : null} tone="bold" /></td>
        <td className={cn(TD, 'w-[104px] text-right')}>
          <Amount value={submitted ? shortfallOf(row) : null} tone="amber" />
        </td>
        <td className={cn(TD, 'w-36')}><FillBar pct={fillPct(row)} status={status} /></td>
        <td className={cn(TD, 'w-32')}><StatusBadge status={status} /></td>
        <td className={cn(TD, 'w-32 whitespace-nowrap')}>
          {submitted && row.denominations.length > 0 ? (
            <span className="text-xs text-slate-600">{row.denominations.length} jenis pecahan</span>
          ) : (
            <span className="text-slate-300">–</span>
          )}
        </td>
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
            {/* The sheet may scroll sideways — pin the panel to the visible width. */}
            <div className="sticky left-0 w-[100cqw]">
              <DetailPanel line={line} verifying={verifying} onVerify={onVerify} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TotalLine({ label, rows, tone }: { label: string; rows: UangModalRow[]; tone: 'sub' | 'grand' }) {
  const t = sumDay(rows);
  // Row borders don't render in a border-separate table, so the rule above the
  // total goes on its cells.
  const cls = tone === 'grand'
    ? 'bg-emerald-50 text-slate-900 [&>td]:border-t-2 [&>td]:border-t-slate-400'
    : 'bg-slate-50 text-slate-700 [&>td]:border-t [&>td]:border-t-slate-300';
  const money = cn(TD, 'border-slate-300 text-right tabular-nums');
  const pct = t.max > 0 ? Math.round((t.total / t.max) * 100) : null;

  return (
    <tr className={cn('text-[13px] font-semibold', cls)}>
      <td colSpan={4} className={cn(TD, 'border-slate-300 text-right text-xs uppercase tracking-wide')}>{label}</td>
      <td className={money}>{num(t.total)}</td>
      <td className={money}>{num(t.shortfall)}</td>
      <td className={cn(TD, 'border-slate-300 text-xs font-medium text-slate-600')}>{pct == null ? '' : `${pct}% terisi`}</td>
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
  groups: CodeGroup<UangModalRow>[];
  statusOf: (r: UangModalRow) => ReviewStatus;
  activeCode: string | null;
  onPick: (code: string | null) => void;
}) {
  const all = groups.flatMap((g) => g.rows);
  const total = sumDay(all);
  const attention = (rows: UangModalRow[]) => rows.filter((r) => STATUS_META[statusOf(r)].attention).length;
  const pctOf = (t: ReturnType<typeof sumDay>) => (t.max > 0 ? `${Math.round((t.total / t.max) * 100)}%` : '–');

  return (
    <div className="overflow-x-auto rounded-md border border-slate-300 bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {['Code', 'Brand', 'Stores', 'Terhitung (Rp)', 'Kurang (Rp)', 'Terisi', 'Perlu Perhatian'].map((h, i) => (
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
                <td className={cn(TD, 'text-right')}><Amount value={t.total} /></td>
                <td className={cn(TD, 'text-right')}><Amount value={t.shortfall} tone="amber" /></td>
                <td className={cn(TD, 'text-right tabular-nums text-slate-700')}>{pctOf(t)}</td>
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
            <td className={cn(TD, 'text-right tabular-nums')}>{num(total.total)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{num(total.shortfall)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{pctOf(total)}</td>
            <td className={cn(TD, 'text-right tabular-nums')}>{attention(all)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FinanceUangModalPage() {
  const [date, setDate] = useState(todayJakarta);
  const [rows, setRows] = useState<UangModalRow[]>([]);
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

  const [downloading, setDownloading] = useState(false);

  const today = todayJakarta();
  const isPast = date < today;

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);

    fetch(`/api/finance/uang-modal?date=${date}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (stale) return;
        if (body.success) {
          const data: UangModalRow[] = body.data;
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
  const lineByStore = useMemo(() => new Map(lines.map((l) => [l.row.storeId, l])), [lines]);
  const statusOf = (r: UangModalRow) => lineByStore.get(r.storeId)?.status ?? 'belum_mulai';

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
  const visibleGroups = useMemo(() => groupRowsByCode(visibleRows), [visibleRows]);

  const totals = sumDay(visibleRows);
  const fillOfCap = totals.max > 0 ? Math.round((totals.total / totals.max) * 100) : null;
  const notFull = visible.filter((l) => l.status === 'kurang' || l.status === 'kosong').length;
  const missing = visible.filter((l) => l.status === 'belum_lapor').length;
  const unverified = visibleRows.filter((r) => r.canVerify).length;
  const verified = visibleRows.filter((r) => r.verifiedAt).length;

  const selectableIds = visibleRows.filter(isSelectable).map((r) => r.taskId as number);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const selectedTotal = visibleRows
    .filter((r) => r.taskId != null && selected.has(r.taskId))
    .reduce((s, r) => s + (r.total ?? 0), 0);

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

  async function verify(taskIds: number[], label: string) {
    setVerifying((prev) => new Set([...prev, ...taskIds]));
    try {
      const res = await fetch('/api/finance/uang-modal/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds }),
      });
      const body = await res.json();
      if (body.success) {
        toast.success(
          `${label} diverifikasi${body.skipped ? ` · ${body.skipped} dilewati (sudah diverifikasi)` : ''}.`,
        );
        setSelected((prev) => new Set([...prev].filter((id) => !taskIds.includes(id))));
      } else {
        toast.error(body.error ?? 'Verifikasi gagal.');
      }
      setReloadKey((k) => k + 1);
    } catch {
      toast.error('Network error.');
    } finally {
      setVerifying((prev) => new Set([...prev].filter((id) => !taskIds.includes(id))));
      setConfirmBulk(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const qs = new URLSearchParams({ date });
      if (code) qs.set('code', code);
      if (onlyUnverified) qs.set('unverified', '1');
      await downloadXlsx(`/api/finance/uang-modal/export?${qs}`, `uang-modal-harian_${date}.xlsx`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download gagal.');
    } finally {
      setDownloading(false);
    }
  }

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
      onVerify={() => l.row.taskId != null && void verify([l.row.taskId], `Uang modal ${l.row.storeName}`)}
    />
  );

  return (
    <div className="min-h-full bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1400px] px-6 pt-4 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Uang Modal
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Uang Modal Review</h1>
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
            <UangModalTabs />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5 lg:px-8">
        {/* Key numbers */}
        {!loading && !error && (
          <KpiStrip
            items={[
              { label: 'Modal terhitung', value: rp(totals.total), sub: `${totals.submitted} dari ${visibleRows.length} toko sudah lapor` },
              { label: 'Terisi dari batas', value: fillOfCap == null ? '–' : `${fillOfCap}%`, sub: `batas ${rp(totals.max)} · kurang ${rp(totals.shortfall)}` },
              { label: 'Belum penuh / kosong', value: String(notFull), sub: 'sudah lapor tapi kurang dari batas', warn: notFull > 0 },
              { label: 'Belum lapor', value: String(missing), sub: isPast ? 'hari sudah lewat' : 'akan ditandai setelah hari berganti', warn: missing > 0 },
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
              {selected.size} hitungan dipilih
              <span className="ml-2 font-normal text-emerald-800">· terhitung {rp(selectedTotal)}</span>
            </span>
            <div className="ml-auto flex items-center gap-2">
              {confirmBulk ? (
                <>
                  <span className="text-xs font-medium text-emerald-900">Yakin verifikasi {selected.size} hitungan?</span>
                  <button
                    type="button"
                    onClick={() => void verify([...selected], `${selected.size} hitungan`)}
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
              <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-9 text-center')}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        disabled={selectableIds.length === 0}
                        onChange={toggleAll}
                        title="Pilih semua yang siap diverifikasi (modal penuh)"
                        aria-label="Pilih semua yang siap diverifikasi"
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600 disabled:opacity-40"
                      />
                    </th>
                    <th className={cn(TH, 'w-11 text-center')}>No</th>
                    <th className={cn(TH, 'text-left')}>Kode</th>
                    <th className={cn(TH, 'text-left')}>Nama Toko</th>
                    <th className={cn(TH, 'text-right')}>Terhitung (Rp)</th>
                    <th className={cn(TH, 'text-right')}>Kurang (Rp)</th>
                    <th className={cn(TH, 'text-left')}>Terisi</th>
                    <th className={cn(TH, 'text-left')}>Status</th>
                    <th className={cn(TH, 'text-left')}>Pecahan</th>
                    <th className={cn(TH, 'text-left')}>Verifikasi</th>
                    <th className={cn(TH, 'w-9')} />
                  </tr>
                </thead>

                <tbody>
                  {view === 'all'
                    ? visible.map((l, i) => renderLine(l, i + 1))
                    : visibleGroups.map((g) => (
                        <GroupBlock key={g.code} group={g} lineByStore={lineByStore} renderLine={renderLine} />
                      ))}
                  <TotalLine label="Total" rows={visibleRows} tone="grand" />
                </tbody>
              </table>
            </div>

            <div className="space-y-1 text-[11px] text-slate-500">
              <p>
                Menampilkan toko yang punya jadwal shift pembuka pada {fmtDateLong(date)}. Modal kasir dibatasi{' '}
                {rp(visibleRows[0]?.max ?? 0)} per hari: <span className="font-semibold text-emerald-700">Penuh</span> = sesuai batas,{' '}
                <span className="font-semibold text-amber-700">Belum penuh</span> = kurang dari batas (selisihnya di kolom Kurang),{' '}
                <span className="font-semibold text-rose-700">Kosong</span> = melapor tanpa uang.
              </p>
              <p>
                {isPast ? 'Toko yang belum lapor pada hari yang sudah lewat' : 'Toko yang belum lapor hari ini'} ditandai{' '}
                <span className="font-semibold text-rose-700">Belum lapor</span>
                {isPast ? '.' : ' setelah hari berganti.'} Kotak centang hanya aktif untuk modal yang penuh; yang belum
                penuh atau kosong diperiksa dan diverifikasi satu per satu.
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
  group: CodeGroup<UangModalRow>;
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
