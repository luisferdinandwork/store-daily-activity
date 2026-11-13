'use client';
// components/audit/cash-check/kit.tsx
//
// Shared pieces of the Audit Pemeriksaan Kas pages (Cek Modal · Cek Petty Cash · Berita Acara): the store + date
// context that travels in the URL (?store=&date=), the three page tabs, the money input, the denomination counter,
// the selisih chip and the sticky save bar. Phone-first: everything stacks at 360 px, inputs use 16 px text so iOS
// does not zoom.

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Banknote, CalendarDays, Coins, FileText, Minus, Plus, UserRound, Wallet } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONES } from '@/lib/status-theme';
import { jakartaTodayKey } from '@/lib/day-bucket';
import {
  AUDIT_DENOMINATIONS,
  DENOMINATION_KIND_LABEL,
  DIFF_LABEL,
  MAX_MONEY,
  MAX_PIECES,
  countsTotal,
  diffState,
  isDay,
  longDateId,
  rupiah,
  signedRupiah,
  type DenominationCounts,
  type DenominationKind,
} from '@/lib/audit-cash-check';
import { StoreCombobox, type StoreComboboxOption } from '@/components/shared/store-combobox';

// ─── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string } & T;
  if (!res.ok || data.success === false) throw new Error(data.error || `Gagal (${res.status})`);
  return data;
}

// ─── URL context (?store=&date=) ─────────────────────────────────────────────

export function useCashCheckParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = jakartaTodayKey();

  const rawStore = Number(params.get('store'));
  const storeId = Number.isInteger(rawStore) && rawStore > 0 ? rawStore : null;
  const rawDate = params.get('date') ?? '';
  const date = isDay(rawDate) && rawDate <= today ? rawDate : today;

  const set = useCallback(
    (next: { storeId?: number | null; date?: string }) => {
      const q = new URLSearchParams(params.toString());
      const s = next.storeId === undefined ? storeId : next.storeId;
      const d = next.date ?? date;
      if (s) q.set('store', String(s));
      else q.delete('store');
      if (d && d !== today) q.set('date', d);
      else q.delete('date');
      router.replace(`${pathname}${q.size ? `?${q}` : ''}`, { scroll: false });
    },
    [params, pathname, router, storeId, date, today],
  );

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (storeId) q.set('store', String(storeId));
    if (date !== today) q.set('date', date);
    return q.size ? `?${q}` : '';
  }, [storeId, date, today]);

  return { storeId, date, today, set, query };
}

/** Active stores for the picker, loaded once per page. */
export function useAuditStores() {
  const [stores, setStores] = useState<StoreComboboxOption[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetchJson<{ stores: StoreComboboxOption[] }>('/api/audit/cash-check/stores')
      .then((d) => alive && setStores(d.stores))
      .catch(() => alive && setStores([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { stores, loading };
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

const TABS = [
  { href: '/audit/cek-modal', label: 'Cek Modal', short: 'Modal', icon: Banknote },
  { href: '/audit/cek-petty-cash', label: 'Cek Petty Cash', short: 'Petty Cash', icon: Wallet },
  { href: '/audit/berita-acara', label: 'Berita Acara', short: 'Berita Acara', icon: FileText },
] as const;

export function CashCheckTabs({ query = '' }: { query?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Pemeriksaan Kas" className="-mb-px flex gap-1 overflow-x-auto">
      {TABS.map(({ href, label, short, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={`${href}${href === '/audit/berita-acara' ? '' : query}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold transition-colors',
              active ? 'border-amber-500 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// ─── Context bar: store · date · Pemegang Kas ────────────────────────────────

export interface StaffOption {
  id: string;
  name: string;
  nik: string;
  typeCode: string | null;
  typeLabel: string | null;
}

export function ContextBar({
  stores,
  storesLoading,
  storeId,
  date,
  today,
  onStore,
  onDate,
  staff,
  holderId,
  onHolder,
}: {
  stores: StoreComboboxOption[];
  storesLoading: boolean;
  storeId: number | null;
  date: string;
  today: string;
  onStore: (id: number | null) => void;
  onDate: (day: string) => void;
  staff?: StaffOption[];
  holderId?: string | null;
  onHolder?: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs sm:p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
      <Field label="Toko">
        <StoreCombobox stores={stores} loading={storesLoading} value={storeId} onChange={onStore} accent="amber" className="max-w-none" />
      </Field>
      <Field label="Tanggal pemeriksaan">
        <label className="flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <CalendarDays className="h-4 w-4" />
          </span>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => isDay(e.target.value) && onDate(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-base font-semibold text-slate-900 outline-none sm:text-sm"
            aria-label="Tanggal pemeriksaan"
          />
        </label>
      </Field>
      {staff && onHolder && (
        <Field label="Pemegang Kas">
          <label className="flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <UserRound className="h-4 w-4" />
            </span>
            <select
              value={holderId ?? ''}
              onChange={(e) => onHolder(e.target.value)}
              disabled={!storeId || staff.length === 0}
              className="min-w-0 flex-1 truncate bg-transparent text-base font-semibold text-slate-900 outline-none disabled:text-slate-400 sm:text-sm"
              aria-label="Pemegang Kas"
            >
              {!holderId && <option value="">{staff.length ? 'Pilih pemegang kas…' : 'Tidak ada staf'}</option>}
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.typeLabel ? ` · ${s.typeLabel}` : ''}
                </option>
              ))}
            </select>
          </label>
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      {children}
    </div>
  );
}

// ─── Cards ───────────────────────────────────────────────────────────────────

export function SectionCard({
  icon: Icon,
  title,
  subtitle,
  action,
  children,
  className,
}: {
  icon?: React.ElementType;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs', className)}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
        {Icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{subtitle}</p>}
        </div>
        {/* Phone: the action drops under the text instead of squeezing it into a narrow column. */}
        {action && <div className="flex shrink-0 max-sm:w-full max-sm:pl-11 [&>*]:mt-0!">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export function EmptyPick({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
        <Wallet className="h-7 w-7" />
      </span>
      <p className="mt-4 text-base font-bold text-slate-800">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{body}</p>
    </div>
  );
}

export function SavedStamp({ at, by }: { at: string | null; by: string | null }) {
  if (!at) return <span className="text-xs font-medium text-slate-400">Belum disimpan</span>;
  const t = new Date(at);
  const when = t.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <span className="text-xs font-medium text-slate-500">
      Tersimpan {when}
      {by ? ` · ${by}` : ''}
    </span>
  );
}

export const dayTitle = (day: string) => longDateId(day);

// ─── Money input ─────────────────────────────────────────────────────────────

const digitsOnly = (s: string) => s.replace(/\D/g, '');

export function MoneyInput({
  value,
  onChange,
  id,
  label,
  hint,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-slate-600">
        {label}
      </label>
      <div className="flex h-11 items-center rounded-xl border border-slate-200 bg-white shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100">
        <span className="pl-3 pr-1.5 text-sm font-semibold text-slate-400">Rp</span>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value ? value.toLocaleString('id-ID') : ''}
          placeholder="0"
          onChange={(e) => onChange(Math.min(Number(digitsOnly(e.target.value) || 0), MAX_MONEY))}
          className="h-full min-w-0 flex-1 rounded-r-xl bg-transparent pr-3 text-right text-base font-semibold tabular-nums text-slate-900 outline-none placeholder:text-slate-300 sm:text-sm"
        />
      </div>
      {hint && <p className="mt-1 text-[11px] leading-snug text-slate-400">{hint}</p>}
    </div>
  );
}

// ─── Denomination counter ────────────────────────────────────────────────────

const KIND_ICON: Record<DenominationKind, React.ElementType> = { kertas: Banknote, koin: Coins };

export function DenominationCounter({
  counts,
  onChange,
  idPrefix,
}: {
  counts: DenominationCounts;
  /** Gets an updater, so quick repeated taps never work from a stale count. */
  onChange: (update: (prev: DenominationCounts) => DenominationCounts) => void;
  idPrefix: string;
}) {
  const setQty = (id: string, qty: number | ((prev: number) => number)) =>
    onChange((prev) => {
      const raw = typeof qty === 'function' ? qty(prev[id] ?? 0) : qty;
      const n = Math.max(0, Math.min(MAX_PIECES, Math.floor(raw) || 0));
      const next = { ...prev };
      if (n > 0) next[id] = n;
      else delete next[id];
      return next;
    });

  return (
    <div className="divide-y divide-slate-100">
      {(['kertas', 'koin'] as const).map((kind) => {
        const rows = AUDIT_DENOMINATIONS.filter((d) => d.kind === kind);
        const subtotal = rows.reduce((s, d) => s + d.value * (counts[d.id] ?? 0), 0);
        const Icon = KIND_ICON[kind];
        return (
          <div key={kind}>
            <div className="flex items-center gap-2 bg-slate-50/70 px-4 py-2">
              <Icon className="h-3.5 w-3.5 text-slate-400" />
              <p className="flex-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{DENOMINATION_KIND_LABEL[kind]}</p>
              <p className="text-xs font-semibold tabular-nums text-slate-500">{rupiah(subtotal)}</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {rows.map((d) => {
                const qty = counts[d.id] ?? 0;
                const inputId = `${idPrefix}-${d.id}`;
                return (
                  <li key={d.id} className={cn('flex items-center gap-2 px-4 py-2 transition-colors sm:gap-3', qty > 0 && 'bg-amber-50/40')}>
                    <label htmlFor={inputId} className="w-[4.75rem] shrink-0 text-sm font-bold tabular-nums text-slate-800 sm:w-24">
                      {d.value.toLocaleString('id-ID')}
                    </label>
                    <div className="flex items-center rounded-xl border border-slate-200 bg-white shadow-xs">
                      <button
                        type="button"
                        onClick={() => setQty(d.id, (q) => q - 1)}
                        disabled={qty === 0}
                        className="flex h-10 w-10 items-center justify-center rounded-l-xl text-slate-500 transition hover:bg-slate-50 active:bg-slate-100 disabled:opacity-30"
                        aria-label={`Kurangi ${d.value.toLocaleString('id-ID')}`}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        id={inputId}
                        inputMode="numeric"
                        autoComplete="off"
                        value={qty ? String(qty) : ''}
                        placeholder="0"
                        onChange={(e) => setQty(d.id, Number(digitsOnly(e.target.value) || 0))}
                        onFocus={(e) => e.currentTarget.select()}
                        className="h-10 w-12 border-x border-slate-100 bg-transparent text-center text-base font-bold tabular-nums text-slate-900 outline-none placeholder:font-medium placeholder:text-slate-300 focus:bg-amber-50/60 sm:w-14"
                      />
                      <button
                        type="button"
                        onClick={() => setQty(d.id, (q) => q + 1)}
                        className="flex h-10 w-10 items-center justify-center rounded-r-xl text-amber-600 transition hover:bg-amber-50 active:bg-amber-100"
                        aria-label={`Tambah ${d.value.toLocaleString('id-ID')}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <p className={cn('min-w-0 flex-1 truncate text-right text-sm tabular-nums', qty > 0 ? 'font-bold text-slate-900' : 'text-slate-300')}>
                      {rupiah(d.value * qty)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
        <p className="text-sm font-bold text-slate-700">Jumlah fisik</p>
        <p className="text-base font-extrabold tabular-nums text-slate-900">{rupiah(countsTotal(counts))}</p>
      </div>
    </div>
  );
}

// ─── Selisih ─────────────────────────────────────────────────────────────────

const DIFF_TONE = { match: TONES.success, short: TONES.danger, over: TONES.warning } as const;

export function DiffChip({ diff, className }: { diff: number; className?: string }) {
  const state = diffState(diff);
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums', DIFF_TONE[state].chip, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', DIFF_TONE[state].dot)} />
      {state === 'match' ? DIFF_LABEL.match : `${DIFF_LABEL[state]} ${rupiah(Math.abs(diff))}`}
    </span>
  );
}

export const diffTextClass = (diff: number) => DIFF_TONE[diffState(diff)].strong;

/** A label + amount line in a summary. */
export function SumLine({
  label,
  value,
  strong,
  sign,
  muted,
}: {
  label: ReactNode;
  value: number;
  strong?: boolean;
  sign?: '+' | '−';
  muted?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1', strong && 'border-t border-slate-200 pt-2')}>
      <span className={cn('min-w-0 text-sm', strong ? 'font-bold text-slate-800' : muted ? 'text-slate-400' : 'text-slate-600')}>{label}</span>
      <span className={cn('shrink-0 tabular-nums', strong ? 'text-base font-extrabold text-slate-900' : 'text-sm font-semibold text-slate-700', muted && 'text-slate-400')}>
        {sign ? `${sign} ` : ''}
        {rupiah(value)}
      </span>
    </div>
  );
}

// ─── Sticky save bar ─────────────────────────────────────────────────────────

export function SaveBar({
  diff,
  physical,
  book,
  saving,
  dirty,
  onSave,
  disabled,
}: {
  diff: number;
  physical: number;
  book: number;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)] backdrop-blur supports-[backdrop-filter]:bg-white/85 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Selisih</span>
            <DiffChip diff={diff} />
          </div>
          <p className="mt-0.5 truncate text-xs tabular-nums text-slate-500">
            Fisik {rupiah(physical)} · Buku {rupiah(book)}
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || disabled}
          className={cn(
            'flex h-11 shrink-0 items-center gap-2 rounded-xl px-5 text-sm font-bold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
            dirty ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-900 text-white hover:bg-slate-800',
          )}
        >
          {saving ? 'Menyimpan…' : dirty ? 'Simpan' : 'Tersimpan'}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        Selisih {signedRupiah(diff)}
      </p>
    </div>
  );
}
