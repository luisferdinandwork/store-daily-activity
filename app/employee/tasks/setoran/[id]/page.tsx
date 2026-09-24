'use client';
// app/employee/tasks/setoran/[id]/page.tsx
//
// Setoran does not enforce location. AccessGuard runs in check-in-only mode
// (`requireGeo={false}`), and no `geo` is sent on autosave/submit.
//
// UI: a single calm column —
//   • purple summary box: "Total uang Cash Drawer" (uang aktual diterima + sisa
//     belum disetor) and "Total wajib disetor" (that, rounded DOWN to the
//     nearest Rp 50.000). Tapping "Total wajib disetor" opens a modal to
//     override it; a "Hitung otomatis" button in the modal restores the auto value.
//   • "Uang aktual diterima kemarin" input
//   • "Kurang" field — the remainder that carries to the next setoran
//   • two slim photo rows + a note
// All business logic (autosave, no-geo guard, upload, submit gating) is
// unchanged from the previous version.
//
// Naming ↔ DB: "Total uang Cash Drawer" = expectedAmount + carriedDeficit;
// "Total wajib disetor" = amount (the deposit); "Kurang" = unpaidAmount.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, CreditCard, Pencil, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import {
  AccessGuard,
  TaskHeader,
  TaskSubmitBar,
  SaveIndicator,
  shiftLabel,
} from '@/components/employee/tasks';
import {
  ActionButton, AmountField, BottomSheet, FieldLabel, InfoRow, ListGroup, Notice,
  NotesField, PageBody, PhotoRow, Section, TaskLoadingScreen, TaskMissingScreen,
  TaskReviewNotices,
} from '@/components/employee/ui';
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

function toNumber(raw: string | null | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const SETORAN_STEP = 50_000;

/** Round a cash-drawer total DOWN to the nearest deposit step (kelipatan 50.000). */
function roundDownToStep(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n / SETORAN_STEP) * SETORAN_STEP;
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
  // false → "Total wajib disetor" follows the auto kelipatan-50.000 value;
  // true  → the employee has typed their own amount, leave it alone.
  const [storedManual, setStoredManual] = useState(false);
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
      const savedStored = d.storedAmount ?? d.amount ?? '';
      setStoredAmount(String(savedStored));
      // A previously saved deposit is treated as a manual value so the auto
      // recompute doesn't clobber it on load.
      setStoredManual(Boolean(savedStored));
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

  // "Tidak ada setoran" — employee explicitly typed 0 for uang aktual diterima.
  // No money to deposit, so nominal disetor and photos are not required.
  const isNoSetoran = actualReceivedAmount.trim() !== '' && actualReceivedNumber === 0;

  // "Total uang Cash Drawer" = uang aktual diterima + sisa belum disetor.
  const cashDrawerTotal = actualReceivedNumber + previousUnpaidAmount;
  // Auto-suggested deposit: that total rounded DOWN to the nearest Rp 50.000.
  const autoStored = isNoSetoran ? 0 : roundDownToStep(cashDrawerTotal);
  const storedNumber = isNoSetoran ? 0 : toNumber(storedAmount);
  // "Kurang" — the odd remainder that carries into the next setoran.
  const kurang = isNoSetoran ? cashDrawerTotal : Math.max(0, cashDrawerTotal - storedNumber);
  const isOverStored = !isNoSetoran && storedNumber > cashDrawerTotal && cashDrawerTotal > 0;

  // Keep "Total wajib disetor" tracking the auto value until the employee
  // overrides it (or presses "Hitung otomatis" to clear the override).
  useEffect(() => {
    if (storedManual || isNoSetoran) return;
    const next = autoStored > 0 ? String(autoStored) : '';
    setStoredAmount((prev) => (prev === next ? prev : next));
  }, [autoStored, storedManual, isNoSetoran]);

  // ─── Render ──────────────────────────────────────────────────────────────
  if (loading) return <TaskLoadingScreen title="Setoran" />;
  if (!task) return <TaskMissingScreen title="Setoran" message={submitError} />;

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
          cashDrawerTotal={cashDrawerTotal}
          autoStored={autoStored}
          storedManual={storedManual}
          setStoredManual={setStoredManual}
          storedNumber={storedNumber}
          kurang={kurang}
          isOverStored={isOverStored}
          isNoSetoran={isNoSetoran}
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
  cashDrawerTotal: number;
  autoStored: number;
  storedManual: boolean;
  setStoredManual: (v: boolean) => void;
  storedNumber: number;
  kurang: number;
  isOverStored: boolean;
  isNoSetoran: boolean;
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
    cashDrawerTotal, autoStored, storedManual, setStoredManual,
    storedNumber, kurang, isOverStored, isNoSetoran,
    readonly, dis, accessOk, banner, lockedOverlay,
    submitting, setSubmitting, uploading, setUploading,
    submitError, setSubmitError,
    cameraTarget, setCameraTarget, router,
  } = props;

  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
  // Validates, then opens the confirmation modal — the actual network call
  // happens in `doSubmit` once the employee confirms the values there. Every
  // submission is reviewed this way; the "no setoran" case gets extra emphasis
  // in the modal since it skips the usual deposit + photo evidence.
  const handleSubmit = useCallback(() => {
    if (readonly) return;
    setSubmitError(null);

    if (!isNoSetoran) {
      if (storedNumber <= 0) {
        setSubmitError('Total wajib disetor belum terisi. Isi uang aktual diterima kemarin terlebih dahulu.');
        return;
      }
      if (storedNumber > cashDrawerTotal) {
        setSubmitError('Total wajib disetor tidak boleh lebih besar dari total uang cash drawer.');
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
    }

    setConfirmOpen(true);
  }, [
    readonly, isNoSetoran, storedNumber, cashDrawerTotal, resiPhoto, atmCardSelfiePhoto,
    setSubmitError,
  ]);

  const doSubmit = useCallback(async () => {
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
          // Send the effective (isNoSetoran-aware) number, not the raw draft
          // string — avoids a stale non-zero storedAmount surviving a switch
          // to "no setoran" and tripping the server's consistency check.
          storedAmount: String(storedNumber),
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
      setConfirmOpen(false);
    }
  }, [
    storedNumber, resiPhoto, atmCardSelfiePhoto,
    task, actualReceivedAmount, notes, router,
    setSubmitError, setSubmitting,
  ]);

  // ─── Submit gating ───────────────────────────────────────────────────────
  const canSubmit =
    !readonly && accessOk &&
    (isNoSetoran || (storedNumber > 0 && !isOverStored && !!resiPhoto && !!atmCardSelfiePhoto));

  const submitHint = (() => {
    if (readonly) return undefined;
    if (!accessOk) return 'Pastikan kamu sudah absen masuk.';
    if (isNoSetoran) return undefined;
    if (storedNumber <= 0) return 'Isi uang aktual diterima kemarin terlebih dahulu.';
    if (isOverStored) return 'Total wajib disetor melebihi total uang cash drawer.';
    if (!resiPhoto) return 'Foto resi belum diupload.';
    if (!atmCardSelfiePhoto) return 'Foto selfie dengan kartu ATM belum diupload.';
    return undefined;
  })();

  const photosDone = (resiPhoto ? 1 : 0) + (atmCardSelfiePhoto ? 1 : 0);

  return (
    <>
      <TaskHeader
        title="Setoran"
        subtitle={shiftLabel(task.shift)}
        status={task.status}
        saveIndicator={!readonly ? <SaveIndicator status={saveStatus} lastSaved={lastSaved} /> : null}
      />

      <PageBody bottomBar={!readonly}>
        {banner}

        {submitError && (
          <Notice tone="error" onDismiss={() => setSubmitError(null)}>{submitError}</Notice>
        )}

        <TaskReviewNotices status={task.status} notes={task.notes} verifiedAt={task.verifiedAt} />

        <div className="relative">
          {lockedOverlay}

          <div className="space-y-5">
            {/* ─── Summary box ──────────────────────────────────────────────
                Total uang Cash Drawer  = uang aktual diterima + sisa belum disetor
                Total wajib disetor     = that, rounded down to kelipatan 50.000.
                Tap "Total wajib disetor" to override it.  */}
            <div className="space-y-2.5 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">
                  Total uang Cash Drawer
                </p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
                  {rupiah(cashDrawerTotal)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setEditOpen(true)}
                disabled={dis || isNoSetoran}
                className="flex w-full items-center justify-between gap-2 rounded-xl border-t border-primary/15 pt-3 text-left transition-opacity disabled:opacity-100"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">
                  Total wajib disetor
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-xl font-bold tabular-nums text-primary">
                    {rupiah(storedNumber)}
                  </span>
                  {!dis && !isNoSetoran && <Pencil className="h-3.5 w-3.5 text-primary/60" />}
                </span>
              </button>

              {!dis && (
                <p className="text-[11px] text-primary/60">
                  {isNoSetoran
                    ? 'Tidak ada setoran hari ini.'
                    : storedManual
                      ? `Diubah manual · ketuk untuk ubah · otomatis ${rupiah(autoStored)}`
                      : 'Otomatis kelipatan Rp 50.000 · ketuk untuk ubah'}
                </p>
              )}
            </div>

            {/* ─── Inputs ─────────────────────────────────────────────────── */}
            <div className="space-y-3">
              <AmountField
                label="Uang aktual diterima kemarin"
                value={actualReceivedAmount}
                onChange={setActualReceivedAmount}
                onBlur={() => autoSave({ actualReceivedAmount })}
                disabled={dis}
                placeholder="1.000.000"
                hint={isNoSetoran ? 'Isi 0 jika hari ini tidak ada setoran sama sekali.' : undefined}
              />

              <KurangField amount={kurang} isOver={isOverStored} pending={!isNoSetoran && storedNumber <= 0} isNoSetoran={isNoSetoran} />
            </div>

            {/* ─── Photos ─────────────────────────────────────────────────── */}
            <Section title="Foto bukti" meta={isNoSetoran ? 'opsional — tidak ada setoran' : `${photosDone}/2`}>
              <ListGroup>
                <PhotoRow
                  title="Foto Resi"
                  hint="Bukti resi setoran"
                  photo={resiPhoto}
                  disabled={dis || uploading !== null}
                  loading={uploading === 'resi'}
                  onClick={() => setCameraTarget('resi')}
                  icon={<Receipt className="h-4 w-4" />}
                />
                <PhotoRow
                  title="Selfie + Kartu ATM"
                  hint="Wajah memegang kartu ATM"
                  photo={atmCardSelfiePhoto}
                  disabled={dis || uploading !== null}
                  loading={uploading === 'atm_card_selfie'}
                  onClick={() => setCameraTarget('atm_card_selfie')}
                  icon={<CreditCard className="h-4 w-4" />}
                />
              </ListGroup>

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
            </Section>

            {/* ─── Notes ──────────────────────────────────────────────────── */}
            <NotesField
              value={notes}
              onChange={setNotes}
              onBlur={() => autoSave({ notes })}
              disabled={dis}
            />
          </div>
        </div>
      </PageBody>

      <TaskSubmitBar
        label="Submit Setoran"
        onSubmit={handleSubmit}
        submitting={submitting}
        disabled={!canSubmit}
        hint={submitHint}
        hidden={readonly}
      />

      {editOpen && (
        <StoredAmountModal
          onClose={() => setEditOpen(false)}
          cashDrawerTotal={cashDrawerTotal}
          autoStored={autoStored}
          current={storedAmount}
          onSave={(value, manual) => {
            if (manual) {
              setStoredAmount(value);
              setStoredManual(true);
            } else {
              setStoredManual(false);
            }
            setEditOpen(false);
            autoSave({ storedAmount: manual ? value : String(autoStored) });
          }}
        />
      )}

      {confirmOpen && (
        <ConfirmSubmitModal
          isNoSetoran={isNoSetoran}
          actualReceivedNumber={toNumber(actualReceivedAmount)}
          storedNumber={storedNumber}
          kurang={kurang}
          submitting={submitting}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={doSubmit}
        />
      )}
    </>
  );
}

// ─── Local UI pieces ────────────────────────────────────────────────────────

// Read-only "Kurang" field — the odd remainder (Total uang Cash Drawer −
// Total wajib disetor) that carries into the next setoran.
function KurangField({
  amount, isOver, pending, isNoSetoran,
}: {
  amount: number;
  isOver: boolean;
  pending: boolean;
  isNoSetoran?: boolean;
}) {
  const tone: 'neutral' | 'ok' | 'warn' | 'error' =
    isNoSetoran ? (amount > 0 ? 'warn' : 'ok') :
    pending ? 'neutral' : isOver ? 'error' : amount > 0 ? 'warn' : 'ok';

  const helper = isNoSetoran
    ? (amount > 0
        ? 'Tidak ada setoran hari ini — sisa kemarin tetap dibawa ke setoran berikutnya.'
        : 'Tidak ada setoran hari ini.')
    : {
        neutral: 'Isi uang aktual diterima kemarin dulu.',
        ok: 'Setoran pas.',
        warn: 'Otomatis ditagihkan di setoran berikutnya.',
        error: 'Perbaiki nominal Total wajib disetor di atas.',
      }[tone];

  const box = {
    neutral: 'border-border bg-secondary text-muted-foreground',
    ok: 'border-green-200 bg-green-50 text-green-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-red-200 bg-red-50 text-red-700',
  }[tone];

  return (
    <div className="space-y-1.5">
      <FieldLabel>Kurang</FieldLabel>
      <div className={cn(
        'flex h-12 w-full items-center gap-1.5 rounded-xl border px-3.5 text-base font-bold tabular-nums',
        box,
      )}>
        <span className="text-sm font-semibold opacity-70">Rp</span>
        <span>{Math.max(0, amount).toLocaleString('id-ID')}</span>
      </div>
      <p className={cn('px-0.5 text-[11px]', isOver ? 'font-medium text-red-600' : 'text-muted-foreground')}>
        {helper}
      </p>
    </div>
  );
}

// Bottom-sheet modal for overriding "Total wajib disetor". "Hitung otomatis"
// restores the kelipatan-50.000 value derived from the Cash Drawer total.
// Mounted only while open (see call site), so `current` seeds the draft once.
function StoredAmountModal({
  onClose, cashDrawerTotal, autoStored, current, onSave,
}: {
  onClose: () => void;
  cashDrawerTotal: number;
  autoStored: number;
  current: string;
  onSave: (value: string, manual: boolean) => void;
}) {
  const [draft, setDraft] = useState(current);
  const [useAuto, setUseAuto] = useState(false);

  const draftNum = toNumber(draft);
  const effective = useAuto ? autoStored : draftNum;
  const over = effective > cashDrawerTotal && cashDrawerTotal > 0;
  const previewKurang = Math.max(0, cashDrawerTotal - effective);
  const canSave = !over && effective > 0;

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Total wajib disetor"
      description={`Total uang Cash Drawer ${rupiah(cashDrawerTotal)}`}
      footer={
        <>
          <ActionButton variant="secondary" className="flex-1" onClick={onClose}>Batal</ActionButton>
          <ActionButton
            className="flex-1"
            disabled={!canSave}
            onClick={() => onSave(useAuto ? String(autoStored) : draft, !useAuto)}
          >
            Simpan
          </ActionButton>
        </>
      }
    >
      <AmountField
        label="Nominal yang disetor"
        value={useAuto ? String(autoStored) : draft}
        onChange={(v) => { setDraft(v); setUseAuto(false); }}
        error={over ? 'Tidak boleh melebihi total uang cash drawer.' : undefined}
        placeholder="1.750.000"
      />

      <button
        type="button"
        onClick={() => setUseAuto(true)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs transition-colors',
          useAuto
            ? 'border-primary/40 bg-primary/5 text-primary'
            : 'border-border bg-secondary text-muted-foreground hover:bg-secondary/70',
        )}
      >
        <span className="font-medium">Hitung otomatis · kelipatan Rp 50.000</span>
        <span className="font-bold tabular-nums">{rupiah(autoStored)}</span>
      </button>

      <div className="flex items-center justify-between rounded-xl bg-secondary px-3.5 py-2.5 text-xs">
        <span className="text-muted-foreground">Kurang</span>
        <span className="font-bold tabular-nums text-foreground">{rupiah(previewKurang)}</span>
      </div>
    </BottomSheet>
  );
}

// Final review before the setoran actually gets submitted (locked afterwards).
// Every submission passes through here so the employee can recheck the
// numbers; the "no setoran" case gets an extra warning since it skips the
// usual deposit + photo evidence.
function ConfirmSubmitModal({
  isNoSetoran, actualReceivedNumber, storedNumber, kurang, submitting, onCancel, onConfirm,
}: {
  isNoSetoran: boolean;
  actualReceivedNumber: number;
  storedNumber: number;
  kurang: number;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <BottomSheet
      open
      onClose={onCancel}
      dismissible={!submitting}
      title={isNoSetoran ? 'Konfirmasi: Tidak Ada Setoran' : 'Konfirmasi Setoran'}
      description="Periksa lagi nominalnya sebelum submit — setoran tidak bisa diubah lagi setelah ini."
      footer={
        <>
          <ActionButton variant="secondary" className="flex-1" onClick={onCancel} disabled={submitting}>
            Periksa lagi
          </ActionButton>
          <ActionButton className="flex-1" onClick={onConfirm} loading={submitting}>
            Ya, Submit
          </ActionButton>
        </>
      }
    >
      {isNoSetoran && (
        <Notice tone="warning" icon={AlertCircle}>
          Uang aktual diterima diisi <span className="font-bold">Rp 0</span> — kamu akan submit
          bahwa hari ini <span className="font-bold">tidak ada setoran sama sekali</span>, tanpa
          foto resi maupun selfie ATM. Pastikan ini benar.
        </Notice>
      )}

      <ListGroup>
        <InfoRow label="Uang aktual diterima" value={rupiah(actualReceivedNumber)} />
        <InfoRow label="Total wajib disetor" value={rupiah(storedNumber)} />
        <InfoRow label="Kurang" value={rupiah(kurang)} />
      </ListGroup>
    </BottomSheet>
  );
}
