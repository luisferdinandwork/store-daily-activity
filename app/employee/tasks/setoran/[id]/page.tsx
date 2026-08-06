'use client';
// app/employee/tasks/setoran/[id]/page.tsx
//
// Setoran does not enforce location. AccessGuard runs in check-in-only mode
// (`requireGeo={false}`), and no `geo` is sent on autosave/submit.
//
// UI: a single calm column instead of stacked cards —
//   • two amount inputs
//   • one summary "table" (label → value rows) for the breakdown
//   • two slim photo rows
//   • a collapsible note
// All business logic (autosave, no-geo guard, upload, submit gating) is
// unchanged from the previous version.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle, AlertTriangle, Camera, Check, CreditCard,
  Loader2, Receipt, X,
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
import CameraCapture from '@/components/shared/CameraCapture';
import { uploadTaskPhoto } from '@/lib/tasks-upload';

// ─── Types ───────────────────────────────────────────────────────────────────

type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'pending' | 'verified' | 'rejected';

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

  const [task, setTask] = useState<SetoranTaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState<'resi' | 'atm_card_selfie' | null>(null);
  const [cameraTarget, setCameraTarget] = useState<'resi' | 'atm_card_selfie' | null>(null);
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
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-secondary" />
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
      taskType="setoran"
      requireGeo={false}
    >
      {({ readonly, dis, locked, banner, lockedOverlay }) => (
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
          accessOk={!locked}
          banner={banner}
          lockedOverlay={lockedOverlay}
          submitting={submitting}
          setSubmitting={setSubmitting}
          uploading={uploading}
          setUploading={setUploading}
          submitError={submitError}
          setSubmitError={setSubmitError}
          cameraTarget={cameraTarget}
          setCameraTarget={setCameraTarget}
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
  cameraTarget: 'resi' | 'atm_card_selfie' | null;
  setCameraTarget: (v: 'resi' | 'atm_card_selfie' | null) => void;
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
    cameraTarget, setCameraTarget, router,
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
      const url = await uploadTaskPhoto(file, photoType);

      if (photoType === 'resi') {
        setResiPhoto(url);
        autoSave({ resiPhoto: url });
      } else {
        setAtmCardSelfiePhoto(url);
        autoSave({ atmCardSelfiePhoto: url });
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
    if (!accessOk) return 'Pastikan kamu sudah absen masuk.';
    if (storedNumber <= 0) return 'Isi nominal yang disetor terlebih dahulu.';
    if (isOverStored) return 'Uang disetor melebihi total wajib disetor.';
    if (!resiPhoto) return 'Foto resi belum diupload.';
    if (!atmCardSelfiePhoto) return 'Foto selfie dengan kartu ATM belum diupload.';
    return undefined;
  })();

  const photosDone = (resiPhoto ? 1 : 0) + (atmCardSelfiePhoto ? 1 : 0);

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
            <p className="min-w-0 flex-1 text-xs text-red-700 break-words">{submitError}</p>
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

          <div className="space-y-5">
            {previousUnpaidAmount > 0 && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />
                <p className="text-xs text-amber-900">
                  Sisa unpaid sebelumnya <span className="font-bold">{rupiah(previousUnpaidAmount)}</span> ditambahkan ke total hari ini.
                </p>
              </div>
            )}

            {/* ─── Inputs ─────────────────────────────────────────────────── */}
            <div className="space-y-3">
              <AmountField
                label="Uang aktual diterima kemarin"
                value={actualReceivedAmount}
                onChange={(v) => setActualReceivedAmount(onlyDigits(v))}
                onBlur={() => autoSave({ actualReceivedAmount })}
                disabled={dis}
                placeholder="1.000.000"
              />
              <AmountField
                label="Nominal yang disetor"
                value={storedAmount}
                onChange={(v) => setStoredAmount(onlyDigits(v))}
                onBlur={() => autoSave({ storedAmount })}
                disabled={dis}
                error={isOverStored ? 'Tidak boleh melebihi total wajib disetor.' : undefined}
                placeholder="950.000"
              />
            </div>

            {/* ─── Breakdown table ────────────────────────────────────────── */}
            <SummaryTable>
              <SummaryRow label="Uang diterima" value={rupiah(actualReceivedNumberOf(actualReceivedAmount))} />
              <SummaryRow label="Unpaid sebelumnya" value={rupiah(previousUnpaidAmount)} muted={previousUnpaidAmount === 0} />
              <SummaryRow label="Total wajib disetor" value={rupiah(requiredStoreAmount)} strong />
              <SummaryRow label="Disetor" value={rupiah(storedNumber)} />
              <SummaryRow
                label={unpaidAmount === 0 ? 'Status' : 'Sisa belum disetor'}
                value={unpaidAmount === 0 ? 'Setoran cukup' : rupiah(unpaidAmount)}
                tone={unpaidAmount === 0 ? 'ok' : 'warn'}
                strong
                last
              />
            </SummaryTable>

            {/* ─── Photos ─────────────────────────────────────────────────── */}
            <div>
              <SectionLabel>
                Foto bukti
                <span className="ml-1 font-normal text-muted-foreground">{photosDone}/2</span>
              </SectionLabel>
              <div className="overflow-hidden rounded-xl border border-border">
                <PhotoRow
                  title="Foto Resi"
                  hint="Bukti resi setoran"
                  photo={resiPhoto}
                  disabled={dis || uploading !== null}
                  loading={uploading === 'resi'}
                  onClick={() => setCameraTarget('resi')}
                  icon={<Receipt className="h-4 w-4" />}
                />
                <div className="h-px bg-border" />
                <PhotoRow
                  title="Selfie + Kartu ATM"
                  hint="Wajah memegang kartu ATM"
                  photo={atmCardSelfiePhoto}
                  disabled={dis || uploading !== null}
                  loading={uploading === 'atm_card_selfie'}
                  onClick={() => setCameraTarget('atm_card_selfie')}
                  icon={<CreditCard className="h-4 w-4" />}
                />
              </div>

              <CameraCapture
                open={cameraTarget !== null}
                onClose={() => setCameraTarget(null)}
                onCapture={(file) => {
                  const target = cameraTarget;
                  setCameraTarget(null);
                  if (target) void uploadPhoto(file, target);
                }}
                title={cameraTarget === 'atm_card_selfie' ? 'Selfie + Kartu ATM' : 'Foto Resi'}
                facingMode={cameraTarget === 'atm_card_selfie' ? 'user' : 'environment'}
              />
            </div>

            {/* ─── Notes ──────────────────────────────────────────────────── */}
            <div>
              <SectionLabel>Catatan <span className="font-normal text-muted-foreground">opsional</span></SectionLabel>
              <textarea
                disabled={dis}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => autoSave({ notes })}
                placeholder="Tambahkan catatan jika ada…"
                rows={2}
                className="w-full resize-none rounded-xl border border-border bg-secondary px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              />
            </div>
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

// Small local helper so the table's "Uang diterima" row matches the input live.
function actualReceivedNumberOf(raw: string): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ─── Local UI pieces ────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
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
      <span className="px-0.5 text-xs font-medium text-muted-foreground">{label}</span>
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
      {error && <p className="px-0.5 text-[11px] font-medium text-red-600">{error}</p>}
    </label>
  );
}

// A clean key→value table: one bordered container, hairline-separated rows.
function SummaryTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {children}
    </div>
  );
}

function SummaryRow({
  label, value, strong, muted, last, tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  last?: boolean;
  tone?: 'ok' | 'warn';
}) {
  const toneClass =
    tone === 'ok' ? 'text-green-700'
    : tone === 'warn' ? 'text-amber-700'
    : 'text-foreground';

  return (
    <div className={cn(
      'flex items-center justify-between gap-3 px-3.5 py-2.5',
      !last && 'border-b border-border',
      tone === 'ok' && 'bg-green-50',
      tone === 'warn' && 'bg-amber-50',
    )}>
      <span className={cn('text-xs', muted ? 'text-muted-foreground' : 'text-muted-foreground', strong && 'font-semibold text-foreground')}>
        {label}
      </span>
      <span className={cn(
        'tabular-nums',
        strong ? 'text-sm font-bold' : 'text-sm font-semibold',
        toneClass,
      )}>
        {value}
      </span>
    </div>
  );
}

// A single compact photo row — thumbnail/icon, label, and state on the right.
function PhotoRow({
  title, hint, photo, onClick, disabled, loading, icon,
}: {
  title: string;
  hint: string;
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
      className="flex w-full items-center gap-3 bg-card px-3.5 py-3 text-left transition active:bg-secondary disabled:opacity-60"
    >
      {photo ? (
        <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-background">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt={title} className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-secondary text-violet-700">
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : icon}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{photo ? 'Tap untuk ganti' : hint}</p>
      </div>

      {photo ? (
        <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
          <Check className="h-3 w-3" /> Ada
        </span>
      ) : (
        <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
          <Camera className="h-3 w-3" /> Foto
        </span>
      )}
    </button>
  );
}