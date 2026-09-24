'use client';
// app/employee/tasks/serah-terima/page.tsx
//
// Serah Terima is a shared, rolling handover board per store: any shift can
// add a new entry at any time, morning/evening/full_day all see the exact
// same list, and any shift member can mark any entry complete. There is no
// "next shift" targeting/chain and no daily reset — entries stay in the
// active list until completed.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  ClipboardList,
  Loader2,
  Lock,
  PauseCircle,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { TaskHeader, TaskSubmitBar } from '@/components/employee/tasks';
import AccessGuard from '@/components/employee/tasks/AccessGuard';
import PhotoUploadGrid from '@/components/shared/PhotoUploadGrid';
import {
  ActionButton, BottomSheet, Chip, EmptyState, ListGroup, Notice, PageBody, Section,
  TaskLoadingScreen, TaskMissingScreen,
} from '@/components/employee/ui';

type SerahTerimaEntry = {
  id: string;
  storeId: string;
  message: string;
  createdByUserId: string;
  createdByShiftId: string;
  isCompleted: boolean;
  completedByUserId: string | null;
  completedAt: string | null;
  createdAt: string | null;
  isOnHold: boolean;
  note: string | null;
  photoUrl: string | null;
};

type SerahTerimaTask = {
  id: string;
  status: string;
  completedAt: string | null;
  locked: boolean;
  notes: string | null;
};

type ApiResponse = {
  success: boolean;
  error?: string;
  storeId?: string;
  scheduleId?: string;
  shiftId?: string;
  task?: SerahTerimaTask;
  entries?: SerahTerimaEntry[];
  recentCompleted?: SerahTerimaEntry[];
};

function fmtTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SerahTerimaBoardPage() {
  return (
    <Suspense fallback={<TaskLoadingScreen title="Serah Terima" />}>
      <SerahTerimaBoard />
    </Suspense>
  );
}

function SerahTerimaBoard() {
  const searchParams = useSearchParams();
  const storeId = searchParams.get('storeId') ?? '';
  const { data: session } = useSession();
  const isPic = session?.user?.employeeType === 'pic_1' || session?.user?.employeeType === 'pic_2';

  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [task, setTask] = useState<SerahTerimaTask | null>(null);
  const [entries, setEntries] = useState<SerahTerimaEntry[]>([]);
  const [recentCompleted, setRecentCompleted] = useState<SerahTerimaEntry[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completingTask, setCompletingTask] = useState(false);
  const [confirmCompleteTask, setConfirmCompleteTask] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [confirmEntryAction, setConfirmEntryAction] = useState<{ entryId: string; outcome: 'done' | 'on_hold' } | null>(null);
  const [entryReason, setEntryReason] = useState('');
  const [entryPhotoUrl, setEntryPhotoUrl] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const pendingCount = entries.length;
  const taskDone = task?.status === 'completed' || task?.locked === true;

  const load = useCallback(async () => {
    if (!storeId) {
      setLoadError('Store tidak ditemukan.');
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/employee/tasks/serah-terima?storeId=${storeId}`, {
        cache: 'no-store',
      });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal memuat serah terima.');
      }

      setScheduleId(json.scheduleId ?? null);
      setTask(json.task ?? null);
      setEntries(json.entries ?? []);
      setRecentCompleted(json.recentCompleted ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Gagal memuat serah terima.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canSubmitMessage = useMemo(() => message.trim().length > 0, [message]);

  async function handleAdd(geo: { lat: number; lng: number } | null) {
    if (!canSubmitMessage) return;

    if (!geo) {
      toast.error('Lokasi wajib aktif untuk menambah item serah terima.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/employee/tasks/serah-terima', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, message, geo }),
      });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal menambah item serah terima.');
      }

      setEntries(json.entries ?? []);
      setRecentCompleted(json.recentCompleted ?? []);
      if (json.task) setTask(json.task);
      setMessage('');
      toast.success('Item serah terima ditambahkan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menambah item serah terima.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteTask(geo: { lat: number; lng: number } | null) {
    if (!geo) {
      toast.error('Lokasi wajib aktif untuk menyelesaikan serah terima.');
      return;
    }
    setCompletingTask(true);
    try {
      const res = await fetch('/api/employee/tasks/serah-terima', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, action: 'complete_task', geo }),
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal menyelesaikan serah terima.');
      }
      setEntries(json.entries ?? []);
      setRecentCompleted(json.recentCompleted ?? []);
      if (json.task) setTask(json.task);
      toast.success('Serah terima shift ini selesai.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyelesaikan serah terima.');
    } finally {
      setCompletingTask(false);
    }
  }

  async function handleUploadEntryPhoto(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    form.append('photoType', 'serah_terima');
    const res = await fetch('/api/employee/tasks/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.url) {
      throw new Error(data.error ?? 'Upload gagal.');
    }
    return data.url as string;
  }

  async function handleResolveEntry(
    entryId: string,
    geo: { lat: number; lng: number } | null,
    outcome: 'done' | 'on_hold',
    note: string,
    photoUrl: string | null,
  ) {
    if (!geo) {
      toast.error('Lokasi wajib aktif untuk menyelesaikan item serah terima.');
      return;
    }

    setCompletingId(entryId);

    try {
      const res = await fetch('/api/employee/tasks/serah-terima', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, entryId, geo, outcome, note: note || undefined, photoUrl: photoUrl || undefined }),
      });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal menyimpan item serah terima.');
      }

      setEntries(json.entries ?? []);
      setRecentCompleted(json.recentCompleted ?? []);
      if (json.task) setTask(json.task);
      toast.success(outcome === 'on_hold' ? 'Item ditahan.' : 'Item handover selesai.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan item serah terima.');
    } finally {
      setCompletingId(null);
    }
  }

  async function handleDeleteHistory(entryId: string) {
    setDeletingId(entryId);

    try {
      const params = new URLSearchParams({ storeId, entryId });
      const res = await fetch(`/api/employee/tasks/serah-terima?${params}`, { method: 'DELETE' });
      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal menghapus riwayat.');
      }

      setEntries(json.entries ?? []);
      setRecentCompleted(json.recentCompleted ?? []);
      if (json.task) setTask(json.task);
      toast.success('Riwayat dihapus.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus riwayat.');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <TaskLoadingScreen title="Serah Terima" />;
  if (!scheduleId) {
    return (
      <TaskMissingScreen
        title="Serah Terima"
        message={loadError ?? 'Tidak bisa memuat papan serah terima. Silakan kembali ke halaman task.'}
      />
    );
  }

  return (
    <AccessGuard
      scheduleId={scheduleId}
      storeId={storeId}
      // Once this shift's serah terima task is completed, the board goes
      // read-only for the rest of the day (a fresh task reopens it tomorrow).
      taskStatus={taskDone ? 'completed' : 'in_progress'}
      taskType="serah_terima"
    >
      {({ banner, lockedOverlay, dis, geo, readonly }) => (
        <>
          <TaskHeader
            title="Serah Terima"
            subtitle={
              taskDone
                ? 'Shift ini sudah selesai'
                : pendingCount > 0
                  ? `${pendingCount} item belum selesai`
                  : 'Papan handover kosong'
            }
          />

          <PageBody bottomBar={!taskDone}>
            {banner}

            {taskDone && (
              <Notice tone="success" icon={Lock} title="Serah terima shift ini selesai">
                Papan dikunci untuk shift ini hari ini. Bisa dikelola lagi besok.
                {task?.notes && <p className="mt-1 italic">Catatan: {task.notes}</p>}
              </Notice>
            )}

            <div className="relative space-y-5">
              {lockedOverlay}

              {/* Compose new entry — any shift can add anytime */}
              <Section title="Tambah item baru">
                <div className="space-y-2">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={dis || readonly}
                    rows={3}
                    placeholder="Contoh: Follow up customer Activity A"
                    className="w-full resize-none rounded-xl border border-border bg-secondary px-3.5 py-2.5 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <ActionButton
                    className="w-full"
                    icon={Plus}
                    loading={submitting}
                    onClick={() => void handleAdd(geo)}
                    disabled={dis || readonly || !canSubmitMessage}
                  >
                    Tambah Item
                  </ActionButton>
                  <p className="px-0.5 text-[11px] text-muted-foreground">
                    Semua shift bisa menambah dan menyelesaikan item di papan ini.
                  </p>
                </div>
              </Section>

              {/* Active list */}
              <Section title="Item aktif" meta={`${pendingCount}`}>
                {entries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border">
                    <EmptyState icon={ClipboardList} title="Belum ada item aktif" description="Tambahkan item di atas untuk diteruskan ke shift lain." className="py-8" />
                  </div>
                ) : (
                  <ListGroup>
                    {entries.map((entry) => (
                      <div key={entry.id} className="space-y-3 px-3.5 py-3.5">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-sm font-semibold leading-relaxed text-foreground">{entry.message}</p>
                              {entry.isOnHold && <Chip tone="warning">Ditahan</Chip>}
                            </div>
                            {entry.isOnHold && entry.note && (
                              <p className="mt-1 text-xs font-medium text-amber-700">Alasan: {entry.note}</p>
                            )}
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Ditambahkan {fmtTime(entry.createdAt)}
                            </p>
                          </div>
                          {entry.photoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={entry.photoUrl} alt="Foto" className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover" />
                          )}
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setEntryReason(entry.note ?? ''); setEntryPhotoUrl(entry.photoUrl); setConfirmEntryAction({ entryId: entry.id, outcome: 'on_hold' }); }}
                            disabled={dis || readonly || completingId === entry.id}
                            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-50 text-xs font-bold text-amber-700 transition active:bg-amber-100 disabled:opacity-60"
                          >
                            <PauseCircle className="h-4 w-4" />
                            Tahan
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEntryReason(''); setEntryPhotoUrl(entry.photoUrl); setConfirmEntryAction({ entryId: entry.id, outcome: 'done' }); }}
                            disabled={dis || readonly || completingId === entry.id}
                            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-50 text-xs font-bold text-green-700 transition active:bg-green-100 disabled:opacity-60"
                          >
                            {completingId === entry.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" />
                            )}
                            Selesai
                          </button>
                        </div>
                      </div>
                    ))}
                  </ListGroup>
                )}
              </Section>

              {/* History — recently completed */}
              <Section title="Riwayat selesai" meta={`${recentCompleted.length}`}>
                <ListGroup>
                  <button
                    type="button"
                    onClick={() => setShowHistory((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-3 bg-card px-3.5 py-3 text-left transition active:bg-secondary"
                  >
                    <span className="text-sm font-semibold text-foreground">
                      {showHistory ? 'Sembunyikan riwayat' : 'Tampilkan riwayat'}
                    </span>
                    <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showHistory && 'rotate-180')} />
                  </button>

                  {showHistory && (
                    recentCompleted.length === 0 ? (
                      <p className="px-3.5 py-4 text-sm text-muted-foreground">Belum ada item yang diselesaikan.</p>
                    ) : (
                      recentCompleted.map((entry) => (
                        <div key={entry.id} className="flex items-start gap-3 px-3.5 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-relaxed text-muted-foreground line-through">
                              {entry.message}
                            </p>
                            {entry.note && (
                              <p className="mt-1 text-xs text-muted-foreground">Catatan: {entry.note}</p>
                            )}
                            <p className="mt-1 text-[11px] font-semibold text-green-600">
                              Selesai {fmtTime(entry.completedAt)}
                            </p>
                          </div>
                          {entry.photoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={entry.photoUrl} alt="Foto" className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover" />
                          )}
                          {isPic && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(entry.id)}
                              disabled={deletingId === entry.id}
                              aria-label="Hapus riwayat"
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition active:bg-red-50 active:text-red-500 disabled:opacity-60"
                            >
                              {deletingId === entry.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                      ))
                    )
                  )}
                </ListGroup>
              </Section>

              <ActionButton
                variant="secondary"
                icon={RefreshCw}
                className="w-full"
                onClick={() => void load()}
                disabled={submitting}
              >
                Muat ulang
              </ActionButton>
            </div>
          </PageBody>

          <TaskSubmitBar
            label="Selesaikan Serah Terima Shift Ini"
            icon={<CheckCheck className="h-4 w-4" />}
            onSubmit={() => setConfirmCompleteTask(true)}
            submitting={completingTask}
            disabled={dis || readonly}
            hidden={taskDone}
          />

          <BottomSheet
            open={confirmCompleteTask}
            onClose={() => setConfirmCompleteTask(false)}
            title="Selesaikan serah terima shift ini?"
            description={`${pendingCount > 0 ? `Masih ada ${pendingCount} item aktif di papan. ` : ''}Setelah diselesaikan, papan dikunci untuk shift ini hari ini dan hanya bisa dikelola lagi besok.`}
            footer={
              <>
                <ActionButton variant="secondary" className="flex-1" onClick={() => setConfirmCompleteTask(false)}>Batal</ActionButton>
                <ActionButton
                  className="flex-1"
                  onClick={() => {
                    setConfirmCompleteTask(false);
                    void handleCompleteTask(geo);
                  }}
                >
                  Selesaikan
                </ActionButton>
              </>
            }
          />

          <BottomSheet
            open={!!confirmDeleteId}
            onClose={() => setConfirmDeleteId(null)}
            title="Hapus item riwayat?"
            description="Tindakan ini tidak bisa dibatalkan."
            footer={
              <>
                <ActionButton variant="secondary" className="flex-1" onClick={() => setConfirmDeleteId(null)}>Batal</ActionButton>
                <ActionButton
                  variant="danger"
                  className="flex-1"
                  onClick={() => {
                    if (confirmDeleteId) void handleDeleteHistory(confirmDeleteId);
                    setConfirmDeleteId(null);
                  }}
                >
                  Hapus
                </ActionButton>
              </>
            }
          />

          <BottomSheet
            open={confirmEntryAction !== null}
            onClose={() => setConfirmEntryAction(null)}
            title={confirmEntryAction?.outcome === 'on_hold' ? 'Tahan item ini?' : 'Selesaikan item ini?'}
            description={
              confirmEntryAction?.outcome === 'on_hold'
                ? 'Item tetap ada di daftar aktif. Jelaskan alasan agar shift lain bisa menindaklanjuti.'
                : 'Catatan tambahan bersifat opsional.'
            }
            footer={
              <>
                <ActionButton variant="secondary" className="flex-1" onClick={() => setConfirmEntryAction(null)}>Batal</ActionButton>
                <ActionButton
                  className="flex-1"
                  disabled={confirmEntryAction?.outcome === 'on_hold' && entryReason.trim() === ''}
                  onClick={() => {
                    if (!confirmEntryAction) return;
                    const { entryId, outcome } = confirmEntryAction;
                    setConfirmEntryAction(null);
                    void handleResolveEntry(entryId, geo, outcome, entryReason.trim(), entryPhotoUrl);
                  }}
                >
                  {confirmEntryAction?.outcome === 'on_hold' ? 'Tahan' : 'Selesaikan'}
                </ActionButton>
              </>
            }
          >
            <textarea
              value={entryReason}
              onChange={(e) => setEntryReason(e.target.value)}
              rows={3}
              placeholder={confirmEntryAction?.outcome === 'on_hold' ? 'Alasan ditahan (wajib)…' : 'Catatan tambahan (opsional)…'}
              className="w-full resize-none rounded-xl border border-border bg-secondary px-3.5 py-2.5 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />

            <PhotoUploadGrid
              label="Foto (opsional)"
              photos={entryPhotoUrl ? [entryPhotoUrl] : []}
              onChange={(urls) => setEntryPhotoUrl(urls[0] ?? null)}
              upload={handleUploadEntryPhoto}
              max={1}
            />
          </BottomSheet>
        </>
      )}
    </AccessGuard>
  );
}
