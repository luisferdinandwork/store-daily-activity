'use client';
// app/employee/tasks/setoran/[id]/page.tsx

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter }             from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, Camera, X, Loader2,
  AlertCircle, Cloud, CloudOff, Save,
  LogIn, RefreshCw, Receipt, AlertTriangle,
  TrendingDown, Wallet,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import ChecklistPhotoModal from '@/components/tasks/ChecklistPhotoModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected' | 'discrepancy';

interface SetoranData {
  id:              string;
  scheduleId:      string;
  userId:          string;
  storeId:         string;
  shift:           'morning' | 'evening';
  date:            string;
  status:          TaskStatus;
  notes:           string | null;
  completedAt:     string | null;
  verifiedBy:      string | null;
  verifiedAt:      string | null;
  amount:          string | null;
  linkSetoran:     string | null;
  resiPhoto:       string | null;
  // New running-deficit fields
  expectedAmount:          string | null;
  carriedDeficit:          string | null;
  carriedDeficitFetchedAt: string | null;
  unpaidAmount:            string | null;
}

interface SubmitMeta {
  unpaidAmount:           string;
  hasUnpaid:              boolean;
  nextDayCarriedDeficit:  string;
}

// ─── Rupiah helpers ───────────────────────────────────────────────────────────

function formatRupiah(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 'Rp 0';
  return 'Rp ' + parseInt(digits, 10).toLocaleString('id-ID');
}

// For stripping formatting from user-typed input (no decimals expected).
function parseRupiah(formatted: string): string {
  return formatted.replace(/\D/g, '') || '0';
}

// For loading a decimal string returned from the DB (e.g. "100000.00").
// Drops the fractional part BEFORE stripping non-digits, so "100000.00"
// becomes "100000" rather than "10000000".
function decimalToRupiahRaw(v: string | null | undefined): string {
  if (!v) return '0';
  const intPart = String(v).split('.')[0];
  return intPart.replace(/\D/g, '') || '0';
}

// ─── Check-in hook ────────────────────────────────────────────────────────────

type CheckInStatus = 'unknown' | 'checked_in' | 'not_checked_in';

function useCheckInStatus(scheduleId: string, storeId: string, taskStatus: TaskStatus | undefined) {
  const [status,  setStatus]  = useState<CheckInStatus>('unknown');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) {
      setStatus('checked_in'); setLoading(false); return;
    }
    if (!scheduleId || !storeId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ scheduleId, storeId });
      const res    = await fetch(`/api/employee/tasks/access?${params}`);
      const data   = await res.json() as { status: string };
      setStatus(data.status === 'not_checked_in' ? 'not_checked_in' : 'checked_in');
    } catch { setStatus('checked_in'); }
    finally  { setLoading(false); }
  }, [scheduleId, storeId, taskStatus]);

  useEffect(() => { refresh(); }, [refresh]);
  return { status, loading, refresh };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CheckInBanner({ status, loading, onRefresh }: {
  status: CheckInStatus; loading: boolean; onRefresh: () => void;
}) {
  if (loading) return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2.5">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      <p className="text-xs text-muted-foreground">Memeriksa absensi…</p>
    </div>
  );
  if (status !== 'not_checked_in') return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3.5">
      <LogIn className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-red-700">Belum absen masuk</p>
        <p className="mt-0.5 text-xs text-red-600">Lakukan absensi masuk terlebih dahulu.</p>
      </div>
      <button onClick={onRefresh}
        className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200 transition-colors">
        <RefreshCw className="h-3 w-3" />Cek ulang
      </button>
    </div>
  );
}

function SaveIndicator({ status, lastSaved }: {
  status: 'idle' | 'saving' | 'saved' | 'error'; lastSaved: Date | null;
}) {
  if (status === 'idle') return null;
  return (
    <div className={cn(
      'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
      status === 'saving' && 'bg-blue-50  text-blue-600',
      status === 'saved'  && 'bg-green-50 text-green-700',
      status === 'error'  && 'bg-red-50   text-red-600',
    )}>
      {status === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" />Menyimpan…</>}
      {status === 'saved'  && <><Cloud    className="h-3 w-3" />Tersimpan{lastSaved ? ` ${new Date(lastSaved).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}` : ''}</>}
      {status === 'error'  && <><CloudOff className="h-3 w-3" />Simpan gagal</>}
    </div>
  );
}

function CarriedDeficitBanner({ carriedDeficit }: { carriedDeficit: string }) {
  const amt = Number(carriedDeficit);
  if (!isFinite(amt) || amt <= 0) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
      <Wallet className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-amber-800">Ada kekurangan setoran kemarin</p>
        <p className="mt-0.5 text-xs text-amber-700">
          Kekurangan dari hari sebelumnya: <span className="font-bold">{formatRupiah(carriedDeficit)}</span>
        </p>
        <p className="mt-1 text-[11px] text-amber-700">
          Jumlah ini ditambahkan ke total yang wajib disetor hari ini.
        </p>
      </div>
    </div>
  );
}

function UnpaidResultBanner({ unpaid, nextDayCarried }: {
  unpaid: string; nextDayCarried: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3.5">
      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-orange-800">Setoran tersimpan — masih ada kekurangan</p>
        <p className="mt-0.5 text-xs text-orange-700">
          Sisa belum disetor: <span className="font-bold">{formatRupiah(unpaid)}</span>
        </p>
        <p className="mt-1.5 text-[11px] text-orange-700">
          Jumlah ini akan muncul sebagai kekurangan hari sebelumnya di setoran besok
          (Rp {Number(nextDayCarried).toLocaleString('id-ID')}).
        </p>
      </div>
    </div>
  );
}

function ResiPhotoTile({ photo, onClick, disabled, hasPhoto }: {
  photo: string | null; onClick: () => void; disabled?: boolean; hasPhoto: boolean;
}) {
  return (
    <button type="button" onClick={() => !disabled && onClick()}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all',
        hasPhoto ? 'border-primary/30 bg-primary/5' : 'border-amber-400 bg-amber-50',
        disabled && 'cursor-default opacity-60',
      )}>
      {hasPhoto && photo ? (
        <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-secondary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="Foto resi" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-amber-400 bg-amber-100">
          <Camera className="h-5 w-5 text-amber-600" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-semibold', hasPhoto ? 'text-foreground' : 'text-amber-800')}>Foto Resi</p>
        <p className={cn('mt-0.5 text-[11px]', hasPhoto ? 'text-muted-foreground' : 'text-amber-700')}>
          {hasPhoto ? 'Ketuk untuk mengubah foto' : 'Ketuk untuk upload foto resi (wajib)'}
        </p>
      </div>
      {hasPhoto && (
        <span className="flex-shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">1/1</span>
      )}
    </button>
  );
}

function RupiahInput({ value, onChange, disabled, placeholder, highlight }: {
  value: string; onChange: (raw: string) => void;
  disabled?: boolean; placeholder?: string;
  highlight?: 'error' | 'warning' | 'success' | null;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={formatRupiah(value)}
      disabled={disabled}
      placeholder={placeholder ?? 'Rp 0'}
      onChange={e => onChange(parseRupiah(e.target.value))}
      onFocus={e => {
        const el = e.target, len = el.value.length;
        requestAnimationFrame(() => el.setSelectionRange(len, len));
      }}
      className={cn(
        'w-full rounded-xl border bg-secondary px-4 py-3 text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 disabled:opacity-60',
        highlight === 'error'   && 'border-red-400    focus:ring-red-400/30',
        highlight === 'warning' && 'border-orange-400 focus:ring-orange-400/30',
        highlight === 'success' && 'border-green-400  focus:ring-green-400/30',
        !highlight              && 'border-border      focus:ring-primary/30',
      )}
    />
  );
}

function ReadOnlyAmount({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-bold tabular-nums text-foreground">{formatRupiah(value)}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function LockedOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-0 rounded-2xl bg-background/70 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 z-10">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <LogIn className="h-6 w-6 text-red-600" />
      </div>
      <p className="text-sm font-bold text-red-700">Absen masuk dulu</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SetoranDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [taskData,       setTaskData]       = useState<SetoranData | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [submitting,     setSubmitting]     = useState(false);
  const [submitError,    setSubmitError]    = useState<string | null>(null);
  const [submitMeta,     setSubmitMeta]     = useState<SubmitMeta | null>(null);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);

  // Form state — raw digit strings
  const [expectedAmount, setExpectedAmount] = useState('0');
  const [amount,         setAmount]         = useState('0');
  const [linkSetoran,    setLinkSetoran]    = useState('');
  const [resiPhoto,      setResiPhoto]      = useState<string | null>(null);
  const [notes,          setNotes]          = useState('');

  // ── Load task ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: { type: string; data: SetoranData }[] };
      const found = data.tasks?.find(t => t.type === 'setoran' && t.data.id === taskId);
      if (found) {
        const d = found.data;
        setTaskData(d);
        setExpectedAmount(decimalToRupiahRaw(d.expectedAmount));
        setAmount(decimalToRupiahRaw(d.amount));
        setLinkSetoran(d.linkSetoran ?? '');
        setResiPhoto(d.resiPhoto ?? null);
        setNotes(d.notes ?? '');
      } else {
        setTaskData(null);
      }
    } catch (e) {
      console.error('[SetoranDetailPage] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  // ── Check-in / auto-save ───────────────────────────────────────────────────
  const { status: checkInStatus, loading: checkInLoading, refresh: refreshCheckIn } = useCheckInStatus(
    taskData?.scheduleId ?? '',
    taskData?.storeId    ?? '',
    taskData?.status,
  );

  const scheduleId = taskData ? parseInt(taskData.scheduleId, 10) : 0;
  const storeId    = taskData ? parseInt(taskData.storeId,    10) : 0;

  const { status: saveStatus, lastSaved, error: saveError, save: autoSave } = useAutoSave({
    url:        '/api/employee/tasks/setoran',
    baseBody:   { scheduleId },
    debounceMs: 800,
  });

  // ── Derived state ──────────────────────────────────────────────────────────
  const taskStatus = taskData?.status;
  const readonly   = taskStatus === 'verified';
  const isRejected = taskStatus === 'rejected';
  const locked     = !readonly && checkInStatus === 'not_checked_in';
  const dis        = readonly || locked;

  const expectedNum = isFinite(Number(expectedAmount)) ? Number(expectedAmount) : 0;
  const amountNum   = isFinite(Number(amount))         ? Number(amount)         : 0;
  const carriedNum  = taskData?.carriedDeficit ? Number(taskData.carriedDeficit) : 0;
  const totalDueNum = expectedNum + carriedNum;

  // Cap preview for amount input
  const overCap   = amountNum > totalDueNum && totalDueNum > 0;
  const isShort   = totalDueNum > 0 && amountNum > 0 && amountNum < totalDueNum;
  const isExact   = totalDueNum > 0 && amountNum > 0 && amountNum === totalDueNum;
  const unpaidLive = Math.max(0, totalDueNum - amountNum);

  const expectedValid = expectedNum > 0;
  const amountValid   = amountNum > 0;
  const canSubmit =
    !locked &&
    expectedValid &&
    amountValid &&
    !overCap &&
    !!linkSetoran &&
    !!resiPhoto;

  const submitHint = (() => {
    if (locked)          return '';
    if (!expectedValid)  return 'Setoran Actual hari ini wajib diisi.';
    if (!amountValid)    return 'Nominal setoran aktual wajib diisi.';
    if (overCap)         return `Nominal disetor melebihi total wajib ${formatRupiah(String(totalDueNum))}. Setoran lebih tidak diperbolehkan.`;
    if (!linkSetoran)    return 'Link / nomor referensi wajib diisi.';
    if (!resiPhoto)      return 'Foto resi wajib diupload.';
    if (isShort)         return `Masih kurang ${formatRupiah(String(unpaidLive))} — akan tercatat sebagai kekurangan hari ini dan muncul di setoran besok.`;
    return '';
  })();

  // ── Photo handlers ─────────────────────────────────────────────────────────
  function confirmResiPhoto(photos: string[]) {
    const url = photos[0] ?? null;
    setResiPhoto(url);
    autoSave({ resiPhoto: url }, { immediate: true });
  }
  function clearResiPhoto() {
    setResiPhoto(null);
    autoSave({ resiPhoto: null }, { immediate: true });
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null);
    setSubmitMeta(null);
    if (!storeId || !scheduleId) {
      const msg = 'Data task tidak valid. Muat ulang halaman.';
      setSubmitError(msg); toast.error(msg); return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/setoran', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId,
          storeId,
          expectedAmount: String(expectedNum),
          amount:         String(amountNum),
          linkSetoran,
          resiPhoto,
          notes: notes || undefined,
        }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();

      if (!res.ok || json.success === false) {
        const serverMsg =
          (typeof json.error   === 'string' && json.error)   ||
          (typeof json.message === 'string' && json.message) || `HTTP ${res.status}`;
        setSubmitError(serverMsg);
        toast.error(serverMsg, { duration: 6000 });
        return;
      }

      const meta = json.meta as SubmitMeta | undefined;

      if (meta?.hasUnpaid) {
        setSubmitMeta(meta);
        toast.warning('Setoran tersimpan — masih ada kekurangan yang akan dibawa ke besok.', { duration: 6000 });
        await load();
      } else {
        toast.success('Setoran lunas & tersimpan ✓', { duration: 4000 });
        router.back();
      }
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg);
      toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <button onClick={() => router.back()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">Setoran</p>
          {taskData && (
            <p className="text-[10px] capitalize text-muted-foreground">
              {taskData.shift} shift · {taskData.status.replace('_', ' ')}
            </p>
          )}
        </div>

        {!readonly && !loading && taskData && <SaveIndicator status={saveStatus} lastSaved={lastSaved} />}

        {taskStatus === 'completed' && <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold text-green-700"><CheckCircle2 className="h-3 w-3" />Tersimpan</span>}
        {taskStatus === 'verified'  && <span className="flex items-center gap-1 rounded-full bg-green-200 px-2.5 py-1 text-[10px] font-bold text-green-800"><CheckCircle2 className="h-3 w-3" />Terverifikasi</span>}
        {taskStatus === 'rejected'  && <span className="flex items-center gap-1 rounded-full bg-red-100   px-2.5 py-1 text-[10px] font-bold text-red-700"><AlertCircle  className="h-3 w-3" />Ditolak</span>}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 p-4 pb-10">

        {!readonly && !loading && taskData && (
          <CheckInBanner status={checkInStatus} loading={checkInLoading} onRefresh={refreshCheckIn} />
        )}

        {!loading && taskData?.carriedDeficit && (
          <CarriedDeficitBanner carriedDeficit={taskData.carriedDeficit} />
        )}

        {submitMeta?.hasUnpaid && (
          <UnpaidResultBanner
            unpaid={submitMeta.unpaidAmount}
            nextDayCarried={submitMeta.nextDayCarriedDeficit}
          />
        )}

        {!loading && !submitMeta && taskData?.unpaidAmount && Number(taskData.unpaidAmount) > 0 && taskStatus === 'completed' && (
          <UnpaidResultBanner
            unpaid={taskData.unpaidAmount}
            nextDayCarried={taskData.unpaidAmount}
          />
        )}

        {submitError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-red-700">Submit gagal</p>
              <p className="mt-0.5 text-xs text-red-600 break-words">{submitError}</p>
            </div>
            <button onClick={() => setSubmitError(null)} className="flex-shrink-0 text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {saveError && !readonly && (
          <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5">
            <CloudOff className="h-4 w-4 flex-shrink-0 text-orange-600" />
            <p className="text-xs text-orange-700">Auto-save gagal: {saveError}</p>
          </div>
        )}

        {isRejected && taskData?.notes && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div>
              <p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p>
              <p className="mt-0.5 text-xs text-red-600">{taskData.notes}</p>
              <p className="mt-1.5 text-xs font-medium text-red-700">Silakan perbaiki dan submit ulang.</p>
            </div>
          </div>
        )}

        {taskStatus === 'verified' && taskData?.verifiedAt && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-xs font-semibold text-green-800">Task telah diverifikasi</p>
            <p className="mt-0.5 text-xs text-green-600">
              {new Date(taskData.verifiedAt).toLocaleString('id-ID',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}
            </p>
          </div>
        )}

        {!readonly && !locked && !loading && taskData && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
            <Save className="h-4 w-4 flex-shrink-0 text-blue-500" />
            <p className="text-xs text-blue-700">Perubahan otomatis tersimpan. Rekan shift lain dapat melanjutkan.</p>
          </div>
        )}

        {/* ── Form ────────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary" />)}</div>
        ) : !taskData ? (
          <div className="flex flex-col items-center py-20 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold">Task tidak ditemukan</p>
            <p className="mt-1 text-xs text-muted-foreground">Task mungkin sudah tidak tersedia.</p>
          </div>
        ) : (
          <div className="relative">
            <LockedOverlay show={locked} />
            <div className="space-y-6">

              {/* ── Carried deficit (read-only) ────────────────────────── */}
              {carriedNum > 0 && (
                <ReadOnlyAmount
                  label="Kekurangan Hari Sebelumnya"
                  value={taskData.carriedDeficit ?? '0'}
                />
              )}

              {/* ── Setoran Actual hari ini ─────────────────────────────── */}
              <Section title="Setoran Actual Hari Ini">
                <RupiahInput
                  value={expectedAmount}
                  onChange={v => { setExpectedAmount(v); autoSave({ expectedAmount: v }); }}
                  disabled={dis}
                  placeholder="Rp 0"
                />
                <p className="text-[10px] text-muted-foreground">
                  Isi nominal yang seharusnya disetor hari ini (di luar kekurangan sebelumnya).
                </p>
              </Section>

              {/* ── Total due (computed) ────────────────────────────────── */}
              {(expectedNum > 0 || carriedNum > 0) && (
                <div className="rounded-xl border-2 border-primary/20 bg-primary/5 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-primary/80">Total Wajib Disetor</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Target hari ini + kekurangan kemarin
                      </p>
                    </div>
                    <p className="text-base font-extrabold tabular-nums text-primary">
                      {formatRupiah(String(totalDueNum))}
                    </p>
                  </div>
                </div>
              )}

              {/* ── Nominal aktual ──────────────────────────────────────── */}
              <Section title="Nominal Disetorkan">
                <RupiahInput
                  value={amount}
                  onChange={v => { setAmount(v); autoSave({ amount: v }); }}
                  disabled={dis}
                  placeholder="Rp 0"
                  highlight={
                    !dis && amountNum > 0 && totalDueNum > 0
                      ? overCap ? 'error'
                        : isExact  ? 'success'
                        : isShort  ? 'warning'
                        : null
                      : null
                  }
                />

                {!dis && overCap && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>Melebihi total wajib {formatRupiah(String(totalDueNum))}. Nominal akan di-reject.</span>
                  </div>
                )}

                {!dis && !overCap && amountNum > 0 && totalDueNum > 0 && (
                  <div className={cn(
                    'flex items-center justify-between rounded-lg px-3 py-2 text-xs',
                    isShort ? 'bg-orange-50' : 'bg-green-50',
                  )}>
                    <span className={cn('flex items-center gap-1.5', isShort ? 'text-orange-700' : 'text-green-700')}>
                      {isShort
                        ? <TrendingDown className="h-3.5 w-3.5" />
                        : <CheckCircle2 className="h-3.5 w-3.5" />
                      }
                      {isShort ? 'Sisa kekurangan' : 'Lunas'}
                    </span>
                    <span className={cn('font-bold tabular-nums', isShort ? 'text-orange-700' : 'text-green-700')}>
                      {isShort ? formatRupiah(String(unpaidLive)) : '✓'}
                    </span>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground">
                  Nominal yang benar-benar sudah disetor hari ini. Tidak boleh melebihi total wajib.
                </p>
              </Section>

              {/* ── Link / referensi ───────────────────────────────────── */}
              <Section title="Link / No. Referensi Transfer">
                <input
                  type="text"
                  value={linkSetoran}
                  disabled={dis}
                  placeholder="Paste link atau nomor referensi"
                  onChange={e => { setLinkSetoran(e.target.value); autoSave({ linkSetoran: e.target.value }); }}
                  className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                />
              </Section>

              {/* ── Foto resi ──────────────────────────────────────────── */}
              <Section title="Foto Resi">
                <ResiPhotoTile
                  photo={resiPhoto}
                  onClick={() => setPhotoModalOpen(true)}
                  disabled={dis}
                  hasPhoto={!!resiPhoto}
                />
              </Section>

              {/* ── Catatan ────────────────────────────────────────────── */}
              <Section title="Catatan (opsional)">
                <textarea
                  value={notes}
                  onChange={e => { setNotes(e.target.value); autoSave({ notes: e.target.value }); }}
                  disabled={dis}
                  rows={3}
                  placeholder="Tambahkan catatan jika ada…"
                  className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                />
              </Section>

              {/* ── Submit button ───────────────────────────────────────── */}
              {!readonly && (
                <>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSubmit || submitting}
                    className={cn(
                      'flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40',
                      isShort && !overCap ? 'bg-orange-500 text-white' : 'bg-primary text-primary-foreground',
                    )}>
                    {submitting
                      ? <><Loader2 className="h-4 w-4 animate-spin" />Menyimpan…</>
                      : isShort && !overCap
                        ? <><AlertTriangle className="h-4 w-4" />Submit (masih kurang)</>
                        : <><Receipt       className="h-4 w-4" />Submit Setoran</>
                    }
                  </button>

                  {submitHint && (
                    <p className={cn('text-center text-[11px]',
                      overCap                ? 'text-red-600' :
                      isShort && !overCap    ? 'text-orange-600' :
                                               'text-muted-foreground',
                    )}>
                      {submitHint}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <ChecklistPhotoModal
        open={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
        title="Foto Resi"
        description="Upload 1 foto resi setoran sebagai bukti transfer."
        photoType="resi"
        min={1}
        max={1}
        initialPhotos={resiPhoto ? [resiPhoto] : []}
        onConfirm={confirmResiPhoto}
        onClear={clearResiPhoto}
        disabled={dis}
      />
    </div>
  );
}