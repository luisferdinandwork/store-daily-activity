'use client';
// app/employee/tasks/open-statement/[id]/page.tsx
// Updated flow:
// - No expected/actual amount comparison.
// - Employee chooses Done or On Hold.
// - Done completes the task.
// - On Hold completes today's task as held and lets backend generate the next morning carry-over task.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CloudOff,
  FileText,
  History,
  PauseCircle,
  Save,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { AccessGuard, SaveIndicator, TaskHeader, TaskSubmitBar } from '@/components/employee/tasks';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected' | 'discrepancy';
type Decision = 'done' | 'hold';

type GeoPoint = {
  lat: number;
  lng: number;
};

interface OpenStatementData {
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
  parentTaskId: number | null;
  isDone: boolean | null;
  isOnHold: boolean | null;
  holdReason: string | null;
  heldBy: string | null;
  heldAt: string | null;
}

interface ParentStatement {
  id: number;
  shiftId: number | null;
  date: string;
  holdReason: string | null;
  heldAt: string | null;
  notes: string | null;
  completedAt: string | null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';

  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DecisionCard({
  value,
  selected,
  disabled,
  icon: Icon,
  title,
  description,
  variant,
  onClick,
}: {
  value: Decision;
  selected: boolean;
  disabled: boolean;
  icon: React.ElementType;
  title: string;
  description: string;
  variant: 'done' | 'hold';
  onClick: (value: Decision) => void;
}) {
  const selectedClass =
    variant === 'done'
      ? 'border-green-300 bg-green-50 ring-green-100'
      : 'border-amber-300 bg-amber-50 ring-amber-100';

  const iconClass = variant === 'done' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700';
  const titleClass = variant === 'done' ? 'text-green-800' : 'text-amber-800';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(value)}
      className={cn(
        'flex w-full items-start gap-3 rounded-2xl border-2 bg-card px-4 py-4 text-left shadow-sm transition-all',
        selected ? `${selectedClass} ring-4` : 'border-border hover:border-primary/30',
        disabled && 'cursor-default opacity-60',
      )}
    >
      <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl', selected ? iconClass : 'bg-muted text-muted-foreground')}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('text-sm font-bold', selected ? titleClass : 'text-foreground')}>{title}</p>
          {selected && (
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', variant === 'done' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
              Dipilih
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

export default function OpenStatementDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = String(params.id);

  const [taskData, setTaskData] = useState<OpenStatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [decision, setDecision] = useState<Decision | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [notes, setNotes] = useState('');

  const [parent, setParent] = useState<ParentStatement | null>(null);

  const {
    status: saveStatus,
    lastSaved,
    error: saveError,
    save: autoSave,
  } = useAutoSave({
    url: '/api/employee/tasks/open-statement',
    baseBody: {},
    debounceMs: 800,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/employee/tasks', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as { tasks?: Array<{ type: string; data: OpenStatementData }> };
      const found = data.tasks?.find((task) => task.type === 'open_statement' && String(task.data.id) === taskId);

      if (!found) {
        setTaskData(null);
        return;
      }

      const task = found.data;
      setTaskData(task);
      setDecision(task.isDone ? 'done' : task.isOnHold ? 'hold' : null);
      setHoldReason(task.holdReason ?? '');
      setNotes(task.notes ?? '');

      if (task.parentTaskId != null) {
        try {
          const pres = await fetch(`/api/employee/tasks/open-statement?taskId=${task.id}`, { cache: 'no-store' });
          const pjson = await pres.json();
          if (pres.ok && pjson.success) setParent(pjson.parent ?? null);
        } catch {
          /* non-fatal: panel just won't show */
        }
      } else {
        setParent(null);
      }
    } catch (error) {
      console.error('[OpenStatement] load error:', error);
      toast.error('Gagal memuat data Open Statement.');
      setTaskData(null);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  const taskStatus = taskData?.status;
  const isCarryOver = taskData?.parentTaskId != null;
  const readonlyHeader = taskStatus === 'completed' || taskStatus === 'verified';

  const scheduleId = taskData ? Number(taskData.scheduleId) : 0;
  const storeId = taskData ? Number(taskData.storeId) : 0;

  const makeAutoSaveBody = useCallback(
    (geo: GeoPoint | null, patch: Record<string, unknown>) => ({
      taskId: taskData ? Number(taskData.id) : undefined,
      scheduleId: taskData ? Number(taskData.scheduleId) : undefined,
      storeId: taskData ? Number(taskData.storeId) : undefined,
      geo: geo ?? null,
      skipGeo: geo === null,
      ...patch,
    }),
    [taskData],
  );

  const submitHint = useMemo(() => {
    if (!decision) return 'Pilih Done atau On Hold terlebih dahulu.';
    if (decision === 'hold' && holdReason.trim().length < 3) return 'Isi alasan hold minimal 3 karakter.';
    return undefined;
  }, [decision, holdReason]);

  function chooseDecision(nextDecision: Decision, geo: GeoPoint | null) {
    setDecision(nextDecision);

    const patch: Record<string, unknown> = { decision: nextDecision };
    if (nextDecision === 'done') patch.holdReason = null;
    if (nextDecision === 'hold') patch.holdReason = holdReason;

    autoSave(makeAutoSaveBody(geo, patch), { immediate: true });
  }

  async function handleSubmit(geo: GeoPoint | null) {
    if (!taskData) return;

    setSubmitError(null);

    if (!scheduleId || !storeId) {
      const message = 'Data task tidak valid. Muat ulang halaman.';
      setSubmitError(message);
      toast.error(message);
      return;
    }

    if (!decision) {
      const message = 'Pilih Done atau On Hold terlebih dahulu.';
      setSubmitError(message);
      toast.error(message);
      return;
    }

    if (decision === 'hold' && holdReason.trim().length < 3) {
      const message = 'Isi alasan hold minimal 3 karakter.';
      setSubmitError(message);
      toast.error(message);
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/employee/tasks/open-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: Number(taskData.id),
          scheduleId,
          storeId,
          geo: geo ?? null,
          skipGeo: geo === null,
          decision,
          holdReason: decision === 'hold' ? holdReason.trim() : undefined,
          notes: notes || undefined,
        }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        json = await res.json();
      }

      if (!res.ok || json.success === false) {
        const message =
          (typeof json.error === 'string' && json.error) ||
          (typeof json.message === 'string' && json.message) ||
          `HTTP ${res.status}`;

        setSubmitError(message);
        toast.error(message, { duration: 6000 });
        return;
      }

      if (decision === 'done') {
        toast.success('Open Statement selesai! ✓', { duration: 4000 });
      } else {
        const nextShiftLabel = taskData.shift === 'morning' ? 'shift sore hari ini' : 'shift pagi berikutnya';
        toast.success(`Open Statement ditandai On Hold. Task lanjutan akan muncul untuk ${nextShiftLabel}.`, { duration: 5000 });
      }

      router.back();
    } catch (error) {
      const message = error instanceof Error ? `Koneksi gagal: ${error.message}` : 'Gagal terhubung ke server.';
      setSubmitError(message);
      toast.error(message, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TaskHeader
        title="Open Statement"
        subtitle={
          taskData
            ? `${isCarryOver ? 'Lanjutan · ' : ''}${taskData.shift.replace('_', ' ')} shift · ${taskData.status.replace('_', ' ')}`
            : undefined
        }
        status={taskStatus}
        saveIndicator={!readonlyHeader && !loading && taskData ? <SaveIndicator status={saveStatus} lastSaved={lastSaved} /> : null}
      />

      {loading ? (
        <div className="flex-1 space-y-3 p-4">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-14 animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : !taskData ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-semibold">Task tidak ditemukan</p>
        </div>
      ) : (
        <AccessGuard scheduleId={String(taskData.scheduleId)} storeId={String(taskData.storeId)} taskStatus={taskData.status}>
          {({ geo, locked, readonly, dis, banner, lockedOverlay }) => {
            const canSubmit = !readonly && !locked && !submitHint;

            return (
              <>
                <div className="flex-1 space-y-4 p-4 pb-32">
                  {!readonly && banner}

                  {isCarryOver && (
                    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <History className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-amber-700">Task lanjutan dari shift sebelumnya</p>
                        <p className="mt-0.5 text-xs text-amber-600">
                          Open Statement sebelumnya ditandai On Hold. Selesaikan (Done) atau On Hold lagi bila masih belum bisa.
                        </p>
                      </div>
                    </div>
                  )}

                  {isCarryOver && parent && (
                    <Section title="Jawaban shift sebelumnya">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                            <PauseCircle className="h-3 w-3" />
                            On Hold
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatDateTime(parent.heldAt ?? parent.completedAt)}
                          </span>
                        </div>
                        {parent.holdReason ? (
                          <p className="mt-2 text-xs text-slate-700">
                            <span className="font-semibold">Alasan hold:</span> {parent.holdReason}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs italic text-muted-foreground">Tidak ada alasan tercatat.</p>
                        )}
                        {parent.notes && (
                          <p className="mt-1 text-xs text-slate-500">
                            <span className="font-semibold">Catatan:</span> {parent.notes}
                          </p>
                        )}
                      </div>
                    </Section>
                  )}

                  {taskData.isOnHold && (
                    <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
                      <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-amber-700">Open Statement masih On Hold</p>
                        <p className="mt-0.5 text-xs text-amber-600">
                          Ditahan pada {formatDateTime(taskData.heldAt)}. Task carry-over akan dikerjakan shift pagi berikutnya.
                        </p>
                        {taskData.holdReason && <p className="mt-1.5 text-xs text-amber-700">Alasan: {taskData.holdReason}</p>}
                      </div>
                    </div>
                  )}

                  {taskData.isDone && (
                    <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-green-700">Open Statement sudah selesai</p>
                        <p className="mt-0.5 text-xs text-green-600">Diselesaikan pada {formatDateTime(taskData.completedAt)}.</p>
                      </div>
                    </div>
                  )}

                  {submitError && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-red-700">Submit gagal</p>
                        <p className="mt-0.5 break-words text-xs text-red-600">{submitError}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSubmitError(null)}
                        className="flex-shrink-0 text-red-400 transition-colors hover:text-red-600"
                        aria-label="Tutup error submit"
                      >
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

                  {taskStatus === 'rejected' && taskData.notes && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                      <div>
                        <p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p>
                        <p className="mt-0.5 text-xs text-red-600">{taskData.notes}</p>
                      </div>
                    </div>
                  )}

                  {/* {!readonly && !locked && (
                    <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
                      <Save className="h-4 w-4 flex-shrink-0 text-blue-500" />
                      <p className="text-xs text-blue-700">
                        Pilihan Open Statement otomatis tersimpan. Pilih Done jika selesai, atau On Hold jika harus dilanjutkan shift pagi berikutnya.
                      </p>
                    </div>
                  )} */}

                  <div className="relative">
                    {lockedOverlay}

                    <div className="space-y-6">
                      <Section title="Status Open Statement">
                        <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-secondary px-5 py-5">
                          <div className="mb-1 flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Instruksi</p>
                          </div>
                          <p className="text-sm font-semibold text-foreground">Cek menu Open Statement pada sistem toko.</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            Jika berhasil dibuka/dikerjakan, pilih Done. Jika belum bisa dikerjakan, pilih On Hold agar task dibuat lagi untuk shift pagi berikutnya.
                          </p>
                        </div>
                      </Section>

                      <Section title="Pilih hasil task">
                        <div className="grid gap-3">
                          <DecisionCard
                            value="done"
                            selected={decision === 'done'}
                            disabled={dis}
                            icon={CheckCircle2}
                            title="Done / Sudah Dikerjakan"
                            description="Open Statement berhasil dicek. Task hari ini langsung selesai."
                            variant="done"
                            onClick={(value) => chooseDecision(value, geo)}
                          />

                          <DecisionCard
                            value="hold"
                            selected={decision === 'hold'}
                            disabled={dis}
                            icon={PauseCircle}
                            title="On Hold / Belum Bisa Dikerjakan"
                            description="Task hari ini ditutup sebagai On Hold dan akan dibuat lagi untuk shift pagi berikutnya."
                            variant="hold"
                            onClick={(value) => chooseDecision(value, geo)}
                          />
                        </div>
                      </Section>

                      {decision === 'hold' && (
                        <Section title="Alasan Hold">
                          <textarea
                            value={holdReason}
                            onChange={(event) => {
                              const value = event.target.value;
                              setHoldReason(value);
                              autoSave(makeAutoSaveBody(geo, { decision: 'hold', holdReason: value }));
                            }}
                            disabled={dis}
                            rows={3}
                            placeholder="Contoh: menu belum bisa dibuka / data belum tersedia / menunggu closing sistem…"
                            className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Alasan ini akan terlihat oleh shift pagi yang menerima task carry-over.
                          </p>
                        </Section>
                      )}

                      <Section title="Catatan opsional">
                        <textarea
                          value={notes}
                          onChange={(event) => {
                            setNotes(event.target.value);
                            autoSave(makeAutoSaveBody(geo, { notes: event.target.value }));
                          }}
                          disabled={dis}
                          rows={3}
                          placeholder="Tambahkan catatan jika ada…"
                          className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                        />
                      </Section>
                    </div>
                  </div>
                </div>

                <TaskSubmitBar
                  label={decision === 'hold' ? 'Submit On Hold' : 'Submit Done'}
                  onSubmit={() => handleSubmit(geo)}
                  submitting={submitting}
                  disabled={!canSubmit}
                  hidden={readonly}
                  hint={!canSubmit ? submitHint : undefined}
                />
              </>
            );
          }}
        </AccessGuard>
      )}
    </div>
  );
}
