'use client';
// app/employee/tasks/briefing/[id]/page.tsx

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, ClipboardCheck, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { TaskHeader, TaskSubmitBar, SaveIndicator } from '@/components/employee/tasks';
import AccessGuard from '@/components/employee/tasks/AccessGuard';
import {
  ActionButton, NotesField, PageBody, SummaryBox, TaskLoadingScreen, TaskMissingScreen,
} from '@/components/employee/ui';

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

  if (loading) return <TaskLoadingScreen title="Briefing" />;
  if (!task) return <TaskMissingScreen title="Briefing" />;

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

        const done = task.status === 'completed';

        return (
          <>
            <TaskHeader
              title="Briefing"
              subtitle={done ? `Selesai ${fmtTime(task.completedAt)}` : undefined}
              status={task.status}
              saveIndicator={
                !readonly ? (
                  <SaveIndicator status={saveStatus} lastSaved={lastSaved} />
                ) : null
              }
            />

            <PageBody bottomBar={!readonly}>
              {banner}

              <div className="relative space-y-5">
                {lockedOverlay}

                <SummaryBox className="flex items-center gap-3 space-y-0">
                  <div className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                    done ? 'bg-green-100 text-green-600' : 'bg-primary/10 text-primary',
                  )}>
                    {done ? <CheckCircle2 className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">Status briefing</p>
                    <p className="mt-0.5 text-base font-bold text-foreground">
                      {done ? `Selesai ${fmtTime(task.completedAt)}` : 'Belum selesai'}
                    </p>
                  </div>
                </SummaryBox>

                <NotesField
                  label="Catatan briefing"
                  value={notes}
                  onChange={setNotes}
                  disabled={dis}
                  rows={5}
                  placeholder="Contoh: Briefing promo hari ini sudah dilakukan, target harian sudah dibagikan…"
                />

                <ActionButton
                  variant="secondary"
                  icon={RefreshCw}
                  className="w-full"
                  onClick={() => void loadTask()}
                  disabled={submitting}
                >
                  Muat ulang
                </ActionButton>
              </div>
            </PageBody>

            <TaskSubmitBar
              label={done ? 'Briefing Sudah Selesai' : 'Selesaikan Briefing'}
              icon={done
                ? <CheckCircle2 className="h-4 w-4" />
                : <Save className="h-4 w-4" />}
              onSubmit={() => void handleSubmit(geo)}
              submitting={submitting}
              disabled={!canSubmit}
              hidden={readonly}
            />
          </>
        );
      }}
    </AccessGuard>
  );
}