'use client';
// components/audit/stock-opname/StockOpnameView.tsx — Audit "Stock Opname": the count of one store on one day.
//
// The auditor scans the store's bins in Business Central (full or ~50 %), then picks the store + day here. Every number
// starts from BC (the day's Cek Bin lines, the bins holding stock now, POS sales — lib/audit-stock-opname.ts) and can
// be changed; ShoppingBag and the findings are typed. Saving creates the Berita Acara SO + Surat Pernyataan
// (/audit/berita-acara-so/[id]), which print exactly these numbers.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Boxes,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  FileText,
  Info,
  ListChecks,
  NotebookPen,
  Plus,
  RefreshCw,
  ScanLine,
  Trash2,
  Wand2,
} from 'lucide-react';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { cn } from '@/lib/utils';
import { TONES } from '@/lib/status-theme';
import {
  SO_FINDINGS_MAX,
  SO_FINDING_MAX,
  SO_NOTES_MAX,
  SO_QTY_MAX,
  SO_VALUE_MAX,
  idNumber,
  longDateId,
  signedPcs,
  soRupiah,
  soTotals,
  suggestFromBc,
  type SoBcSnapshot,
  type SoNumbers,
  type StockOpnameRecord,
} from '@/lib/audit-stock-opname';
import {
  ContextBar,
  EmptyPick,
  SavedStamp,
  SectionCard,
  fetchJson,
  useAuditStores,
  useCashCheckParams,
  type StaffOption,
} from '@/components/audit/cash-check/kit';
import SoTabs from './SoTabs';

interface Loaded {
  context: { store: { id: number; storeNo: string; name: string; status: string }; staff: StaffOption[]; defaultHolderId: string | null };
  so: StockOpnameRecord | null;
  bc: SoBcSnapshot;
}

interface Form extends SoNumbers {
  holderId: string | null;
  findings: string[];
  notes: string;
}

function formOf(d: Loaded): Form {
  const s = d.so;
  if (s) {
    return {
      holderId: s.holderUserId ?? d.context.defaultHolderId,
      sohBc: s.sohBc,
      scanQty: s.scanQty,
      shoppingBagQty: s.shoppingBagQty,
      transSalesQty: s.transSalesQty,
      valuePlus: s.valuePlus,
      valueMinus: s.valueMinus,
      binsTotal: s.binsTotal,
      binsMatch: s.binsMatch,
      binsMismatch: s.binsMismatch,
      findings: s.findings,
      notes: s.notes ?? '',
    };
  }
  return { holderId: d.context.defaultHolderId, ...suggestFromBc(d.bc), findings: [], notes: '' };
}

export default function StockOpnameView() {
  const { storeId, date, today, set, query } = useCashCheckParams();
  const { stores, loading: storesLoading } = useAuditStores();

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (!storeId) return;
      setLoading(true);
      setError(null);
      try {
        const d = await fetchJson<Loaded>(`/api/audit/stock-opname?storeId=${storeId}&date=${date}${refresh ? '&refresh=1' : ''}`);
        setData(d);
        if (!refresh) {
          const f = formOf(d);
          setForm(f);
          setBaseline(JSON.stringify(f));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Gagal memuat.');
        if (!refresh) {
          setData(null);
          setForm(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [storeId, date],
  );

  useEffect(() => {
    if (storeId) void load();
    else {
      setData(null);
      setForm(null);
    }
  }, [storeId, load]);

  const dirty = form != null && JSON.stringify(form) !== baseline;
  const guard = (go: () => void) => {
    if (dirty && !window.confirm('Perubahan belum disimpan. Tinggalkan halaman ini?')) return;
    go();
  };
  const patch = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
  const totals = useMemo(() => (form ? soTotals(form) : null), [form]);
  const bc = data?.bc ?? null;

  function fillFromBc() {
    if (!bc) return;
    setForm((f) => (f ? filledFromBc(f, bc) : f));
    toast.success('Angka diisi dari Business Central', { description: 'ShoppingBag dan temuan tidak diubah.' });
  }

  async function save() {
    if (!storeId || !form) return;
    if (form.binsTotal > 0 && form.binsMatch + form.binsMismatch > form.binsTotal) {
      toast.error('Bin sesuai + tidak sesuai lebih dari total bin store.');
      return;
    }
    setSaving(true);
    try {
      const d = await fetchJson<{ so: StockOpnameRecord }>('/api/audit/stock-opname', {
        method: 'PUT',
        body: JSON.stringify({ storeId, date, holderUserId: form.holderId, ...form, findings: form.findings.filter((f) => f.trim()) }),
      });
      const next = { ...(data as Loaded), so: d.so };
      setData(next);
      const f = formOf(next);
      setForm(f);
      setBaseline(JSON.stringify(f));
      toast.success('Stock Opname tersimpan', { description: `Berita Acara ${d.so.docNumber}` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  const saved = data?.so ?? null;
  const store = data?.context.store;

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <PanelPageHeader
        scope="Audit · Cek Bin & SO"
        title={<><ClipboardCheck />Stock Opname</>}
        subtitle={store ? `${store.storeNo} · ${store.name} · ${longDateId(date)}` : 'Hasil stock opname toko — angka awal dari Business Central'}
        tabs={<SoTabs query={query} />}
        hideTabsOnPhone
        hideActionsOnPhone
        actions={
          saved ? (
            <>
              <Link
                href={`/audit/berita-acara-so/${saved.id}`}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50"
                onClick={(e) => {
                  if (dirty && !window.confirm('Perubahan belum disimpan. Tinggalkan halaman ini?')) e.preventDefault();
                }}
              >
                <FileText className="h-4 w-4" /> <span className="sm:hidden">BA</span>
                <span className="hidden sm:inline">Berita Acara & Surat</span>
              </Link>
              <Link
                href={`/audit/berita-acara-so/${saved.id}/super-reward`}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50"
                onClick={(e) => {
                  if (dirty && !window.confirm('Perubahan belum disimpan. Tinggalkan halaman ini?')) e.preventDefault();
                }}
              >
                <Award className="h-4 w-4" /> Super Reward
              </Link>
            </>
          ) : undefined
        }
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
          holderLabel="Head Store"
          dateLabel="Tanggal stock opname"
        />

        {!storeId ? (
          <EmptyPick
            title="Pilih toko yang di-stock opname"
            body="Pilih toko dan tanggal scan bin di Business Central. Angka SOH, hasil scan dan data bin terisi otomatis dari BC."
          />
        ) : loading && !form ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-white" />
            ))}
          </div>
        ) : error && !form ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}{' '}
            <button type="button" className="font-bold underline" onClick={() => void load()}>
              Coba lagi
            </button>
          </div>
        ) : form && totals && data ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-xs">
              {saved ? (
                <>
                  <span className="font-bold text-slate-800">No. {saved.docNumber}</span>
                  <SavedStamp at={saved.checkedAt} by={saved.checkedBy} />
                  {/* The header holds these on desktop; on a phone they live here, one tap each. */}
                  <div className="mt-1.5 grid w-full grid-cols-2 gap-2 md:hidden">
                    <Link
                      href={`/audit/berita-acara-so/${saved.id}`}
                      onClick={(e) => dirty && !window.confirm('Perubahan belum disimpan. Tinggalkan halaman ini?') && e.preventDefault()}
                      className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 active:bg-amber-50"
                    >
                      <FileText className="h-4 w-4 text-amber-600" /> Berita Acara
                    </Link>
                    <Link
                      href={`/audit/berita-acara-so/${saved.id}/super-reward`}
                      onClick={(e) => dirty && !window.confirm('Perubahan belum disimpan. Tinggalkan halaman ini?') && e.preventDefault()}
                      className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 active:bg-amber-50"
                    >
                      <Award className="h-4 w-4 text-amber-600" /> Super Reward
                    </Link>
                  </div>
                </>
              ) : (
                <span className="text-slate-600">
                  <span className="font-bold text-slate-800">Belum disimpan.</span> Angka di bawah diambil dari Business Central — periksa, ubah bila perlu, lalu Simpan.
                </span>
              )}
            </div>

            <div className="grid items-start gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              {/* BC panel: first on a phone (its "Isi dari BC" shortcut is what the auditor needs before typing), a side column from xl. */}
              <BcPanel
                bc={bc}
                loading={loading}
                onRefresh={() => void load(true)}
                onFill={fillFromBc}
                differs={!!bc && JSON.stringify(pickNumbers(form)) !== JSON.stringify(pickNumbers(filledFromBc(form, bc)))}
              />
              <div className="space-y-3 sm:space-y-4 xl:col-start-1 xl:row-start-1">
                {/* ── Hasil perhitungan ── */}
                <SectionCard
                  icon={Boxes}
                  title="Hasil perhitungan SO"
                  subtitle="Qty BC = stok menurut Business Central. Hasil Scan = yang dihitung fisik. Semua dalam Prs/Pcs."
                >
                  <div className="space-y-4 p-3 sm:p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <QtyInput
                        id="soh-bc"
                        label={`SOH BC ${longDateId(date)}`}
                        badge="Qty BC"
                        value={form.sohBc}
                        onChange={(n) => patch({ sohBc: n })}
                        hint={
                          <>
                            {bc && bc.state === 'ok' ? `Σ qty bin di BC dari ${bc.checkedBins} bin yang di-scan: ${idNumber(bc.binQty)}.` : 'Data BC belum tersedia.'}
                            {bc?.storeQty != null && (
                              <>
                                {' '}Isi bin seluruh toko saat ini: {idNumber(bc.storeQty)}{' '}
                                <UseChip onClick={() => patch({ sohBc: bc.storeQty ?? 0 })} />
                              </>
                            )}
                          </>
                        }
                      />
                      <QtyInput
                        id="scan-all"
                        label="Scan All Fisik Barang"
                        badge="Hasil Scan"
                        value={form.scanQty}
                        onChange={(n) => patch({ scanQty: n })}
                        hint={bc && bc.state === 'ok' ? `Σ qty scan di BC: ${idNumber(bc.scanQty)} (${idNumber(bc.lines)} baris item).` : undefined}
                      />
                      <QtyInput
                        id="shopping-bag"
                        label="ShoppingBag"
                        badge="Hasil Scan"
                        value={form.shoppingBagQty}
                        onChange={(n) => patch({ shoppingBagQty: n })}
                        hint="Dihitung manual — shopping bag yang ada di toko."
                      />
                      <QtyInput
                        id="trans-sales"
                        label={`Trans Sales, ${longDateId(date)}`}
                        badge="Hasil Scan"
                        value={form.transSalesQty}
                        onChange={(n) => patch({ transSalesQty: n })}
                        hint={
                          bc?.salesQty != null ? (
                            <>
                              Penjualan POS di BC hari itu: {idNumber(bc.salesQty)} pcs{' '}
                              {bc.salesQty !== form.transSalesQty && <UseChip onClick={() => patch({ transSalesQty: bc.salesQty ?? 0 })} />}
                            </>
                          ) : (
                            'Penjualan BC tidak tersedia — isi manual.'
                          )
                        }
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-100 sm:grid-cols-3 sm:p-3">
                      <Stat label="TOTAL Qty BC" value={idNumber(totals.bcTotal)} />
                      <Stat label="TOTAL Hasil Scan" value={idNumber(totals.scanTotal)} />
                      <Stat
                        className="col-span-2 sm:col-span-1"
                        label="Selisih plus / (minus)"
                        value={signedPcs(totals.qtyDiff)}
                        tone={totals.qtyDiff === 0 ? 'success' : totals.qtyDiff < 0 ? 'danger' : 'warning'}
                      />
                    </div>
                  </div>
                </SectionCard>

                {/* ── Nilai selisih ── */}
                <SectionCard
                  icon={CircleDollarSign}
                  title="Nilai selisih (Rp)"
                  subtitle="Selisih all artikel lebih (+) dan kurang (−), All Brand. Boleh dikosongkan — tercetak “-”."
                >
                  <div className="space-y-3 p-3 sm:p-4">
                    {bc && bc.priceField == null && (
                      <div className="flex gap-2.5 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 ring-1 ring-inset ring-slate-100">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <p>
                          Harga barang belum dikirim Business Central, jadi nilai selisih belum bisa dihitung otomatis. Begitu BC mengirim harga per item,
                          kolom ini terisi sendiri (qty selisih per SKU × harga). Sementara itu, isi manual bila sudah dihitung.
                        </p>
                      </div>
                    )}
                    {bc?.priceField && bc.pricedDiffSkus < bc.diffSkus && (
                      <div className={cn('flex gap-2.5 rounded-xl p-3 text-xs', TONES.warning.chip)}>
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                          {bc.diffSkus - bc.pricedDiffSkus} dari {bc.diffSkus} SKU yang selisih belum punya harga di BC — nilainya belum ikut dihitung.
                        </p>
                      </div>
                    )}
                    <div className="grid gap-3 md:grid-cols-2">
                      <ValueInput
                        id="value-plus"
                        label="Selisih all artikel lebih (+)"
                        value={form.valuePlus}
                        onChange={(n) => patch({ valuePlus: n })}
                        hint={bc && bc.state === 'ok' ? `Qty lebih per SKU dari scan BC: ${idNumber(bc.plusQty)} pcs` : undefined}
                      />
                      <ValueInput
                        id="value-minus"
                        label="Selisih all artikel kurang (−)"
                        value={form.valueMinus}
                        onChange={(n) => patch({ valueMinus: n })}
                        hint={bc && bc.state === 'ok' ? `Qty kurang per SKU dari scan BC: ${idNumber(bc.minusQty)} pcs` : undefined}
                        negative
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-amber-50/70 px-3 py-2.5 ring-1 ring-inset ring-amber-100">
                      <span className="text-sm font-semibold text-amber-900">Total harga selisih</span>
                      <span className="text-base font-extrabold tabular-nums text-amber-900">{totals.valueTotal == null ? '–' : soRupiah(totals.valueTotal)}</span>
                    </div>
                  </div>
                </SectionCard>

                {/* ── Data bin ── */}
                <SectionCard icon={ScanLine} title="Data stock opname bin" subtitle="Dicetak di Surat Pernyataan.">
                  <div className="grid grid-cols-2 gap-3 p-3 sm:p-4 md:grid-cols-3">
                    <QtyInput
                      className="col-span-2 md:col-span-1"
                      id="bins-total"
                      label="Total bin store"
                      value={form.binsTotal}
                      onChange={(n) => patch({ binsTotal: n })}
                      unit="bin"
                      hint={
                        bc?.storeBins != null
                          ? `Bin berisi stok di BC saat ini: ${idNumber(bc.storeBins)}. Di-scan: ${bc.checkedBins}.`
                          : bc && bc.state === 'ok'
                            ? `Bin yang di-scan di BC: ${bc.checkedBins}.`
                            : undefined
                      }
                    />
                    <QtyInput
                      id="bins-match"
                      label="Qty sesuai bin"
                      value={form.binsMatch}
                      onChange={(n) => patch({ binsMatch: n })}
                      unit="bin"
                      hint={bc && bc.state === 'ok' ? `Bin yang semua itemnya benar: ${bc.binsMatch}.` : undefined}
                    />
                    <QtyInput
                      id="bins-mismatch"
                      label="Qty tidak sesuai bin"
                      value={form.binsMismatch}
                      onChange={(n) => patch({ binsMismatch: n })}
                      unit="bin"
                      hint={bc && bc.state === 'ok' ? `Bin dengan item salah: ${bc.binsMismatch}.` : undefined}
                    />
                    {form.binsTotal > 0 && form.binsMatch + form.binsMismatch > form.binsTotal && (
                      <p className={cn('col-span-2 rounded-lg px-3 py-2 text-xs font-semibold md:col-span-3', TONES.danger.chip)}>
                        Sesuai + tidak sesuai ({form.binsMatch + form.binsMismatch}) lebih dari total bin store ({form.binsTotal}).
                      </p>
                    )}
                  </div>
                </SectionCard>

                {/* ── Temuan ── */}
                <SectionCard
                  icon={ListChecks}
                  title="Temuan stock opname"
                  subtitle={`Satu temuan per baris — tercetak di tabel Surat Pernyataan (maks. ${SO_FINDINGS_MAX}).`}
                  action={
                    <button
                      type="button"
                      disabled={form.findings.length >= SO_FINDINGS_MAX}
                      onClick={() => patch({ findings: [...form.findings, ''] })}
                      className="flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" /> Tambah temuan
                    </button>
                  }
                >
                  {form.findings.length === 0 ? (
                    <p className="px-4 py-5 text-sm text-slate-400">Tidak ada temuan. Tabel di Surat tercetak kosong.</p>
                  ) : (
                    <ol className="divide-y divide-slate-100">
                      {form.findings.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 px-3 py-2 sm:px-4">
                          <span className="mt-2 w-5 shrink-0 text-center text-sm font-bold tabular-nums text-slate-400">{i + 1}</span>
                          {/* A finding is a sentence: two lines on a phone instead of one that scrolls sideways. */}
                          <textarea
                            value={f}
                            rows={2}
                            maxLength={SO_FINDING_MAX}
                            onChange={(e) => patch({ findings: form.findings.map((x, j) => (j === i ? e.target.value : x)) })}
                            placeholder="Mis. 3 pcs SPE2040034 ada di bin DISPLAY-B2, seharusnya GDM1B1"
                            className="min-w-0 flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-base leading-snug text-slate-900 outline-none placeholder:text-slate-300 focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
                            aria-label={`Temuan ${i + 1}`}
                          />
                          <button
                            type="button"
                            onClick={() => patch({ findings: form.findings.filter((_, j) => j !== i) })}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            aria-label={`Hapus temuan ${i + 1}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </SectionCard>

                <SectionCard icon={NotebookPen} title="Catatan auditor" subtitle="Untuk tim audit saja — tidak dicetak.">
                  <div className="p-4">
                    <textarea
                      value={form.notes}
                      maxLength={SO_NOTES_MAX}
                      onChange={(e) => patch({ notes: e.target.value })}
                      rows={3}
                      className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
                    />
                  </div>
                </SectionCard>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {form && totals && storeId && (
        <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)] backdrop-blur supports-[backdrop-filter]:bg-white/85 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Selisih</p>
              <p
                className={cn(
                  'truncate text-sm font-extrabold tabular-nums',
                  totals.qtyDiff === 0 ? TONES.success.strong : totals.qtyDiff < 0 ? TONES.danger.strong : TONES.warning.strong,
                )}
              >
                {signedPcs(totals.qtyDiff)}
                {totals.valueTotal != null && <span className="font-semibold text-slate-500"> · {soRupiah(totals.valueTotal)}</span>}
              </p>
            </div>
            {saved && !dirty && (
              <Link
                href={`/audit/berita-acara-so/${saved.id}`}
                className="hidden h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:flex"
              >
                Berita Acara <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || (!dirty && !!saved)}
              className={cn(
                'flex h-11 shrink-0 items-center gap-2 rounded-xl px-5 text-sm font-bold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
                dirty || !saved ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-900 text-white',
              )}
            >
              {saving ? 'Menyimpan…' : dirty || !saved ? 'Simpan' : 'Tersimpan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The form with every BC-backed number replaced by BC's; ShoppingBag (manual) and typed Rp values BC can't price stay. */
function filledFromBc(f: Form, bc: SoBcSnapshot): Form {
  const s = suggestFromBc(bc);
  return { ...f, ...s, shoppingBagQty: f.shoppingBagQty, valuePlus: s.valuePlus ?? f.valuePlus, valueMinus: s.valueMinus ?? f.valueMinus };
}

const pickNumbers = (n: SoNumbers): SoNumbers => ({
  sohBc: n.sohBc,
  scanQty: n.scanQty,
  shoppingBagQty: n.shoppingBagQty,
  transSalesQty: n.transSalesQty,
  valuePlus: n.valuePlus,
  valueMinus: n.valueMinus,
  binsTotal: n.binsTotal,
  binsMatch: n.binsMatch,
  binsMismatch: n.binsMismatch,
});

// ─── BC panel ────────────────────────────────────────────────────────────────

function BcPanel({
  bc,
  loading,
  onRefresh,
  onFill,
  differs,
}: {
  bc: SoBcSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
  onFill: () => void;
  differs: boolean;
}) {
  const ok = bc?.state === 'ok';
  // Phone: only the header (title, refill shortcut, refresh) shows; the figures open with "Rincian". From xl it is a plain side column.
  const [open, setOpen] = useState(false);
  const collapsed = open ? '' : 'max-xl:hidden';
  return (
    <aside className="space-y-3 xl:sticky xl:top-4 xl:col-start-2 xl:row-start-1">
      <SectionCard
        icon={Database}
        title="Data Business Central"
        subtitle={bc?.fetchedAt ? `Diambil ${new Date(bc.fetchedAt).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })} WIB` : undefined}
        action={
          <div className="flex w-full items-center gap-2 xl:w-auto">
            {ok && (
              <button
                type="button"
                onClick={onFill}
                disabled={!differs}
                className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60 xl:hidden"
              >
                <Wand2 className="h-3.5 w-3.5" /> {differs ? 'Isi dari BC' : 'Sesuai BC'}
              </button>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Muat ulang data BC"
              className="flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50 xl:min-h-9"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> <span className="max-sm:hidden">Muat ulang</span>
            </button>
            {ok && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex min-h-10 shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50 xl:hidden"
              >
                Rincian <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
              </button>
            )}
          </div>
        }
      >
        {!bc || bc.state !== 'ok' ? (
          <p className={cn('m-4 rounded-xl px-3 py-2.5 text-xs', bc?.state === 'not_configured' ? TONES.warning.chip : TONES.danger.chip)}>
            {bc?.state === 'not_configured'
              ? 'Login BC untuk Cek Bin belum diisi di server — isi angka secara manual.'
              : 'Business Central tidak bisa dihubungi. Isi manual atau Muat ulang sebentar lagi.'}
          </p>
        ) : (
          <dl className={cn('divide-y divide-slate-100 text-sm', collapsed)}>
            <Row label="Bin di-scan" value={`${idNumber(bc.checkedBins)}${bc.uncheckedBins ? ` (+${bc.uncheckedBins} belum di-scan)` : ''}`} />
            <Row label="Bin sesuai / tidak sesuai" value={`${bc.binsMatch} / ${bc.binsMismatch}`} />
            <Row label="Baris item benar / salah" value={`${idNumber(bc.correctLines)} / ${idNumber(bc.wrongLines)}`} />
            <Row label="Σ qty bin · Σ qty scan" value={`${idNumber(bc.binQty)} · ${idNumber(bc.scanQty)}`} />
            <Row label="SKU selisih (lebih / kurang)" value={`${bc.diffSkus} (${idNumber(bc.plusQty)} / ${idNumber(bc.minusQty)} pcs)`} />
            <Row label="Bin berisi stok saat ini" value={bc.storeBins == null ? '—' : `${idNumber(bc.storeBins)} bin · ${idNumber(bc.storeQty ?? 0)} pcs`} />
            <Row label="Penjualan POS hari itu" value={bc.salesQty == null ? '—' : `${idNumber(bc.salesQty)} pcs`} />
            <Row label="Harga item" value={bc.priceField ? `ada (${bc.priceField})` : 'belum dikirim BC'} />
          </dl>
        )}
        {ok && bc.checkedBins === 0 && (
          <p className={cn('mx-4 mb-4 rounded-xl px-3 py-2.5 text-xs', TONES.warning.chip)}>Belum ada bin yang di-scan di BC untuk toko dan tanggal ini.</p>
        )}
        {ok && (
          <div className="border-t border-slate-100 p-3 max-xl:hidden">
            <button
              type="button"
              onClick={onFill}
              disabled={!differs}
              className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
            >
              <Wand2 className="h-3.5 w-3.5" /> {differs ? 'Isi ulang angka dari BC' : 'Angka sama dengan BC'}
            </button>
          </div>
        )}
      </SectionCard>
      <p className={cn('px-1 text-[11px] leading-relaxed text-slate-400', collapsed)}>
        Scan bin dilakukan di Business Central (PP Bin Content Check) pada tanggal SO — full atau sebagian bin. Angka yang disimpan adalah
        angka di form ini; Berita Acara tidak berubah walau BC berubah.
      </p>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2">
      <dt className="min-w-0 text-xs text-slate-500">{label}</dt>
      <dd className="shrink-0 text-right text-xs font-semibold tabular-nums text-slate-800">{value}</dd>
    </div>
  );
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

const digitsOnly = (s: string) => s.replace(/\D/g, '');

function UseChip({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 hover:bg-amber-200">
      Pakai
    </button>
  );
}

function QtyInput({
  id,
  label,
  badge,
  value,
  onChange,
  hint,
  unit = 'pcs',
  className,
}: {
  id: string;
  label: string;
  badge?: string;
  value: number;
  onChange: (n: number) => void;
  hint?: React.ReactNode;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <span className="truncate">{label}</span>
        {badge && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500">{badge}</span>}
      </label>
      <div className="flex h-11 items-center rounded-xl border border-slate-200 bg-white shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value ? idNumber(value) : ''}
          placeholder="0"
          onChange={(e) => onChange(Math.min(Number(digitsOnly(e.target.value) || 0), SO_QTY_MAX))}
          onFocus={(e) => e.currentTarget.select()}
          className="h-full min-w-0 flex-1 rounded-l-xl bg-transparent pl-3 text-right text-base font-semibold tabular-nums text-slate-900 outline-none placeholder:text-slate-300 sm:text-sm"
        />
        <span className="pl-1.5 pr-3 text-xs font-semibold text-slate-400">{unit}</span>
      </div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-slate-400">{hint}</div>}
    </div>
  );
}

function ValueInput({
  id,
  label,
  value,
  onChange,
  hint,
  negative,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  hint?: React.ReactNode;
  negative?: boolean;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-slate-600">
        {label}
      </label>
      <div className="flex h-11 items-center rounded-xl border border-slate-200 bg-white shadow-xs focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100">
        <span className="pl-3 pr-1.5 text-sm font-semibold text-slate-400">{negative ? '−Rp' : 'Rp'}</span>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value == null ? '' : idNumber(value)}
          placeholder="kosong = “-”"
          onChange={(e) => {
            const d = digitsOnly(e.target.value);
            onChange(d ? Math.min(Number(d), SO_VALUE_MAX) : null);
          }}
          className="h-full min-w-0 flex-1 rounded-r-xl bg-transparent pr-3 text-right text-base font-semibold tabular-nums text-slate-900 outline-none placeholder:text-xs placeholder:font-normal placeholder:text-slate-300 sm:text-sm"
        />
      </div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-slate-400">{hint}</div>}
    </div>
  );
}

function Stat({ label, value, tone, className }: { label: string; value: string; tone?: 'success' | 'danger' | 'warning'; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-slate-100', className)}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('mt-0.5 truncate text-lg font-extrabold tabular-nums', tone ? TONES[tone].strong : 'text-slate-900')}>{value}</p>
    </div>
  );
}
