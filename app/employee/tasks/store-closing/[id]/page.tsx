'use client';
// app/employee/tasks/store-closing/[id]/page.tsx

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Check, CloudOff, Save, Clock, Lock, Receipt,
  AlertTriangle, CheckCircle2, ChevronDown, StickyNote,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { TaskHeader, TaskSubmitBar, SaveIndicator, shiftLabel } from '@/components/employee/tasks';
import {
  CheckRow, EmptyState, ListGroup, Notice, NotesField, PageBody, PhotoRow, Section,
  SkeletonBlocks, TaskReviewNotices,
} from '@/components/employee/ui';
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
  storefrontLockedPhoto:   string | null;
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
  storefrontLocked: { min: 1, max: 1 },
} as const;

// ─── Collapsible notes row (sits inside a ListGroup under its checklist row) ─

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
    <div className="bg-card">
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        disabled={disabled && !value}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition active:bg-secondary disabled:opacity-60"
      >
        <StickyNote className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {value && !open ? value : label}
        </span>
        <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-3.5 pb-3">
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            rows={2}
            placeholder={placeholder ?? 'Tambahkan catatan…'}
            className="w-full resize-none rounded-xl border border-border bg-secondary px-3.5 py-2.5 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
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
  const options = [
    {
      value:       'post_statement' as const,
      label:       'Post Statement',
      description: 'Saldo akhir sesuai, open statement bisa diposting.',
      Icon:        CheckCircle2,
      selected:    'bg-green-50',
      tint:        'text-green-600',
      dot:         'border-green-500 bg-green-500',
    },
    {
      value:       'on_hold' as const,
      label:       'On Hold',
      description: 'Ada selisih atau masalah, perlu dicek lebih lanjut.',
      Icon:        AlertTriangle,
      selected:    'bg-amber-50',
      tint:        'text-amber-600',
      dot:         'border-amber-500 bg-amber-500',
    },
  ];

  return (
    <div className="space-y-3">
      <ListGroup>
        {options.map(opt => {
          const isSelected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => !disabled && onChange(opt.value)}
              disabled={disabled}
              className={cn(
                'flex w-full items-center gap-3 px-3.5 py-3.5 text-left transition active:bg-secondary disabled:opacity-60',
                isSelected ? opt.selected : 'bg-card',
              )}
            >
              <opt.Icon className={cn('h-5 w-5 flex-shrink-0', isSelected ? opt.tint : 'text-muted-foreground')} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{opt.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{opt.description}</span>
              </span>
              <span className={cn(
                'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                isSelected ? opt.dot : 'border-border bg-background',
              )}>
                {isSelected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </ListGroup>

      {value === 'on_hold' && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
          <p className="text-xs font-bold text-amber-800">
            Alasan On Hold <span className="text-amber-600">*</span>
          </p>
          <textarea
            value={holdReason}
            onChange={e => onHoldReasonChange(e.target.value)}
            disabled={disabled}
            rows={3}
            placeholder="Jelaskan alasan mengapa open statement tidak bisa diposting sekarang…"
            className="w-full resize-none rounded-xl border border-amber-200 bg-white px-3.5 py-2.5 text-base placeholder:text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:opacity-60"
          />
          <p className="text-[11px] text-amber-700">
            Issue akan dibuat secara otomatis dan dikirim ke tim terkait untuk ditindaklanjuti.
          </p>
        </div>
      )}
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
  const [storefrontLockedModalOpen, setStorefrontLockedModalOpen] = useState(false);

  // Form state
  const [eodZReportDone,        setEodZReportDone]        = useState(false);
  const [eodEdcSettlementPhoto, setEodEdcSettlementPhoto] = useState<string | null>(null);
  const [storefrontLockedPhoto, setStorefrontLockedPhoto] = useState<string | null>(null);
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
        setStorefrontLockedPhoto(d.storefrontLockedPhoto ?? null);
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

  function syncStorefrontLockedPhoto(photos: string[]) {
    const next = Array.isArray(photos) && photos.length > 0 ? photos[0] : null;
    setStorefrontLockedPhoto(next);
    autoSave({ storefrontLockedPhoto: next }, { immediate: true });
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
          storefrontLockedPhoto,
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
        const storefrontLockedSatisfied = !!storefrontLockedPhoto;
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
          storefrontLockedSatisfied &&
          edcSummaryDone &&
          !!openStatementDecision &&
          openStmtSatisfied;

        const submitHint = (() => {
          if (locked || isOnHold) return '';
          if (!zReportSatisfied) return 'Centang checklist EOD Z-Report.';
          if (!edcSettlementDone) return 'Centang checklist EDC Settlement.';
          if (!evidencePhotoSatisfied) return 'Upload foto Z-Report & EDC Settlement.';
          if (!storefrontLockedSatisfied) return 'Upload foto storefront terkunci.';
          if (!edcSummaryDone)       return 'Centang checklist EDC Summary.';
          if (!openStatementDecision) return 'Pilih status Open Statement.';
          return '';
        })();

        return (
          <>
            <TaskHeader
              title="Store Closing"
              subtitle={shiftLabel(taskData?.shift)}
              status={taskData?.status}
              saveIndicator={
                !readonly && !loading && taskData ? (
                  <SaveIndicator status={saveStatus} lastSaved={lastSaved ?? null} />
                ) : null
              }
            />

            <PageBody bottomBar={!readonly && !isOnHold && !!taskData}>
              {/* Access banner — hidden while loading or on-hold */}
              {!readonly && !isOnHold && !loading && taskData && banner}

              {isOnHold && (
                <Notice tone="warning" icon={Clock} title="Task sedang On Hold">
                  Issue terkait sedang ditangani tim. Task akan dibuka kembali setelah issue diselesaikan.
                  {taskData?.openStatementHoldReason && (
                    <p className="mt-1.5 italic">&ldquo;{taskData.openStatementHoldReason}&rdquo;</p>
                  )}
                </Notice>
              )}

              {submitError && (
                <Notice tone="error" title="Submit gagal" onDismiss={() => setSubmitError(null)}>
                  {submitError}
                </Notice>
              )}

              {saveError && !readonly && (
                <Notice tone="warning" icon={CloudOff}>Auto-save gagal: {saveError}</Notice>
              )}

              <TaskReviewNotices status={taskData?.status} notes={taskData?.notes} verifiedAt={taskData?.verifiedAt} />

              {!readonly && !isOnHold && !locked && !loading && taskData && (
                <Notice tone="info" icon={Save}>Perubahan otomatis tersimpan.</Notice>
              )}

              {loading ? (
                <SkeletonBlocks count={4} className="h-14" />
              ) : !taskData ? (
                <EmptyState title="Task tidak ditemukan" description="Task ini mungkin sudah tidak tersedia untuk jadwalmu hari ini." />
              ) : (
                <div className="relative">
                  {/* AccessGuard's lockedOverlay handles the blur/lock UI */}
                  {!isOnHold && lockedOverlay}

                  <div className="space-y-5">
                    <Section title="1 · EOD Z-Report">
                      <ListGroup>
                        <CheckRow
                          label="EOD Z-Report selesai"
                          hint="Z-Report EOD sudah dicetak/diperiksa."
                          checked={eodZReportDone}
                          onToggle={() => { const v = !eodZReportDone; setEodZReportDone(v); autoSave({ eodZReportDone: v }); }}
                          disabled={dis}
                        />
                      </ListGroup>
                    </Section>

                    <Section title="2 · EDC Summary">
                      <ListGroup>
                        <CheckRow
                          label="EDC Summary selesai"
                          hint="Laporan summary EDC sudah dicetak/dicatat."
                          checked={edcSummaryDone}
                          onToggle={() => { const v = !edcSummaryDone; setEdcSummaryDone(v); autoSave({ edcSummaryDone: v }); }}
                          disabled={dis}
                        />
                        <NotesInput
                          label="Catatan EDC Summary (opsional)"
                          value={edcSummaryNotes}
                          onChange={handleEdcSummaryNotes}
                          disabled={dis}
                          placeholder="Tambahkan catatan summary jika ada…"
                        />
                      </ListGroup>
                    </Section>

                    <Section title="3 · EDC Settlement">
                      <ListGroup>
                        <CheckRow
                          label="EDC Settlement selesai"
                          hint="Proses settlement EDC sudah dilakukan."
                          checked={edcSettlementDone}
                          onToggle={() => { const v = !edcSettlementDone; setEdcSettlementDone(v); autoSave({ edcSettlementDone: v }); }}
                          disabled={dis}
                        />
                        <NotesInput
                          label="Catatan EDC Settlement (opsional)"
                          value={edcSettlementNotes}
                          onChange={handleEdcSettlementNotes}
                          disabled={dis}
                          placeholder="Tambahkan catatan settlement jika ada…"
                        />
                      </ListGroup>
                    </Section>

                    <Section title="4 · Foto bukti" meta={`${(evidencePhotoSatisfied ? 1 : 0) + (storefrontLockedSatisfied ? 1 : 0)}/2`}>
                      <ListGroup>
                        <PhotoRow
                          title="Z-Report & EDC Settlement"
                          hint="Satu foto yang menampilkan keduanya"
                          photo={eodEdcSettlementPhoto}
                          onClick={() => setEodEdcSettlementModalOpen(true)}
                          disabled={dis}
                          icon={<Receipt className="h-4 w-4" />}
                        />
                        <PhotoRow
                          title="Storefront Dikunci"
                          hint="Pintu / rolling door terkunci"
                          photo={storefrontLockedPhoto}
                          onClick={() => setStorefrontLockedModalOpen(true)}
                          disabled={dis}
                          icon={<Lock className="h-4 w-4" />}
                        />
                      </ListGroup>
                    </Section>

                    <Section title="5 · Open Statement">
                      <OpenStatementSelector
                        value={openStatementDecision}
                        onChange={handleOpenStatementDecision}
                        holdReason={holdReason}
                        onHoldReasonChange={handleHoldReason}
                        disabled={dis}
                      />
                    </Section>

                    <NotesField
                      label="Catatan umum"
                      value={notes}
                      onChange={(v) => { setNotes(v); autoSave({ notes: v }); }}
                      disabled={dis}
                      rows={3}
                      placeholder="Tambahkan catatan penutupan toko jika ada…"
                    />
                  </div>
                </div>
              )}
            </PageBody>

            {taskData && (
              <TaskSubmitBar
                label={openStatementDecision === 'on_hold' ? 'Submit — On Hold' : 'Submit Store Closing'}
                onSubmit={() => handleSubmit(geo)}
                submitting={submitting}
                disabled={!canSubmit}
                hidden={readonly || isOnHold}
                hint={!canSubmit ? submitHint : undefined}
              />
            )}

            {/* Z-Report + EDC Settlement photo modal */}
            <ChecklistPhotoModal
              open={eodEdcSettlementModalOpen}
              onClose={() => setEodEdcSettlementModalOpen(false)}
              title="Foto Z-Report & EDC Settlement"
              description={`Upload 1 foto yang menampilkan Z-Report dan EDC Settlement.`}
              photoType="eod_edc_settlement"
              min={PHOTO_RULES.eodEdcSettlement.min}
              max={PHOTO_RULES.eodEdcSettlement.max}
              initialPhotos={eodEdcSettlementPhoto ? [eodEdcSettlementPhoto] : []}
              onConfirm={syncEodEdcSettlementPhoto}
              onChange={syncEodEdcSettlementPhoto}
              onClear={() => syncEodEdcSettlementPhoto([])}
              disabled={dis}
            />

            {/* Storefront locked photo modal */}
            <ChecklistPhotoModal
              open={storefrontLockedModalOpen}
              onClose={() => setStorefrontLockedModalOpen(false)}
              title="Foto Storefront Dikunci"
              description={`Upload 1 foto pintu / rolling door toko dalam keadaan terkunci.`}
              photoType="storefront_locked"
              min={PHOTO_RULES.storefrontLocked.min}
              max={PHOTO_RULES.storefrontLocked.max}
              initialPhotos={storefrontLockedPhoto ? [storefrontLockedPhoto] : []}
              onConfirm={syncStorefrontLockedPhoto}
              onChange={syncStorefrontLockedPhoto}
              onClear={() => syncStorefrontLockedPhoto([])}
              disabled={dis}
            />
          </>
        );
      }}
    </AccessGuard>
  );
}