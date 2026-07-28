'use client';
// app/employee/tasks/store-closing/[id]/page.tsx

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  X, Loader2, AlertCircle, Check, CloudOff, Save,
  Camera, Clock, CreditCard, BarChart3,
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { TaskHeader, TaskSubmitBar, SaveIndicator } from '@/components/employee/tasks';
import ChecklistPhotoModal from '@/components/tasks/ChecklistPhotoModal';
import AccessGuard from '@/components/employee/tasks/AccessGuard';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'verified' | 'rejected' | 'pending';
type OpenStatementDecision = 'post_statement' | 'on_hold';

interface StoreClosingData {
  id:               string;
  scheduleId:       string;
  userId:           string;
  storeId:          string;
  shiftId:          string;
  shift:            'morning' | 'evening' | 'full_day';
  date:             string;
  status:           TaskStatus;
  notes:            string | null;
  completedAt:      string | null;
  verifiedBy:       string | null;
  verifiedAt:       string | null;

  eodZReportDone:          boolean;
  eodEdcSettlementPhoto:   string | null;
  edcSettlementDone:       boolean;
  edcSettlementNotes:      string | null;
  edcSummaryDone:          boolean;
  edcSummaryNotes:         string | null;
  openStatementDecision:   OpenStatementDecision | null;
  openStatementHoldReason: string | null;
  isOnHold:                boolean;
  holdIssueId:             number | null;
  holdResolvedAt:          string | null;
  reopenedAt:              string | null;
}

// ─── Photo rules ──────────────────────────────────────────────────────────────

const PHOTO_RULES = {
  eodEdcSettlement: { min: 1, max: 1 },
} as const;

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

// ─── Photo checklist item ─────────────────────────────────────────────────────

function PhotoCheckItem({
  label, description, checked, photoCount, requiredCount, onClick, disabled,
}: {
  label:         string;
  description:   string;
  checked:       boolean;
  photoCount:    number;
  requiredCount: number;
  onClick:       () => void;
  disabled?:     boolean;
}) {
  const needsMore = photoCount < requiredCount;
  return (
    <button type="button" onClick={() => !disabled && onClick()}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all',
        checked && !needsMore && 'border-primary/30 bg-primary/5',
        !checked               && 'border-border bg-card hover:border-primary/20',
        photoCount > 0 && needsMore && 'border-amber-400 bg-amber-50',
        disabled && 'cursor-default opacity-60',
      )}>
      <div className={cn(
        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked && !needsMore ? 'border-primary bg-primary' : 'border-border',
      )}>
        {checked && !needsMore && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-sm font-medium', checked && !needsMore ? 'text-foreground' : 'text-muted-foreground')}>
            {label}
          </span>
          <span className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
            photoCount === 0
              ? 'bg-secondary text-muted-foreground'
              : !needsMore
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700',
          )}>
            <Camera className="h-2.5 w-2.5" />
            {photoCount}/{requiredCount}
          </span>
        </div>
        <p className={cn('mt-0.5 text-[10px]', photoCount > 0 && needsMore ? 'font-semibold text-amber-700' : 'text-muted-foreground')}>
          {description}
        </p>
      </div>
    </button>
  );
}

// ─── Simple checklist item ────────────────────────────────────────────────────

function SimpleCheckItem({
  label, description, checked, onChange, disabled, icon,
}: {
  label:        string;
  description?: string;
  checked:      boolean;
  onChange:     (v: boolean) => void;
  disabled?:    boolean;
  icon?:        React.ReactNode;
}) {
  return (
    <button type="button" onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all',
        checked ? 'border-primary/30 bg-primary/5' : 'border-border bg-card hover:border-primary/20',
        disabled && 'cursor-default opacity-60',
      )}>
      <div className={cn(
        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked ? 'border-primary bg-primary' : 'border-border',
      )}>
        {checked && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
      </div>
      <div className="min-w-0 flex-1">
        <span className={cn('text-sm font-medium', checked ? 'text-foreground' : 'text-muted-foreground')}>
          {label}
        </span>
        {description && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">{description}</p>
        )}
      </div>
      {icon && <div className="mt-0.5 flex-shrink-0 text-muted-foreground">{icon}</div>}
    </button>
  );
}

// ─── Collapsible notes input ──────────────────────────────────────────────────

function NotesInput({
  label, value, onChange, disabled, placeholder,
}: {
  label:        string;
  value:        string;
  onChange:     (v: string) => void;
  disabled?:    boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(!!value);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        disabled={disabled}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        }
      </button>
      {open && (
        <div className="px-4 pb-3 pt-0">
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            rows={2}
            placeholder={placeholder ?? 'Tambahkan catatan…'}
            className="w-full resize-none rounded-lg border border-border bg-secondary px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
          />
        </div>
      )}
    </div>
  );
}

// ─── Open Statement selector ──────────────────────────────────────────────────

function OpenStatementSelector({
  value, onChange, holdReason, onHoldReasonChange, disabled,
}: {
  value:              OpenStatementDecision | null;
  onChange:           (v: OpenStatementDecision) => void;
  holdReason:         string;
  onHoldReasonChange: (v: string) => void;
  disabled?:          boolean;
}) {
  const options: {
    value:       OpenStatementDecision;
    label:       string;
    description: string;
    icon:        React.ReactNode;
    color:       'green' | 'amber';
  }[] = [
    {
      value:       'post_statement',
      label:       'Post Statement',
      description: 'Saldo akhir sesuai, open statement bisa diposting.',
      icon:        <CheckCircle2 className="h-5 w-5" />,
      color:       'green',
    },
    {
      value:       'on_hold',
      label:       'On Hold',
      description: 'Ada selisih atau masalah, perlu dicek lebih lanjut.',
      icon:        <AlertTriangle className="h-5 w-5" />,
      color:       'amber',
    },
  ];

  return (
    <div className="space-y-2">
      {options.map(opt => {
        const isSelected = value === opt.value;
        const isGreen    = opt.color === 'green';
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !disabled && onChange(opt.value)}
            disabled={disabled}
            className={cn(
              'flex w-full items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all',
              isSelected && isGreen  && 'border-green-400 bg-green-50',
              isSelected && !isGreen && 'border-amber-400 bg-amber-50',
              !isSelected            && 'border-border bg-card hover:border-primary/20',
              disabled               && 'cursor-default opacity-60',
            )}
          >
            <div className={cn(
              'mt-0.5 flex-shrink-0 transition-colors',
              isSelected && isGreen  && 'text-green-600',
              isSelected && !isGreen && 'text-amber-600',
              !isSelected            && 'text-muted-foreground',
            )}>
              {opt.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className={cn(
                'text-sm font-semibold',
                isSelected && isGreen  && 'text-green-800',
                isSelected && !isGreen && 'text-amber-800',
                !isSelected            && 'text-foreground',
              )}>
                {opt.label}
              </p>
              <p className={cn(
                'mt-0.5 text-[10px]',
                isSelected && isGreen  && 'text-green-700',
                isSelected && !isGreen && 'text-amber-700',
                !isSelected            && 'text-muted-foreground',
              )}>
                {opt.description}
              </p>
            </div>
            <div className={cn(
              'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
              isSelected && isGreen  && 'border-green-500 bg-green-500',
              isSelected && !isGreen && 'border-amber-500 bg-amber-500',
              !isSelected            && 'border-border',
            )}>
              {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
            </div>
          </button>
        );
      })}

      {value === 'on_hold' && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-amber-800">
            Alasan On Hold <span className="text-amber-600">*</span>
          </p>
          <textarea
            value={holdReason}
            onChange={e => onHoldReasonChange(e.target.value)}
            disabled={disabled}
            rows={3}
            placeholder="Jelaskan alasan mengapa open statement tidak bisa diposting sekarang…"
            className="w-full resize-none rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm placeholder:text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:opacity-60"
          />
          <p className="text-[10px] text-amber-700">
            Issue akan dibuat secara otomatis dan dikirim ke tim terkait untuk ditindaklanjuti.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── On Hold banner ───────────────────────────────────────────────────────────

function OnHoldBanner({ holdReason }: { holdReason: string | null }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
      <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-amber-800">Task sedang On Hold</p>
        <p className="mt-0.5 text-xs text-amber-700">
          Issue terkait sedang ditangani tim. Task akan dibuka kembali setelah issue diselesaikan.
        </p>
        {holdReason && (
          <p className="mt-2 text-[11px] text-amber-600 italic">"{holdReason}"</p>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StoreClosingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [taskData,    setTaskData]    = useState<StoreClosingData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [eodEdcSettlementModalOpen, setEodEdcSettlementModalOpen] = useState(false);

  // Form state
  const [eodZReportDone,        setEodZReportDone]        = useState(false);
  const [eodEdcSettlementPhoto, setEodEdcSettlementPhoto] = useState<string | null>(null);
  const [edcSettlementDone,     setEdcSettlementDone]     = useState(false);
  const [edcSettlementNotes,    setEdcSettlementNotes]    = useState('');
  const [edcSummaryDone,        setEdcSummaryDone]        = useState(false);
  const [edcSummaryNotes,       setEdcSummaryNotes]       = useState('');
  const [openStatementDecision, setOpenStatementDecision] = useState<OpenStatementDecision | null>(null);
  const [holdReason,            setHoldReason]            = useState('');
  const [notes,                 setNotes]                 = useState('');

  // ─── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: { type: string; data: StoreClosingData }[] };
      const found = data.tasks?.find(t => t.type === 'store_closing' && t.data.id === taskId);
      if (found) {
        const d = found.data;
        setTaskData(d);
        setEodZReportDone(!!d.eodZReportDone);
        setEodEdcSettlementPhoto(d.eodEdcSettlementPhoto ?? null);
        setEdcSettlementDone(d.edcSettlementDone);
        setEdcSettlementNotes(d.edcSettlementNotes ?? '');
        setEdcSummaryDone(d.edcSummaryDone);
        setEdcSummaryNotes(d.edcSummaryNotes ?? '');
        setOpenStatementDecision(d.openStatementDecision ?? null);
        setHoldReason(d.openStatementHoldReason ?? '');
        setNotes(d.notes ?? '');
      } else {
        setTaskData(null);
      }
    } catch (e) {
      console.error('[StoreClosingDetailPage] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const scheduleId = taskData ? parseInt(taskData.scheduleId, 10) : 0;
  const storeId    = taskData ? parseInt(taskData.storeId,    10) : 0;

  // ─── Auto-save ───────────────────────────────────────────────────────────────
  const { status: saveStatus, lastSaved, error: saveError, save: rawAutoSave } = useAutoSave({
    url:        '/api/employee/tasks/store-closing',
    baseBody:   { taskId: taskData ? Number(taskData.id) : 0 },
    debounceMs: 800,
  });

  const autoSave = useCallback((patch: Record<string, unknown>, options?: { immediate?: boolean }) => {
    if (!taskData) { toast.error('Data task belum siap.'); return; }
    rawAutoSave({ taskId: Number(taskData.id), patch }, options);
  }, [rawAutoSave, taskData]);

  // ─── Handlers ────────────────────────────────────────────────────────────────
  function syncEodEdcSettlementPhoto(photos: string[]) {
    const next = Array.isArray(photos) && photos.length > 0 ? photos[0] : null;
    setEodEdcSettlementPhoto(next);
    autoSave({ eodEdcSettlementPhoto: next }, { immediate: true });
  }

  function handleEdcSettlementNotes(v: string) {
    setEdcSettlementNotes(v);
    autoSave({ edcSettlementNotes: v || null });
  }

  function handleEdcSummaryNotes(v: string) {
    setEdcSummaryNotes(v);
    autoSave({ edcSummaryNotes: v || null });
  }

  function handleOpenStatementDecision(v: OpenStatementDecision) {
    setOpenStatementDecision(v);
    if (v !== 'on_hold') setHoldReason('');
    autoSave({
      openStatementDecision:   v,
      openStatementHoldReason: v === 'on_hold' ? holdReason || null : null,
    }, { immediate: true });
  }

  function handleHoldReason(v: string) {
    setHoldReason(v);
    autoSave({ openStatementHoldReason: v || null });
  }

  // ─── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(geo: { lat: number; lng: number } | null) {
    if (!taskData) return;
    setSubmitError(null);

    if (!geo) {
      const msg = 'Lokasi wajib aktif untuk submit Store Closing.';
      setSubmitError(msg); toast.error(msg); return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/store-closing', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: Number(taskData.id),
          scheduleId, storeId,
          geo, skipGeo: false,
          eodZReportDone,
          eodEdcSettlementPhoto,
          edcSettlementDone,
          edcSettlementNotes: edcSettlementNotes || undefined,
          edcSummaryDone,
          edcSummaryNotes: edcSummaryNotes || undefined,
          openStatementDecision,
          openStatementHoldReason: holdReason || undefined,
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

      toast.success(
        openStatementDecision === 'on_hold'
          ? 'Open Statement ditandai On Hold. Issue telah dibuat. ✓'
          : 'Store Closing berhasil disubmit! ✓',
        { duration: 4000 },
      );
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg);
      toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  const isOnHold = taskData?.isOnHold ?? false;

  return (
    <AccessGuard
      scheduleId={taskData?.scheduleId ?? ''}
      storeId={taskData?.storeId ?? ''}
      taskStatus={taskData?.status}
      taskType="store_closing"
    >
      {({ geo, banner, lockedOverlay, dis: guardDis, readonly, locked }) => {
        // On-hold tasks are readable but fully non-interactive.
        const dis = guardDis || isOnHold;

        const zReportSatisfied = eodZReportDone;
        const evidencePhotoSatisfied = !!eodEdcSettlementPhoto;
        const openStmtSatisfied =
          openStatementDecision === 'post_statement' ||
          openStatementDecision === 'on_hold';

        const canSubmit =
          !locked &&
          !isOnHold &&
          !!geo &&
          zReportSatisfied &&
          edcSettlementDone &&
          evidencePhotoSatisfied &&
          edcSummaryDone &&
          !!openStatementDecision &&
          openStmtSatisfied;

        const submitHint = (() => {
          if (locked || isOnHold) return '';
          if (!zReportSatisfied) return 'Centang checklist EOD Z-Report.';
          if (!edcSettlementDone) return 'Centang checklist EDC Settlement.';
          if (!evidencePhotoSatisfied) return 'Upload foto EOD dan EDC Settlement berdampingan.';
          if (!edcSummaryDone)       return 'Centang checklist EDC Summary.';
          if (!openStatementDecision) return 'Pilih status Open Statement.';
          return '';
        })();

        return (
          <div className="flex min-h-screen flex-col bg-background">
            <TaskHeader
              title="Store Closing"
              subtitle={
                taskData
                  ? `${String(taskData.shift).replace('_', ' ')} shift · ${String(taskData.status).replace('_', ' ')}`
                  : undefined
              }
              status={taskData?.status}
              saveIndicator={
                !readonly && !loading && taskData ? (
                  <SaveIndicator status={saveStatus} lastSaved={lastSaved ?? null} />
                ) : null
              }
            />

            <div className="flex-1 space-y-4 p-4 pb-10">

              {/* Access banner — hidden while loading or on-hold */}
              {!readonly && !isOnHold && !loading && taskData && banner}

              {/* On Hold banner */}
              {isOnHold && (
                <OnHoldBanner holdReason={taskData?.openStatementHoldReason ?? null} />
              )}

              {/* Submit error */}
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

              {/* Auto-save error */}
              {saveError && !readonly && (
                <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5">
                  <CloudOff className="h-4 w-4 flex-shrink-0 text-orange-600" />
                  <p className="text-xs text-orange-700">Auto-save gagal: {saveError}</p>
                </div>
              )}

              {/* Rejected note */}
              {taskData?.status === 'rejected' && taskData.notes && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                  <div>
                    <p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p>
                    <p className="mt-0.5 text-xs text-red-600">{taskData.notes}</p>
                    <p className="mt-1.5 text-xs font-medium text-red-700">Silakan perbaiki dan submit ulang.</p>
                  </div>
                </div>
              )}

              {/* Verified */}
              {taskData?.status === 'verified' && taskData.verifiedAt && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                  <p className="text-xs font-semibold text-green-800">Task telah diverifikasi</p>
                  <p className="mt-0.5 text-xs text-green-600">
                    {new Date(taskData.verifiedAt).toLocaleString('id-ID', {
                      day: 'numeric', month: 'long', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
              )}

              {/* Auto-save hint */}
              {!readonly && !isOnHold && !locked && !loading && taskData && (
                <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
                  <Save className="h-4 w-4 flex-shrink-0 text-blue-500" />
                  <p className="text-xs text-blue-700">Perubahan otomatis tersimpan.</p>
                </div>
              )}

              {/* Content */}
              {loading ? (
                <div className="space-y-3">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary" />
                  ))}
                </div>
              ) : !taskData ? (
                <div className="flex flex-col items-center py-20 text-center">
                  <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm font-semibold">Task tidak ditemukan</p>
                </div>
              ) : (
                <div className="relative">
                  {/* AccessGuard's lockedOverlay handles the blur/lock UI */}
                  {!isOnHold && lockedOverlay}

                  <div className="space-y-6">

                    {/* ── 1. EOD Z-Report ─────────────────────────────────── */}
                    <Section title="1 · EOD Z-Report">
                      <SimpleCheckItem
                        label="EOD Z-Report selesai"
                        description="Konfirmasi Z-Report EOD sudah dicetak/diperiksa."
                        checked={eodZReportDone}
                        onChange={v => { setEodZReportDone(v); autoSave({ eodZReportDone: v }); }}
                        disabled={dis}
                        icon={<Clock className="h-4 w-4" />}
                      />
                    </Section>

                    {/* ── 2. EDC Summary ──────────────────────────────────── */}
                    <Section title="2 · EDC Summary">
                      <SimpleCheckItem
                        label="EDC Summary selesai"
                        description="Konfirmasi laporan summary EDC sudah dicetak/dicatat."
                        checked={edcSummaryDone}
                        onChange={v => { setEdcSummaryDone(v); autoSave({ edcSummaryDone: v }); }}
                        disabled={dis}
                        icon={<BarChart3 className="h-4 w-4" />}
                      />
                      <NotesInput
                        label="Catatan EDC Summary (opsional)"
                        value={edcSummaryNotes}
                        onChange={handleEdcSummaryNotes}
                        disabled={dis}
                        placeholder="Tambahkan catatan summary jika ada…"
                      />
                    </Section>

                    {/* ── 3. EDC Settlement ───────────────────────────────── */}
                    <Section title="3 · EDC Settlement">
                      <SimpleCheckItem
                        label="EDC Settlement selesai"
                        description="Konfirmasi proses settlement EDC sudah dilakukan."
                        checked={edcSettlementDone}
                        onChange={v => { setEdcSettlementDone(v); autoSave({ edcSettlementDone: v }); }}
                        disabled={dis}
                        icon={<CreditCard className="h-4 w-4" />}
                      />
                      <NotesInput
                        label="Catatan EDC Settlement (opsional)"
                        value={edcSettlementNotes}
                        onChange={handleEdcSettlementNotes}
                        disabled={dis}
                        placeholder="Tambahkan catatan settlement jika ada…"
                      />
                    </Section>

                    

                    {/* ── 4. Foto Bukti EOD + EDC Settlement ─────────────── */}
                    <Section title="4 · Foto Bukti EOD + EDC Settlement">
                      <PhotoCheckItem
                        label="Upload Foto EOD dan EDC Settlement"
                        description="Satu foto wajib yang menampilkan EOD dan EDC Settlement berdampingan."
                        checked={evidencePhotoSatisfied}
                        photoCount={eodEdcSettlementPhoto ? 1 : 0}
                        requiredCount={PHOTO_RULES.eodEdcSettlement.min}
                        onClick={() => setEodEdcSettlementModalOpen(true)}
                        disabled={dis}
                      />
                    </Section>

                    {/* ── 5. Open Statement ───────────────────────────────── */}
                    <Section title="5 · Open Statement">
                      <OpenStatementSelector
                        value={openStatementDecision}
                        onChange={handleOpenStatementDecision}
                        holdReason={holdReason}
                        onHoldReasonChange={handleHoldReason}
                        disabled={dis}
                      />
                    </Section>

                    {/* ── Notes ───────────────────────────────────────────── */}
                    <Section title="Catatan Umum (opsional)">
                      <textarea
                        value={notes}
                        onChange={e => { setNotes(e.target.value); autoSave({ notes: e.target.value }); }}
                        disabled={dis}
                        rows={3}
                        placeholder="Tambahkan catatan penutupan toko jika ada…"
                        className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                      />
                    </Section>

                    <TaskSubmitBar
                      label={openStatementDecision === 'on_hold' ? 'Submit — On Hold' : 'Submit Store Closing'}
                      onSubmit={() => handleSubmit(geo)}
                      submitting={submitting}
                      disabled={!canSubmit}
                      hidden={readonly || isOnHold}
                      hint={!canSubmit ? submitHint : undefined}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* EOD + EDC Settlement side-by-side photo modal */}
            <ChecklistPhotoModal
              open={eodEdcSettlementModalOpen}
              onClose={() => setEodEdcSettlementModalOpen(false)}
              title="Foto EOD + EDC Settlement"
              description={`Upload 1 foto yang menampilkan EOD dan EDC Settlement berdampingan.`}
              photoType="eod_edc_settlement"
              min={PHOTO_RULES.eodEdcSettlement.min}
              max={PHOTO_RULES.eodEdcSettlement.max}
              initialPhotos={eodEdcSettlementPhoto ? [eodEdcSettlementPhoto] : []}
              onConfirm={syncEodEdcSettlementPhoto}
              onChange={syncEodEdcSettlementPhoto}
              onClear={() => syncEodEdcSettlementPhoto([])}
              disabled={dis}
            />
          </div>
        );
      }}
    </AccessGuard>
  );
}