'use client';
// components/ops/dashboard/TodayCards.tsx
//
// The top of the Ops Dashboard: today's Attendance Rate and today's Completion Rate, each with
// the five stores that need the most attention listed under it ("FF001 - Store name", rate on
// the right). Shared by the desktop panel and the phone layout.

import { ListChecks, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import { STATUS } from '@/components/status/AttendanceStatus';
import { showedUp } from '@/lib/attendance-health';
import { storesBehind, type DashboardData } from '@/lib/ops-dashboard';
import { RateCard, type AttentionRow } from './widgets';

export default function TodayCards({
  data,
  loading,
  className,
}: {
  data: DashboardData | null;
  loading: boolean;
  className?: string;
}) {
  const att = data?.attendance;
  const today = data?.tasks.today;
  const behind = storesBehind(data);

  const attendanceRows: AttentionRow[] = behind.attendance.map((s) => ({
    key: s.storeId,
    storeNo: s.storeNo,
    name: s.storeName,
    rate: s.rate,
    // A store with no shift today already says "No shift" in the chip; its detail is the roster size.
    detail:
      s.total > 0
        ? `${showedUp(s)}/${s.total}${s.noSchedule > 0 ? ` · ${s.noSchedule} ${STATUS.not_scheduled.label.toLowerCase()}` : ''}`
        : s.noSchedule > 0
          ? `${s.noSchedule} staff`
          : undefined,
  }));

  const taskRows: AttentionRow[] = behind.tasks.map((s) => ({
    key: String(s.storeId),
    storeNo: s.storeNo,
    name: s.storeName,
    rate: s.completionRate,
    detail: `${s.completed}/${s.total} task`,
  }));

  return (
    <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-4 lg:gap-5', className)}>
      <RateCard
        icon={Users}
        label="Attendance Rate"
        subtitle="Today · Present + Late of scheduled"
        rate={att?.rate ?? 0}
        caption={
          att && att.total > 0
            ? `${showedUp(att)} of ${att.total} scheduled have checked in`
            : 'Belum ada shift terjadwal hari ini'
        }
        rows={attendanceRows}
        total={behind.attendanceTotal}
        href="/ops/attendance"
        emptyText="Semua toko hadir lengkap dan terjadwal hari ini"
        loading={loading}
      />
      <RateCard
        icon={ListChecks}
        label="Completion Rate"
        subtitle="Today · Tasks completed"
        rate={today?.completionRate ?? 0}
        caption={
          today && today.total > 0
            ? `${today.completed} of ${today.total} tasks done`
            : 'Belum ada task hari ini'
        }
        rows={taskRows}
        total={behind.tasksTotal}
        href="/ops/tasks/progress"
        emptyText="Semua toko sudah menyelesaikan task hari ini"
        loading={loading}
      />
    </div>
  );
}
