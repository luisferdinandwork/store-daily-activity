'use client';
// app/employee/tasks/setoran/[id]/page.tsx
//
// Setoran does not enforce location. AccessGuard runs in check-in-only mode
// (`requireGeo={false}`), and no `geo` is sent on autosave/submit.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle, Camera, CreditCard, Loader2,
  Receipt, Wallet, AlertCircle, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import {
  AccessGuard,
  TaskHeader,
  TaskSubmitBar,
  SaveIndicator,
} from '@/components/employee/tasks';

// ─── Types ───────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'discrepancy' | 'verified' | 'rejected';

type SetoranTaskData = {
  id: string;
  scheduleId: string;
  userId: string;
  storeId: string;
  shift: 'morning' | 'evening' | 'full_day';
  date: string;
  status: TaskStatus;
  notes: string | null;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;

  amount: string | null;
  expectedAmount: string | null;
  carriedDeficit: string | null;
  carriedDeficitFetchedAt: string | null;
  unpaidAmount: string | null;

  actualReceivedAmount?: string | null;
  previousUnpaidAmount?: string | null;
  requiredStoreAmount?: string | null;
  storedAmount?: string | null;

  resiPhoto: string | null;
  atmCardSelfiePhoto: string | null;
};

type TaskItem = { type: string; data: SetoranTaskData };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rupiah(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 'Rp 0';
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function onlyDigits(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

function toNumber(raw: string | null | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SetoranTaskPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const taskId = String(params?.id ?? '');

  const resiInputRef = useRef<HTMLInputElement | null>(null);
  const atmInputRef = useRef<HTMLInputElement | null>(null);

  const [task, setTask] = useState<SetoranTaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState<'resi' | 'atm_card_selfie' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [actualReceivedAmount, setActualReceivedAmount] = useState('');
  const [storedAmount, setStoredAmount] = useState('');
  const [resiPhoto, setResiPhoto] = useState<string | null>(null);
  const [atmCardSelfiePhoto, setAtmCardSelfiePhoto] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  // ─── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/employee/tasks', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Gagal memuat task.');

      const found = (data.tasks ?? []).find(
        (item: TaskItem) => item.type === 'setoran' && String(item.data.id) === taskId,
      ) as TaskItem | undefined;

      if (!found) throw new Error('Setoran task tidak ditemukan.');

      const d = found.data;
      setTask(d);
      setActualReceivedAmount(String(d.actualReceivedAmount ?? d.expectedAmount ?? ''));
      setStoredAmount(String(d.storedAmount ?? d.amount ?? ''));
      setResiPhoto(d.resiPhoto ?? null);
      setAtmCardSelfiePhoto(d.atmCardSelfiePhoto ?? null);
      setNotes(d.notes ?? '');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  // ─── Derived numbers ─────────────────────────────────────────────────────
  const previousUnpaidAmount = useMemo(
    () => toNumber(task?.previousUnpaidAmount ?? task?.carriedDeficit),
    [task],
  );
  const actualReceivedNumber = useMemo(() => toNumber(actualReceivedAmount), [actualReceivedAmount]);
  const requiredStoreAmount = actualReceivedNumber + previousUnpaidAmount;
  const storedNumber = toNumber(storedAmount);
  const unpaidAmount = Math.max(0, requiredStoreAmount - storedNumber);
  const isOverStored = storedNumber > requiredStoreAmount && requiredStoreAmount > 0;

  // ─── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen bg-background">
        <TaskHeader title="Setoran" />
        <div className="space-y-3 p-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-secondary" />
          ))}
        </div>
      </main>
    );
  }

  if (!task) {
    return (
      <main className="min-h-screen bg-background">
        <TaskHeader title="Setoran" />
        <div className="p-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {submitError ?? 'Setoran task tidak ditemukan.'}
          </div>
        </div>
      </main>
    );
  }

  return (
    <AccessGuard
      scheduleId={task.scheduleId}
      storeId={task.storeId}
      taskStatus={task.status}
      requireGeo={false}
    >
      {({ readonly, dis, accessStatus, banner, lockedOverlay }) => (
        <SetoranPageBody
          task={task}
          actualReceivedAmount={actualReceivedAmount}
          setActualReceivedAmount={setActualReceivedAmount}
          storedAmount={storedAmount}
          setStoredAmount={setStoredAmount}
          resiPhoto={resiPhoto}
          setResiPhoto={setResiPhoto}
          atmCardSelfiePhoto={atmCardSelfiePhoto}
          setAtmCardSelfiePhoto={setAtmCardSelfiePhoto}
          notes={notes}
          setNotes={setNotes}
          previousUnpaidAmount={previousUnpaidAmount}
          requiredStoreAmount={requiredStoreAmount}
          storedNumber={storedNumber}
          unpaidAmount={unpaidAmount}
          isOverStored={isOverStored}
          readonly={readonly}
          dis={dis}
          accessOk={accessStatus?.status === 'ok'}
          banner={banner}
          lockedOverlay={lockedOverlay}
          submitting={submitting}
          setSubmitting={setSubmitting}
          uploading={uploading}
          setUploading={setUploading}
          submitError={submitError}
          setSubmitError={setSubmitError}
          resiInputRef={resiInputRef}
          atmInputRef={atmInputRef}
          router={router}
        />
      )}
    </AccessGuard>
  );
}

// ─── Body (inside AccessGuard) ──────────────────────────────────────────────

interface BodyProps {
  task: SetoranTaskData;
  actualReceivedAmount: string;
  setActualReceivedAmount: (v: string) => void;
  storedAmount: string;
  setStoredAmount: (v: string) => void;
  resiPhoto: string | null;
  setResiPhoto: (v: string | null) => void;
  atmCardSelfiePhoto: string | null;
  setAtmCardSelfiePhoto: (v: string | null) => void;
  notes: string;
  setNotes: (v: string) => void;
  previousUnpaidAmount: number;
  requiredStoreAmount: number;
  storedNumber: number;
  unpaidAmount: number;
  isOverStored: boolean;
  readonly: boolean;
  dis: boolean;
  accessOk: boolean;
  banner: React.ReactNode;
  lockedOverlay: React.ReactNode;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  uploading: 'resi' | 'atm_card_selfie' | null;
  setUploading: (v: 'resi' | 'atm_card_selfie' | null) => void;
  submitError: string | null;
  setSubmitError: (v: string | null) => void;
  resiInputRef: React.MutableRefObject<HTMLInputElement | null>;
  atmInputRef: React.MutableRefObject<HTMLInputElement | null>;
  router: ReturnType<typeof useRouter>;
}

function SetoranPageBody(props: BodyProps) {
  const {
    task, actualReceivedAmount, setActualReceivedAmount, storedAmount, setStoredAmount,
    resiPhoto, setResiPhoto, atmCardSelfiePhoto, setAtmCardSelfiePhoto, notes, setNotes,
    previousUnpaidAmount, requiredStoreAmount, storedNumber, unpaidAmount, isOverStored,
    readonly, dis, accessOk, banner, lockedOverlay,
    submitting, setSubmitting, uploading, setUploading,
    submitError, setSubmitError,
    resiInputRef, atmInputRef, router,
  } = props;

  // ─── Autosave (no geo) ───────────────────────────────────────────────────
  const { status: saveStatus, lastSaved, save: rawAutoSave } = useAutoSave({
    url: '/api/employee/tasks/setoran',
    baseBody: {
      taskId: Number(task.id),
      scheduleId: Number(task.scheduleId),
      storeId: Number(task.storeId),
    },
    debounceMs: 800,
  });

  const autoSave = useCallback((patch: Record<string, unknown>) => {
    if (readonly) return;
    rawAutoSave({
      taskId: Number(task.id),
      scheduleId: Number(task.scheduleId),
      storeId: Number(task.storeId),
      actualReceivedAmount,
      storedAmount,
      resiPhoto,
      atmCardSelfiePhoto,
      notes,
      ...patch,
    });
  }, [
    readonly, rawAutoSave, task,
    actualReceivedAmount, storedAmount, resiPhoto, atmCardSelfiePhoto, notes,
  ]);

  // ─── Photo upload ────────────────────────────────────────────────────────
  const uploadPhoto = useCallback(async (file: File, photoType: 'resi' | 'atm_card_selfie') => {
    if (dis) return;
    setUploading(photoType);
    setSubmitError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('photoType', photoType);

      const res = await fetch('/api/employee/tasks/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Upload gagal.');

      if (photoType === 'resi') {
        setResiPhoto(data.url);
        autoSave({ resiPhoto: data.url });
      } else {
        setAtmCardSelfiePhoto(data.url);
        autoSave({ atmCardSelfiePhoto: data.url });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setUploading(null);
    }
  }, [dis, autoSave, setResiPhoto, setAtmCardSelfiePhoto, setUploading, setSubmitError]);

  // ─── Submit (no geo) ─────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (readonly) return;
    setSubmitError(null);

    if (storedNumber <= 0) {
      setSubmitError('Nominal yang disetor wajib diisi.');
      return;
    }
    if (storedNumber > requiredStoreAmount) {
      setSubmitError('Uang disetor tidak boleh lebih besar dari total wajib disetor.');
      return;
    }
    if (!resiPhoto) {
      setSubmitError('Foto resi wajib diupload.');
      return;
    }
    if (!atmCardSelfiePhoto) {
      setSubmitError('Foto selfie dengan kartu ATM wajib diupload.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/setoran', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: Number(task.id),
          scheduleId: Number(task.scheduleId),
          storeId: Number(task.storeId),
          actualReceivedAmount,
          storedAmount,
          resiPhoto,
          atmCardSelfiePhoto,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error ?? 'Gagal submit Setoran.');
      }
      toast.success('Setoran berhasil disubmit! ✓');
      router.push('/employee/tasks');
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    readonly, storedNumber, requiredStoreAmount, resiPhoto, atmCardSelfiePhoto,
    task, actualReceivedAmount, storedAmount, notes, router,
    setSubmitError, setSubmitting,
  ]);

  // ─── Submit gating ───────────────────────────────────────────────────────
  const canSubmit =
    !readonly && accessOk &&
    storedNumber > 0 && !isOverStored &&
    !!resiPhoto && !!atmCardSelfiePhoto;

  const submitHint = (() => {
    if (readonly) return undefined;
    if (!accessOk) return undefined; // banner already explains why
    if (storedNumber <= 0) return 'Isi nominal yang disetor terlebih dahulu.';
    if (isOverStored) return 'Uang disetor melebihi total wajib disetor.';
    if (!resiPhoto) return 'Foto resi belum diupload.';
    if (!atmCardSelfiePhoto) return 'Foto selfie dengan kartu ATM belum diupload.';
    return undefined;
  })();

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <TaskHeader
        title="Setoran"
        subtitle={`${task.shift} shift · ${task.status.replace('_', ' ')}`}
        status={task.status}
        saveIndicator={!readonly ? <SaveIndicator status={saveStatus} lastSaved={lastSaved} /> : null}
      />

      <div className="flex-1 space-y-4 p-4 pb-28">
        {banner}

        {submitError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-red-700 break-words">{submitError}</p>
            </div>
            <button onClick={() => setSubmitError(null)} className="flex-shrink-0 text-red-400 hover:text-red-600" aria-label="Tutup">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {task.status === 'rejected' && task.notes && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div>
              <p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p>
              <p className="mt-0.5 text-xs text-red-600">{task.notes}</p>
              <p className="mt-1.5 text-xs font-medium text-red-700">Perbaiki dan submit ulang.</p>
            </div>
          </div>
        )}

        <div className="relative">
          {lockedOverlay}

          <div className="space-y-4">
            {previousUnpaidAmount > 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />
                <p className="text-xs text-amber-900">
                  Sisa unpaid sebelumnya <span className="font-bold">{rupiah(previousUnpaidAmount)}</span> ditambahkan ke total hari ini.
                </p>
              </div>
            )}

            {/* ─── Amounts ──────────────────────────────────────────────── */}
            <SectionCard icon={<Wallet className="h-4 w-4" />} title="Deposit Amount">
              <AmountField
                label="Uang aktual diterima hari ini"
                value={actualReceivedAmount}
                onChange={(v) => setActualReceivedAmount(onlyDigits(v))}
                onBlur={() => autoSave({ actualReceivedAmount })}
                disabled={dis}
                placeholder="1.000.000"
              />

              <div className="rounded-xl bg-secondary px-3 py-2.5 text-xs">
                <RowKV label="Unpaid sebelumnya" value={rupiah(previousUnpaidAmount)} />
                <div className="my-1.5 h-px bg-border" />
                <RowKV label="Total wajib disetor" value={rupiah(requiredStoreAmount)} emphasis />
              </div>

              <AmountField
                label="Nominal yang disetor"
                value={storedAmount}
                onChange={(v) => setStoredAmount(onlyDigits(v))}
                onBlur={() => autoSave({ storedAmount })}
                disabled={dis}
                error={isOverStored ? 'Tidak boleh melebihi total wajib disetor.' : undefined}
                placeholder="950.000"
              />

              <ResultBadge unpaidAmount={unpaidAmount} />
            </SectionCard>

            {/* ─── Photos ────────────────────────────────────────────────── */}
            <SectionCard icon={<Receipt className="h-4 w-4" />} title="Photo Evidence">
              <PhotoSlot
                title="Foto Resi"
                description="Bukti resi setoran."
                photo={resiPhoto}
                disabled={dis || uploading !== null}
                loading={uploading === 'resi'}
                onClick={() => resiInputRef.current?.click()}
                icon={<Receipt className="h-5 w-5 text-amber-700" />}
              />
              <PhotoSlot
                title="Selfie dengan Kartu ATM"
                description="Foto wajah memegang kartu ATM."
                photo={atmCardSelfiePhoto}
                disabled={dis || uploading !== null}
                loading={uploading === 'atm_card_selfie'}
                onClick={() => atmInputRef.current?.click()}
                icon={<CreditCard className="h-5 w-5 text-amber-700" />}
              />

              <input
                ref={resiInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void uploadPhoto(file, 'resi');
                }}
              />
              <input
                ref={atmInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void uploadPhoto(file, 'atm_card_selfie');
                }}
              />
            </SectionCard>

            {/* ─── Notes ─────────────────────────────────────────────────── */}
            <SectionCard title="Notes" subtitle="Opsional">
              <textarea
                disabled={dis}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => autoSave({ notes })}
                placeholder="Tambahkan catatan jika ada…"
                rows={3}
                className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              />
            </SectionCard>
          </div>
        </div>
      </div>

      <TaskSubmitBar
        label="Submit Setoran"
        onSubmit={handleSubmit}
        submitting={submitting}
        disabled={!canSubmit}
        hint={submitHint}
        hidden={readonly}
      />
    </main>
  );
}

// ─── Local UI pieces ────────────────────────────────────────────────────────

function SectionCard({
  icon, title, subtitle, children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        {icon && <span className="text-primary">{icon}</span>}
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {subtitle && <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{subtitle}</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function AmountField({
  label, value, onChange, onBlur, disabled, placeholder, error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
}) {
  const formatted = value ? Number(value).toLocaleString('id-ID') : '';
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
          Rp
        </span>
        <input
          inputMode="numeric"
          disabled={disabled}
          value={formatted}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          className={cn(
            'h-12 w-full rounded-xl border bg-background pl-10 pr-3 text-base font-semibold tabular-nums outline-none transition-colors',
            'focus:border-primary disabled:opacity-60',
            error ? 'border-red-400 focus:border-red-500' : 'border-border',
          )}
        />
      </div>
      {error && <p className="text-[11px] font-medium text-red-600">{error}</p>}
    </label>
  );
}

function RowKV({
  label, value, emphasis,
}: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn('text-muted-foreground', emphasis && 'font-semibold text-foreground')}>
        {label}
      </span>
      <span className={cn(
        'tabular-nums',
        emphasis ? 'text-base font-bold text-foreground' : 'font-semibold text-foreground',
      )}>
        {value}
      </span>
    </div>
  );
}

function ResultBadge({ unpaidAmount }: { unpaidAmount: number }) {
  const isOk = unpaidAmount === 0;
  return (
    <div className={cn(
      'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5',
      isOk ? 'border-green-200 bg-green-50' : 'border-amber-300 bg-amber-50',
    )}>
      <span className={cn('text-xs font-semibold', isOk ? 'text-green-800' : 'text-amber-900')}>
        {isOk ? 'Setoran cukup' : 'Sisa belum disetor'}
      </span>
      <span className={cn('text-base font-bold tabular-nums', isOk ? 'text-green-800' : 'text-amber-900')}>
        {rupiah(unpaidAmount)}
      </span>
    </div>
  );
}

function PhotoSlot({
  title, description, photo, onClick, disabled, loading, icon,
}: {
  title: string;
  description: string;
  photo: string | null;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition active:scale-[0.99] disabled:opacity-60',
        photo ? 'border-green-200 bg-green-50' : 'border-dashed border-amber-300 bg-amber-50',
      )}
    >
      {photo ? (
        <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-background">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt={title} className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-background">
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {photo ? 'Tap untuk ganti foto.' : description}
        </p>
      </div>
      {!photo && <Camera className="h-4 w-4 flex-shrink-0 text-amber-700" />}
    </button>
  );
}