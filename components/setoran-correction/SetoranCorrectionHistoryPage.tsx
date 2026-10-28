'use client';

// components/setoran-correction/SetoranCorrectionHistoryPage.tsx
//
// Shared by IT (/it/setoran-correction/history) and Finance
// (/finance/setoran-correction/history): "Riwayat Koreksi" — every correction and
// addition anyone made on any store, in one searchable, filterable, sortable list.
// The per-store history on Koreksi Setoran only shows one store at a time; this is
// the audit view across all of them. A row opens to the before / after figures and
// the full note.

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Eraser, History, Loader2, Search, Shield, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn, formatRupiah } from '@/lib/utils';
import { StoreCombobox } from '@/components/shared/store-combobox';
import { KpiStrip } from '@/components/finance/shared/sheet-kit';
import { Delta, type CorrectionPanel } from '@/components/setoran-correction/SetoranCorrectionPage';
import { shiftDate, todayJakarta } from '@/lib/finance/dates';
import { correctorLabel, type CorrectionHistoryRow } from '@/lib/setoran-correction';

// ─── Config ───────────────────────────────────────────────────────────────────

const PANELS: Record<CorrectionPanel, {
  api: string;
  scope: string;
  home: string;
  /** The Koreksi Setoran page of the same panel. */
  correction: string;
  roles: readonly string[];
  denied: string;
}> = {
  it: {
    api: '/api/ops/setoran-correction/history',
    scope: 'IT',
    home: '/it',
    correction: '/it/setoran-correction',
    roles: ['it'],
    denied: 'Only IT can see the setoran correction history.',
  },
  finance: {
    api: '/api/finance/setoran-correction/history',
    scope: 'Finance',
    home: '/finance',
    correction: '/finance/setoran-correction',
    roles: ['finance', 'it'],
    denied: 'Only Finance can see the setoran correction history.',
  },
};

const PAGE_SIZE = 50;

type Period = '30' | '90' | 'month' | 'all' | 'custom';

const PERIODS: { key: Period; label: string }[] = [
  { key: '30', label: '30 hari' },
  { key: '90', label: '90 hari' },
  { key: 'month', label: 'Bulan ini' },
  { key: 'all', label: 'Semua' },
  { key: 'custom', label: 'Pilih tanggal' },
];

/** The from / to (Jakarta days, inclusive) a preset stands for; null = no limit. */
function presetRange(period: Exclude<Period, 'custom'>): { from: string; to: string } | null {
  const today = todayJakarta();
  switch (period) {
    case '30': return { from: shiftDate(today, -29), to: today };
    case '90': return { from: shiftDate(today, -89), to: today };
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today };
    case 'all': return null;
  }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const rp = (n: number) => formatRupiah(n);

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });

const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

async function api(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error ?? 'Request gagal');
  return json;
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

type SortKey = 'createdAt' | 'store' | 'date' | 'kind' | 'by' | 'received' | 'stored' | 'unpaid';

const COMPARE: Record<SortKey, (a: CorrectionHistoryRow, b: CorrectionHistoryRow) => number> = {
  createdAt: (a, b) => a.createdAt.localeCompare(b.createdAt),
  store: (a, b) => a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true }),
  date: (a, b) => a.date.localeCompare(b.date),
  kind: (a, b) => a.kind.localeCompare(b.kind),
  by: (a, b) => a.correctedBy.localeCompare(b.correctedBy),
  received: (a, b) => a.after.received - b.after.received,
  stored: (a, b) => a.after.stored - b.after.stored,
  unpaid: (a, b) => a.after.unpaid - b.after.unpaid,
};

/** Text sorts start A→Z, everything else newest / largest first. */
const FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = {
  createdAt: 'desc', store: 'asc', date: 'desc', kind: 'asc', by: 'asc', received: 'desc', stored: 'desc', unpaid: 'desc',
};

type Sort = { key: SortKey; dir: 'asc' | 'desc' };

function SortHeader({
  label, sortKey, sort, onSort, align = 'left', className,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-3 py-3 font-semibold', align === 'right' ? 'text-right' : 'text-left', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-slate-900',
          align === 'right' && 'flex-row-reverse',
          active && 'text-slate-900',
        )}
      >
        {label}
        <Icon className={cn('h-3 w-3', !active && 'opacity-40')} />
      </button>
    </th>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function KindBadge({ kind }: { kind: CorrectionHistoryRow['kind'] }) {
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold',
        kind === 'create' ? 'bg-cyan-50 text-cyan-700' : 'bg-amber-50 text-amber-700',
      )}
    >
      {kind === 'create' ? 'Ditambahkan' : 'Dikoreksi'}
    </span>
  );
}

function ChipTabs<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'h-7 rounded-full px-3 text-xs font-semibold transition',
            value === o.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const SELECT_CLS =
  'h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-cyan-400 focus:outline-none';

/** The figures behind a row: what each amount was and became, plus the full note. */
function RowDetail({ row }: { row: CorrectionHistoryRow }) {
  const isCreate = row.kind === 'create';
  return (
    <div className="grid gap-4 bg-slate-50 px-5 py-4 lg:grid-cols-[minmax(0,320px)_1fr]">
      <dl className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white px-4 text-xs">
        {([
          ['Uang diterima', row.before.received, row.after.received],
          ['Disetor', row.before.stored, row.after.stored],
          ['Sisa', row.before.unpaid, row.after.unpaid],
        ] as const).map(([label, before, after]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-2">
            <dt className="font-semibold text-slate-500">{label}</dt>
            <dd className="text-[13px] font-semibold tabular-nums text-slate-800">
              {isCreate ? rp(after) : <Delta before={before} after={after} />}
            </dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2">
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="font-semibold">Catatan: </span>
          <span className="whitespace-pre-wrap break-words">{row.reason}</span>
        </div>
        <p className="text-[11px] text-slate-500">
          {isCreate ? 'Ditambahkan' : 'Dikoreksi'} oleh <span className="font-medium text-slate-700">{row.correctedBy}</span>{' '}
          ({correctorLabel(row.correctedByRole)}) · {fmtStamp(row.createdAt)}
          {row.affectedDays > 0 && ` · ${row.affectedDays} hari setelahnya dihitung ulang`}
          {row.wasVerified && ' · verifikasi Finance direset'}
        </p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type KindFilter = 'all' | 'correct' | 'create';

const KIND_OPTIONS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'Semua jenis' },
  { key: 'correct', label: 'Dikoreksi' },
  { key: 'create', label: 'Ditambahkan' },
];

export default function SetoranCorrectionHistoryPage({ panel }: { panel: CorrectionPanel }) {
  const cfg = PANELS[panel];
  const { status: authStatus, data: session } = useSession();
  const router = useRouter();
  const allowed = cfg.roles.includes(session?.user?.role ?? '');

  const [period, setPeriod] = useState<Period>('90');
  const [customFrom, setCustomFrom] = useState(() => shiftDate(todayJakarta(), -29));
  const [customTo, setCustomTo] = useState(() => todayJakarta());
  const [rows, setRows] = useState<CorrectionHistoryRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [storeId, setStoreId] = useState<number | null>(null);
  const [by, setBy] = useState('');
  const [role, setRole] = useState('');
  const [resetOnly, setResetOnly] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: 'createdAt', dir: 'desc' });
  const [pageNo, setPageNo] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!allowed) router.replace(cfg.home);
  }, [authStatus, session, allowed, router, cfg.home]);

  // The range the server is asked for. A half-typed custom range waits.
  const range = useMemo(() => {
    if (period !== 'custom') return presetRange(period);
    return customFrom && customTo && customFrom <= customTo ? { from: customFrom, to: customTo } : undefined;
  }, [period, customFrom, customTo]);

  const load = useCallback(async () => {
    if (range === undefined) return; // custom range not valid yet
    setLoading(true);
    try {
      const qs = range ? `?from=${range.from}&to=${range.to}` : '';
      const json = await api(`${cfg.api}${qs}`);
      setRows(json.rows);
      setTruncated(json.truncated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat riwayat koreksi');
    } finally {
      setLoading(false);
    }
  }, [cfg.api, range]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  // Pickers list only what the loaded rows contain.
  const stores = useMemo(() => {
    const byId = new Map<number, { id: number; storeNo: string; name: string }>();
    for (const r of rows) byId.set(r.storeId, { id: r.storeId, storeNo: r.storeNo, name: r.storeName });
    return [...byId.values()].sort((a, b) => a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true }));
  }, [rows]);

  const people = useMemo(() => {
    const byUser = new Map<string, string>();
    for (const r of rows) byUser.set(r.correctedById, r.correctedBy);
    return [...byUser.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false;
      if (storeId != null && r.storeId !== storeId) return false;
      if (by && r.correctedById !== by) return false;
      if (role && correctorLabel(r.correctedByRole) !== role) return false;
      if (resetOnly && !r.wasVerified) return false;
      if (!q) return true;
      return (
        r.storeNo.toLowerCase().includes(q) ||
        r.storeName.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q) ||
        r.correctedBy.toLowerCase().includes(q) ||
        r.date.includes(q) ||
        fmtDay(r.date).toLowerCase().includes(q)
      );
    });
  }, [rows, search, kind, storeId, by, role, resetOnly]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const cmp = COMPARE[sort.key];
    // Ties fall back to newest first, so equal values keep a stable, readable order.
    return [...filtered].sort((a, b) => dir * cmp(a, b) || b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(pageNo, totalPages);
  const visible = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => ({
    corrected: filtered.filter((r) => r.kind === 'correct').length,
    created: filtered.filter((r) => r.kind === 'create').length,
    stores: new Set(filtered.map((r) => r.storeId)).size,
    reset: filtered.filter((r) => r.wasVerified).length,
  }), [filtered]);

  const hasFilter = Boolean(search || kind !== 'all' || storeId != null || by || role || resetOnly);

  function clearFilters() {
    setSearch(''); setKind('all'); setStoreId(null); setBy(''); setRole(''); setResetOnly(false); setPageNo(1);
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: FIRST_DIR[key] }));
    setPageNo(1);
  }

  /** Wraps a filter setter so changing a filter returns to the first page. */
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPageNo(1); };

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

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope={cfg.scope}
        title="Riwayat Koreksi Setoran"
        subtitle="Semua koreksi dan penambahan setoran dari semua toko — siapa yang mengubah, kapan, dan apa alasannya."
        actions={
          <Link
            href={cfg.correction}
            className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Eraser className="h-4 w-4" />
            Koreksi Setoran
          </Link>
        }
      />

      <div className="space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <KpiStrip
          items={[
            { label: 'Total perubahan', value: String(filtered.length), sub: hasFilter ? `dari ${rows.length} dimuat` : 'dalam periode ini' },
            { label: 'Dikoreksi', value: String(stats.corrected), sub: 'nominal diubah' },
            { label: 'Ditambahkan', value: String(stats.created), sub: 'hari yang belum ada setorannya' },
            { label: 'Toko terdampak', value: String(stats.stores) },
            { label: 'Verifikasi direset', value: String(stats.reset), sub: 'sudah diverifikasi Finance', warn: stats.reset > 0 },
          ]}
        />

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs font-bold text-slate-600">Periode koreksi</span>
            <ChipTabs label="Periode" value={period} options={PERIODS} onChange={(p) => { setPeriod(p); setPageNo(1); }} />
            {period === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  aria-label="Dari tanggal"
                  className={SELECT_CLS}
                />
                s/d
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  aria-label="Sampai tanggal"
                  className={SELECT_CLS}
                />
              </div>
            )}
            {loading && <Loader2 className="h-4 w-4 animate-spin text-cyan-500" />}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => reset(setSearch)(e.target.value)}
                placeholder="Cari toko, alasan, atau nama petugas…"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-sm placeholder-slate-400 focus:border-cyan-400 focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => reset(setSearch)('')}
                  aria-label="Hapus pencarian"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="w-64">
              <StoreCombobox stores={stores} value={storeId} onChange={reset(setStoreId)} allLabel="Semua toko" loading={loading && rows.length === 0} />
            </div>

            <select value={by} onChange={(e) => reset(setBy)(e.target.value)} aria-label="Filter petugas" className={SELECT_CLS}>
              <option value="">Semua petugas</option>
              {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>

            <select value={role} onChange={(e) => reset(setRole)(e.target.value)} aria-label="Filter peran" className={SELECT_CLS}>
              <option value="">IT &amp; Finance</option>
              <option value="IT">Hanya IT</option>
              <option value="Finance">Hanya Finance</option>
            </select>

            <ChipTabs label="Jenis" value={kind} options={KIND_OPTIONS} onChange={reset(setKind)} />

            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={resetOnly}
                onChange={(e) => reset(setResetOnly)(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 accent-cyan-600"
              />
              Verifikasi direset
            </label>

            {hasFilter && (
              <button type="button" onClick={clearFilters} className="text-xs font-semibold text-slate-500 underline hover:text-slate-700">
                Hapus filter
              </button>
            )}
          </div>
        </section>

        {truncated && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            Terlalu banyak data — hanya perubahan terbaru yang dimuat. Persempit periode untuk melihat yang lebih lama.
          </p>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <History className="h-4 w-4 text-slate-400" />
              Riwayat
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
                {sorted.length}
              </span>
            </h2>
            <span className="text-xs text-slate-400">Klik baris untuk melihat angka sebelum / sesudah dan catatan lengkap.</span>
          </div>

          {loading && rows.length === 0 ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : sorted.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">
              {hasFilter ? 'Tidak ada koreksi yang cocok dengan filter.' : 'Belum ada koreksi atau penambahan setoran di periode ini.'}
            </p>
          ) : (
            <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
              <table className="w-full min-w-[1080px] text-[13px]">
                <thead className="text-[11px] font-semibold text-slate-500">
                  <tr className="border-b border-slate-200">
                    <SortHeader label="Waktu koreksi" sortKey="createdAt" sort={sort} onSort={toggleSort} className="px-5" />
                    <SortHeader label="Toko" sortKey="store" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Tanggal setoran" sortKey="date" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Jenis" sortKey="kind" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Diterima" sortKey="received" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Disetor" sortKey="stored" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Sisa" sortKey="unpaid" sort={sort} onSort={toggleSort} align="right" />
                    <th className="px-3 py-3 text-left font-semibold">Alasan</th>
                    <SortHeader label="Oleh" sortKey="by" sort={sort} onSort={toggleSort} className="px-5" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const open = openId === r.id;
                    return (
                      <RowGroup key={r.id} row={r} open={open} onToggle={() => setOpenId(open ? null : r.id)} />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {sorted.length > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
              <span className="tabular-nums">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} dari {sorted.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPageNo(page - 1)}
                  disabled={page <= 1}
                  aria-label="Halaman sebelumnya"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="w-20 text-center font-semibold tabular-nums">{page} / {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPageNo(page + 1)}
                  disabled={page >= totalPages}
                  aria-label="Halaman berikutnya"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function RowGroup({ row: r, open, onToggle }: { row: CorrectionHistoryRow; open: boolean; onToggle: () => void }) {
  const isCreate = r.kind === 'create';
  const figure = (before: number, after: number) =>
    isCreate ? <span className="tabular-nums text-slate-700">{rp(after)}</span> : <Delta before={before} after={after} />;

  return (
    <>
      <tr
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
        }}
        tabIndex={0}
        aria-expanded={open}
        className={cn(
          'cursor-pointer border-b border-slate-100 align-top outline-none focus-visible:bg-cyan-50/60',
          open ? 'bg-cyan-50/40' : 'hover:bg-slate-50',
        )}
      >
        <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-600">{fmtStamp(r.createdAt)}</td>
        <td className="px-3 py-3">
          <p className="font-semibold text-slate-900">{r.storeNo}</p>
          <p className="max-w-[200px] truncate text-xs text-slate-500" title={r.storeName}>{r.storeName}</p>
        </td>
        <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-800">{fmtDay(r.date)}</td>
        <td className="px-3 py-3">
          <div className="flex flex-col items-start gap-1">
            <KindBadge kind={r.kind} />
            {r.wasVerified && (
              <span className="whitespace-nowrap text-[10px] font-semibold text-emerald-700">Verifikasi direset</span>
            )}
          </div>
        </td>
        <td className="px-3 py-3 text-right">{figure(r.before.received, r.after.received)}</td>
        <td className="px-3 py-3 text-right">{figure(r.before.stored, r.after.stored)}</td>
        <td className="px-3 py-3 text-right">{figure(r.before.unpaid, r.after.unpaid)}</td>
        <td className="min-w-56 max-w-xs px-3 py-3 text-slate-700">
          <p className={cn('break-words', !open && 'line-clamp-2')}>{r.reason}</p>
        </td>
        <td className="whitespace-nowrap px-5 py-3 text-xs">
          <p className="font-medium text-slate-700">{r.correctedBy}</p>
          <p className="text-slate-400">{correctorLabel(r.correctedByRole)}</p>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-200">
          <td colSpan={9} className="p-0">
            <RowDetail row={r} />
          </td>
        </tr>
      )}
    </>
  );
}
