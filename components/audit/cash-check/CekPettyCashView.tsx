'use client';
// components/audit/cash-check/CekPettyCashView.tsx — Audit "Cek Petty Cash": the PETTY CASH half of the Berita Acara.
//
// 1. A checklist of every completed request Finance has not covered with a verified Refill yet — the period in use,
//    plus the period before it while its Refill is not verified (lib/db/utils/audit-cash-check.ts). The auditor ticks
//    the ones whose receipt matches; only ticked lines are printed under PENGELUARAN.
// 2. Extra cash-outs the system does not have (typed by the auditor).
// 3. "Penggantian petty cash periode lalu yang belum diterima" — a Refill Finance sent that the store has not
//    received; pre-filled from the system.
// 4. The petty cash counted per denomination. Selisih = fisik − (dana − cashout − penggantian belum diterima).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  ChevronDown,
  ClipboardList,
  Coins,
  Hourglass,
  ImageIcon,
  Info,
  ListChecks,
  NotebookPen,
  PencilLine,
  Plus,
  ReceiptText,
  RotateCcw,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { ImageLightbox, type LightboxImage } from '@/components/shared/ImageLightbox';
import { cn } from '@/lib/utils';
import {
  NOTES_MAX,
  PERIOD_REFILL_STATE_LABEL,
  PETTY_CASH_FUND,
  PETTY_EXTRA_DESCRIPTION_MAX,
  PETTY_EXTRA_MAX,
  PETTY_ITEM_NOTE_MAX,
  cashCheckTotals,
  countsPieces,
  countsTotal,
  extraTotal,
  monthLabelId,
  rupiah,
  type CashCheckRecord,
  type DenominationCounts,
  type PeriodRefillState,
  type PettyCheckItem,
  type PettyExtraItem,
} from '@/lib/audit-cash-check';
import {
  CashCheckTabs,
  ContextBar,
  DenominationCounter,
  DiffChip,
  EmptyPick,
  MoneyInput,
  SaveBar,
  SectionCard,
  SumLine,
  diffTextClass,
  fetchJson,
  useAuditStores,
  useCashCheckParams,
  type StaffOption,
} from './kit';
import { LoadingBlocks, StatusStrip } from './CekModalView';

interface PeriodGroup {
  month: string;
  rangeLabel: string;
  refillState: PeriodRefillState;
  verifiedAt: string | null;
  pendingRefill: number;
  items: PettyCheckItem[];
  savedOnly?: boolean;
}

interface Loaded {
  context: { store: { id: number; storeNo: string; name: string; status: string }; staff: StaffOption[]; defaultHolderId: string | null };
  check: CashCheckRecord | null;
  petty: {
    available: boolean;
    usageMonth: string | null;
    periods: PeriodGroup[];
    pendingRefill: number;
    systemBalance: number | null;
    inProgress: { txId: number; date: string; category: string | null; description: string; amount: number }[];
  };
}

type Ticks = Partial<Record<number, { checked: boolean; note: string }>>;
const NO_TICK = { checked: false, note: '' };

interface Form {
  holderId: string | null;
  ticks: Ticks;
  extras: PettyExtraItem[];
  pendingRefill: number;
  counts: DenominationCounts;
  notes: string;
}

function formOf(d: Loaded): Form {
  const ticks: Ticks = {};
  for (const g of d.petty.periods) for (const i of g.items) ticks[i.txId] = { checked: i.checked, note: i.note ?? '' };
  const c = d.check;
  return {
    holderId: c?.holderUserId ?? d.context.defaultHolderId,
    ticks,
    extras: c?.pettyExtras ?? [],
    pendingRefill: c?.pettyCheckedAt ? c.pettyPendingRefill : d.petty.pendingRefill,
    counts: c?.pettyCounts ?? {},
    notes: c?.pettyNotes ?? '',
  };
}

const STATE_TONE: Record<PeriodRefillState, string> = {
  none: 'border-slate-200 bg-slate-50 text-slate-600',
  waiting_ops: 'border-sky-200 bg-sky-50 text-sky-700',
  waiting_finance: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  verified: 'border-violet-200 bg-violet-50 text-violet-700',
  received: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'short' });

const newKey = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function CekPettyCashView() {
  const { storeId, date, today, set, query } = useCashCheckParams();
  const { stores, loading: storesLoading } = useAuditStores();

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  const [noteOpen, setNoteOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [showInProgress, setShowInProgress] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await fetchJson<Loaded>(`/api/audit/cash-check?storeId=${storeId}&date=${date}&part=petty`);
      const f = formOf(d);
      setData(d);
      setForm(f);
      setBaseline(JSON.stringify(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat.');
      setData(null);
      setForm(null);
    } finally {
      setLoading(false);
    }
  }, [storeId, date]);

  useEffect(() => {
    if (storeId) void load();
    else {
      setData(null);
      setForm(null);
    }
  }, [storeId, load]);

  const dirty = form != null && JSON.stringify(form) !== baseline;
  const savedOnce = Boolean(data?.check?.pettyCheckedAt);
  const guard = (go: () => void) => {
    if (dirty && !window.confirm('Perubahan belum disimpan. Tinggalkan halaman ini?')) return;
    go();
  };
  const patch = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  const allItems = useMemo(() => data?.petty.periods.flatMap((g) => g.items) ?? [], [data]);

  const items: PettyCheckItem[] = useMemo(
    () => allItems.map((i) => ({ ...i, checked: form?.ticks[i.txId]?.checked ?? false, note: form?.ticks[i.txId]?.note || null })),
    [allItems, form?.ticks],
  );

  const totals = useMemo(() => {
    if (!form) return null;
    return cashCheckTotals({
      modalBook: 0,
      salesCash: 0,
      salesDebit: 0,
      salesCredit: 0,
      salesVoucher: 0,
      modalCounts: {},
      pettyFund: PETTY_CASH_FUND,
      pettyItems: items,
      pettyExtras: form.extras,
      pettyPendingRefill: form.pendingRefill,
      pettyCounts: form.counts,
    });
  }, [form, items]);

  const setTick = (txId: number, p: Partial<{ checked: boolean; note: string }>) =>
    setForm((f) => (f ? { ...f, ticks: { ...f.ticks, [txId]: { ...(f.ticks[txId] ?? NO_TICK), ...p } } } : f));

  const setAll = (ids: number[], checked: boolean) =>
    setForm((f) => {
      if (!f) return f;
      const ticks = { ...f.ticks };
      for (const id of ids) ticks[id] = { ...(ticks[id] ?? NO_TICK), checked };
      return { ...f, ticks };
    });

  async function save() {
    if (!storeId || !form) return;
    setSaving(true);
    try {
      const d = await fetchJson<{ check: CashCheckRecord }>('/api/audit/cash-check', {
        method: 'PUT',
        body: JSON.stringify({
          part: 'petty',
          storeId,
          date,
          holderUserId: form.holderId,
          items: Object.entries(form.ticks).map(([txId, t]) => ({ txId: Number(txId), checked: t?.checked === true, note: t?.note ?? '' })),
          extras: form.extras,
          pendingRefill: form.pendingRefill,
          counts: form.counts,
          notes: form.notes,
        }),
      });
      toast.success('Cek Petty Cash tersimpan', { description: `Berita Acara ${d.check.docNumber}` });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  const openReceipts = (txId: number) => {
    const withPhoto = items.filter((i) => i.imageUrl);
    const index = withPhoto.findIndex((i) => i.txId === txId);
    if (index < 0) return;
    setLightbox({
      images: withPhoto.map((i) => ({ url: i.imageUrl as string, label: `${shortDay(i.date)} · ${i.description} · ${rupiah(i.amount)}` })),
      index,
    });
  };

  const systemPending = data?.petty.pendingRefill ?? 0;
  const allIds = items.map((i) => i.txId);
  const allChecked = items.length > 0 && items.every((i) => i.checked);

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <PanelPageHeader
        scope="Audit · Pemeriksaan Kas"
        title={<><Wallet />Cek Petty Cash</>}
        subtitle="Cocokkan pengeluaran yang belum dicek Finance dan hitung kas petty cash"
        tabs={<CashCheckTabs query={query} />}
      />

      <div className="flex-1 space-y-4 p-4 sm:p-6 lg:p-8">
        <ContextBar
          stores={stores}
          storesLoading={storesLoading}
          storeId={storeId}
          date={date}
          today={today}
          onStore={(id) => guard(() => set({ storeId: id }))}
          onDate={(d) => guard(() => set({ date: d }))}
          staff={data?.context.staff}
          holderId={form?.holderId ?? null}
          onHolder={(id) => patch({ holderId: id })}
        />

        {!storeId ? (
          <EmptyPick title="Pilih toko yang diperiksa" body="Daftar pengeluaran petty cash yang belum dicek Finance akan muncul di sini." />
        ) : loading && !form ? (
          <LoadingBlocks />
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}{' '}
            <button type="button" className="font-bold underline" onClick={() => void load()}>
              Coba lagi
            </button>
          </div>
        ) : form && totals && data ? (
          <>
            <StatusStrip check={data.check} date={date} savedOnce={savedOnce} part="petty" />

            {!data.petty.available && (
              <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                Toko ini tidak berstatus aktif, jadi tidak ada request petty cash yang bisa dicek. Kas fisik tetap bisa dihitung.
              </div>
            )}

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
                {/* ── Checklist ── */}
                <SectionCard
                  icon={ListChecks}
                  title="Pengeluaran belum dicek Finance"
                  subtitle="Request selesai yang belum ditutup Refill terverifikasi Finance. Centang yang struknya sesuai — hanya yang dicentang masuk PENGELUARAN."
                  action={
                    items.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setAll(allIds, !allChecked)}
                        className="mt-0.5 flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
                      >
                        {allChecked ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                        {allChecked ? 'Hapus centang' : 'Centang semua'}
                      </button>
                    ) : undefined
                  }
                >
                  <div className="flex items-center gap-3 border-b border-slate-100 bg-amber-50/50 px-4 py-2.5">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-amber-100">
                      <div
                        className="h-full rounded-full bg-amber-500 transition-all"
                        style={{ width: `${items.length ? (totals.checkedCount / items.length) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold tabular-nums text-amber-900">
                      {totals.checkedCount}/{items.length} dicentang
                    </span>
                  </div>

                  {data.petty.periods.length === 0 || items.length === 0 ? (
                    <div className="px-4 py-10 text-center">
                      <ReceiptText className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="mt-2 text-sm font-semibold text-slate-600">Tidak ada pengeluaran yang belum dicek Finance</p>
                      <p className="mt-0.5 text-xs text-slate-400">Semua request sudah tercakup Refill yang diverifikasi Finance.</p>
                    </div>
                  ) : (
                    data.petty.periods
                      .filter((g) => g.items.length > 0)
                      .map((g) => {
                        const groupItems = items.filter((i) => i.periodMonth === g.month);
                        const groupTotal = groupItems.reduce((s, i) => s + i.amount, 0);
                        const groupChecked = groupItems.filter((i) => i.checked).length;
                        return (
                          <div key={g.month}>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-slate-100 bg-slate-50 px-4 py-2 first:border-t-0">
                              <p className="text-sm font-bold text-slate-800">Periode {monthLabelId(g.month)}</p>
                              <p className="text-xs text-slate-400">{g.rangeLabel}</p>
                              <span
                                className={cn(
                                  'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                  g.savedOnly ? 'border-slate-200 bg-white text-slate-500' : STATE_TONE[g.refillState],
                                )}
                              >
                                {g.savedOnly ? 'Tersimpan sebelumnya' : PERIOD_REFILL_STATE_LABEL[g.refillState]}
                              </span>
                              <span className="ml-auto text-xs font-semibold tabular-nums text-slate-500">
                                {groupChecked}/{groupItems.length} · {rupiah(groupTotal)}
                              </span>
                            </div>
                            {g.verifiedAt && !g.savedOnly && (
                              <p className="border-b border-slate-100 bg-violet-50/40 px-4 py-1.5 text-[11px] text-violet-700">
                                Refill periode ini sudah diverifikasi Finance — hanya request setelah verifikasi yang ditampilkan.
                              </p>
                            )}
                            <ul className="divide-y divide-slate-100">
                              {groupItems.map((item) => (
                                <ChecklistRow
                                  key={item.txId}
                                  item={item}
                                  noteOpen={noteOpen === item.txId}
                                  onToggle={() => setTick(item.txId, { checked: !item.checked })}
                                  onNoteToggle={() => setNoteOpen((v) => (v === item.txId ? null : item.txId))}
                                  onNote={(note) => setTick(item.txId, { note })}
                                  onReceipt={() => openReceipts(item.txId)}
                                />
                              ))}
                            </ul>
                          </div>
                        );
                      })
                  )}

                  {data.petty.inProgress.length > 0 && (
                    <div className="border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setShowInProgress((v) => !v)}
                        className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-semibold text-slate-500 hover:bg-slate-50"
                      >
                        <Hourglass className="h-3.5 w-3.5 text-sky-500" />
                        <span className="flex-1">
                          {data.petty.inProgress.length} request disetujui OPS, jumlah aktual belum dicatat PIC 1 (tidak dihitung)
                        </span>
                        <ChevronDown className={cn('h-4 w-4 transition', showInProgress && 'rotate-180')} />
                      </button>
                      {showInProgress && (
                        <ul className="divide-y divide-slate-100 bg-sky-50/30">
                          {data.petty.inProgress.map((t) => (
                            <li key={t.txId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                              <span className="w-14 shrink-0 text-xs text-slate-400">{shortDay(t.date)}</span>
                              <span className="min-w-0 flex-1 truncate text-slate-600">{t.description}</span>
                              <span className="shrink-0 tabular-nums text-slate-500">{rupiah(t.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </SectionCard>

                {/* ── Extra lines ── */}
                <SectionCard
                  icon={ReceiptText}
                  title="Pengeluaran lain"
                  subtitle="Struk di kotak petty cash yang belum ada di sistem. Ikut dicetak di PENGELUARAN."
                  action={
                    !adding && form.extras.length < PETTY_EXTRA_MAX ? (
                      <button
                        type="button"
                        onClick={() => setAdding(true)}
                        className="mt-0.5 flex min-h-9 shrink-0 items-center gap-1 rounded-lg bg-amber-500 px-2.5 text-xs font-bold text-white transition hover:bg-amber-600"
                      >
                        <Plus className="h-3.5 w-3.5" /> Tambah
                      </button>
                    ) : undefined
                  }
                >
                  {form.extras.length === 0 && !adding ? (
                    <p className="px-4 py-5 text-center text-xs text-slate-400">Tidak ada.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {form.extras.map((e) => (
                        <li key={e.key} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-800">{e.description}</p>
                            <p className="text-xs text-slate-400">
                              {shortDay(e.date)} · {e.qty} × {rupiah(e.price)}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{rupiah(extraTotal(e))}</span>
                          <button
                            type="button"
                            onClick={() => patch({ extras: form.extras.filter((x) => x.key !== e.key) })}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            aria-label={`Hapus ${e.description}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {adding && (
                    <ExtraEditor
                      defaultDate={date}
                      maxDate={today}
                      onCancel={() => setAdding(false)}
                      onAdd={(e) => {
                        patch({ extras: [...form.extras, e] });
                        setAdding(false);
                      }}
                    />
                  )}
                </SectionCard>

                {/* ── Lain-lain ── */}
                <SectionCard icon={RotateCcw} title="Lain-lain">
                  <div className="space-y-2 p-4">
                    <MoneyInput
                      id="pending-refill"
                      label="1. Penggantian petty cash periode lalu yang belum diterima"
                      value={form.pendingRefill}
                      onChange={(n) => patch({ pendingRefill: n })}
                      hint={
                        systemPending > 0
                          ? `Menurut sistem: ${rupiah(systemPending)} — Refill sudah dikirim Finance, belum dikonfirmasi diterima toko.`
                          : 'Menurut sistem: tidak ada Refill yang sedang dalam perjalanan.'
                      }
                    />
                    {form.pendingRefill !== systemPending && (
                      <button
                        type="button"
                        onClick={() => patch({ pendingRefill: systemPending })}
                        className="flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-xs font-bold text-amber-700 hover:underline"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Pakai angka sistem ({rupiah(systemPending)})
                      </button>
                    )}
                  </div>
                </SectionCard>

                {/* ── Rincian kas ── */}
                <SectionCard
                  icon={Coins}
                  title={<>Rincian Kas <span className="ml-1 text-xs font-semibold tabular-nums text-slate-400">{countsPieces(form.counts)} pcs</span></>}
                  subtitle="Uang tunai di kotak petty cash, per pecahan."
                >
                  <DenominationCounter idPrefix="petty" counts={form.counts} onChange={(update) => setForm((f) => (f ? { ...f, counts: update(f.counts) } : f))} />
                </SectionCard>

                <SectionCard icon={NotebookPen} title="Catatan" subtitle="Opsional — tidak dicetak di Berita Acara.">
                  <div className="p-4">
                    <textarea
                      value={form.notes}
                      maxLength={NOTES_MAX}
                      onChange={(e) => patch({ notes: e.target.value })}
                      rows={3}
                      placeholder="Mis. 2 struk tidak ditemukan, sudah dikonfirmasi ke PIC 1…"
                      className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-800 shadow-xs outline-none placeholder:text-slate-300 focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
                    />
                  </div>
                </SectionCard>
              </div>

              <aside className="space-y-4 lg:sticky lg:top-4">
                <SectionCard icon={ClipboardList} title="Ringkasan Petty Cash">
                  <div className="px-4 py-3">
                    <SumLine label="Petty Cash" value={PETTY_CASH_FUND} />
                    <SumLine label={`Total cashout (${totals.checkedCount + form.extras.length} baris)`} value={totals.cashout} sign="−" />
                    <SumLine label="Penggantian belum diterima" value={form.pendingRefill} sign="−" />
                    <SumLine label="Sisa petty cash menurut buku" value={totals.pettyBook} strong />
                    <div className="h-2" />
                    <SumLine label="Jumlah fisik KAS Petty Cash" value={totals.pettyPhysical} strong />
                    <div
                      className={cn(
                        'mt-3 rounded-xl px-3 py-3 ring-1 ring-inset',
                        totals.pettyDiff === 0 ? 'bg-emerald-50 ring-emerald-100' : totals.pettyDiff < 0 ? 'bg-rose-50 ring-rose-100' : 'bg-amber-50 ring-amber-100',
                      )}
                    >
                      <p className="text-xs font-semibold text-slate-500">Selisih Petty Cash menurut buku dengan fisik kas</p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className={cn('text-xl font-extrabold tabular-nums', diffTextClass(totals.pettyDiff))}>
                          {totals.pettyDiff > 0 ? '+' : ''}
                          {rupiah(totals.pettyDiff)}
                        </p>
                        <DiffChip diff={totals.pettyDiff} />
                      </div>
                    </div>
                  </div>
                </SectionCard>

                {data.petty.systemBalance != null && (
                  <div className="flex gap-3 rounded-2xl border border-sky-100 bg-sky-50/70 p-3.5 text-sm">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                    <div className="min-w-0 text-sky-900">
                      <p className="font-semibold">Saldo petty cash menurut PRISM: {rupiah(data.petty.systemBalance)}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-sky-700">
                        {data.petty.systemBalance === totals.pettyBook
                          ? 'Sama dengan sisa menurut buku di atas.'
                          : `Beda ${rupiah(Math.abs(data.petty.systemBalance - totals.pettyBook))} dari sisa menurut buku — biasanya karena ada baris yang belum dicentang atau pengeluaran lain.`}
                      </p>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </>
        ) : null}
      </div>

      {form && totals && storeId && (
        <SaveBar
          diff={totals.pettyDiff}
          physical={countsTotal(form.counts)}
          book={totals.pettyBook}
          saving={saving}
          dirty={dirty || !savedOnce}
          onSave={() => void save()}
        />
      )}

      {lightbox && (
        <ImageLightbox
          title="Struk petty cash"
          images={lightbox.images}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox((l) => (l ? { ...l, index } : l))}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

// ─── One checklist line ──────────────────────────────────────────────────────

function ChecklistRow({
  item,
  noteOpen,
  onToggle,
  onNoteToggle,
  onNote,
  onReceipt,
}: {
  item: PettyCheckItem;
  noteOpen: boolean;
  onToggle: () => void;
  onNoteToggle: () => void;
  onNote: (note: string) => void;
  onReceipt: () => void;
}) {
  return (
    <li className={cn('transition-colors', item.checked ? 'bg-emerald-50/40' : 'bg-white')}>
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={item.checked}
          onClick={onToggle}
          className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition active:scale-90',
            item.checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white hover:border-amber-400',
          )}
          aria-label={`Centang ${item.description}`}
        >
          {item.checked && <Check className="h-4 w-4" strokeWidth={3} />}
        </button>

        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-semibold text-slate-400">
            <span className="tabular-nums">{shortDay(item.date)}</span>
            {item.category && <span className="truncate">· {item.category}</span>}
            {item.isReRequest && <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-700">Re-request</span>}
          </p>
          <p className={cn('mt-0.5 line-clamp-2 text-sm font-semibold leading-snug', item.checked ? 'text-slate-900' : 'text-slate-700')}>
            {item.description}
          </p>
          {item.requestedBy && <p className="mt-0.5 truncate text-[11px] text-slate-400">#{item.txId} · {item.requestedBy}</p>}
        </button>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <p className="text-sm font-bold tabular-nums text-slate-900">{rupiah(item.amount)}</p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onReceipt}
              disabled={!item.imageUrl}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-30"
              aria-label="Lihat struk"
              title={item.imageUrl ? 'Lihat struk' : 'Tidak ada foto struk'}
            >
              <ImageIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onNoteToggle}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg border transition',
                item.note ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700',
              )}
              aria-label="Catatan baris"
              title="Catatan"
            >
              <PencilLine className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {(noteOpen || item.note) && (
        <div className="px-4 pb-3 pl-13">
          {noteOpen ? (
            <input
              autoFocus
              value={item.note ?? ''}
              maxLength={PETTY_ITEM_NOTE_MAX}
              onChange={(e) => onNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onNoteToggle()}
              placeholder="Catatan auditor, mis. struk tidak ada"
              className="h-10 w-full rounded-lg border border-amber-200 bg-white px-3 text-base text-slate-800 outline-none placeholder:text-slate-300 focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
            />
          ) : (
            <button type="button" onClick={onNoteToggle} className="text-left text-xs italic text-amber-800">
              “{item.note}”
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// ─── Add an extra line ───────────────────────────────────────────────────────

function ExtraEditor({
  defaultDate,
  maxDate,
  onAdd,
  onCancel,
}: {
  defaultDate: string;
  maxDate: string;
  onAdd: (e: PettyExtraItem) => void;
  onCancel: () => void;
}) {
  const [day, setDay] = useState(defaultDate);
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const valid = description.trim().length > 0 && qty >= 1 && price > 0 && Boolean(day);

  return (
    <div className="space-y-3 border-t border-amber-100 bg-amber-50/40 p-4">
      <div className="grid gap-3 min-[420px]:grid-cols-[150px_minmax(0,1fr)]">
        <div>
          <label htmlFor="extra-date" className="mb-1 block text-xs font-semibold text-slate-600">
            Tanggal
          </label>
          <input
            id="extra-date"
            type="date"
            value={day}
            max={maxDate}
            onChange={(e) => setDay(e.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900 shadow-xs outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="extra-desc" className="mb-1 block text-xs font-semibold text-slate-600">
            Keperluan
          </label>
          <input
            id="extra-desc"
            value={description}
            maxLength={PETTY_EXTRA_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value.toLocaleUpperCase('id-ID'))}
            placeholder="MIS. AIR MINUM ISI ULANG"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900 shadow-xs outline-none placeholder:font-normal placeholder:text-slate-300 focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
          />
        </div>
      </div>
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
        <div>
          <label htmlFor="extra-qty" className="mb-1 block text-xs font-semibold text-slate-600">
            Qty
          </label>
          <input
            id="extra-qty"
            inputMode="numeric"
            value={qty || ''}
            onChange={(e) => setQty(Math.min(9_999, Number(e.target.value.replace(/\D/g, '') || 0)))}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-center text-base font-semibold tabular-nums text-slate-900 shadow-xs outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
          />
        </div>
        <MoneyInput id="extra-price" label="Harga satuan (Basic Price)" value={price} onChange={setPrice} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tabular-nums text-slate-600">Total {rupiah(qty * price)}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-500 hover:bg-white">
            Batal
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onAdd({ key: newKey(), date: day, description: description.trim(), qty, price })}
            className="min-h-10 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-40"
          >
            Tambahkan
          </button>
        </div>
      </div>
    </div>
  );
}
