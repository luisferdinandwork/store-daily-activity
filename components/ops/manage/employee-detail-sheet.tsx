// components/ops/manage/employee-detail-sheet.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Building2,
  Calendar as CalendarIcon,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Infinity as InfinityIcon,
  Loader2,
  MapPin,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { HistoryItem, ManageEmployee, ManageStore, ScheduleDay, TransferPreview } from './types';

interface Props {
  employee: ManageEmployee;
  stores: ManageStore[];
  employeeTypes: Array<{ id: number; code: string; label: string }>;
  employeeRoleId: number;
  isHO: boolean;
  onClose: () => void;
  onTransferComplete: (toStoreId: number) => Promise<void> | void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hueFromString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function formatDateID(d: Date | string | null): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function dateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EmployeeDetailSheet({ employee, stores, employeeTypes, employeeRoleId, isHO, onClose, onTransferComplete }: Props) {
  const [tab, setTab] = useState<'transfer' | 'schedule' | 'history'>('transfer');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [schedule, setSchedule] = useState<ScheduleDay[]>([]);
  const [auxLoading, setAuxLoading] = useState(true);

  const h = hueFromString(employee.name);

  useEffect(() => {
    (async () => {
      setAuxLoading(true);
      try {
        const res = await fetch(`/api/ops/users/${employee.id}`);
        const json = await res.json();
        if (res.ok) {
          setHistory(json.history ?? []);
          setSchedule(json.schedule ?? []);
        }
      } catch { /* silent */ }
      finally { setAuxLoading(false); }
    })();
  }, [employee.id]);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full max-w-xl p-0 sm:max-w-xl">
        <div className="flex h-full flex-col">
          {/* ── Header ── */}
          <div className="relative shrink-0 overflow-hidden border-b border-slate-200 px-6 pb-5 pt-6 bg-gradient-to-br from-violet-50 to-white">
            <div className="flex items-start gap-4">
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white shadow-md ring-4 ring-white"
                style={{
                  background: `linear-gradient(135deg, hsl(${h} 65% 55%), hsl(${(h + 45) % 360} 70% 45%))`,
                }}
              >
                {initials(employee.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Karyawan</p>
                    <h2 className="mt-0.5 truncate text-xl font-bold tracking-tight text-slate-900">{employee.name}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      NIK {employee.nik}
                      {employee.employeeTypeLabel && (
                        <> {' · '}<span className="font-semibold text-slate-700">{employee.employeeTypeLabel}</span></>
                      )}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="gap-1 border-slate-200 bg-white px-1.5 py-0 text-[10px] font-semibold text-slate-700">
                    <Building2 className="h-2.5 w-2.5" />
                    {employee.storeName ?? 'Tanpa toko'}
                  </Badge>
                  {employee.areaName && (
                    <Badge variant="outline" className="gap-1 border-slate-200 bg-white px-1.5 py-0 text-[10px] text-slate-500">
                      <MapPin className="h-2.5 w-2.5" />
                      {employee.areaName}
                    </Badge>
                  )}
                  {employee.isTemporary && employee.effectiveTo && (
                    <Badge className="gap-1 bg-amber-100 px-1.5 py-0 text-[10px] font-bold text-amber-700 hover:bg-amber-100">
                      <CalendarClock className="h-2.5 w-2.5" />
                      Periode hingga {formatDateID(employee.effectiveTo)}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Tabs ── */}
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex flex-1 min-h-0 flex-col">
            <div className="shrink-0 border-b border-slate-200 bg-white px-6 pt-3">
              <TabsList className="grid w-full grid-cols-3 bg-slate-100">
                <TabsTrigger value="transfer" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:text-violet-700 data-[state=active]:shadow-sm">
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  Transfer
                </TabsTrigger>
                <TabsTrigger value="schedule" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:text-violet-700 data-[state=active]:shadow-sm">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  Jadwal
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:text-violet-700 data-[state=active]:shadow-sm">
                  <History className="h-3.5 w-3.5" />
                  Riwayat
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 min-h-0">
              <TabsContent value="transfer" className="m-0 h-full data-[state=inactive]:hidden">
                <TransferWizard
                  employee={employee}
                  stores={stores}
                  employeeTypes={employeeTypes}
                  employeeRoleId={employeeRoleId}
                  isHO={isHO}
                  onTransferComplete={onTransferComplete}
                />
              </TabsContent>
              <TabsContent value="schedule" className="m-0 h-full data-[state=inactive]:hidden">
                <SchedulePreview schedule={schedule} loading={auxLoading} />
              </TabsContent>
              <TabsContent value="history" className="m-0 h-full data-[state=inactive]:hidden">
                <HistoryView history={history} loading={auxLoading} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Transfer Wizard ──────────────────────────────────────────────────────────

type Step = 'destination' | 'period' | 'review';

function TransferWizard({ employee, stores, employeeTypes, employeeRoleId, isHO, onTransferComplete }: {
  employee: ManageEmployee;
  stores: ManageStore[];
  employeeTypes: Array<{ id: number; code: string; label: string }>;
  employeeRoleId: number;
  isHO: boolean;
  onTransferComplete: (toStoreId: number) => Promise<void> | void;
}) {
  const [step, setStep] = useState<Step>('destination');
  const [toStoreId, setToStoreId] = useState<number | null>(null);
  const [employeeTypeId, setEmployeeTypeId] = useState<string>(
    employee.employeeTypeId ? String(employee.employeeTypeId) : '',
  );
  const [mode, setMode] = useState<'permanent' | 'temporary'>('permanent');
  const [fromDate, setFromDate] = useState<Date>(() => new Date());
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const otherStores = useMemo(
    () => stores.filter((s) => s.id !== employee.homeStoreId),
    [stores, employee.homeStoreId],
  );

  const selectedStore = otherStores.find((s) => s.id === toStoreId) ?? null;
  const isCrossArea = selectedStore != null && employee.areaId != null && selectedStore.areaId !== employee.areaId;

  const storesByArea = useMemo(() => {
    const m = new Map<string, ManageStore[]>();
    for (const s of otherStores) {
      if (!m.has(s.areaName)) m.set(s.areaName, []);
      m.get(s.areaName)!.push(s);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [otherStores]);

  function canProceed(s: Step): boolean {
    if (s === 'destination') return !!toStoreId;
    if (s === 'period') return mode === 'permanent' || !!toDate;
    return false;
  }

  async function runPreview() {
    if (!toStoreId) return;
    setPreviewing(true);
    try {
      const res = await fetch('/api/ops/transfers/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: employee.id, toStoreId, roleId: employeeRoleId,
          employeeTypeId: employeeTypeId ? Number(employeeTypeId) : null,
          effectiveFrom: dateOnly(fromDate),
          effectiveTo: mode === 'temporary' && toDate ? dateOnly(toDate) : null,
          isTemporary: mode === 'temporary', notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Preview failed.');
      setPreview(json.preview);
      setStep('review');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed.');
    } finally { setPreviewing(false); }
  }

  async function submit() {
    if (!toStoreId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/ops/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: employee.id, toStoreId, roleId: employeeRoleId,
          employeeTypeId: employeeTypeId ? Number(employeeTypeId) : null,
          effectiveFrom: dateOnly(fromDate),
          effectiveTo: mode === 'temporary' && toDate ? dateOnly(toDate) : null,
          isTemporary: mode === 'temporary', notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Transfer failed.');
      toast.success(
        `${employee.name} dipindahkan${json.movedSchedules > 0 ? ` · ${json.movedSchedules} hari jadwal disesuaikan` : ''}`,
      );
      await onTransferComplete(toStoreId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Transfer failed.');
    } finally { setSubmitting(false); }
  }

  return (
    <ScrollArea className="h-full">
      <div className="px-6 py-5">
        <StepIndicator step={step} />

        <div className="mt-6">
          {step === 'destination' && (
            <DestinationStep
              storesByArea={storesByArea}
              employeeTypes={employeeTypes}
              toStoreId={toStoreId}
              setToStoreId={setToStoreId}
              employeeTypeId={employeeTypeId}
              setEmployeeTypeId={setEmployeeTypeId}
              isHO={isHO}
              isCrossArea={isCrossArea}
            />
          )}
          {step === 'period' && (
            <PeriodStep
              mode={mode} setMode={setMode}
              fromDate={fromDate} setFromDate={setFromDate}
              toDate={toDate} setToDate={setToDate}
              notes={notes} setNotes={setNotes}
            />
          )}
          {step === 'review' && preview && (
            <ReviewStep preview={preview} employee={employee} />
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
          {step === 'destination' ? (
            <span className="text-[11px] font-semibold text-slate-400">Langkah 1 dari 3</span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (step === 'period') setStep('destination');
                else if (step === 'review') { setPreview(null); setStep('period'); }
              }}
              className="gap-1 text-slate-500 hover:text-slate-700"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Kembali
            </Button>
          )}

          {step === 'destination' && (
            <Button onClick={() => setStep('period')} disabled={!canProceed('destination')}
              className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
              Lanjut <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
          {step === 'period' && (
            <Button onClick={runPreview} disabled={!canProceed('period') || previewing}
              className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
              {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Lihat dampak
            </Button>
          )}
          {step === 'review' && (
            <Button onClick={submit} disabled={submitting}
              className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Konfirmasi transfer
            </Button>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

// ─── Step UI ──────────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'destination', label: 'Tujuan' },
    { key: 'period', label: 'Periode' },
    { key: 'review', label: 'Konfirmasi' },
  ];
  const idx = steps.findIndex((s) => s.key === step);

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        return (
          <div key={s.key} className="flex flex-1 items-center gap-2">
            <div className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition',
              active && 'bg-violet-600 text-white',
              done && 'bg-violet-200 text-violet-700',
              !active && !done && 'border border-slate-200 text-slate-400',
            )}>
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span className={cn('text-xs font-semibold',
              active ? 'text-slate-900' : done ? 'text-slate-500' : 'text-slate-300',
            )}>{s.label}</span>
            {i < steps.length - 1 && (
              <div className={cn('h-px flex-1', done ? 'bg-violet-200' : 'bg-slate-100')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DestinationStep({ storesByArea, employeeTypes, toStoreId, setToStoreId, employeeTypeId, setEmployeeTypeId, isHO, isCrossArea }: {
  storesByArea: [string, ManageStore[]][];
  employeeTypes: Array<{ id: number; code: string; label: string }>;
  toStoreId: number | null;
  setToStoreId: (id: number | null) => void;
  employeeTypeId: string;
  setEmployeeTypeId: (s: string) => void;
  isHO: boolean;
  isCrossArea: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = useMemo(() => {
    for (const [, list] of storesByArea) {
      const found = list.find((s) => s.id === toStoreId);
      if (found) return `${found.name} · ${found.areaName}`;
    }
    return '';
  }, [storesByArea, toStoreId]);

  return (
    <div className="space-y-5">
      <div>
        <Label icon={Building2}>Toko tujuan</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox"
              className="h-11 w-full justify-between font-normal border-slate-200 hover:border-violet-300 focus-visible:ring-violet-400">
              {selectedLabel || <span className="text-slate-400">Pilih toko…</span>}
              <ChevronRight className="h-4 w-4 shrink-0 opacity-40" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Cari toko atau area…" />
              <CommandList>
                <CommandEmpty>Tidak ada toko.</CommandEmpty>
                {storesByArea.map(([areaName, list]) => (
                  <CommandGroup key={areaName} heading={areaName}>
                    {list.map((s) => (
                      <CommandItem
                        key={s.id}
                        value={`${s.name} ${s.areaName}`}
                        onSelect={() => { setToStoreId(s.id); setOpen(false); }}
                        className="gap-2"
                      >
                        <Building2 className="h-3.5 w-3.5 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{s.name}</p>
                          <p className="truncate text-[10px] text-slate-400">{s.address} · {s.employeeCount} karyawan</p>
                        </div>
                        {toStoreId === s.id && <Check className="h-3.5 w-3.5 text-violet-600" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {isCrossArea && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="text-[11px] font-bold text-amber-800">Pindah antar-area</p>
              <p className="mt-0.5 text-[10px] text-amber-700">Hanya OPS Head Office yang bisa melakukan ini. Pastikan ini disengaja.</p>
            </div>
          </div>
        )}
      </div>

      <div>
        <Label icon={Sparkles}>Tipe karyawan</Label>
        <Select value={employeeTypeId} onValueChange={setEmployeeTypeId}>
          <SelectTrigger className="h-11 focus:ring-violet-400">
            <SelectValue placeholder="Pilih tipe…" />
          </SelectTrigger>
          <SelectContent>
            {employeeTypes.map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function PeriodStep({ mode, setMode, fromDate, setFromDate, toDate, setToDate, notes, setNotes }: {
  mode: 'permanent' | 'temporary';
  setMode: (m: 'permanent' | 'temporary') => void;
  fromDate: Date;
  setFromDate: (d: Date) => void;
  toDate: Date | undefined;
  setToDate: (d: Date | undefined) => void;
  notes: string;
  setNotes: (s: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <Label icon={Clock}>Tipe transfer</Label>
        <div className="grid grid-cols-2 gap-2">
          <ModeCard
            active={mode === 'permanent'}
            onClick={() => setMode('permanent')}
            icon={<InfinityIcon className="h-4 w-4" />}
            title="Permanen"
            description="Penempatan tetap tanpa batas waktu."
          />
          <ModeCard
            active={mode === 'temporary'}
            onClick={() => setMode('temporary')}
            icon={<CalendarClock className="h-4 w-4" />}
            title="Periode"
            description="Otomatis kembali setelah tanggal berakhir."
          />
        </div>
      </div>

      <div className={cn('grid gap-3', mode === 'temporary' ? 'grid-cols-2' : 'grid-cols-1')}>
        <div>
          <Label icon={CalendarIcon}>Mulai</Label>
          <DatePicker date={fromDate} setDate={(d) => d && setFromDate(d)} />
        </div>
        {mode === 'temporary' && (
          <div>
            <Label icon={CalendarIcon}>Berakhir</Label>
            <DatePicker date={toDate} setDate={setToDate} minDate={fromDate} placeholder="Pilih tanggal akhir" />
          </div>
        )}
      </div>

      <div>
        <Label>Catatan untuk tim absensi</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Mis. rotasi bulanan, cover karyawan cuti, dsb."
          className="resize-none text-sm focus-visible:ring-violet-400"
        />
      </div>
    </div>
  );
}

function ReviewStep({ preview, employee }: { preview: TransferPreview; employee: ManageEmployee }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Pemindahan</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Dari</p>
            <p className="mt-0.5 truncate text-sm font-bold text-slate-600">{preview.fromStore?.name ?? '—'}</p>
            {preview.fromStore?.areaName && <p className="truncate text-[10px] text-slate-400">{preview.fromStore.areaName}</p>}
          </div>
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100">
            <ArrowRight className="h-3.5 w-3.5 text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ke</p>
            <p className="mt-0.5 truncate text-sm font-bold text-slate-900">{preview.toStore.name}</p>
            {preview.toStore.areaName && <p className="truncate text-[10px] text-slate-400">{preview.toStore.areaName}</p>}
          </div>
        </div>

        <Separator className="my-4" />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tipe</p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">{preview.mode === 'temporary' ? 'Periode' : 'Permanen'}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Periode</p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">
              {formatDateID(preview.effectiveFrom)}
              {preview.effectiveTo && (
                <><span className="mx-1 text-slate-400">→</span>{formatDateID(preview.effectiveTo)}</>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Impact */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700">Dampak ke jadwal</p>
        <div className="mt-3 space-y-2.5">
          <ImpactRow
            label="Hari jadwal dipindah"
            value={preview.affectedScheduleCount}
            hint={preview.affectedScheduleCount > 0 ? 'Shift dipertahankan (pagi tetap pagi).' : 'Tidak ada jadwal mendatang.'}
          />
          {preview.attendanceToWipeCount > 0 && (
            <ImpactRow
              label="Absensi dihapus"
              value={preview.attendanceToWipeCount}
              hint="Karyawan check-in ulang di toko baru."
              tone="rose"
            />
          )}
          {preview.crossArea && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-100/70 px-3 py-2">
              <Globe2Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
              <p className="text-[11px] font-semibold text-amber-800">Pemindahan lintas area — pastikan tim area tujuan diberi tahu.</p>
            </div>
          )}
        </div>

        {preview.affectedDates.length > 0 && (
          <div className="mt-3 border-t border-amber-200 pt-3">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
              {preview.affectedDates.length} tanggal terdampak
            </p>
            <div className="flex flex-wrap gap-1">
              {preview.affectedDates.slice(0, 12).map((d) => (
                <span key={d} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-amber-200">
                  {formatDateID(d)}
                </span>
              ))}
              {preview.affectedDates.length > 12 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                  +{preview.affectedDates.length - 12} lagi
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Schedule preview ─────────────────────────────────────────────────────────

function SchedulePreview({ schedule, loading }: { schedule: ScheduleDay[]; loading: boolean }) {
  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
    </div>
  );

  if (schedule.length === 0) return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
      <CalendarIcon className="mb-2 h-6 w-6 text-slate-300" />
      <p className="text-sm font-bold text-slate-600">Belum ada jadwal mendatang</p>
      <p className="mt-1 max-w-xs text-xs text-slate-400">Tidak ada entry jadwal untuk 60 hari ke depan.</p>
    </div>
  );

  const byMonth = new Map<string, ScheduleDay[]>();
  for (const d of schedule) {
    const date = new Date(d.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(d);
  }

  function shiftBadge(d: ScheduleDay) {
    if (d.isLeave) return { label: 'Cuti', cls: 'bg-indigo-100 text-indigo-700' };
    if (d.isOff) return { label: 'Off', cls: 'bg-slate-100 text-slate-500' };
    if (d.shiftCode === 'morning') return { label: 'Pagi', cls: 'bg-orange-100 text-orange-700' };
    if (d.shiftCode === 'evening') return { label: 'Sore', cls: 'bg-violet-100 text-violet-700' };
    if (d.shiftCode === 'full_day') return { label: 'Full', cls: 'bg-emerald-100 text-emerald-700' };
    return { label: '—', cls: 'bg-slate-100 text-slate-500' };
  }

  return (
    <ScrollArea className="h-full">
      <div className="px-6 py-5">
        <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">60 hari ke depan</p>
        <div className="space-y-5">
          {[...byMonth.entries()].map(([key, days]) => {
            const [y, m] = key.split('-').map(Number);
            const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
            return (
              <div key={key}>
                <p className="mb-2 text-xs font-bold capitalize text-slate-700">{monthLabel}</p>
                <div className="space-y-1">
                  {days.map((d) => {
                    const badge = shiftBadge(d);
                    const dt = new Date(d.date);
                    return (
                      <div key={d.date} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2">
                        <div className="text-center">
                          <p className="text-[9px] font-bold uppercase text-slate-400">{dt.toLocaleDateString('id-ID', { weekday: 'short' })}</p>
                          <p className="text-sm font-bold tabular-nums text-slate-800">{dt.getDate()}</p>
                        </div>
                        <Separator orientation="vertical" className="h-8" />
                        <p className="flex-1 text-xs text-slate-500">{dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })}</p>
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', badge.cls)}>{badge.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}

// ─── History ──────────────────────────────────────────────────────────────────

function HistoryView({ history, loading }: { history: HistoryItem[]; loading: boolean }) {
  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
    </div>
  );

  if (history.length === 0) return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
      <History className="mb-2 h-6 w-6 text-slate-300" />
      <p className="text-sm font-bold text-slate-600">Belum ada riwayat</p>
      <p className="mt-1 text-xs text-slate-400">Karyawan ini belum pernah dipindah.</p>
    </div>
  );

  return (
    <ScrollArea className="h-full">
      <div className="px-6 py-5">
        <ol className="relative space-y-3 border-l-2 border-slate-100 pl-5">
          {history.map((item, idx) => (
            <li key={item.id} className="relative">
              <div className={cn(
                'absolute -left-[27px] top-2.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white',
                item.isActive ? 'bg-violet-600' : 'bg-slate-300',
              )}>
                {item.isActive && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
              </div>

              <div className={cn(
                'rounded-xl border px-3.5 py-3',
                item.isActive ? 'border-violet-200 bg-violet-50/40' : 'border-slate-100 bg-white',
              )}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900">
                      {item.storeName ?? '—'}
                      {item.areaName && <span className="ml-1.5 font-semibold text-slate-400">· {item.areaName}</span>}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {item.employeeTypeLabel && (
                        <Badge variant="outline" className="border-slate-200 bg-white px-1.5 py-0 text-[10px] font-semibold text-slate-600">
                          {item.employeeTypeLabel}
                        </Badge>
                      )}
                      {item.isTemporary && (
                        <Badge className="bg-amber-100 px-1.5 py-0 text-[10px] font-bold text-amber-700 hover:bg-amber-100">Periode</Badge>
                      )}
                      {item.revertedAt && (
                        <Badge variant="outline" className="border-slate-200 px-1.5 py-0 text-[10px] text-slate-500">Sudah revert</Badge>
                      )}
                    </div>
                  </div>
                  <Badge className={cn(
                    'shrink-0 px-1.5 py-0 text-[9px] font-bold uppercase',
                    item.isActive ? 'bg-violet-600 text-white hover:bg-violet-600' : 'bg-slate-200 text-slate-600 hover:bg-slate-200',
                  )}>
                    {item.isActive ? 'Aktif' : `#${idx + 1}`}
                  </Badge>
                </div>

                <p className="mt-2 text-[11px] font-semibold text-slate-500">
                  {formatDateID(item.effectiveFrom)}
                  <span className="mx-1 text-slate-300">→</span>
                  {formatDateID(item.effectiveTo)}
                </p>

                {(item.previousStoreName || item.assignedByName || item.notes) && (
                  <div className="mt-2 space-y-1 border-t border-slate-200/60 pt-2">
                    {item.previousStoreName && (
                      <p className="text-[10px] text-slate-500">Dari <span className="font-semibold text-slate-700">{item.previousStoreName}</span></p>
                    )}
                    {item.assignedByName && (
                      <p className="text-[10px] text-slate-500">Oleh <span className="font-semibold text-slate-700">{item.assignedByName}</span></p>
                    )}
                    {item.notes && <p className="text-[10px] italic text-slate-500">&ldquo;{item.notes}&rdquo;</p>}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </ScrollArea>
  );
}

// ─── Small reusable bits ──────────────────────────────────────────────────────

function Label({ children, icon: Icon }: { children: React.ReactNode; icon?: any }) {
  return (
    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </p>
  );
}

function ModeCard({ active, onClick, icon, title, description }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition',
        active ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/30',
      )}
    >
      <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg', active ? 'bg-white/15' : 'bg-slate-100')}>
        {icon}
      </div>
      <div>
        <p className={cn('text-sm font-bold', active ? 'text-white' : 'text-slate-900')}>{title}</p>
        <p className={cn('mt-0.5 text-[10px] leading-tight', active ? 'text-violet-200' : 'text-slate-500')}>{description}</p>
      </div>
      {active && (
        <div className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-white">
          <Check className="h-2.5 w-2.5 text-violet-600" />
        </div>
      )}
    </button>
  );
}

function ImpactRow({ label, value, hint, tone }: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'rose';
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={cn(
        'flex h-9 w-12 shrink-0 items-center justify-center rounded-lg text-sm font-black tabular-nums',
        tone === 'rose' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700',
      )}>
        {value}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('text-xs font-bold', tone === 'rose' ? 'text-rose-900' : 'text-amber-900')}>{label}</p>
        {hint && <p className={cn('mt-0.5 text-[10px] font-semibold', tone === 'rose' ? 'text-rose-700' : 'text-amber-700')}>{hint}</p>}
      </div>
    </div>
  );
}

function DatePicker({ date, setDate, minDate, placeholder = 'Pilih tanggal' }: {
  date: Date | undefined;
  setDate: (d: Date | undefined) => void;
  minDate?: Date;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('h-11 w-full justify-start gap-2 font-normal border-slate-200 hover:border-violet-300', !date && 'text-slate-400')}>
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-60" />
          {date ? formatDateID(date) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => { setDate(d); setOpen(false); }}
          disabled={minDate ? (d) => d < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()) : undefined}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

function Globe2Icon(props: any) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25" />
      <path d="m8 16 1.5 1.5L12 15" />
    </svg>
  );
}