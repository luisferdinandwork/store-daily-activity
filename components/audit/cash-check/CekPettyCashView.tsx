'use client';
// components/audit/cash-check/CekPettyCashView.tsx — Audit "Cek Petty Cash": the PETTY CASH half of the Berita Acara.
//
// Built phone-first (the auditor stands at the store with a phone): one column, 44 px tap targets, a three-number
// summary on top while the full one sits beside the form on desktop, steps numbered 1–5.
//
// 1. A checklist of every completed request Finance has not covered with a verified Refill yet — the period in use,
//    plus the period before it while its Refill is not verified (lib/db/utils/audit-cash-check.ts). The auditor ticks
//    the ones whose receipt matches; only ticked lines are printed under PENGELUARAN.
// 2. Extra cash-outs the system does not have (typed by the auditor, each WITH a photo of its receipt).
// 3. "Penggantian petty cash periode lalu yang belum diterima" — a Refill Finance sent that the store has not
//    received; pre-filled from the system.
// 4. The petty cash counted per denomination. Selisih = fisik − (dana − cashout − penggantian belum diterima).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Camera,
  Check,
  ChevronDown,
  ClipboardList,
  Coins,
  Hourglass,
  ImagePlus,
  Info,
  ListChecks,
  Loader2,
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
import DocumentScanner from '@/components/shared/DocumentScanner';
import { ImageLightbox, type LightboxImage } from '@/components/shared/ImageLightbox';
import { compressImageFile } from '@/lib/image-compress';
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

/** Sends one receipt photo to object storage (shrunk first) and returns its URL. */
async function uploadExtraPhoto(storeId: number, date: string, file: File): Promise<string> {
  const small = await compressImageFile(file);
  const body = new FormData();
  body.set('file', small);
  body.set('storeId', String(storeId));
  body.set('date', date);
  const res = await fetch('/api/audit/cash-check/photo', { method: 'POST', body });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; url?: string };
  if (!res.ok || data.success === false || !data.url) throw new Error(data.error || `Gagal mengunggah foto (${res.status})`);
  return data.url;
}

/** One numbered step badge for a card title. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-extrabold text-white">{n}</span>
      {children}
    </span>
  );
}

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

  const openExtraPhotos = (key: string) => {
    if (!form) return;
    const withPhoto = form.extras.filter((e) => e.photoUrl);
    const index = withPhoto.findIndex((e) => e.key === key);
    if (index < 0) return;
    setLightbox({
      images: withPhoto.map((e) => ({ url: e.photoUrl as string, label: `${shortDay(e.date)} · ${e.description} · ${rupiah(extraTotal(e))}` })),
      index,
    });
  };

  /** Puts a photo on a line that was saved before photos were required. */
  async function attachExtraPhoto(key: string, file: File) {
    if (!storeId) return;
    const t = toast.loading('Mengunggah foto…');
    try {
      const url = await uploadExtraPhoto(storeId, date, file);
      setForm((f) => (f ? { ...f, extras: f.extras.map((e) => (e.key === key ? { ...e, photoUrl: url } : e)) } : f));
      toast.success('Foto tersimpan di baris — jangan lupa Simpan.', { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengunggah foto.', { id: t });
    }
  }

  const systemPending = data?.petty.pendingRefill ?? 0;
  const allIds = items.map((i) => i.txId);
  const allChecked = items.length > 0 && items.every((i) => i.checked);
  const cashoutRows = totals ? totals.checkedCount + (form?.extras.length ?? 0) : 0;

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <PanelPageHeader
        scope="Audit · Pemeriksaan Kas"
        title={<><Wallet />Cek Petty Cash</>}
        subtitle="Cocokkan pengeluaran yang belum dicek Finance dan hitung kas petty cash"
        tabs={<CashCheckTabs query={query} />}
      />

      <div className="flex-1 space-y-3 p-3 sm:space-y-4 sm:p-6 lg:p-8">
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
            <button type="button" className="min-h-11 font-bold underline" onClick={() => void load()}>
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

            {/* Phone: the three numbers that matter, always at the top. Desktop has the full summary beside the form. */}
            <div className="grid grid-cols-3 divide-x divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs lg:hidden">
              <MiniStat label={`Cashout · ${cashoutRows} baris`} value={rupiah(totals.cashout)} />
              <MiniStat label="Sisa menurut buku" value={rupiah(totals.pettyBook)} />
              <MiniStat label="Fisik kas" value={rupiah(totals.pettyPhysical)} />
            </div>

            <div className="grid items-start gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0 space-y-3 sm:space-y-4">
                {/* ── 1 · Checklist ── */}
                <SectionCard
                  icon={ListChecks}
                  title={<Step n={1}>Pengeluaran belum dicek Finance</Step>}
                  subtitle="Request selesai yang belum ditutup Refill terverifikasi Finance. Centang yang struknya sesuai — hanya yang dicentang masuk PENGELUARAN."
                  action={
                    items.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setAll(allIds, !allChecked)}
                        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600 transition active:bg-amber-50 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 sm:min-h-9 sm:w-auto sm:rounded-lg sm:text-xs"
                      >
                        {allChecked ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                        {allChecked ? 'Hapus semua centang' : 'Centang semua'}
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
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-slate-100 bg-slate-50 px-4 py-2.5 first:border-t-0">
                              <p className="text-sm font-bold text-slate-800">Periode {monthLabelId(g.month)}</p>
                              <span
                                className={cn(
                                  'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                  g.savedOnly ? 'border-slate-200 bg-white text-slate-500' : STATE_TONE[g.refillState],
                                )}
                              >
                                {g.savedOnly ? 'Tersimpan sebelumnya' : PERIOD_REFILL_STATE_LABEL[g.refillState]}
                              </span>
                              <p className="w-full text-xs text-slate-400 min-[420px]:w-auto">{g.rangeLabel}</p>
                              <span className="text-xs font-semibold tabular-nums text-slate-500 min-[420px]:ml-auto">
                                {groupChecked}/{groupItems.length} · {rupiah(groupTotal)}
                              </span>
                            </div>
                            {g.verifiedAt && !g.savedOnly && (
                              <p className="border-b border-slate-100 bg-violet-50/40 px-4 py-1.5 text-[11px] leading-snug text-violet-700">
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
                        className="flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left text-xs font-semibold text-slate-500 hover:bg-slate-50"
                      >
                        <Hourglass className="h-4 w-4 shrink-0 text-sky-500" />
                        <span className="flex-1 leading-snug">
                          {data.petty.inProgress.length} request disetujui OPS, jumlah aktual belum dicatat PIC 1 (tidak dihitung)
                        </span>
                        <ChevronDown className={cn('h-4 w-4 shrink-0 transition', showInProgress && 'rotate-180')} />
                      </button>
                      {showInProgress && (
                        <ul className="divide-y divide-slate-100 bg-sky-50/30">
                          {data.petty.inProgress.map((t) => (
                            <li key={t.txId} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                              <span className="w-12 shrink-0 pt-px text-xs text-slate-400">{shortDay(t.date)}</span>
                              <span className="min-w-0 flex-1 text-slate-600">{t.description}</span>
                              <span className="shrink-0 tabular-nums text-slate-500">{rupiah(t.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </SectionCard>

                {/* ── 2 · Extra lines ── */}
                <SectionCard
                  icon={ReceiptText}
                  title={<Step n={2}>Pengeluaran lain</Step>}
                  subtitle="Struk di kotak petty cash yang belum ada di sistem. Foto struknya wajib dilampirkan. Ikut dicetak di PENGELUARAN."
                >
                  {form.extras.length > 0 && (
                    <ul className="divide-y divide-slate-100">
                      {form.extras.map((e) => (
                        <ExtraRow
                          key={e.key}
                          extra={e}
                          onOpenPhoto={() => openExtraPhotos(e.key)}
                          onAttach={(file) => void attachExtraPhoto(e.key, file)}
                          onRemove={() => patch({ extras: form.extras.filter((x) => x.key !== e.key) })}
                        />
                      ))}
                    </ul>
                  )}
                  {adding ? (
                    <ExtraEditor
                      defaultDate={date}
                      maxDate={today}
                      upload={(file) => (storeId ? uploadExtraPhoto(storeId, date, file) : Promise.reject(new Error('Pilih toko dulu.')))}
                      onCancel={() => setAdding(false)}
                      onAdd={(e) => {
                        patch({ extras: [...form.extras, e] });
                        setAdding(false);
                      }}
                    />
                  ) : form.extras.length < PETTY_EXTRA_MAX ? (
                    <div className={cn('p-3', form.extras.length > 0 && 'border-t border-slate-100')}>
                      <button
                        type="button"
                        onClick={() => setAdding(true)}
                        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/50 text-sm font-bold text-amber-800 transition active:bg-amber-100 hover:bg-amber-50"
                      >
                        <Plus className="h-4 w-4" /> Tambah pengeluaran lain
                      </button>
                    </div>
                  ) : null}
                </SectionCard>

                {/* ── 3 · Lain-lain ── */}
                <SectionCard icon={RotateCcw} title={<Step n={3}>Lain-lain</Step>}>
                  <div className="space-y-2 p-4">
                    <MoneyInput
                      id="pending-refill"
                      label="Penggantian petty cash periode lalu yang belum diterima"
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
                        className="flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-bold text-amber-700 hover:underline"
                      >
                        <RotateCcw className="h-4 w-4" /> Pakai angka sistem ({rupiah(systemPending)})
                      </button>
                    )}
                  </div>
                </SectionCard>

                {/* ── 4 · Rincian kas ── */}
                <SectionCard
                  icon={Coins}
                  title={
                    <Step n={4}>
                      Rincian Kas <span className="text-xs font-semibold tabular-nums text-slate-400">{countsPieces(form.counts)} pcs</span>
                    </Step>
                  }
                  subtitle="Uang tunai di kotak petty cash, per pecahan."
                >
                  <DenominationCounter idPrefix="petty" counts={form.counts} onChange={(update) => setForm((f) => (f ? { ...f, counts: update(f.counts) } : f))} />
                </SectionCard>

                {/* ── 5 · Catatan ── */}
                <SectionCard icon={NotebookPen} title={<Step n={5}>Catatan</Step>} subtitle="Opsional — tidak dicetak di Berita Acara.">
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

              <aside className="min-w-0 space-y-3 sm:space-y-4 lg:sticky lg:top-4">
                <SectionCard icon={ClipboardList} title="Ringkasan Petty Cash">
                  <div className="px-4 py-3">
                    <SumLine label="Petty Cash" value={PETTY_CASH_FUND} />
                    <SumLine label={`Total cashout (${cashoutRows} baris)`} value={totals.cashout} sign="−" />
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
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2.5 py-2.5 text-center">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-extrabold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

/** A receipt thumbnail that opens the lightbox. */
function Thumb({ url, onOpen, label }: { url: string; onOpen: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 transition active:scale-95 hover:border-amber-300"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
    </button>
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
    <li className={cn('transition-colors', item.checked ? 'bg-emerald-50/50' : 'bg-white')}>
      {/* The whole top part is one big tap target; the photo + note buttons below stay separate. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={item.checked}
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 pb-1 pt-3 text-left active:bg-slate-50"
      >
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition',
            item.checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white',
          )}
          aria-hidden="true"
        >
          {item.checked && <Check className="h-4 w-4" strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-semibold text-slate-400">
            <span className="tabular-nums">{shortDay(item.date)}</span>
            {item.category && <span className="truncate">· {item.category}</span>}
            {item.isReRequest && <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-700">Re-request</span>}
          </span>
          <span className={cn('mt-0.5 block text-sm font-semibold leading-snug', item.checked ? 'text-slate-900' : 'text-slate-700')}>
            {item.description}
          </span>
          {item.requestedBy && <span className="mt-0.5 block truncate text-[11px] text-slate-400">#{item.txId} · {item.requestedBy}</span>}
        </span>
        <span className="shrink-0 pt-0.5 text-sm font-bold tabular-nums text-slate-900">{rupiah(item.amount)}</span>
      </button>

      <div className="flex items-center gap-2 py-2 pl-[3.25rem] pr-4">
        {item.imageUrl ? (
          <Thumb url={item.imageUrl} onOpen={onReceipt} label={`Lihat struk ${item.description}`} />
        ) : (
          <span className="flex h-14 min-w-14 items-center justify-center rounded-xl border border-dashed border-slate-200 px-2 text-center text-[10px] font-semibold leading-tight text-slate-300">
            Tanpa foto
          </span>
        )}
        <button
          type="button"
          onClick={onNoteToggle}
          className={cn(
            'flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition',
            item.note || noteOpen
              ? 'border-amber-300 bg-amber-50 text-amber-800'
              : 'border-slate-200 text-slate-500 active:bg-amber-50 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700',
          )}
        >
          <PencilLine className="h-4 w-4" />
          {item.note ? 'Ubah catatan' : 'Catatan'}
        </button>
      </div>

      {(noteOpen || item.note) && (
        <div className="px-4 pb-3 pl-[3.25rem]">
          {noteOpen ? (
            <input
              autoFocus
              value={item.note ?? ''}
              maxLength={PETTY_ITEM_NOTE_MAX}
              onChange={(e) => onNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onNoteToggle()}
              placeholder="Catatan auditor, mis. struk tidak ada"
              className="h-11 w-full rounded-xl border border-amber-200 bg-white px-3 text-base text-slate-800 outline-none placeholder:text-slate-300 focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
            />
          ) : (
            <p className="text-xs italic leading-snug text-amber-800">“{item.note}”</p>
          )}
        </div>
      )}
    </li>
  );
}

// ─── One extra line ──────────────────────────────────────────────────────────

function ExtraRow({
  extra,
  onOpenPhoto,
  onAttach,
  onRemove,
}: {
  extra: PettyExtraItem;
  onOpenPhoto: () => void;
  onAttach: (file: File) => void;
  onRemove: () => void;
}) {
  const pick = useRef<HTMLInputElement>(null);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      {extra.photoUrl ? (
        <Thumb url={extra.photoUrl} onOpen={onOpenPhoto} label={`Lihat foto struk ${extra.description}`} />
      ) : (
        <>
          <button
            type="button"
            onClick={() => pick.current?.click()}
            className="flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-dashed border-rose-300 bg-rose-50 text-[10px] font-bold leading-tight text-rose-600 transition active:scale-95"
            aria-label={`Tambah foto struk ${extra.description}`}
          >
            <Camera className="h-4 w-4" />
            Foto
          </button>
          <input
            ref={pick}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onAttach(f);
            }}
          />
        </>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-slate-800">{extra.description}</p>
        <p className="mt-0.5 text-xs text-slate-400">
          {shortDay(extra.date)} · {extra.qty} × {rupiah(extra.price)}
        </p>
        <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{rupiah(extraTotal(extra))}</p>
        {!extra.photoUrl && <p className="mt-0.5 text-[11px] font-semibold text-rose-600">Belum ada foto struk</p>}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition active:bg-rose-100 hover:bg-rose-50 hover:text-rose-600"
        aria-label={`Hapus ${extra.description}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

// ─── Add an extra line ───────────────────────────────────────────────────────

/** Receipt photo for a new extra line: scan with the in-app camera, or pick one from the gallery. */
function ReceiptPhotoField({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const [scan, setScan] = useState(false);
  const gallery = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600">
        Foto struk <span className="text-rose-500">*</span>
      </p>
      {preview ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Foto struk yang dipilih" className="h-20 w-20 shrink-0 rounded-xl border border-white object-cover shadow-xs" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-sm font-bold text-emerald-800">
              <Check className="h-4 w-4" /> Foto siap
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button type="button" onClick={() => setScan(true)} className="min-h-10 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-800 active:bg-emerald-100">
                Foto ulang
              </button>
              <button type="button" onClick={() => onFile(null)} className="min-h-10 rounded-lg px-3 text-xs font-semibold text-slate-500 active:bg-white">
                Hapus
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setScan(true)}
            className="flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-amber-300 bg-white text-sm font-bold text-amber-800 transition active:bg-amber-50"
          >
            <Camera className="h-6 w-6" />
            Foto struk
          </button>
          <button
            type="button"
            onClick={() => gallery.current?.click()}
            className="flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-300 bg-white text-sm font-bold text-slate-600 transition active:bg-slate-50"
          >
            <ImagePlus className="h-6 w-6" />
            Dari galeri
          </button>
        </div>
      )}
      <input
        ref={gallery}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      <DocumentScanner
        open={scan}
        onClose={() => setScan(false)}
        onCapture={(f) => {
          setScan(false);
          onFile(f);
        }}
        title="Foto struk"
      />
    </div>
  );
}

function ExtraEditor({
  defaultDate,
  maxDate,
  upload,
  onAdd,
  onCancel,
}: {
  defaultDate: string;
  maxDate: string;
  upload: (file: File) => Promise<string>;
  onAdd: (e: PettyExtraItem) => void;
  onCancel: () => void;
}) {
  const [day, setDay] = useState(defaultDate);
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = description.trim().length > 0 && qty >= 1 && price > 0 && Boolean(day) && photo != null;

  async function add() {
    if (!photo || !valid) return;
    setBusy(true);
    try {
      const photoUrl = await upload(photo);
      onAdd({ key: newKey(), date: day, description: description.trim(), qty, price, photoUrl });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengunggah foto.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-amber-100 bg-amber-50/40 p-3 sm:p-4">
      <ReceiptPhotoField file={photo} onFile={setPhoto} />

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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="extra-date" className="mb-1 block text-xs font-semibold text-slate-600">
            Tanggal struk
          </label>
          <input
            id="extra-date"
            type="date"
            value={day}
            max={maxDate}
            onChange={(e) => setDay(e.target.value)}
            className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900 shadow-xs outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="extra-qty" className="mb-1 block text-xs font-semibold text-slate-600">
            Qty
          </label>
          <input
            id="extra-qty"
            inputMode="numeric"
            value={qty || ''}
            onChange={(e) => setQty(Math.min(9_999, Number(e.target.value.replace(/\D/g, '') || 0)))}
            onFocus={(e) => e.currentTarget.select()}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-center text-base font-semibold tabular-nums text-slate-900 shadow-xs outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
          />
        </div>
      </div>

      <MoneyInput id="extra-price" label="Harga satuan (Basic Price)" value={price} onChange={setPrice} />

      <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2.5 ring-1 ring-inset ring-slate-100">
        <span className="text-xs font-semibold text-slate-500">Total</span>
        <span className="text-base font-extrabold tabular-nums text-slate-900">{rupiah(qty * price)}</span>
      </div>

      {!photo && <p className="text-[11px] font-semibold text-rose-600">Lampirkan foto struk dulu untuk menambahkan.</p>}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="min-h-12 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 transition active:bg-slate-50 disabled:opacity-50"
        >
          Batal
        </button>
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void add()}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-500 text-sm font-bold text-white shadow-sm transition active:bg-amber-600 hover:bg-amber-600 disabled:opacity-40"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? 'Mengunggah…' : 'Tambahkan'}
        </button>
      </div>
    </div>
  );
}
