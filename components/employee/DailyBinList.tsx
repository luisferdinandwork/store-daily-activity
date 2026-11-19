'use client';
// components/employee/DailyBinList.tsx
//
// Cek Bin · "Bin hari ini": the 20 bins the store scans in BC today (monthly bin round, lib/bin-round.ts) —
// numbered in walking order, each Belum di-scan / Benar / Salah from BC's scans, with the month's progress on top.
// A bin that was checked never comes back this month, so the list is different every day. While the store's bin
// list is still being read from BC the card says so and tries again by itself.
//
// GET /api/employee/tasks/cek-bin/bins?taskId=… (the same access rule as the BC results panel below it).

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleDashed, CloudOff, Loader2, MapPin, RefreshCw, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONES } from '@/lib/status-theme';
import {
  formatPct,
  monthLabel,
  pendingBins,
  progressPct,
  shortDay,
  type BinRoundStatus,
  type EmployeeBinRound,
} from '@/lib/bin-round';
import { Card, Notice, Section, SkeletonBlocks } from '@/components/employee/ui';

/** While the bin list is being read from BC: ask again this often, this many times. */
const PREPARING_RETRY_MS = 30_000;
const PREPARING_RETRIES = 8;

function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn(className, 'animate-spin')} />;
}

const LOOK: Record<BinRoundStatus, { label: string; icon: typeof CheckCircle2; tile: string; text: string }> = {
  pending: { label: 'Belum di-scan', icon: CircleDashed, tile: 'border-border bg-card', text: TONES.muted.text },
  correct: { label: 'Benar', icon: CheckCircle2, tile: `${TONES.success.border} ${TONES.success.tint}`, text: TONES.success.text },
  wrong: { label: 'Salah', icon: XCircle, tile: `${TONES.danger.border} ${TONES.danger.tint}`, text: TONES.danger.text },
};

export default function DailyBinList({ taskId }: { taskId: string }) {
  const [data, setData] = useState<EmployeeBinRound | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const retries = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/employee/tasks/cek-bin/bins?taskId=${encodeURIComponent(taskId)}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(60_000),
      });
      const json = (await res.json()) as { success?: boolean; data?: EmployeeBinRound };
      if (!res.ok || !json.success || !json.data) throw new Error(`HTTP ${res.status}`);
      setData(json.data);
      setFailed(false);
    } catch (e) {
      console.error('[DailyBinList] load error:', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  // The store's bin list is still coming from BC: try again a few times by itself.
  useEffect(() => {
    if (data?.state !== 'preparing' || retries.current >= PREPARING_RETRIES) return;
    const t = setTimeout(() => { retries.current += 1; load(); }, PREPARING_RETRY_MS);
    return () => clearTimeout(t);
  }, [data, load]);

  const list = data?.list ?? null;
  const month = data?.month ?? null;

  const refresh = (
    <button
      type="button"
      onClick={() => load()}
      disabled={loading}
      aria-label="Muat ulang daftar bin"
      className="flex h-7 items-center gap-1 rounded-lg bg-secondary px-2 text-[11px] font-semibold text-muted-foreground transition-colors active:bg-border disabled:opacity-50"
    >
      <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
      Muat ulang
    </button>
  );

  let body;
  if (loading && !data) {
    body = <SkeletonBlocks count={1} className="h-40" />;
  } else if (failed && !data) {
    body = (
      <Notice tone="neutral" icon={CloudOff} title="Daftar bin belum bisa dimuat">
        Coba muat ulang sebentar lagi.
      </Notice>
    );
  } else if (data?.state === 'preparing') {
    body = (
      <Notice tone="info" icon={Spinner} title="Daftar bin toko sedang diambil dari BC">
        Ini hanya terjadi sekali. Daftar bin hari ini muncul sendiri dalam 1–2 menit.
      </Notice>
    );
  } else if (data?.state === 'no_bins') {
    body = (
      <Notice tone="neutral" icon={CircleDashed} title="Toko ini belum punya bin di BC">
        Daftar bin diambil dari Business Central. Hubungi tim OPS bila toko ini seharusnya sudah punya bin.
      </Notice>
    );
  } else if (data?.state === 'failed') {
    body = (
      <Notice tone="neutral" icon={CloudOff} title="Daftar bin belum bisa diambil dari BC">
        Coba lagi nanti. Task Cek BIN tetap bisa dikerjakan — scan bin di BC seperti biasa.
      </Notice>
    );
  } else if (data) {
    const pct = month ? progressPct(month) : null;
    body = (
      <div className="space-y-3">
        {month && month.totalBins > 0 && (
          <Card className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground">Bin dicek {monthLabel(data.day.slice(0, 7))}</p>
              <p className="text-sm font-bold tabular-nums text-foreground">
                {month.checkedBins.toLocaleString('id-ID')} / {month.totalBins.toLocaleString('id-ID')}
                <span className="ml-1 text-xs font-semibold text-muted-foreground">({formatPct(pct)})</span>
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
              <div className={cn('h-full rounded-full', TONES.active.dot)} style={{ width: `${pct ?? 0}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Sisa {pendingBins(month).toLocaleString('id-ID')} bin · bin yang sudah dicek tidak muncul lagi bulan ini.
            </p>
          </Card>
        )}

        {list && list.bins.length > 0 ? (
          <>
            <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Scan bin ini di BC, mulai dari nomor 1 — urutannya sudah disusun per lokasi.
            </p>
            <ol className="grid grid-cols-2 gap-2">
              {list.bins.map((bin) => {
                const look = LOOK[bin.status];
                const Icon = look.icon;
                return (
                  <li key={bin.binCode} className={cn('flex items-center gap-2 rounded-xl border px-2.5 py-2', look.tile)}>
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-bold tabular-nums text-muted-foreground">
                      {bin.position}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-all font-mono text-[13px] font-bold leading-tight text-foreground">{bin.binCode}</p>
                      <p className={cn('mt-0.5 text-[10px] font-semibold', look.text)}>
                        {bin.status === 'wrong' && bin.wrongCount > 0 ? `Salah · ${bin.wrongCount} item` : look.label}
                        {bin.status !== 'pending' && bin.checkedOn && bin.checkedOn !== data.day ? ` · ${shortDay(bin.checkedOn)}` : ''}
                      </p>
                    </div>
                    <Icon className={cn('h-4 w-4 flex-shrink-0', look.text)} />
                  </li>
                );
              })}
            </ol>
          </>
        ) : data.allChecked ? (
          <div className={cn('flex items-start gap-3 rounded-2xl border px-4 py-4', TONES.success.border, TONES.success.tint)}>
            <CheckCircle2 className={cn('mt-0.5 h-5 w-5 flex-shrink-0', TONES.success.text)} />
            <div className="min-w-0">
              <p className={cn('text-sm font-bold', TONES.success.strong)}>Semua bin bulan ini sudah dicek 🎉</p>
              <p className={cn('mt-0.5 text-xs leading-relaxed', TONES.success.text)}>
                Daftar baru mulai lagi tanggal 1 bulan depan.
              </p>
            </div>
          </div>
        ) : (
          <Notice tone="neutral" icon={CircleDashed}>Belum ada daftar bin untuk hari ini.</Notice>
        )}

        {data.resultsState && data.resultsState !== 'ok' && (
          <p className="px-1 text-[11px] text-muted-foreground">
            Status scan belum bisa diperbarui dari BC sekarang — coba muat ulang sebentar lagi.
          </p>
        )}
      </div>
    );
  }

  return (
    <Section
      title="Bin hari ini"
      meta={list?.bins.length ? `${list.checked}/${list.bins.length} di-scan` : undefined}
      action={refresh}
    >
      {body}
    </Section>
  );
}
