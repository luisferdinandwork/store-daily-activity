'use client';
// app/employee/tasks/briefing/[id]/page.tsx

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  RefreshCw,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { TaskHeader, TaskSubmitBar, SaveIndicator } from '@/components/employee/tasks';
import AccessGuard from '@/components/employee/tasks/AccessGuard';

type BriefingTask = {
  id: string;
  scheduleId: string;
  userId: string;
  storeId: string;
  shiftId: string;
  date: string | null;
  done: boolean;
  status: 'not_started' | 'in_progress' | 'completed' | 'pending';
  notes: string | null;
  completedAt: string | null;
};

type ApiResponse = {
  success: boolean;
  error?: string;
  task?: BriefingTask;
};

function fmtTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function BriefingTaskPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [task, setTask] = useState<BriefingTask | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const loadTask = useCallback(async () => {
    setLoading(true);

    try {
      const res = await fetch(`/api/employee/tasks/briefing/${id}`, {
        cache: 'no-store',
      });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.success || !json.task) {
        throw new Error(json.error ?? 'Gagal memuat task briefing.');
      }

      setTask(json.task);
      setNotes(json.task.notes ?? '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat task briefing.');
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
      toast.error('Lokasi wajib aktif untuk menyelesaikan briefing.');
      return;
    }

    setSubmitting(true);
    setSaveStatus('saving');

    try {
      const res = await fetch(`/api/employee/tasks/briefing/${task.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geo, notes }),
      });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.success || !json.task) {
        throw new Error(json.error ?? 'Gagal menyelesaikan briefing.');
      }

      setTask(json.task);
      setNotes(json.task.notes ?? '');
      setSaveStatus('saved');
      setLastSaved(new Date());
      toast.success('Briefing selesai.');
      router.refresh();
    } catch (err) {
      setSaveStatus('error');
      toast.error(err instanceof Error ? err.message : 'Gagal menyelesaikan briefing.');
    } finally {
      setSubmitting(false);
    }
  }

  // Loading state — render minimally before we have task data
  if (loading || !task) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <TaskHeader title="Briefing" subtitle="Simple complete-finish task" />
        <div className="flex-1 p-4">
          {loading ? (
            <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-border bg-card">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat briefing…
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
      taskType="briefing"
    >
      {({ banner, lockedOverlay, dis, geo, readonly, locked }) => {
        const canSubmit =
          !locked && !!geo && !submitting && task.status !== 'completed';

        const submitHint = (() => {
          if (locked) return '';
          if (task.status === 'completed') return '';
          return '';
        })();

        return (
          <div className="flex min-h-screen flex-col bg-background">
            <TaskHeader
              title="Briefing"
              subtitle={
                task.status === 'completed'
                  ? `Selesai ${fmtTime(task.completedAt)}`
                  : 'Simple complete-finish task untuk morning dan night shift.'
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

              <div className="relative">
                {lockedOverlay}

                <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  <div className="border-b border-border p-4">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                        task.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-indigo-50 text-indigo-600',
                      )}>
                        {task.status === 'completed'
                          ? <CheckCircle2 className="h-5 w-5" />
                          : <ClipboardCheck className="h-5 w-5" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-foreground">
                          Status Briefing
                        </p>
                        <p className="mt-1 text-xs font-semibold text-muted-foreground">
                          {task.status === 'completed'
                            ? `Selesai ${fmtTime(task.completedAt)}`
                            : 'Belum selesai'}
                        </p>
                      </div>

                      <span className={cn(
                        'rounded-full border px-2.5 py-1 text-xs font-bold',
                        task.status === 'completed'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700',
                      )}>
                        {task.status === 'completed' ? 'Selesai' : 'Not Started'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3 p-4">
                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Notes / Catatan briefing
                      </span>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        disabled={dis}
                        rows={5}
                        placeholder="Contoh: Briefing promo hari ini sudah dilakukan, target harian sudah dibagikan..."
                        className="mt-2 w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>
                  </div>
                </section>

                <button
                  type="button"
                  onClick={() => void loadTask()}
                  disabled={submitting}
                  className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-muted-foreground transition hover:bg-secondary disabled:opacity-60"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
              </div>
            </div>

            <TaskSubmitBar
              label={task.status === 'completed' ? 'Briefing Sudah Selesai' : 'Selesaikan Briefing'}
              icon={task.status === 'completed'
                ? <CheckCircle2 className="h-4 w-4" />
                : <Save className="h-4 w-4" />}
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