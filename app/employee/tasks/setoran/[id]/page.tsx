'use client';
// app/employee/tasks/setoran/[id]/page.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  Receipt,
  Wallet,
  CreditCard,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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

  // Old names kept by /api/employee/tasks for compatibility.
  amount: string | null;
  expectedAmount: string | null;
  carriedDeficit: string | null;
  carriedDeficitFetchedAt: string | null;
  unpaidAmount: string | null;

  // New clearer money-storage names.
  actualReceivedAmount?: string | null;
  previousUnpaidAmount?: string | null;
  requiredStoreAmount?: string | null;
  storedAmount?: string | null;

  resiPhoto: string | null;
  atmCardSelfiePhoto: string | null;

  // Optional field-level tracking fields from backend.
  actualReceivedAmountBy?: string | null;
  actualReceivedAmountAt?: string | null;
  storedAmountBy?: string | null;
  storedAmountAt?: string | null;
  resiPhotoBy?: string | null;
  resiPhotoAt?: string | null;
  atmCardSelfiePhotoBy?: string | null;
  atmCardSelfiePhotoAt?: string | null;
  notesBy?: string | null;
  notesAt?: string | null;
  completedBy?: string | null;
  completedByScheduleId?: string | null;
};

type TaskItem = {
  type: string;
  data: SetoranTaskData;
};

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

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'in_progress': return 'Active';
    case 'completed': return 'Submitted';
    case 'verified': return 'Verified';
    case 'rejected': return 'Rejected';
    case 'discrepancy': return 'Discrepancy';
    default: return status;
  }
}

function statusClass(status: TaskStatus): string {
  switch (status) {
    case 'completed':
    case 'verified':
      return 'bg-green-100 text-green-700 hover:bg-green-100';
    case 'rejected':
      return 'bg-red-100 text-red-700 hover:bg-red-100';
    case 'discrepancy':
      return 'bg-amber-100 text-amber-700 hover:bg-amber-100';
    case 'in_progress':
      return 'bg-primary/10 text-primary hover:bg-primary/10';
    default:
      return 'bg-muted text-muted-foreground hover:bg-muted';
  }
}

export default function SetoranTaskPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const taskId = String(params?.id ?? '');

  const resiInputRef = useRef<HTMLInputElement | null>(null);
  const atmInputRef = useRef<HTMLInputElement | null>(null);

  const [task, setTask] = useState<SetoranTaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'resi' | 'atm_card_selfie' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [actualReceivedAmount, setActualReceivedAmount] = useState('');
  const [storedAmount, setStoredAmount] = useState('');
  const [resiPhoto, setResiPhoto] = useState<string | null>(null);
  const [atmCardSelfiePhoto, setAtmCardSelfiePhoto] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/employee/tasks', { cache: 'no-store' });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error ?? 'Failed to load task.');

      const found = (data.tasks ?? []).find(
        (item: TaskItem) => item.type === 'setoran' && String(item.data.id) === taskId,
      ) as TaskItem | undefined;

      if (!found) throw new Error('Setoran task not found.');

      const d = found.data;
      setTask(d);
      setActualReceivedAmount(String(d.actualReceivedAmount ?? d.expectedAmount ?? ''));
      setStoredAmount(String(d.storedAmount ?? d.amount ?? ''));
      setResiPhoto(d.resiPhoto ?? null);
      setAtmCardSelfiePhoto(d.atmCardSelfiePhoto ?? null);
      setNotes(d.notes ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const previousUnpaidAmount = useMemo(() => {
    return toNumber(task?.previousUnpaidAmount ?? task?.carriedDeficit);
  }, [task]);

  const actualReceivedNumber = useMemo(() => toNumber(actualReceivedAmount), [actualReceivedAmount]);
  const requiredStoreAmount = useMemo(
    () => actualReceivedNumber + previousUnpaidAmount,
    [actualReceivedNumber, previousUnpaidAmount],
  );
  const storedNumber = useMemo(() => toNumber(storedAmount), [storedAmount]);
  const unpaidAmount = useMemo(
    () => Math.max(0, requiredStoreAmount - storedNumber),
    [requiredStoreAmount, storedNumber],
  );

  const isLocked = task?.status === 'completed' || task?.status === 'verified';
  const isOverStored = storedNumber > requiredStoreAmount && requiredStoreAmount > 0;

  const autoSave = useCallback(async (patch?: Record<string, unknown>) => {
    if (!task || isLocked) return;

    const payload = {
      taskId: Number(task.id),
      scheduleId: Number(task.scheduleId),
      storeId: Number(task.storeId),
      actualReceivedAmount,
      storedAmount,
      resiPhoto,
      atmCardSelfiePhoto,
      notes,
      ...(patch ?? {}),
    };

    try {
      const res = await fetch('/api/employee/tasks/setoran', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error ?? 'Failed to autosave Setoran.');
      }
    } catch (err) {
      console.error('[SetoranTaskPage] autosave error:', err);
    }
  }, [actualReceivedAmount, atmCardSelfiePhoto, isLocked, notes, resiPhoto, storedAmount, task]);

  const uploadPhoto = useCallback(async (file: File, photoType: 'resi' | 'atm_card_selfie') => {
    if (!task || isLocked) return;

    setUploading(photoType);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('photoType', photoType);

      const res = await fetch('/api/employee/tasks/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error ?? 'Upload failed.');

      if (photoType === 'resi') {
        setResiPhoto(data.url);
        await autoSave({ resiPhoto: data.url });
      } else {
        setAtmCardSelfiePhoto(data.url);
        await autoSave({ atmCardSelfiePhoto: data.url });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(null);
    }
  }, [autoSave, isLocked, task]);

  const submit = useCallback(async () => {
    if (!task || isLocked) return;

    setSaving(true);
    setError(null);

    try {
      if (actualReceivedNumber <= 0) throw new Error('Nominal uang aktual diterima hari ini wajib diisi.');
      if (storedNumber <= 0) throw new Error('Nominal uang yang disetor/disimpan wajib diisi.');
      if (storedNumber > requiredStoreAmount) throw new Error('Uang disetor tidak boleh lebih besar dari total wajib disetor.');
      if (!resiPhoto) throw new Error('Foto resi wajib diupload.');
      if (!atmCardSelfiePhoto) throw new Error('Foto selfie dengan kartu ATM wajib diupload.');

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
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to submit Setoran.');

      router.push('/employee/tasks');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [actualReceivedAmount, actualReceivedNumber, atmCardSelfiePhoto, isLocked, notes, requiredStoreAmount, resiPhoto, router, storedAmount, storedNumber, task]);

  if (loading) {
    return (
      <main className="min-h-screen bg-background px-4 py-6">
        <div className="mx-auto flex max-w-md items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading Setoran...
        </div>
      </main>
    );
  }

  if (!task) {
    return (
      <main className="min-h-screen bg-background px-4 py-6">
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => router.back()} className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 text-sm text-red-700">{error ?? 'Setoran task not found.'}</CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background pb-28">
      <div className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full border bg-card"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold">Setoran</h1>
            <p className="text-xs text-muted-foreground">Uang diterima, uang disetor, dan sisa unpaid.</p>
          </div>
          <Badge className={cn('text-[11px]', statusClass(task.status))}>{statusLabel(task.status)}</Badge>
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-4 px-4 py-4">
        {previousUnpaidAmount > 0 && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="flex gap-3 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-semibold text-amber-900">Ada kekurangan dari setoran sebelumnya</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  Sisa unpaid <span className="font-bold">{rupiah(previousUnpaidAmount)}</span> otomatis ditambahkan ke total uang yang wajib disetor hari ini.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-bold">Nominal Setoran</h2>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Uang aktual diterima hari ini</span>
              <input
                inputMode="numeric"
                disabled={isLocked}
                value={actualReceivedAmount ? Number(actualReceivedAmount).toLocaleString('id-ID') : ''}
                onChange={(e) => setActualReceivedAmount(onlyDigits(e.target.value))}
                onBlur={() => void autoSave({ actualReceivedAmount })}
                placeholder="Contoh: 1000000"
                className="h-12 w-full rounded-xl border bg-background px-3 text-base font-semibold outline-none focus:border-primary disabled:opacity-60"
              />
            </label>

            <div className="rounded-xl border bg-muted/40 p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Unpaid sebelumnya</span>
                <span className="font-semibold text-foreground">{rupiah(previousUnpaidAmount)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Total wajib disetor</span>
                <span className="text-base font-bold text-foreground">{rupiah(requiredStoreAmount)}</span>
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Uang yang benar-benar disetor/disimpan</span>
              <input
                inputMode="numeric"
                disabled={isLocked}
                value={storedAmount ? Number(storedAmount).toLocaleString('id-ID') : ''}
                onChange={(e) => setStoredAmount(onlyDigits(e.target.value))}
                onBlur={() => void autoSave({ storedAmount })}
                placeholder="Contoh: 850000"
                className={cn(
                  'h-12 w-full rounded-xl border bg-background px-3 text-base font-semibold outline-none focus:border-primary disabled:opacity-60',
                  isOverStored && 'border-red-400 focus:border-red-500',
                )}
              />
              {isOverStored && <p className="text-xs text-red-600">Tidak boleh lebih besar dari total wajib disetor.</p>}
            </label>

            <div className={cn('rounded-xl border p-3', unpaidAmount > 0 ? 'border-amber-300 bg-amber-50' : 'border-green-200 bg-green-50')}>
              <div className="flex items-center justify-between gap-3">
                <span className={cn('text-sm font-semibold', unpaidAmount > 0 ? 'text-amber-900' : 'text-green-800')}>
                  {unpaidAmount > 0 ? 'Sisa belum disetor' : 'Setoran cukup'}
                </span>
                <span className={cn('text-lg font-bold', unpaidAmount > 0 ? 'text-amber-900' : 'text-green-800')}>
                  {rupiah(unpaidAmount)}
                </span>
              </div>
              {unpaidAmount > 0 && (
                <p className="mt-1 text-xs text-amber-800">Nominal ini akan menjadi kebutuhan setoran morning berikutnya.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-bold">Bukti Foto</h2>
            </div>

            <PhotoButton
              title="Foto Resi"
              description="Upload bukti resi setoran."
              photo={resiPhoto}
              disabled={isLocked || uploading !== null}
              loading={uploading === 'resi'}
              onClick={() => resiInputRef.current?.click()}
            />

            <PhotoButton
              title="Selfie dengan Kartu ATM"
              description="Upload selfie memegang kartu ATM."
              photo={atmCardSelfiePhoto}
              disabled={isLocked || uploading !== null}
              loading={uploading === 'atm_card_selfie'}
              onClick={() => atmInputRef.current?.click()}
              icon="card"
            />

            <input
              ref={resiInputRef}
              type="file"
              accept="image/*"
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
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void uploadPhoto(file, 'atm_card_selfie');
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 p-4">
            <label className="block text-xs font-medium text-muted-foreground">Catatan</label>
            <textarea
              disabled={isLocked}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => void autoSave({ notes })}
              placeholder="Tambahkan catatan jika ada..."
              rows={4}
              className="w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
            />
          </CardContent>
        </Card>

        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
          </Card>
        )}
      </div>

      {!isLocked && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-md">
            <button
              type="button"
              disabled={saving || uploading !== null || isOverStored}
              onClick={() => void submit()}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Submit Setoran
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function PhotoButton({
  title,
  description,
  photo,
  onClick,
  disabled,
  loading,
  icon,
}: {
  title: string;
  description: string;
  photo: string | null;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: 'camera' | 'card';
}) {
  const Icon = icon === 'card' ? CreditCard : Camera;

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
        <div className="h-14 w-14 overflow-hidden rounded-lg border bg-background">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt={title} className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-background">
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <Icon className="h-5 w-5 text-amber-700" />}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{photo ? 'Foto sudah diupload. Tap untuk ganti.' : description}</p>
      </div>
    </button>
  );
}
