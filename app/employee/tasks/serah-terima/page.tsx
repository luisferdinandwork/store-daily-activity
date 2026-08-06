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
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { TaskHeader } from '@/components/employee/tasks';
import AccessGuard from '@/components/employee/tasks/AccessGuard';

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
};

type ApiResponse = {
  success: boolean;
  error?: string;
  storeId?: string;
  scheduleId?: string;
  shiftId?: string;
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
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col bg-background">
          <TaskHeader title="Serah Terima" subtitle="Papan handover bersama semua shift." />
          <div className="flex-1 p-4">
            <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-border bg-card">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat serah terima…
              </div>
            </div>
          </div>
        </div>
      }
    >
      <SerahTerimaBoard />
    </Suspense>
  );
}

function SerahTerimaBoard() {
  const searchParams = useSearchParams();
  const storeId = searchParams.get('storeId') ?? '';

  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [entries, setEntries] = useState<SerahTerimaEntry[]>([]);
  const [recentCompleted, setRecentCompleted] = useState<SerahTerimaEntry[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const pendingCount = entries.length;

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
      setMessage('');
      toast.success('Item serah terima ditambahkan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menambah item serah terima.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComplete(entryId: string, geo: { lat: number; lng: number } | null) {
    if (!geo) {
      toast.error('Lokasi wajib aktif untuk menyelesaikan item serah terima.');
      return;
    }

    setCompletingId(entryId);

    try {
      const res = await fetch('/api/employee/tasks/serah-terima', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, entryId, geo }),
      });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal menyelesaikan item serah terima.');
      }

      setEntries(json.entries ?? []);
      setRecentCompleted(json.recentCompleted ?? []);
      toast.success('Item handover selesai.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyelesaikan item serah terima.');
    } finally {
      setCompletingId(null);
    }
  }

  if (loading || !scheduleId) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <TaskHeader title="Serah Terima" subtitle="Papan handover bersama semua shift." />
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
                  <p className="font-bold">Tidak bisa memuat papan serah terima</p>
                  <p className="text-sm">{loadError ?? 'Silakan kembali ke halaman task.'}</p>
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
      scheduleId={scheduleId}
      storeId={storeId}
      // The board itself is never "done" — it's a rolling list, not a single
      // completable task — so it should never go permanently read-only.
      taskStatus="in_progress"
      taskType="serah_terima"
    >
      {({ banner, lockedOverlay, dis, geo, readonly }) => (
        <div className="flex min-h-screen flex-col bg-background">
          <TaskHeader
            title="Serah Terima"
            subtitle={
              pendingCount > 0
                ? `${pendingCount} item belum selesai`
                : 'Papan handover kosong'
            }
          />

          <div className="flex-1 space-y-4 p-4 pb-24">
            {banner}

            <div className="relative space-y-4">
              {lockedOverlay}

              {/* Compose new entry — any shift can add anytime */}
              <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="border-b border-border p-4">
                  <p className="text-sm font-bold text-foreground">Tambah item baru</p>
                  <p className="mt-1 text-xs font-semibold text-muted-foreground">
                    Semua shift bisa menambah dan menyelesaikan item di papan ini.
                  </p>
                </div>

                <div className="space-y-3 p-4">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={dis || readonly}
                    rows={3}
                    placeholder="Contoh: Follow up customer Activity A"
                    className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  <button
                    type="button"
                    onClick={() => void handleAdd(geo)}
                    disabled={dis || readonly || submitting || !canSubmitMessage}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Tambah Item
                  </button>
                </div>
              </section>

              {/* Active list */}
              <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="border-b border-border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                        <ClipboardList className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground">Item aktif</p>
                        <p className="mt-1 text-xs font-semibold text-muted-foreground">
                          Tap ceklis untuk menyelesaikan item.
                        </p>
                      </div>
                    </div>

                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-bold text-muted-foreground">
                      {pendingCount} item
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-border">
                  {entries.length === 0 ? (
                    <div className="p-4 text-sm font-semibold text-muted-foreground">
                      Belum ada item serah terima aktif.
                    </div>
                  ) : (
                    entries.map((entry) => (
                      <div key={entry.id} className="flex items-start gap-3 p-4">
                        <button
                          type="button"
                          onClick={() => void handleComplete(entry.id, geo)}
                          disabled={dis || readonly || completingId === entry.id}
                          className={cn(
                            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition',
                            'border-amber-200 bg-amber-50 text-amber-500 hover:bg-amber-100',
                            (dis || readonly) && 'opacity-60 cursor-not-allowed',
                          )}
                        >
                          {completingId === entry.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-relaxed text-foreground">
                            {entry.message}
                          </p>
                          <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                            Ditambahkan {fmtTime(entry.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* History — recently completed */}
              <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowHistory((prev) => !prev)}
                  className="flex w-full items-center justify-between p-4 text-left"
                >
                  <p className="text-sm font-bold text-foreground">
                    Riwayat selesai ({recentCompleted.length})
                  </p>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {showHistory ? 'Sembunyikan' : 'Tampilkan'}
                  </span>
                </button>

                {showHistory && (
                  <div className="divide-y divide-border border-t border-border">
                    {recentCompleted.length === 0 ? (
                      <div className="p-4 text-sm font-semibold text-muted-foreground">
                        Belum ada item yang diselesaikan.
                      </div>
                    ) : (
                      recentCompleted.map((entry) => (
                        <div key={entry.id} className="p-4">
                          <p className="text-sm font-semibold leading-relaxed text-muted-foreground line-through">
                            {entry.message}
                          </p>
                          <p className="mt-1 text-[11px] font-semibold text-emerald-600">
                            Selesai {fmtTime(entry.completedAt)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </section>

              <button
                type="button"
                onClick={() => void load()}
                disabled={submitting}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-muted-foreground transition hover:bg-secondary disabled:opacity-60"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>
        </div>
      )}
    </AccessGuard>
  );
}
