'use client';
// app/employee/sales-returns/page.tsx
//
// Sales Return — the employee files the POS receipt of a customer return: the
// receipt number typed in + 1–3 photos of the receipt, taken with the in-app camera
// (CameraCapture) — there is no gallery / file upload, like every other photo flow.
// The date and the person filing are NOT asked: the server records the signed-in
// user and the upload time (POST /api/employee/sales-returns). Below the form, the
// store's latest returns so the team can see what is already in. Ops (own area) and
// Finance (all stores) read the same rows at /ops/sales-returns and
// /finance/sales-returns. Reached from the floating "More" menu.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ChevronRight, ImageOff, Images, ReceiptText, Send, X } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import {
  ActionButton,
  Chip,
  EmptyState,
  FieldHint,
  FieldLabel,
  ListGroup,
  Notice,
  PageBody,
  Section,
  SectionLabel,
  SkeletonBlocks,
  inputClass,
} from '@/components/employee/ui';
import CameraCapture from '@/components/shared/CameraCapture';
import { ImageLightbox, type LightboxImage } from '@/components/shared/ImageLightbox';
import {
  RECEIPT_NUMBER_MAX,
  SALES_RETURN_MAX_PHOTOS,
  fmtSalesReturnWhen,
  validateReceiptNumber,
  type EmployeeSalesReturn,
} from '@/lib/sales-returns';

interface CapturedPhoto {
  id: string;
  file: File;
  /** Object URL for the preview — revoked when the photo goes away. */
  url: string;
}

// ─── Photo pieces ────────────────────────────────────────────────────────────

/** A stored photo; an icon when the URL no longer loads. */
function StoredThumb({ url }: { url: string | undefined }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary">
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <ImageOff className="h-4 w-4 text-muted-foreground" />
      )}
    </span>
  );
}

function ReturnRow({ item, onOpen }: { item: EmployeeSalesReturn; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={item.imageUrls.length === 0}
      className="flex w-full items-center gap-3 bg-card px-3.5 py-3 text-left transition active:bg-secondary disabled:active:bg-card"
    >
      <StoredThumb url={item.imageUrls[0]} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm font-bold text-foreground">{item.receiptNumber}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {item.mine ? 'Kamu' : item.uploadedByName} · {fmtSalesReturnWhen(item.createdAt)}
        </span>
      </span>
      {item.imageUrls.length > 1 && <Chip icon={Images}>{item.imageUrls.length}</Chip>}
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/60" />
    </button>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SalesReturnsPage() {
  const [receipt, setReceipt] = useState('');
  const [touched, setTouched] = useState(false);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [list, setList] = useState<EmployeeSalesReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number; title: string } | null>(null);

  const photoUrls = useRef<string[]>([]);

  // Free the previews' memory when the page goes away.
  useEffect(() => {
    photoUrls.current = photos.map((p) => p.url);
  }, [photos]);
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const check = validateReceiptNumber(receipt);
  const receiptError = touched && !check.ok ? check.error : undefined;
  // Best-effort: only the store's latest returns are loaded, so a miss proves nothing.
  const duplicate = check.ok ? list.find((r) => r.receiptNumber === check.value) : undefined;
  const canSubmit = check.ok && photos.length > 0 && !submitting;

  // The camera already shrinks each shot (useCameraCapture), so it goes straight into the list.
  function onCapture(file: File) {
    setCameraOpen(false);
    if (photos.length >= SALES_RETURN_MAX_PHOTOS) {
      toast.error(`Maksimal ${SALES_RETURN_MAX_PHOTOS} foto per retur.`);
      return;
    }
    setPhotos((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, file, url: URL.createObjectURL(file) }]);
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function submit() {
    setTouched(true);
    if (!check.ok || photos.length === 0) return;

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('receiptNumber', check.value);
      for (const p of photos) form.append('files', p.file, p.file.name);

      const res = await fetch('/api/employee/sales-returns', { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(
          json?.error ??
            (res.status === 413
              ? 'Foto terlalu besar. Kurangi jumlah foto lalu coba lagi.'
              : 'Gagal mengirim retur. Coba lagi.'),
        );
      }

      photos.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]);
      setReceipt('');
      setTouched(false);
      toast.success('Retur berhasil dikirim.');
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengirim retur. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageBody className="pb-24">
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          title={lightbox.title}
          onIndexChange={(index) => setLightbox((l) => (l ? { ...l, index } : l))}
          onClose={() => setLightbox(null)}
        />
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Foto struk retur penjualan dan isi nomor struknya. Tanggal dan nama kamu tercatat otomatis saat dikirim —
        Ops dan Finance bisa langsung melihatnya.
      </p>

      {/* ── New return ── */}
      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <div className="space-y-1.5">
          <FieldLabel>Nomor struk</FieldLabel>
          <input
            value={receipt}
            onChange={(e) => setReceipt(e.target.value.replace(/\s+/g, '').toUpperCase())}
            onBlur={() => setTouched(true)}
            disabled={submitting}
            aria-label="Nomor struk"
            maxLength={RECEIPT_NUMBER_MAX}
            placeholder="mis. 000000P001000091825"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={Boolean(receiptError)}
            className={cn(inputClass, 'font-mono tracking-wide', receiptError && 'border-red-400 focus:border-red-500')}
          />
          {receiptError ? (
            <FieldHint error>{receiptError}</FieldHint>
          ) : (
            <FieldHint>Ketik persis seperti yang tertera di struk (tanpa spasi).</FieldHint>
          )}
        </div>

        {duplicate && (
          <Notice tone="warning" title="Nomor struk ini sudah ada">
            Sudah dikirim {duplicate.mine ? 'oleh kamu' : `oleh ${duplicate.uploadedByName}`} pada{' '}
            {fmtSalesReturnWhen(duplicate.createdAt)}. Kirim lagi hanya jika memang berbeda.
          </Notice>
        )}

        <div>
          <SectionLabel meta={`${photos.length}/${SALES_RETURN_MAX_PHOTOS}`}>Foto struk</SectionLabel>

          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div
                key={p.id}
                className="relative aspect-square overflow-hidden rounded-xl border border-border bg-secondary"
              >
                <button
                  type="button"
                  onClick={() =>
                    setLightbox({
                      title: 'Foto struk',
                      index: i,
                      images: photos.map((x, n) => ({ url: x.url, label: `Foto ${n + 1}` })),
                    })
                  }
                  className="block h-full w-full"
                  aria-label={`Lihat foto ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Foto struk ${i + 1}`} className="h-full w-full object-cover" />
                </button>
                {!submitting && (
                  <button
                    type="button"
                    onClick={() => removePhoto(p.id)}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                    aria-label={`Hapus foto ${i + 1}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 text-[10px] font-bold leading-4 text-white">
                  {i + 1}
                </span>
              </div>
            ))}

            {photos.length < SALES_RETURN_MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                disabled={submitting}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-secondary text-muted-foreground transition active:scale-[0.97] disabled:opacity-60"
              >
                <Camera className="h-5 w-5 text-primary" />
                <span className="text-[11px] font-semibold">Ambil foto</span>
              </button>
            )}
          </div>

          <p className="mt-2 px-0.5 text-[11px] text-muted-foreground">
            Foto diambil langsung dengan kamera. Pastikan nomor struk terbaca jelas.
          </p>

          <CameraCapture
            open={cameraOpen}
            onClose={() => setCameraOpen(false)}
            onCapture={onCapture}
            title="Foto struk"
          />
        </div>

        <ActionButton
          icon={Send}
          loading={submitting}
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="w-full"
        >
          {submitting ? 'Mengirim…' : 'Kirim Retur'}
        </ActionButton>
      </section>

      {/* ── Store's returns ── */}
      <Section title="Retur toko" meta={list.length > 0 ? `${list.length} terbaru` : undefined}>
        {loading ? (
          <SkeletonBlocks count={3} className="h-16" />
        ) : loadError ? (
          <Notice tone="error">{loadError}</Notice>
        ) : list.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="Belum ada retur"
            description="Retur yang dikirim tim toko akan muncul di sini."
          />
        ) : (
          <ListGroup>
            {list.map((item) => (
              <ReturnRow
                key={item.id}
                item={item}
                onOpen={() =>
                  setLightbox({
                    title: item.receiptNumber,
                    index: 0,
                    images: item.imageUrls.map((url, n) => ({ url, label: `Foto ${n + 1}` })),
                  })
                }
              />
            ))}
          </ListGroup>
        )}
      </Section>
    </PageBody>
  );
}
