'use client';
// components/audit/cash-check/CekModalView.tsx — Audit "Cek Modal": the MODAL half of the Berita Acara.
//
// The auditor counts the cashier float in the drawer (per denomination, like the staff's Cek Uang Modal), types the
// sales still in the drawer (cash / debit / credit / voucher) and the float the store should hold (default
// Rp 500.000). Selisih = fisik − (modal + penjualan), exactly as the Excel's L31 − L13.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, Banknote, ClipboardList, Coins, FileText, Info, Loader2, NotebookPen, ReceiptText } from 'lucide-react';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import {
  NOTES_MAX,
  UANG_MODAL_MAX_TOTAL,
  cashCheckTotals,
  countsPieces,
  countsTotal,
  rupiah,
  type CashCheckRecord,
  type DenominationCounts,
} from '@/lib/audit-cash-check';
import {
  CashCheckTabs,
  ContextBar,
  DenominationCounter,
  DiffChip,
  EmptyPick,
  MoneyInput,
  SaveBar,
  SavedStamp,
  SectionCard,
  SumLine,
  dayTitle,
  diffTextClass,
  fetchJson,
  useAuditStores,
  useCashCheckParams,
  type StaffOption,
} from './kit';
import { cn } from '@/lib/utils';

interface Loaded {
  context: { store: { id: number; storeNo: string; name: string; status: string }; staff: StaffOption[]; defaultHolderId: string | null };
  check: CashCheckRecord | null;
  modalRef?: { total: number; by: string | null; at: string | null } | null;
}

interface Form {
  holderId: string | null;
  modalBook: number;
  salesCash: number;
  salesDebit: number;
  salesCredit: number;
  salesVoucher: number;
  counts: DenominationCounts;
  notes: string;
}

function formOf(data: Loaded): Form {
  const c = data.check;
  return {
    holderId: c?.holderUserId ?? data.context.defaultHolderId,
    modalBook: c ? c.modalBook : UANG_MODAL_MAX_TOTAL,
    salesCash: c?.salesCash ?? 0,
    salesDebit: c?.salesDebit ?? 0,
    salesCredit: c?.salesCredit ?? 0,
    salesVoucher: c?.salesVoucher ?? 0,
    counts: c?.modalCounts ?? {},
    notes: c?.modalNotes ?? '',
  };
}

export default function CekModalView() {
  const { storeId, date, today, set, query } = useCashCheckParams();
  const { stores, loading: storesLoading } = useAuditStores();

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [baseline, setBaseline] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await fetchJson<Loaded>(`/api/audit/cash-check?storeId=${storeId}&date=${date}&part=modal`);
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
  const savedOnce = Boolean(data?.check?.modalCheckedAt);

  const guard = (go: () => void) => {
    if (dirty && !window.confirm('Perubahan belum disimpan. Tinggalkan halaman ini?')) return;
    go();
  };

  const totals = useMemo(() => {
    if (!form) return null;
    return cashCheckTotals({
      ...form,
      pettyFund: 0,
      pettyItems: [],
      pettyExtras: [],
      pettyPendingRefill: 0,
      pettyCounts: {},
      modalCounts: form.counts,
    });
  }, [form]);

  async function save() {
    if (!storeId || !form) return;
    setSaving(true);
    try {
      const d = await fetchJson<{ check: CashCheckRecord }>('/api/audit/cash-check', {
        method: 'PUT',
        body: JSON.stringify({
          part: 'modal',
          storeId,
          date,
          holderUserId: form.holderId,
          modalBook: form.modalBook,
          salesCash: form.salesCash,
          salesDebit: form.salesDebit,
          salesCredit: form.salesCredit,
          salesVoucher: form.salesVoucher,
          counts: form.counts,
          notes: form.notes,
        }),
      });
      const next = { ...(data as Loaded), check: d.check };
      setData(next);
      const f = formOf(next);
      setForm(f);
      setBaseline(JSON.stringify(f));
      toast.success('Cek Modal tersimpan', { description: `Berita Acara ${d.check.docNumber}` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  const patch = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <PanelPageHeader
        scope="Audit · Pemeriksaan Kas"
        title={<><Banknote />Cek Modal</>}
        subtitle="Hitung uang modal kasir untuk Berita Acara Pemeriksaan Kas"
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
          <EmptyPick title="Pilih toko yang diperiksa" body="Pilih toko dan tanggal pemeriksaan. Hasil Cek Modal dan Cek Petty Cash masuk ke satu Berita Acara." />
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
            <StatusStrip check={data.check} date={date} savedOnce={savedOnce} />

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
                <SectionCard icon={ReceiptText} title="Modal & Penjualan" subtitle="Modal menurut buku dan penjualan yang masih ada di laci saat diperiksa.">
                  <div className="space-y-4 p-4">
                    <MoneyInput
                      id="modal-book"
                      label="Modal"
                      value={form.modalBook}
                      onChange={(n) => patch({ modalBook: n })}
                      hint={`Uang modal kasir menurut buku — standar ${rupiah(UANG_MODAL_MAX_TOTAL)}.`}
                    />
                    <div>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Penjualan</p>
                      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                        <MoneyInput id="sales-cash" label="1. Cash Penjualan" value={form.salesCash} onChange={(n) => patch({ salesCash: n })} />
                        <MoneyInput id="sales-debit" label="2. Flash/Debit Card" value={form.salesDebit} onChange={(n) => patch({ salesDebit: n })} />
                        <MoneyInput id="sales-credit" label="3. Credit Card" value={form.salesCredit} onChange={(n) => patch({ salesCredit: n })} />
                        <MoneyInput id="sales-voucher" label="4. Voucher" value={form.salesVoucher} onChange={(n) => patch({ salesVoucher: n })} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-amber-50/70 px-3 py-2.5 ring-1 ring-inset ring-amber-100">
                      <span className="text-sm font-semibold text-amber-900">Jumlah Modal + Penjualan</span>
                      <span className="text-base font-extrabold tabular-nums text-amber-900">{rupiah(totals.modalPlusSales)}</span>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  icon={Coins}
                  title={<>Rincian Modal <span className="ml-1 text-xs font-semibold tabular-nums text-slate-400">{countsPieces(form.counts)} pcs</span></>}
                  subtitle="Jumlah lembar / koin per pecahan di laci kasir."
                >
                  <DenominationCounter idPrefix="modal" counts={form.counts} onChange={(update) => setForm((f) => (f ? { ...f, counts: update(f.counts) } : f))} />
                </SectionCard>

                <SectionCard icon={NotebookPen} title="Catatan" subtitle="Opsional — tidak dicetak di Berita Acara.">
                  <div className="p-4">
                    <textarea
                      value={form.notes}
                      maxLength={NOTES_MAX}
                      onChange={(e) => patch({ notes: e.target.value })}
                      rows={3}
                      placeholder="Mis. kasir sedang melayani pelanggan saat dihitung…"
                      className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-800 shadow-xs outline-none placeholder:text-slate-300 focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
                    />
                  </div>
                </SectionCard>
              </div>

              <aside className="space-y-4 lg:sticky lg:top-4">
                <SectionCard icon={ClipboardList} title="Ringkasan Modal">
                  <div className="px-4 py-3">
                    <SumLine label="Modal" value={form.modalBook} />
                    <SumLine label="Penjualan" value={totals.sales} sign="+" />
                    <SumLine label="Jumlah Modal + Penjualan" value={totals.modalPlusSales} strong />
                    <div className="h-2" />
                    <SumLine label="Jumlah uang tunai KAS Modal" value={totals.modalPhysical} strong />
                    <div className={cn('mt-3 rounded-xl px-3 py-3 ring-1 ring-inset', totals.modalDiff === 0 ? 'bg-emerald-50 ring-emerald-100' : totals.modalDiff < 0 ? 'bg-rose-50 ring-rose-100' : 'bg-amber-50 ring-amber-100')}>
                      <p className="text-xs font-semibold text-slate-500">Selisih modal menurut buku dengan fisik kas</p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className={cn('text-xl font-extrabold tabular-nums', diffTextClass(totals.modalDiff))}>
                          {totals.modalDiff > 0 ? '+' : ''}
                          {rupiah(totals.modalDiff)}
                        </p>
                        <DiffChip diff={totals.modalDiff} />
                      </div>
                    </div>
                  </div>
                </SectionCard>

                {data.modalRef && (
                  <div className="flex gap-3 rounded-2xl border border-sky-100 bg-sky-50/70 p-3.5 text-sm">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                    <div className="min-w-0 text-sky-900">
                      <p className="font-semibold">Cek Uang Modal staf hari itu: {rupiah(data.modalRef.total)}</p>
                      <p className="mt-0.5 text-xs text-sky-700">
                        {data.modalRef.by ?? 'Staf'}
                        {data.modalRef.at
                          ? ` · ${new Date(data.modalRef.at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })}`
                          : ''}
                        {' — '}hanya pembanding, tidak dicetak.
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
          diff={totals.modalDiff}
          physical={countsTotal(form.counts)}
          book={totals.modalPlusSales}
          saving={saving}
          dirty={dirty || !savedOnce}
          onSave={() => void save()}
        />
      )}
    </div>
  );
}

export function StatusStrip({ check, date, savedOnce, part = 'modal' }: { check: CashCheckRecord | null; date: string; savedOnce: boolean; part?: 'modal' | 'petty' }) {
  const other = part === 'modal' ? check?.pettyCheckedAt : check?.modalCheckedAt;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
        <FileText className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-slate-900">
          {check ? `No. ${check.docNumber}` : 'Berita Acara baru'}
          <span className="font-medium text-slate-400"> · {dayTitle(date)}</span>
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
          <SavedStamp at={part === 'modal' ? check?.modalCheckedAt ?? null : check?.pettyCheckedAt ?? null} by={part === 'modal' ? check?.modalCheckedBy ?? null : check?.pettyCheckedBy ?? null} />
          {check && (
            <span className={cn('font-medium', other ? 'text-emerald-600' : 'text-slate-400')}>
              · {part === 'modal' ? 'Petty Cash' : 'Modal'} {other ? 'sudah dicek' : 'belum dicek'}
            </span>
          )}
        </div>
      </div>
      {check && savedOnce && (
        <Link
          href={`/audit/berita-acara/${check.id}`}
          className="flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
        >
          Lihat Berita Acara <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

export function LoadingBlocks() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {[180, 420].map((h) => (
          <div key={h} className="animate-pulse rounded-2xl border border-slate-200 bg-white" style={{ height: h }} />
        ))}
      </div>
      <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
      </div>
    </div>
  );
}
