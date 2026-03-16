// components/ops/AttendanceExportModal.tsx
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Download,
  CalendarDays,
  Loader2,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  stores?: { id: string; name: string }[];
}

type QuickRange = '7d' | '14d' | '30d' | 'this_month' | 'last_month' | 'custom';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getQuickRange(key: QuickRange): { from: string; to: string } | null {
  const today = new Date();
  const to    = toDateStr(today);

  if (key === '7d') {
    const from = new Date(today); from.setDate(today.getDate() - 6);
    return { from: toDateStr(from), to };
  }
  if (key === '14d') {
    const from = new Date(today); from.setDate(today.getDate() - 13);
    return { from: toDateStr(from), to };
  }
  if (key === '30d') {
    const from = new Date(today); from.setDate(today.getDate() - 29);
    return { from: toDateStr(from), to };
  }
  if (key === 'this_month') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: toDateStr(from), to };
  }
  if (key === 'last_month') {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last  = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: toDateStr(first), to: toDateStr(last) };
  }
  return null;
}

function dayCount(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to   + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

const QUICK_RANGES: { key: QuickRange; label: string }[] = [
  { key: '7d',         label: 'Last 7 days'  },
  { key: '14d',        label: 'Last 14 days' },
  { key: '30d',        label: 'Last 30 days' },
  { key: 'this_month', label: 'This month'   },
  { key: 'last_month', label: 'Last month'   },
  { key: 'custom',     label: 'Custom range' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AttendanceExportModal({ open, onClose, stores = [] }: Props) {
  const today = toDateStr(new Date());

  const [quickRange, setQuickRange] = useState<QuickRange>('this_month');
  const [fromDate,   setFromDate]   = useState(() => {
    const r = getQuickRange('this_month');
    return r?.from ?? today;
  });
  const [toDate,     setToDate]     = useState(today);
  const [storeId,    setStoreId]    = useState('all');
  const [shift,      setShift]      = useState('all');
  const [status,     setStatus]     = useState('all');

  const [exporting,  setExporting]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [success,    setSuccess]    = useState(false);

  // Apply a quick range preset
  const applyQuickRange = (key: QuickRange) => {
    setQuickRange(key);
    const r = getQuickRange(key);
    if (r) { setFromDate(r.from); setToDate(r.to); }
  };

  const days  = dayCount(fromDate, toDate);
  const valid = fromDate <= toDate && days <= 90;

  const handleExport = async () => {
    setError(null);
    setSuccess(false);
    setExporting(true);

    try {
      const params = new URLSearchParams({
        fromDate,
        toDate,
        ...(storeId !== 'all' && { storeId }),
        ...(shift   !== 'all' && { shift   }),
        ...(status  !== 'all' && { status  }),
      });

      const res = await fetch(`/api/ops/attendance/export?${params}`);

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Server error ${res.status}`);
      }

      // Trigger browser download
      const blob     = await res.blob();
      const url      = URL.createObjectURL(blob);
      const anchor   = document.createElement('a');
      anchor.href    = url;
      anchor.download = `attendance_${fromDate}_to_${toDate}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div className="bg-primary px-6 py-5">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
                <FileSpreadsheet className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-primary-foreground">
                  Export Attendance
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs text-primary-foreground/60">
                  Download as Excel (.xlsx) with summary sheet
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-5 p-6">
          {/* Quick range pills */}
          <div>
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Quick Select
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_RANGES.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyQuickRange(key)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-all',
                    quickRange === key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-secondary text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Date range inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="from" className="mb-1.5 block text-xs font-semibold">
                From
              </Label>
              <div className="relative">
                <CalendarDays className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="from"
                  type="date"
                  value={fromDate}
                  max={toDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setQuickRange('custom');
                  }}
                  className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="to" className="mb-1.5 block text-xs font-semibold">
                To
              </Label>
              <div className="relative">
                <CalendarDays className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="to"
                  type="date"
                  value={toDate}
                  min={fromDate}
                  max={toDateStr(new Date())}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setQuickRange('custom');
                  }}
                  className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Day count indicator */}
          <div className={cn(
            'flex items-center justify-between rounded-lg px-3 py-2 text-xs',
            !valid
              ? 'bg-destructive/10 text-destructive'
              : 'bg-secondary text-muted-foreground',
          )}>
            <span>
              {!valid
                ? days > 90
                  ? `Range too large (${days} days) — max 90 days`
                  : 'Invalid date range'
                : `${days} day${days !== 1 ? 's' : ''} selected`
              }
            </span>
            {valid && (
              <span className="font-medium text-foreground">
                {new Date(fromDate + 'T00:00:00').toLocaleDateString('en-ID', { day: 'numeric', month: 'short' })}
                {' — '}
                {new Date(toDate   + 'T00:00:00').toLocaleDateString('en-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>

          {/* Filters */}
          <div className="space-y-3">
            <Label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Filters (optional)
            </Label>

            <div className="grid grid-cols-3 gap-2">
              {/* Store */}
              {stores.length > 1 && (
                <div className="col-span-3">
                  <Label className="mb-1 block text-xs text-muted-foreground">Store</Label>
                  <Select value={storeId} onValueChange={setStoreId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="All Stores" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Stores</SelectItem>
                      {stores.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Shift */}
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Shift</Label>
                <Select value={shift} onValueChange={setShift}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="morning">Morning</SelectItem>
                    <SelectItem value="evening">Evening</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Status */}
              <div className="col-span-2">
                <Label className="mb-1 block text-xs text-muted-foreground">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="present">Present</SelectItem>
                    <SelectItem value="late">Late</SelectItem>
                    <SelectItem value="absent">Absent</SelectItem>
                    <SelectItem value="excused">Excused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Error / success */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2.5 text-xs text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              File downloaded successfully!
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={exporting}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 gap-2"
              disabled={!valid || exporting}
              onClick={handleExport}
            >
              {exporting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
              ) : (
                <><Download className="h-4 w-4" /> Download Excel</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}