'use client';
// app/employee/tasks/serah-terima/[id]/page.tsx

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { TaskHeader, TaskSubmitBar, SaveIndicator } from '@/components/employee/tasks';
import AccessGuard from '@/components/employee/tasks/AccessGuard';

type SerahItem = {
  id: string;
  taskId: string;
  receiverTaskId: string | null;
  message: string;
  isCompleted: boolean;
  completedBy: string | null;
  completedAt: string | null;
  createdAt: string | null;
};

type SerahTask = {
  id: string;
  scheduleId: string;
  userId: string;
  storeId: string;
  shiftId: string;
  date: string | null;
  handoverText: string;
  status: 'pending' | 'in_progress' | 'completed' | 'discrepancy';
  notes: string | null;
  completedAt: string | null;
};

type ApiResponse = {
  success: boolean;
  error?: string;
  task?: SerahTask;
  outgoingItems?: SerahItem[];
  incomingItems?: SerahItem[];
};

function fmtTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SerahTerimaTaskPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [task, setTask] = useState<SerahTask | null>(null);
  const [outgoingItems, setOutgoingItems] = useState<SerahItem[]>([]);
  const [incomingItems, setIncomingItems] = useState<SerahItem[]>([]);
  const [handoverText, setHandoverText] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completingItemId, setCompletingItemId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const generatedPreview = useMemo(() => {
    return handoverText
      .split(/\r?\n|;/)
      .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(Boolean);
  }, [handoverText]);

  const incomingCompleted = incomingItems.filter((item) => item.isCompleted).length;

  const loadTask = useCallback(async () => {
    setLoading(true);

    try {
      const res = await fetch(`/api/employee/tasks/serah-terima/${id}`, {
        cache: 'no-store',
      });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.success || !json.task) {
        throw new Error(json.error ?? 'Gagal memuat serah terima.');
      }

      setTask(json.task);
      setOutgoingItems(json.outgoingItems ?? []);
      setIncomingItems(json.incomingItems ?? []);
      setHandoverText(json.task.handoverText ?? '');
      setNotes(json.task.notes ?? '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat serah terima.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

  async function handleSubmit(geo: { lat: number; lng: number } | null) {
    if (!task || task.status === 'completed') return;
  
    if (!geo) {
      toast.error('Lokasi wajib aktif untuk mengirim serah terima.');
      return;
    }
  
    // Empty handoverText is now allowed — employee may have nothing to hand over.
  
    setSubmitting(true);
    setSaveStatus('saving');
  
    try {
      const res = await fetch(`/api/employee/tasks/serah-terima/${task.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geo, handoverText, notes }),
      });
  
      const json = (await res.json()) as ApiResponse;
  
      if (!res.ok || !json.success || !json.task) {
        throw new Error(json.error ?? 'Gagal menyimpan serah terima.');
      }
  
      setTask(json.task);
      setOutgoingItems(json.outgoingItems ?? []);
      setIncomingItems(json.incomingItems ?? []);
      setHandoverText(json.task.handoverText ?? '');
      setNotes(json.task.notes ?? '');
      setSaveStatus('saved');
      setLastSaved(new Date());
      toast.success('Serah terima berhasil dikirim.');
      router.refresh();
    } catch (err) {
      setSaveStatus('error');
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan serah terima.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteItem(itemId: string) {
    if (!task) return;

    setCompletingItemId(itemId);

    try {
      const res = await fetch(`/api/employee/tasks/serah-terima/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.success || !json.task) {
        throw new Error(json.error ?? 'Gagal menyelesaikan item.');
      }

      setTask(json.task);
      setOutgoingItems(json.outgoingItems ?? []);
      setIncomingItems(json.incomingItems ?? []);
      toast.success('Item handover selesai.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyelesaikan item.');
    } finally {
      setCompletingItemId(null);
    }
  }

  // Loading / not-found states — render before AccessGuard so we have task data
  if (loading || !task) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <TaskHeader title="Serah Terima" subtitle="Tulis pesan handover untuk shift berikutnya." />
        <div className="flex-1 p-4">
          {loading ? (
            <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-border bg-card">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat serah terima…
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-700">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="font-bold">Task tidak ditemukan</p>
                  <p className="text-sm">Silakan kembali ke halaman task.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <AccessGuard
      scheduleId={task.scheduleId}
      storeId={task.storeId}
      taskStatus={task.status}
      requireGeo
    >
      {({ banner, lockedOverlay, dis, geo, readonly, locked }) => {
        const canSubmit =
          !locked &&
          !!geo &&
          !submitting &&
          task.status !== 'completed';
        
        const submitHint = '';

        return (
          <div className="flex min-h-screen flex-col bg-background">
            <TaskHeader
              title="Serah Terima"
              subtitle={
                task.status === 'completed'
                  ? `Terkirim ${fmtTime(task.completedAt)}`
                  : 'Tulis pesan handover untuk shift berikutnya.'
              }
              status={task.status}
              saveIndicator={
                !readonly ? (
                  <SaveIndicator status={saveStatus} lastSaved={lastSaved} />
                ) : null
              }
            />

            <div className="flex-1 space-y-4 p-4 pb-24">
              {banner}

              <div className="relative space-y-4">
                {lockedOverlay}

                {/* Incoming pesan dari shift sebelumnya */}
                <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  <div className="border-b border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                          <ClipboardList className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-foreground">
                            Incoming dari shift sebelumnya
                          </p>
                          <p className="mt-1 text-xs font-semibold text-muted-foreground">
                            {incomingCompleted}/{incomingItems.length} item selesai
                          </p>
                        </div>
                      </div>

                      <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-bold text-muted-foreground">
                        {incomingItems.length} pesan
                      </span>
                    </div>
                  </div>

                  <div className="divide-y divide-border">
                    {incomingItems.length === 0 ? (
                      <div className="p-4 text-sm font-semibold text-muted-foreground">
                        Belum ada pesan masuk dari shift sebelumnya.
                      </div>
                    ) : (
                      incomingItems.map((item) => (
                        <div key={item.id} className="flex items-start gap-3 p-4">
                          <button
                            type="button"
                            onClick={() => void handleCompleteItem(item.id)}
                            disabled={item.isCompleted || completingItemId === item.id || dis}
                            className={cn(
                              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition',
                              item.isCompleted
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                                : 'border-amber-200 bg-amber-50 text-amber-500 hover:bg-amber-100',
                              dis && !item.isCompleted && 'opacity-60 cursor-not-allowed',
                            )}
                          >
                            {completingItemId === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <p className={cn(
                              'text-sm font-semibold leading-relaxed',
                              item.isCompleted ? 'text-muted-foreground line-through' : 'text-foreground',
                            )}>
                              {item.message}
                            </p>
                            {item.completedAt && (
                              <p className="mt-1 text-[11px] font-semibold text-emerald-600">
                                Selesai {fmtTime(item.completedAt)}
                              </p>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                {/* Outgoing — compose */}
                <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  <div className="border-b border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-foreground">
                          Pesan untuk shift berikutnya
                        </p>
                        <p className="mt-1 text-xs font-semibold text-muted-foreground">
                          Tulis satu item per baris. Sistem akan menjadikannya list.
                        </p>
                      </div>

                      <span className={cn(
                        'rounded-full border px-2.5 py-1 text-xs font-bold',
                        task.status === 'completed'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700',
                      )}>
                        {task.status === 'completed' ? 'Terkirim' : 'Draft'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4 p-4">
                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Pesan handover
                      </span>
                      <textarea
                        value={handoverText}
                        onChange={(e) => setHandoverText(e.target.value)}
                        disabled={dis}
                        rows={7}
                        placeholder={`Contoh:\n- Follow up customer Activity A\n- Rapikan display wall kanan\n- Cek ulang stok artikel XYZ`}
                        className="mt-2 w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>

                    <div className="rounded-xl border border-border bg-secondary p-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Preview list
                      </p>

                      {generatedPreview.length === 0 ? (
                        <p className="mt-2 text-sm font-semibold text-muted-foreground">
                          Belum ada item.
                        </p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {generatedPreview.map((line, index) => (
                            <div key={`${line}-${index}`} className="flex items-start gap-2">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                                {index + 1}
                              </span>
                              <p className="text-sm font-semibold leading-relaxed text-foreground">
                                {line}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Notes tambahan
                      </span>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        disabled={dis}
                        rows={3}
                        placeholder="Catatan tambahan optional..."
                        className="mt-2 w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>

                    {outgoingItems.length > 0 && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                          Pesan terkirim
                        </p>
                        <div className="mt-2 space-y-2">
                          {outgoingItems.map((item, index) => (
                            <div key={item.id} className="flex items-start gap-2">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-emerald-600">
                                {index + 1}
                              </span>
                              <p className="text-sm font-semibold leading-relaxed text-emerald-800">
                                {item.message}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <button
                  type="button"
                  onClick={() => void loadTask()}
                  disabled={submitting}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-muted-foreground transition hover:bg-secondary disabled:opacity-60"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
              </div>
            </div>

            <TaskSubmitBar
              label={task.status === 'completed' ? 'Serah Terima Sudah Terkirim' : 'Kirim Serah Terima'}
              icon={task.status === 'completed'
                ? <CheckCircle2 className="h-4 w-4" />
                : <Send className="h-4 w-4" />}
              onSubmit={() => void handleSubmit(geo)}
              submitting={submitting}
              disabled={!canSubmit}
              hidden={readonly}
              hint={!canSubmit && !submitting ? submitHint : undefined}
            />
          </div>
        );
      }}
    </AccessGuard>
  );
}