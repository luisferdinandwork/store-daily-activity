'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ChevronRight, ImageOff, Images, ReceiptText, Send, X } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import {
  ActionButton, Chip, EmptyState, FieldHint, FieldLabel, ListGroup, Notice,
  PageBody, Section, SkeletonBlocks, inputClass,
} from '@/components/employee/ui';
import DocumentScanner from '@/components/shared/DocumentScanner';
import { ImageLightbox, type LightboxImage } from '@/components/shared/ImageLightbox';
import {
  RECEIPT_NUMBER_MAX, fmtSalesReturnWhen, salesReturnPhotos, validateReceiptNumber,
  validateSalesReturnReceipts, type EmployeeSalesReturn,
} from '@/lib/sales-returns';

type ReceiptKind = 'old' | 'new';
interface CapturedPhoto { file: File; url: string }
const RECEIPT_FIELDS = [
  { kind: 'old', label: 'Nomor struk lama', photoLabel: 'Foto struk lama', required: false },
  { kind: 'new', label: 'Nomor struk baru', photoLabel: 'Foto struk baru', required: true },
] as const;

function StoredThumb({ url }: { url: string | undefined }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary">
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : <ImageOff className="h-4 w-4 text-muted-foreground" />}
    </span>
  );
}

function ReturnRow({ item, onOpen }: { item: EmployeeSalesReturn; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} disabled={item.imageUrls.length === 0}
      className="flex w-full items-center gap-3 bg-card px-3.5 py-3 text-left transition active:bg-secondary disabled:active:bg-card">
      <StoredThumb url={item.newReceiptImageUrl ?? item.imageUrls[0]} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10px] font-semibold text-muted-foreground">
          {item.newReceiptNumber ? 'Struk baru' : 'Struk arsip · jenis belum tercatat'}
        </span>
        <span className="block truncate font-mono text-sm font-bold text-foreground">{item.newReceiptNumber ?? item.receiptNumber}</span>
        {item.oldReceiptNumber && <span className="block truncate text-xs text-muted-foreground">Lama: {item.oldReceiptNumber}</span>}
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {item.mine ? 'Kamu' : item.uploadedByName} · {fmtSalesReturnWhen(item.createdAt)}
        </span>
      </span>
      {item.imageUrls.length > 1 && <Chip icon={Images}>{item.imageUrls.length}</Chip>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

export default function SalesReturnsPage() {
  const [receipts, setReceipts] = useState({ old: '', new: '' });
  const [touched, setTouched] = useState({ old: false, new: false });
  const [photos, setPhotos] = useState<Partial<Record<ReceiptKind, CapturedPhoto>>>({});
  const [cameraFor, setCameraFor] = useState<ReceiptKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [list, setList] = useState<EmployeeSalesReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number; title: string } | null>(null);
  const photoUrls = useRef<string[]>([]);

  useEffect(() => { photoUrls.current = Object.values(photos).map((p) => p.url); }, [photos]);
  useEffect(() => () => photoUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/employee/sales-returns', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memuat daftar retur.');
      setList(json.returns);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Gagal memuat daftar retur.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);

  const check = validateSalesReturnReceipts(receipts.old, receipts.new);
  const duplicate = check.ok ? list.find((r) => r.newReceiptNumber === check.newReceiptNumber) : undefined;
  const canSubmit = check.ok && Boolean(photos.old && photos.new) && !submitting;

  function onCapture(file: File) {
    if (!cameraFor) return;
    const previous = photos[cameraFor];
    if (previous) URL.revokeObjectURL(previous.url);
    const captured = { file, url: URL.createObjectURL(file) };
    setPhotos((prev) => ({ ...prev, [cameraFor]: captured }));
    setCameraFor(null);
  }

  function removePhoto(kind: ReceiptKind) {
    const photo = photos[kind];
    if (photo) URL.revokeObjectURL(photo.url);
    setPhotos((prev) => { const next = { ...prev }; delete next[kind]; return next; });
  }

  async function submit() {
    setTouched({ old: true, new: true });
    if (!check.ok || !photos.old || !photos.new || submitting) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('newReceiptNumber', check.newReceiptNumber);
      if (check.oldReceiptNumber) form.append('oldReceiptNumber', check.oldReceiptNumber);
      form.append('oldReceiptPhoto', photos.old.file, photos.old.file.name);
      form.append('newReceiptPhoto', photos.new.file, photos.new.file.name);
      const res = await fetch('/api/employee/sales-returns', { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error ?? (res.status === 413
        ? 'Foto terlalu besar. Ambil ulang dengan ukuran lebih kecil.' : 'Gagal mengirim retur. Coba lagi.'));
      Object.values(photos).forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos({});
      setReceipts({ old: '', new: '' });
      setTouched({ old: false, new: false });
      toast.success('Retur berhasil dikirim.');
      await loadList();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Gagal mengirim retur. Coba lagi.'); }
    finally { setSubmitting(false); }
  }

  return (
    <PageBody className="pb-24">
      {lightbox && <ImageLightbox images={lightbox.images} index={lightbox.index} title={lightbox.title}
        onIndexChange={(index) => setLightbox((l) => l ? { ...l, index } : l)} onClose={() => setLightbox(null)} />}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Isi nomor struk baru, lalu ambil masing-masing 1 foto struk lama dan baru. Nomor struk lama boleh dikosongkan.
        Tanggal dan nama kamu tercatat otomatis saat dikirim.
      </p>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        {RECEIPT_FIELDS.map(({ kind, label, photoLabel, required }) => {
          const validation = required || receipts[kind] ? validateReceiptNumber(receipts[kind], label) : null;
          const error = touched[kind] && validation && !validation.ok ? validation.error : null;
          const photo = photos[kind];
          return (
            <div key={kind} className="space-y-3 rounded-xl border border-border p-3">
              <div className="space-y-1.5">
                <FieldLabel><label htmlFor={`receipt-${kind}`}>{label} <span className={required ? 'text-red-500' : 'text-muted-foreground'}>{required ? '(wajib)' : '(opsional)'}</span></label></FieldLabel>
                <input id={`receipt-${kind}`} value={receipts[kind]} required={required}
                  onChange={(e) => setReceipts((prev) => ({ ...prev, [kind]: e.target.value.replace(/\s+/g, '').toUpperCase() }))}
                  onBlur={() => setTouched((prev) => ({ ...prev, [kind]: true }))} disabled={submitting}
                  maxLength={RECEIPT_NUMBER_MAX} placeholder={required ? 'Isi nomor pada struk baru' : 'Boleh dikosongkan'}
                  autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false}
                  aria-invalid={Boolean(error)} aria-describedby={`receipt-${kind}-hint`}
                  className={cn(inputClass, 'font-mono tracking-wide', error && 'border-red-400 focus:border-red-500')} />
                <div id={`receipt-${kind}-hint`}><FieldHint error={Boolean(error)}>{error ?? 'Ketik nomor struk tanpa spasi.'}</FieldHint></div>
              </div>

              <div className="flex items-center justify-between text-xs font-semibold">
                <span>{photoLabel} <span className="text-red-500">(wajib)</span></span>
                <span className="text-muted-foreground">{photo ? '1/1' : '0/1'} foto</span>
              </div>
              {photo ? (
                <div className="relative h-40 overflow-hidden rounded-lg border border-border bg-secondary">
                  <button type="button" aria-label={`Lihat ${photoLabel.toLowerCase()}`} className="h-full w-full"
                    onClick={() => setLightbox({ title: photoLabel, index: 0, images: [{ url: photo.url, label: photoLabel }] })}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt={photoLabel} className="h-full w-full object-contain" />
                  </button>
                  <button type="button" onClick={() => removePhoto(kind)} disabled={submitting}
                    aria-label={`Hapus ${photoLabel.toLowerCase()}`}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-50"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <button type="button" onClick={() => setCameraFor(kind)} disabled={submitting}
                  aria-label={`Ambil ${photoLabel.toLowerCase()}`}
                  className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-secondary text-muted-foreground transition active:scale-[0.97] disabled:opacity-60">
                  <Camera className="h-5 w-5 text-primary" /><span className="text-xs font-semibold">Ambil {photoLabel.toLowerCase()}</span>
                </button>
              )}
            </div>
          );
        })}

        {duplicate && <Notice tone="warning" title="Nomor struk baru ini sudah ada">
          Sudah dikirim {duplicate.mine ? 'oleh kamu' : `oleh ${duplicate.uploadedByName}`} pada {fmtSalesReturnWhen(duplicate.createdAt)}. Kirim lagi hanya jika memang berbeda.
        </Notice>}
        <p className="text-[11px] text-muted-foreground">Pastikan kedua foto lengkap dan nomor struk terbaca jelas.</p>
        <DocumentScanner open={cameraFor !== null} onClose={() => setCameraFor(null)} onCapture={onCapture}
          title={cameraFor === 'old' ? 'Foto struk lama' : 'Foto struk baru'} />
        <ActionButton icon={Send} loading={submitting} disabled={!canSubmit} onClick={() => void submit()} className="w-full">
          {submitting ? 'Mengirim…' : 'Kirim Retur'}
        </ActionButton>
      </section>

      <Section title="Retur toko" meta={list.length ? `${list.length} terbaru` : undefined}>
        {loading ? <SkeletonBlocks count={3} className="h-16" /> : loadError ? <Notice tone="error">{loadError}</Notice> : list.length === 0 ? (
          <EmptyState icon={ReceiptText} title="Belum ada retur" description="Retur yang dikirim tim toko akan muncul di sini." />
        ) : <ListGroup>{list.map((item) => <ReturnRow key={item.id} item={item} onOpen={() => setLightbox({
          title: item.newReceiptNumber ?? item.receiptNumber, index: 0, images: salesReturnPhotos(item),
        })} />)}</ListGroup>}
      </Section>
    </PageBody>
  );
}
