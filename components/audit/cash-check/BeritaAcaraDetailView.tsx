'use client';
// components/audit/cash-check/BeritaAcaraDetailView.tsx — one Berita Acara Pemeriksaan Kas: the three selisih, which
// half is done (with a jump back to fix it), the paper preview, Cetak, and the header / signatories editor.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CircleDashed,
  FileText,
  Loader2,
  PencilLine,
  Printer,
  Trash2,
  Wallet,
} from 'lucide-react';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  DOC_NUMBER_MAX,
  SIGNATORY_MAX,
  cashCheckTotals,
  isDay,
  longDateId,
  rupiah,
  type CashCheckRecord,
} from '@/lib/audit-cash-check';
import { CashCheckTabs, DiffChip, SavedStamp, diffTextClass, fetchJson } from './kit';
import { BeritaAcaraPrintPortal, PaperPreview, printBeritaAcara } from './BeritaAcaraPrint';

export default function BeritaAcaraDetailView({ id }: { id: number }) {
  const router = useRouter();
  const [record, setRecord] = useState<CashCheckRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchJson<{ check: CashCheckRecord }>(`/api/audit/berita-acara/${id}`)
      .then((d) => alive && setRecord(d.check))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Gagal memuat.'));
    return () => {
      alive = false;
    };
  }, [id]);

  async function remove() {
    setBusy(true);
    try {
      await fetchJson(`/api/audit/berita-acara/${id}`, { method: 'DELETE' });
      toast.success('Berita Acara dihapus');
      router.replace('/audit/berita-acara');
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
        <Link href="/audit/berita-acara" className="text-sm font-bold text-amber-700 hover:underline">
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

  const t = cashCheckTotals(record);
  const q = `?store=${record.storeId}&date=${record.checkDate}`;
  const missing = [!record.modalCheckedAt && 'Cek Modal', !record.pettyCheckedAt && 'Cek Petty Cash'].filter(Boolean) as string[];

  return (
    <div className="min-h-full bg-slate-50">
      <PanelPageHeader
        scope="Audit · Berita Acara"
        title={<><FileText />{record.storeNo} · {record.storeName}</>}
        subtitle={`No. ${record.docNumber} · ${longDateId(record.checkDate)}`}
        tabs={<CashCheckTabs />}
        actions={
          <>
            <button
              type="button"
              onClick={() => printBeritaAcara(record)}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600"
            >
              <Printer className="h-4 w-4" /> Cetak
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50"
            >
              <PencilLine className="h-4 w-4" />
              <span className="sm:hidden">Ubah</span>
              <span className="hidden sm:inline">Ubah kop & tanda tangan</span>
            </button>
            <button
              type="button"
              onClick={() => setDeleting(true)}
              className="flex w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
              aria-label="Hapus Berita Acara"
              title="Hapus"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        }
      />

      <div className="space-y-4 p-4 sm:p-6 lg:p-8">
        <Link href="/audit/berita-acara" className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Semua Berita Acara
        </Link>

        {missing.length > 0 && (
          <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>
              <span className="font-bold">{missing.join(' dan ')}</span> belum diisi — bagian itu tercetak dengan angka nol.
            </p>
          </div>
        )}

        {/* Phone: Selisih Akhir across the top, the two halves side by side under it. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <DiffTile label="Selisih Akhir" diff={t.finalDiff} done={!!record.modalCheckedAt || !!record.pettyCheckedAt} strong className="col-span-2 md:order-last md:col-span-1" />
          <DiffTile label="Selisih Modal" diff={t.modalDiff} done={!!record.modalCheckedAt} />
          <DiffTile label="Selisih Petty Cash" diff={t.pettyDiff} done={!!record.pettyCheckedAt} />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <PartCard
            icon={Banknote}
            title="Cek Modal"
            href={`/audit/cek-modal${q}`}
            at={record.modalCheckedAt}
            by={record.modalCheckedBy}
            lines={[
              ['Modal + Penjualan', t.modalPlusSales],
              ['Fisik kas modal', t.modalPhysical],
            ]}
          />
          <PartCard
            icon={Wallet}
            title="Cek Petty Cash"
            href={`/audit/cek-petty-cash${q}`}
            at={record.pettyCheckedAt}
            by={record.pettyCheckedBy}
            lines={[
              [`Cashout (${t.checkedCount} dari ${t.itemCount} dicentang${record.pettyExtras.length ? ` + ${record.pettyExtras.length} lain` : ''})`, t.cashout],
              ['Sisa menurut buku', t.pettyBook],
              ['Fisik kas petty cash', t.pettyPhysical],
            ]}
          />
        </div>

        <PaperPreview record={record} />
      </div>

      <BeritaAcaraPrintPortal record={record} />

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
        title="Hapus Berita Acara ini?"
        description={`Hasil Cek Modal dan Cek Petty Cash ${record.storeNo} tanggal ${longDateId(record.checkDate)} ikut terhapus dan tidak bisa dikembalikan.`}
        confirmLabel="Hapus"
        tone="danger"
        icon={Trash2}
        busy={busy}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function DiffTile({
  label,
  diff,
  done,
  strong,
  className,
}: {
  label: string;
  diff: number;
  done: boolean;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 rounded-2xl border bg-white px-4 py-3 shadow-xs', strong ? 'border-slate-300' : 'border-slate-200', className)}>
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      {done ? (
        <div className={cn('mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1', !strong && 'max-md:[&>span]:hidden')}>
          <p className={cn('font-extrabold tabular-nums', strong ? 'text-2xl' : 'text-lg md:text-xl', diffTextClass(diff))}>
            {diff > 0 ? '+' : ''}
            {rupiah(diff)}
          </p>
          <DiffChip diff={diff} />
        </div>
      ) : (
        <p className="mt-1 text-sm font-semibold text-slate-400">Belum dicek</p>
      )}
    </div>
  );
}

function PartCard({
  icon: Icon,
  title,
  href,
  at,
  by,
  lines,
}: {
  icon: React.ElementType;
  title: string;
  href: string;
  at: string | null;
  by: string | null;
  lines: [string, number][];
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', at ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            {title}
            {at ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <CircleDashed className="h-4 w-4 text-slate-300" />}
          </p>
          <SavedStamp at={at} by={by} />
        </div>
        <Link
          href={href}
          className="flex min-h-9 shrink-0 items-center rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
        >
          {at ? 'Ubah' : 'Isi sekarang'}
        </Link>
      </div>
      {at && (
        <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3">
          {lines.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="min-w-0 text-slate-500">{k}</dt>
              <dd className="shrink-0 font-semibold tabular-nums text-slate-800">{rupiah(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ─── Header + signatories ────────────────────────────────────────────────────

interface HeaderForm {
  docNumber: string;
  signCity: string;
  signDate: string;
  holderName: string;
  holderCaption: string;
  auditorName: string;
  auditorCaption: string;
  knownName: string;
  knownTitle: string;
  approvedName: string;
  approvedTitle: string;
}

const headerOf = (r: CashCheckRecord): HeaderForm => ({
  docNumber: r.docNumber,
  signCity: r.signCity,
  signDate: r.signDate,
  holderName: r.holderName,
  holderCaption: r.holderCaption,
  auditorName: r.auditorName,
  auditorCaption: r.auditorCaption,
  knownName: r.known.name,
  knownTitle: r.known.title,
  approvedName: r.approved.name,
  approvedTitle: r.approved.title,
});

function HeaderSheet({
  open,
  onOpenChange,
  record,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: CashCheckRecord;
  onSaved: (r: CashCheckRecord) => void;
}) {
  // null = untouched since the sheet opened → shows the record as saved.
  const [draft, setDraft] = useState<HeaderForm | null>(null);
  const [saving, setSaving] = useState(false);
  const form = draft ?? headerOf(record);

  const close = (next: boolean) => {
    if (!next) setDraft(null);
    onOpenChange(next);
  };
  const set = (k: keyof HeaderForm) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...form, [k]: e.target.value });
  const valid = form.docNumber.trim() && form.signCity.trim() && isDay(form.signDate);

  async function save() {
    setSaving(true);
    try {
      const d = await fetchJson<{ check: CashCheckRecord }>(`/api/audit/berita-acara/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      toast.success('Berita Acara diperbarui');
      setDraft(null);
      onSaved(d.check);
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
          <SheetDescription>Teks yang tercetak di Berita Acara. Angka diambil dari Cek Modal dan Cek Petty Cash.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <Group title="Kop">
            <TextField label="Nomor" value={form.docNumber} onChange={set('docNumber')} max={DOC_NUMBER_MAX} />
            <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-3">
              <TextField label="Kota" value={form.signCity} onChange={set('signCity')} max={SIGNATORY_MAX} />
              <TextField label="Tanggal tanda tangan" type="date" value={form.signDate} onChange={set('signDate')} />
            </div>
          </Group>
          <Group title="Dilakukan oleh">
            <TextField label="Nama" value={form.auditorName} onChange={set('auditorName')} max={SIGNATORY_MAX} />
            <TextField label="Keterangan" value={form.auditorCaption} onChange={set('auditorCaption')} max={SIGNATORY_MAX} />
          </Group>
          <Group title="Pemegang kas">
            <TextField label="Nama" value={form.holderName} onChange={set('holderName')} max={SIGNATORY_MAX} />
            <TextField label="Keterangan" value={form.holderCaption} onChange={set('holderCaption')} max={SIGNATORY_MAX} />
          </Group>
          <Group title="Diketahui">
            <TextField label="Nama" value={form.knownName} onChange={set('knownName')} max={SIGNATORY_MAX} />
            <TextField label="Jabatan" value={form.knownTitle} onChange={set('knownTitle')} max={SIGNATORY_MAX} />
          </Group>
          <Group title="Disetujui">
            <TextField label="Nama" value={form.approvedName} onChange={set('approvedName')} max={SIGNATORY_MAX} />
            <TextField label="Jabatan" value={form.approvedTitle} onChange={set('approvedTitle')} max={SIGNATORY_MAX} />
          </Group>
          <p className="text-xs leading-relaxed text-slate-400">
            Nama &quot;Diketahui&quot; dan &quot;Disetujui&quot; terbawa ke Berita Acara berikutnya.
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
