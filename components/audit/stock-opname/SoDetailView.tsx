'use client';
// components/audit/stock-opname/SoDetailView.tsx — one Stock Opname: the numbers at a glance, the three documents
// (Berita Acara SO · Surat Pernyataan · Super Reward) as A4 previews, Cetak / PDF for each, the kop / Surat /
// signature editor and delete. The numbers themselves are changed on /audit/stock-opname (link "Ubah angka"), the
// Super Reward rows on /audit/berita-acara-so/[id]/super-reward.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { ArrowLeft, Award, Boxes, ChevronRight, CircleDollarSign, Eye, FileText, Loader2, PencilLine, Printer, ScanLine, Trash2 } from 'lucide-react';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { TONES } from '@/lib/status-theme';
import { DOC_NUMBER_MAX } from '@/lib/audit-cash-check';
import {
  SO_BRANDS,
  SO_TEXT_MAX,
  idNumber,
  isDay,
  longDateId,
  signedPcs,
  soRupiah,
  soTotals,
  type SoBrandKey,
  type StockOpnameRecord,
} from '@/lib/audit-stock-opname';
import { SavedStamp, fetchJson } from '@/components/audit/cash-check/kit';
import SoTabs from './SoTabs';
import { SO_DOC_LABEL, SoPaperPreview, SoPrintPortal, printSoDocument, type SoDocKind } from './SoPrint';

export default function SoDetailView({ id }: { id: number }) {
  const router = useRouter();
  const [record, setRecord] = useState<StockOpnameRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<SoDocKind>('ba');
  const [previewKind, setPreviewKind] = useState<SoDocKind | null>(null);
  const [printKind, setPrintKind] = useState<SoDocKind>('ba');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchJson<{ so: StockOpnameRecord }>(`/api/audit/stock-opname/${id}`)
      .then((d) => alive && setRecord(d.so))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Gagal memuat.'));
    return () => {
      alive = false;
    };
  }, [id]);

  // Ctrl+P prints the document on screen.
  useEffect(() => {
    const onBefore = () => setPrintKind(doc);
    window.addEventListener('beforeprint', onBefore);
    return () => window.removeEventListener('beforeprint', onBefore);
  }, [doc]);

  function print(kind: SoDocKind) {
    if (!record) return;
    flushSync(() => setPrintKind(kind));
    printSoDocument(record, kind);
  }

  async function remove() {
    setBusy(true);
    try {
      await fetchJson(`/api/audit/stock-opname/${id}`, { method: 'DELETE' });
      toast.success('Stock Opname dihapus');
      router.replace('/audit/berita-acara-so');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menghapus.');
      setBusy(false);
    }
  }

  if (error && !record) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center">
        <FileText className="h-10 w-10 text-slate-300" />
        <p className="text-sm font-semibold text-slate-700">{error}</p>
        <Link href="/audit/berita-acara-so" className="text-sm font-bold text-amber-700 hover:underline">
          Kembali ke daftar
        </Link>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
      </div>
    );
  }

  const t = soTotals(record);
  const qtyTone = t.qtyDiff === 0 ? TONES.success : t.qtyDiff < 0 ? TONES.danger : TONES.warning;
  const scanned = record.binsMatch + record.binsMismatch;

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope="Audit · Berita Acara SO"
        title={<><FileText />{record.storeNo} · {record.storeName}</>}
        subtitle={`No. ${record.docNumber} · SO ${longDateId(record.soDate)}`}
        tabs={<SoTabs />}
        hideTabsOnPhone
        hideActionsOnPhone
        wideActions
        actions={
          <>
            <button
              type="button"
              onClick={() => print('ba')}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600"
            >
              <Printer className="h-4 w-4" /> <span className="sm:hidden">BA</span>
              <span className="hidden sm:inline">Cetak BA</span>
            </button>
            <button
              type="button"
              onClick={() => print('surat')}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600"
            >
              <Printer className="h-4 w-4" /> <span className="sm:hidden">Surat</span>
              <span className="hidden sm:inline">Cetak Surat</span>
            </button>
            {record.reward ? (
              <button
                type="button"
                onClick={() => print('reward')}
                className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600"
              >
                <Printer className="h-4 w-4" /> <span className="sm:hidden">Reward</span>
                <span className="hidden sm:inline">Cetak Super Reward</span>
              </button>
            ) : (
              <Link
                href={`/audit/berita-acara-so/${record.id}/super-reward`}
                className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-800 transition hover:bg-amber-100"
              >
                <Award className="h-4 w-4" /> <span className="sm:hidden">Reward</span>
                <span className="hidden sm:inline">Isi Super Reward</span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50"
            >
              <PencilLine className="h-4 w-4" />
              <span className="sm:hidden">Ubah</span>
              <span className="hidden sm:inline">Kop & tanda tangan</span>
            </button>
            <button
              type="button"
              onClick={() => setDeleting(true)}
              className="flex w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
              aria-label="Hapus Stock Opname"
              title="Hapus"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        }
      />

      <div className="space-y-3 p-3 sm:space-y-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/audit/berita-acara-so" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 md:min-h-9">
            <ArrowLeft className="h-4 w-4" /> <span className="md:hidden">Daftar</span>
            <span className="max-md:hidden">Semua Berita Acara SO</span>
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <SavedStamp at={record.checkedAt} by={record.checkedBy} />
            <Link
              href={`/audit/stock-opname?store=${record.storeId}&date=${record.soDate}`}
              className="flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 max-md:hidden"
            >
              Ubah angka
            </Link>
            <Link
              href={`/audit/berita-acara-so/${record.id}/super-reward`}
              className="flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 max-md:hidden"
            >
              {record.reward ? 'Ubah Super Reward' : 'Isi Super Reward'}
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile icon={Boxes} label="Qty BC · Hasil Scan" value={`${idNumber(t.bcTotal)} · ${idNumber(t.scanTotal)}`} />
          <Tile
            icon={ScanLine}
            label="Selisih fisik"
            value={t.qtyDiff === 0 ? 'Sesuai' : signedPcs(t.qtyDiff)}
            valueClass={qtyTone.strong}
          />
          <Tile icon={CircleDollarSign} label="Nominal selisih" value={t.valueTotal == null ? '–' : soRupiah(t.valueTotal)} hint={t.valueTotal == null ? 'Belum diisi' : undefined} />
          <Tile
            icon={ScanLine}
            label="Bin sesuai"
            value={`${record.binsMatch} / ${scanned}`}
            hint={record.binsTotal ? `dari ${idNumber(record.binsTotal)} bin store` : undefined}
          />
        </div>

        {/* ── Phone: documents as a short list — Lihat (full-screen preview) / Cetak — then the secondary actions ── */}
        <div className="space-y-3 md:hidden">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs" aria-label="Dokumen">
            <h2 className="border-b border-slate-100 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Dokumen</h2>
            <ul className="divide-y divide-slate-100">
              {(['ba', 'surat', 'reward'] as const).map((k) => {
                const pending = k === 'reward' && !record.reward;
                return (
                  <li key={k} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                      {k === 'reward' ? <Award className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-tight text-slate-900">{SO_DOC_LABEL[k]}</p>
                      <p className={cn('truncate text-xs', pending ? 'font-semibold text-amber-700' : 'text-slate-400')}>
                        {pending ? 'Belum diisi' : `A4 ${k === 'reward' ? 'landscape' : 'portrait'}`}
                      </p>
                    </div>
                    {pending ? (
                      <Link
                        href={`/audit/berita-acara-so/${record.id}/super-reward`}
                        className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 text-sm font-bold text-amber-800 active:bg-amber-100"
                      >
                        <Award className="h-4 w-4" /> Isi
                      </Link>
                    ) : (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewKind(k)}
                          aria-label={`Lihat ${SO_DOC_LABEL[k]}`}
                          className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 active:bg-slate-50"
                        >
                          <Eye className="h-[18px] w-[18px]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => print(k)}
                          aria-label={`Cetak ${SO_DOC_LABEL[k]}`}
                          className="flex h-11 items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 text-sm font-bold text-white shadow-sm active:bg-amber-600"
                        >
                          <Printer className="h-4 w-4" /> Cetak
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <p className="px-1 text-[11px] leading-relaxed text-slate-400">
            Cetak membuka dialog print — pilih &quot;Simpan sebagai PDF&quot; untuk file PDF (A4, tanpa header/footer). Layar kecil: periksa isinya lewat Lihat.
          </p>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs" aria-label="Kelola">
            <ul className="divide-y divide-slate-100">
              <ManageRow icon={Boxes} label="Ubah angka" hint="Qty, nilai selisih, bin, temuan" href={`/audit/stock-opname?store=${record.storeId}&date=${record.soDate}`} />
              {record.reward && <ManageRow icon={Award} label="Ubah Super Reward" hint="Daftar karyawan & reward" href={`/audit/berita-acara-so/${record.id}/super-reward`} />}
              <ManageRow icon={PencilLine} label="Kop & tanda tangan" hint="Nomor, kota, penanda tangan" onClick={() => setEditing(true)} />
              <ManageRow icon={Trash2} label="Hapus Stock Opname" onClick={() => setDeleting(true)} danger />
            </ul>
          </section>
        </div>

        <div className="flex rounded-xl bg-white p-1 shadow-xs ring-1 ring-slate-200 max-md:hidden md:inline-flex" role="tablist" aria-label="Dokumen">
          {(['ba', 'surat', 'reward'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={doc === k}
              onClick={() => setDoc(k)}
              className={cn(
                'min-h-10 flex-1 rounded-lg px-4 text-sm font-bold transition sm:flex-none',
                doc === k ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {SO_DOC_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="space-y-4 max-md:hidden">
        {doc === 'reward' && !record.reward ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
              <Award className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-800">Super Reward belum diisi</p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                Daftar karyawan {record.storeNo} diambil otomatis dari PRISM. Auditor mengisi Tgl Masuk Toko Awal dan Rincian Tgl SO, reward
                mengikuti otomatis.
              </p>
            </div>
            <Link
              href={`/audit/berita-acara-so/${record.id}/super-reward`}
              className="flex min-h-11 items-center gap-1.5 rounded-xl bg-amber-500 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600"
            >
              <Award className="h-4 w-4" /> Isi Super Reward
            </Link>
          </div>
        ) : (
          <SoPaperPreview record={record} kind={doc} />
        )}
        <p className="text-[11px] text-slate-400">
          Cetak membuka dialog print browser — pilih printer, atau &quot;Simpan sebagai PDF&quot; untuk file PDF (A4, tanpa header/footer browser
          {doc === 'reward' ? '; Super Reward dicetak landscape' : ''}).
        </p>
        </div>
      </div>

      {/* Phone: the full-screen preview behind "Lihat". */}
      <Sheet open={previewKind != null} onOpenChange={(open) => !open && setPreviewKind(null)}>
        <SheetContent side="bottom" className="h-[92dvh] gap-0 rounded-t-2xl p-0 md:hidden">
          <SheetHeader className="border-b border-slate-100 px-4 py-3 text-left">
            <SheetTitle className="text-base">{previewKind ? SO_DOC_LABEL[previewKind] : ''}</SheetTitle>
            <SheetDescription className="text-xs">
              {record.storeNo} · SO {longDateId(record.soDate)}. &quot;Perbesar&quot; menampilkan ukuran asli — geser untuk membaca.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-2">{previewKind && <SoPaperPreview record={record} kind={previewKind} />}</div>
          <div className="border-t border-slate-100 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => previewKind && print(previewKind)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-sm font-bold text-white shadow-sm active:bg-amber-600"
            >
              <Printer className="h-4 w-4" /> Cetak / Simpan PDF
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <SoPrintPortal record={record} kind={printKind} />

      <HeaderSheet
        open={editing}
        onOpenChange={setEditing}
        record={record}
        onSaved={(r) => {
          setRecord(r);
          setEditing(false);
        }}
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Hapus Stock Opname ini?"
        description={`Berita Acara SO, Surat Pernyataan dan Super Reward ${record.storeNo} tanggal ${longDateId(record.soDate)} ikut terhapus dan tidak bisa dikembalikan.`}
        confirmLabel="Hapus"
        tone="danger"
        icon={Trash2}
        busy={busy}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/** One tap-sized row of the phone "Kelola" list: a link or an action. */
function ManageRow({
  icon: Icon,
  label,
  hint,
  href,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  hint?: string;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  const cls = cn('flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-slate-50', danger && 'active:bg-rose-50');
  const inner = (
    <>
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', danger ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-600')}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-semibold', danger ? 'text-rose-700' : 'text-slate-800')}>{label}</span>
        {hint && <span className="block truncate text-xs text-slate-400">{hint}</span>}
      </span>
      {!danger && <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />}
    </>
  );
  return <li>{href ? <Link href={href} className={cls}>{inner}</Link> : <button type="button" onClick={onClick} className={cls}>{inner}</button>}</li>;
}

function Tile({
  icon: Icon,
  label,
  value,
  hint,
  valueClass,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
      <p className="flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className={cn('mt-1 truncate text-lg font-extrabold tabular-nums text-slate-900 md:text-xl', valueClass)}>{value}</p>
      {hint && <p className="truncate text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

// ─── Kop, Surat + tanda tangan ───────────────────────────────────────────────

interface HeaderForm {
  docNumber: string;
  signCity: string;
  signDate: string;
  storeTitle: string;
  suratCity: string;
  suratBrand: SoBrandKey;
  suratLocation: string;
  auditorName: string;
  auditorCaption: string;
  holderName: string;
  holderCaption: string;
  holderTitle: string;
  knownName: string;
  knownTitle: string;
  approvedName: string;
  approvedTitle: string;
  irName: string;
  irTitle: string;
}

const headerOf = (r: StockOpnameRecord): HeaderForm => ({
  docNumber: r.docNumber,
  signCity: r.signCity,
  signDate: r.signDate,
  storeTitle: r.storeTitle,
  suratCity: r.suratCity,
  suratBrand: r.suratBrand,
  suratLocation: r.suratLocation,
  auditorName: r.auditorName,
  auditorCaption: r.auditorCaption,
  holderName: r.holderName,
  holderCaption: r.holderCaption,
  holderTitle: r.holderTitle,
  knownName: r.known.name,
  knownTitle: r.known.title,
  approvedName: r.approved.name,
  approvedTitle: r.approved.title,
  irName: r.ir.name,
  irTitle: r.ir.title,
});

function HeaderSheet({
  open,
  onOpenChange,
  record,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: StockOpnameRecord;
  onSaved: (r: StockOpnameRecord) => void;
}) {
  const [draft, setDraft] = useState<HeaderForm | null>(null);
  const [saving, setSaving] = useState(false);
  const form = draft ?? headerOf(record);

  const close = (next: boolean) => {
    if (!next) setDraft(null);
    onOpenChange(next);
  };
  const set = (k: keyof HeaderForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft({ ...form, [k]: e.target.value });
  const valid = form.docNumber.trim() && form.signCity.trim() && form.storeTitle.trim() && isDay(form.signDate);

  async function save() {
    setSaving(true);
    try {
      const d = await fetchJson<{ so: StockOpnameRecord }>(`/api/audit/stock-opname/${record.id}`, { method: 'PATCH', body: JSON.stringify(form) });
      toast.success('Berita Acara SO diperbarui');
      setDraft(null);
      onSaved(d.so);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-slate-100 px-5 py-4">
          <SheetTitle>Kop & tanda tangan</SheetTitle>
          <SheetDescription>Teks yang tercetak di Berita Acara SO dan Surat Pernyataan. Angka diubah di halaman Stock Opname.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <Group title="Berita Acara">
            <TextField label="Nomor" value={form.docNumber} onChange={set('docNumber')} max={DOC_NUMBER_MAX} />
            <TextField label="Nama toko (baris kedua judul)" value={form.storeTitle} onChange={set('storeTitle')} max={SO_TEXT_MAX} />
            <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-3">
              <TextField label="Kota tanda tangan" value={form.signCity} onChange={set('signCity')} max={SO_TEXT_MAX} />
              <TextField label="Tanggal" type="date" value={form.signDate} onChange={set('signDate')} />
            </div>
          </Group>
          <Group title="Surat Pernyataan">
            <TextField label="Kota (di atas tanggal)" value={form.suratCity} onChange={set('suratCity')} max={SO_TEXT_MAX} />
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Brand toko</span>
              <select
                value={form.suratBrand}
                onChange={set('suratBrand')}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900 shadow-xs outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
              >
                <option value="">— tidak ada —</option>
                {SO_BRANDS.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <TextField label="Lokasi toko (di baris brand)" value={form.suratLocation} onChange={set('suratLocation')} max={SO_TEXT_MAX} />
          </Group>
          <Group title="Dibuat (Tim Audit)">
            <TextField label="Nama" value={form.auditorName} onChange={set('auditorName')} max={SO_TEXT_MAX} />
            <TextField label="Keterangan" value={form.auditorCaption} onChange={set('auditorCaption')} max={SO_TEXT_MAX} />
          </Group>
          <Group title="Toko">
            <TextField label="Judul kolom (mis. Store FS PMF)" value={form.holderCaption} onChange={set('holderCaption')} max={SO_TEXT_MAX} />
            <TextField label="Nama" value={form.holderName} onChange={set('holderName')} max={SO_TEXT_MAX} />
            <TextField label="Jabatan" value={form.holderTitle} onChange={set('holderTitle')} max={SO_TEXT_MAX} />
          </Group>
          <Group title="Diketahui">
            <TextField label="Nama" value={form.knownName} onChange={set('knownName')} max={SO_TEXT_MAX} />
            <TextField label="Jabatan" value={form.knownTitle} onChange={set('knownTitle')} max={SO_TEXT_MAX} />
          </Group>
          <Group title="Disetujui">
            <TextField label="Nama" value={form.approvedName} onChange={set('approvedName')} max={SO_TEXT_MAX} />
            <TextField label="Jabatan" value={form.approvedTitle} onChange={set('approvedTitle')} max={SO_TEXT_MAX} />
          </Group>
          <Group title="Dept IR (Super Reward)">
            <TextField label="Nama" value={form.irName} onChange={set('irName')} max={SO_TEXT_MAX} />
            <TextField label="Jabatan" value={form.irTitle} onChange={set('irTitle')} max={SO_TEXT_MAX} />
          </Group>
          <p className="text-xs leading-relaxed text-slate-400">
            Kota tanda tangan, &quot;Diketahui&quot;, &quot;Disetujui&quot; dan Dept IR terbawa ke Stock Opname berikutnya.
          </p>
        </div>
        <div className="flex gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={() => close(false)} className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Batal
          </button>
          <button
            type="button"
            disabled={!valid || saving}
            onClick={() => void save()}
            className="min-h-11 flex-1 rounded-xl bg-amber-500 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-50"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</legend>
      {children}
    </fieldset>
  );
}

function TextField({
  label,
  value,
  onChange,
  max,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  max?: number;
  type?: 'text' | 'date';
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        maxLength={max}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900 shadow-xs outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm"
      />
    </label>
  );
}
