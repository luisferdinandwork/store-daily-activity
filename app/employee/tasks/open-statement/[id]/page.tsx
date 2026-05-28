'use client';
// app/employee/tasks/open-statement/[id]/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated detail page for the Open Statement task.
//
// Refactor notes:
// - Uses shared employee task components:
//   AccessGuard, TaskHeader, TaskSubmitBar, SaveIndicator.
// - Removes duplicated local geo/access/header/save/submit-bar code.
// - Keeps the original Open Statement flow:
//   1. Load task from /api/employee/tasks.
//   2. Fetch expected amount through PUT /api/employee/tasks/open-statement.
//   3. Employee inputs actual Open Statement amount.
//   4. Submit compares expected vs actual.
//      • match    → completed / balanced
//      • mismatch → discrepancy
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  CircleCheck,
  CircleX,
  Clock,
  CloudOff,
  FileText,
  Loader2,
  Save,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import {
  AccessGuard,
  TaskHeader,
  TaskSubmitBar,
  SaveIndicator,
} from '@/components/employee/tasks';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'verified'
  | 'rejected'
  | 'discrepancy';

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
  expectedAmount: string | null;
  expectedFetchedAt: string | null;
  actualAmount: string | null;
  isBalanced: boolean | null;
  discrepancyStartedAt: string | null;
  discrepancyResolvedAt: string | null;
  discrepancyDurationMinutes: number | null;
}

// ─── Rupiah helpers ───────────────────────────────────────────────────────────

function formatRupiah(raw: string | number | null | undefined): string {
  if (raw == null) return 'Rp 0';

  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return 'Rp 0';

  return `Rp ${parseInt(digits, 10).toLocaleString('id-ID')}`;
}

function parseRupiah(formatted: string): string {
  return formatted.replace(/\D/g, '') || '0';
}

function toNumber(raw: string | number | null | undefined): number {
  if (raw == null) return 0;

  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return 0;

  return Number(digits);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';

  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── UI helpers ────────────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OpenStatementDetailPage() {
  const params = useParams();
  const router = useRouter();

  const taskId = String(params.id);

  const [taskData, setTaskData] = useState<OpenStatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fetchingExpected, setFetchingExpected] = useState(false);

  const [expectedAmount, setExpectedAmount] = useState<number | null>(null);
  const [actualAmount, setActualAmount] = useState('0');
  const [notes, setNotes] = useState('');

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
      const res = await fetch('/api/employee/tasks', {
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        tasks?: Array<{
          type: string;
          data: OpenStatementData;
        }>;
      };

      const found = data.tasks?.find(
        (task) => task.type === 'open_statement' && String(task.data.id) === taskId,
      );

      if (!found) {
        setTaskData(null);
        return;
      }

      const task = found.data;

      setTaskData(task);
      setActualAmount(task.actualAmount ? parseRupiah(task.actualAmount) : '0');
      setNotes(task.notes ?? '');
      setExpectedAmount(task.expectedAmount ? toNumber(task.expectedAmount) : null);
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

  const fetchExpected = useCallback(async () => {
    if (!taskData) return;
    if (expectedAmount != null) return;

    setFetchingExpected(true);

    try {
      const res = await fetch('/api/employee/tasks/open-statement', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: Number(taskData.id),
        }),
      });

      const json = (await res.json()) as {
        success: boolean;
        data?: {
          expectedAmount: number | string;
        };
        error?: string;
      };

      if (!res.ok || !json.success || !json.data) {
        toast.error(json.error ?? 'Gagal mengambil nominal Open Statement.');
        return;
      }

      setExpectedAmount(toNumber(json.data.expectedAmount));
    } catch (error) {
      console.error('[OpenStatement] fetchExpected error:', error);
      toast.error('Koneksi gagal saat mengambil nominal Open Statement.');
    } finally {
      setFetchingExpected(false);
    }
  }, [taskData, expectedAmount]);

  useEffect(() => {
    if (taskData) fetchExpected();
  }, [taskData, fetchExpected]);

  const taskStatus = taskData?.status;
  const readonlyHeader = taskStatus === 'completed' || taskStatus === 'verified';

  const scheduleId = taskData ? Number(taskData.scheduleId) : 0;
  const storeId = taskData ? Number(taskData.storeId) : 0;

  const actualNum = toNumber(actualAmount);
  const amountValid = Number.isFinite(actualNum) && actualNum >= 0;
  const liveMatches =
    expectedAmount != null &&
    Number.isFinite(actualNum) &&
    actualNum === expectedAmount;

  const liveDiff =
    expectedAmount != null && Number.isFinite(actualNum)
      ? actualNum - expectedAmount
      : 0;

  const submitHint = (() => {
    if (expectedAmount == null) return 'Menunggu nominal dari sistem.';
    if (!amountValid) return 'Masukkan nominal yang valid.';
    return undefined;
  })();

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

  async function handleSubmit(geo: GeoPoint | null) {
    if (!taskData) return;

    setSubmitError(null);

    if (!scheduleId || !storeId) {
      const message = 'Data task tidak valid. Muat ulang halaman.';
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
          actualAmount,
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

      const updated = (json.data ?? {}) as Partial<OpenStatementData>;

      if (updated.isBalanced === true) {
        toast.success('Open Statement balanced! ✓', {
          duration: 4000,
        });
      } else {
        toast.warning('Nominal tidak cocok — task masuk ke status discrepancy.', {
          duration: 5000,
        });
      }

      router.back();
    } catch (error) {
      const message =
        error instanceof Error
          ? `Koneksi gagal: ${error.message}`
          : 'Gagal terhubung ke server.';

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
            ? `${taskData.shift.replace('_', ' ')} shift · ${taskData.status.replace('_', ' ')}`
            : undefined
        }
        status={taskStatus}
        saveIndicator={
          !readonlyHeader && !loading && taskData ? (
            <SaveIndicator status={saveStatus} lastSaved={lastSaved} />
          ) : null
        }
      />

      {loading ? (
        <div className="flex-1 space-y-3 p-4">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-14 animate-pulse rounded-xl bg-secondary"
            />
          ))}
        </div>
      ) : !taskData ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-semibold">Task tidak ditemukan</p>
        </div>
      ) : (
        <AccessGuard
          scheduleId={String(taskData.scheduleId)}
          storeId={String(taskData.storeId)}
          taskStatus={taskData.status}
        >
          {({ geo, locked, readonly, dis, banner, lockedOverlay }) => {
            const canSubmit = !readonly && !locked && amountValid && expectedAmount != null;

            return (
              <>
                <div className="flex-1 space-y-4 p-4 pb-32">
                  {!readonly && banner}

                  {taskData.discrepancyStartedAt || taskStatus === 'discrepancy' ? (
                    <div
                      className={cn(
                        'flex items-start gap-3 rounded-xl border px-4 py-3',
                        taskData.discrepancyResolvedAt
                          ? 'border-green-200 bg-green-50'
                          : 'border-amber-300 bg-amber-50',
                      )}
                    >
                      <Clock
                        className={cn(
                          'mt-0.5 h-5 w-5 flex-shrink-0',
                          taskData.discrepancyResolvedAt
                            ? 'text-green-600'
                            : 'text-amber-600',
                        )}
                      />

                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'text-sm font-bold',
                            taskData.discrepancyResolvedAt
                              ? 'text-green-700'
                              : 'text-amber-700',
                          )}
                        >
                          {taskData.discrepancyResolvedAt
                            ? 'Discrepancy terselesaikan'
                            : 'Task dalam status discrepancy'}
                        </p>

                        <p
                          className={cn(
                            'mt-0.5 text-xs',
                            taskData.discrepancyResolvedAt
                              ? 'text-green-600'
                              : 'text-amber-600',
                          )}
                        >
                          Dimulai: {formatDateTime(taskData.discrepancyStartedAt)}
                          {taskData.discrepancyResolvedAt && (
                            <> · Selesai: {formatDateTime(taskData.discrepancyResolvedAt)}</>
                          )}
                          {taskData.discrepancyDurationMinutes != null && (
                            <> · Durasi: {taskData.discrepancyDurationMinutes} menit</>
                          )}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {submitError && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />

                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-red-700">Submit gagal</p>
                        <p className="mt-0.5 break-words text-xs text-red-600">
                          {submitError}
                        </p>
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
                      <p className="text-xs text-orange-700">
                        Auto-save gagal: {saveError}
                      </p>
                    </div>
                  )}

                  {taskStatus === 'rejected' && taskData.notes && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />

                      <div>
                        <p className="text-xs font-bold text-red-700">
                          Ditolak oleh OPS
                        </p>
                        <p className="mt-0.5 text-xs text-red-600">
                          {taskData.notes}
                        </p>
                        <p className="mt-1.5 text-xs font-medium text-red-700">
                          Silakan perbaiki dan submit ulang.
                        </p>
                      </div>
                    </div>
                  )}

                  {!readonly && !locked && (
                    <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
                      <Save className="h-4 w-4 flex-shrink-0 text-blue-500" />
                      <p className="text-xs text-blue-700">
                        Perubahan otomatis tersimpan. Rekan shift lain dapat
                        melanjutkan task ini.
                      </p>
                    </div>
                  )}

                  <div className="relative">
                    {lockedOverlay}

                    <div className="space-y-6">
                      <Section title="Data Sistem (Expected)">
                        <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-secondary px-5 py-5">
                          <div className="mb-1 flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Nominal Open Statement
                            </p>
                          </div>

                          {fetchingExpected ? (
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              <p className="text-xs text-muted-foreground">
                                Mengambil dari sistem…
                              </p>
                            </div>
                          ) : expectedAmount != null ? (
                            <p className="text-2xl font-bold tabular-nums text-foreground">
                              {formatRupiah(expectedAmount)}
                            </p>
                          ) : (
                            <p className="text-xs text-red-600">
                              Gagal fetch. Muat ulang halaman.
                            </p>
                          )}
                        </div>

                        <p className="text-[10px] text-muted-foreground">
                          Cek menu Open Statement di sistem dan masukkan nominal
                          yang tertera.
                        </p>
                      </Section>

                      <Section title="Input dari Menu Open Statement (Actual)">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatRupiah(actualAmount)}
                          disabled={dis}
                          placeholder="Rp 0"
                          onChange={(event) => {
                            const raw = parseRupiah(event.target.value);

                            setActualAmount(raw);
                            autoSave(makeAutoSaveBody(geo, { actualAmount: raw }));
                          }}
                          onFocus={(event) => {
                            const input = event.target;
                            const length = input.value.length;

                            requestAnimationFrame(() => {
                              input.setSelectionRange(length, length);
                            });
                          }}
                          className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-semibold tabular-nums outline-none transition focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                        />

                        {expectedAmount != null && actualAmount !== '0' && (
                          <div
                            className={cn(
                              'flex items-center gap-2 rounded-xl border px-3 py-2.5',
                              liveMatches
                                ? 'border-green-200 bg-green-50'
                                : 'border-amber-200 bg-amber-50',
                            )}
                          >
                            {liveMatches ? (
                              <CircleCheck className="h-4 w-4 flex-shrink-0 text-green-600" />
                            ) : (
                              <CircleX className="h-4 w-4 flex-shrink-0 text-amber-600" />
                            )}

                            <p
                              className={cn(
                                'text-xs font-semibold',
                                liveMatches ? 'text-green-700' : 'text-amber-700',
                              )}
                            >
                              {liveMatches
                                ? 'Nominal cocok dengan sistem ✓'
                                : `Selisih: ${liveDiff > 0 ? '+' : ''}${formatRupiah(Math.abs(liveDiff))}`}
                            </p>
                          </div>
                        )}
                      </Section>

                      <Section title="Catatan opsional">
                        <textarea
                          value={notes}
                          onChange={(event) => {
                            setNotes(event.target.value);
                            autoSave(
                              makeAutoSaveBody(geo, {
                                notes: event.target.value,
                              }),
                            );
                          }}
                          disabled={dis}
                          rows={3}
                          placeholder="Tambahkan catatan jika ada…"
                          className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm outline-none placeholder:text-muted-foreground transition focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                        />
                      </Section>
                    </div>
                  </div>
                </div>

                <TaskSubmitBar
                  label="Submit & Bandingkan"
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
