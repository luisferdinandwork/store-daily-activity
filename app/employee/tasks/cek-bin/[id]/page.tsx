'use client';
// app/employee/tasks/cek-bin/[id]/page.tsx

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Box, Check, ChevronDown, RefreshCw, Save, Search, X } from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { useTaskLocationSetting } from '@/lib/hooks/useTaskLocationSetting';
import {
  AccessBanner, LockedOverlay, TaskHeader, TaskSubmitBar, SaveIndicator, shiftLabel,
} from '@/components/employee/tasks';
import {
  ActionButton, EmptyState, Notice, NotesField, PageBody, Section, SkeletonBlocks,
  SummaryBox, TaskReviewNotices, inputClass,
} from '@/components/employee/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'verified' | 'rejected' | 'pending';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface BinItem {
  id: string; storeId: string; bin: string;
  qtyBc: number; qtySesuaiBin: number; qtyTidakSesuaiBin: number; nama: string;
}

interface CheckedBin {
  id: string; taskId: string; binId: string; bin: string;
  qtyBc: number; qtySesuaiBin: number; qtyTidakSesuaiBin: number;
  nama: string; notes: string | null;
}

interface SelectedBinDraft {
  binId: number; qtyBc: number; qtySesuaiBin: number; qtyTidakSesuaiBin: number; notes?: string;
}

interface CekBinData {
  id: string; scheduleId: string; userId?: string; storeId: string;
  shift: string; date: string; status: TaskStatus; notes: string | null;
  completedAt: string | null; verifiedBy?: string | null; verifiedAt: string | null;
  totalStoreBins: number; minimumBinsToCheck: number; checkedBinsCount: number;
  availableBins: BinItem[]; checkedBins: CheckedBin[]; selectedBinIds: string[];
}

// ─── Geo hook ─────────────────────────────────────────────────────────────────

function useGeo(required: boolean) {
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);
  const refresh = useCallback(() => {
    if (!required) { setGeo(null); setGeoError(null); setGeoReady(true); return; }
    setGeoReady(false); setGeoError(null);
    if (!navigator.geolocation) { setGeoError('Geolocation tidak didukung.'); setGeoReady(true); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoReady(true); },
      ()  => { setGeoError('Lokasi tidak dapat diperoleh.'); setGeoReady(true); },
      { timeout: 10_000, maximumAge: 0 },
    );
  }, [required]);
  useEffect(() => { refresh(); }, [refresh]);
  return { geo, geoError, geoReady, refresh };
}

// ─── Access hook ──────────────────────────────────────────────────────────────

function useAccessStatus(scheduleId: string, storeId: string, geo: { lat: number; lng: number } | null, geoReady: boolean, taskStatus?: TaskStatus) {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const check = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) { setAccessStatus({ status: 'ok' }); setAccessLoading(false); return; }
    if (!scheduleId || !storeId) return;
    setAccessLoading(true);
    try {
      const p = new URLSearchParams({ scheduleId, storeId });
      if (geo) { p.set('lat', String(geo.lat)); p.set('lng', String(geo.lng)); }
      setAccessStatus(await fetch(`/api/employee/tasks/access?${p}`).then(r => r.json()) as AccessStatus);
    } catch { setAccessStatus({ status: 'geo_unavailable' }); }
    finally { setAccessLoading(false); }
  }, [scheduleId, storeId, geo, taskStatus]);
  useEffect(() => { if (geoReady) check(); }, [geoReady, check]);
  return { accessStatus, accessLoading, refreshAccess: check };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNonNegativeInt(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

// ─── Quantity input ───────────────────────────────────────────────────────────

function QuantityInput({ label, value, onChange, disabled }: {
  label: string; value: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="block truncate px-0.5 text-[11px] font-medium text-muted-foreground">{label}</span>
      <input type="number" min="0" inputMode="numeric" value={value} disabled={disabled}
        onChange={e => onChange(toNonNegativeInt(e.target.value))}
        className={cn(inputClass, 'h-11 px-3 text-center font-semibold tabular-nums')}
      />
    </label>
  );
}

// ─── Bin card ─────────────────────────────────────────────────────────────────
// Outer row is <div role="button"> so the chevron <button> inside is valid HTML.

function QtyStrip({ items, tone = 'neutral' }: { items: { label: string; val: number }[]; tone?: 'neutral' | 'primary' }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-border border-t border-border text-center">
      {items.map(({ label, val }) => (
        <div key={label} className={cn('py-2', tone === 'primary' ? 'bg-primary/[0.04]' : 'bg-secondary/50')}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{val}</p>
        </div>
      ))}
    </div>
  );
}

function BinCard({ bin, selected, isOpen, disabled, onToggle, onToggleOpen, onUpdate }: {
  bin: BinItem; selected: SelectedBinDraft | undefined;
  isOpen: boolean; disabled: boolean;
  onToggle: () => void; onToggleOpen: () => void;
  onUpdate: (patch: Partial<SelectedBinDraft>) => void;
}) {
  const isSelected = Boolean(selected);

  return (
    <article className={cn(
      'overflow-hidden rounded-xl border bg-card transition-colors',
      isSelected ? 'border-primary/40' : 'border-border',
    )}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-pressed={isSelected}
        onClick={() => !disabled && onToggle()}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && !disabled && onToggle()}
        className={cn(
          'flex w-full cursor-pointer select-none items-center gap-3 px-3.5 py-3.5 text-left transition active:bg-secondary',
          isSelected && 'bg-primary/[0.03]',
          disabled && 'cursor-default opacity-60',
        )}
      >
        <span className={cn(
          'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          isSelected ? 'border-primary bg-primary' : 'border-border bg-background',
        )}>
          {isSelected && <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-mono text-sm font-bold text-foreground">{bin.bin}</p>
            {isSelected && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Dicek</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{bin.nama}</p>
        </div>

        {isSelected && !disabled && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onToggleOpen(); }}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-secondary transition-colors active:bg-border"
            aria-label={isOpen ? 'Tutup detail' : 'Buka detail'}
          >
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
          </button>
        )}
      </div>

      {/* Default qty (from master data) */}
      <QtyStrip
        tone={isSelected ? 'primary' : 'neutral'}
        items={[
          { label: 'Qty BC',       val: bin.qtyBc             },
          { label: 'Sesuai',       val: bin.qtySesuaiBin      },
          { label: 'Tidak sesuai', val: bin.qtyTidakSesuaiBin },
        ]}
      />

      {/* Editable qty inputs (when selected + open) */}
      {isSelected && isOpen && selected && (
        <div className="space-y-3 border-t border-border px-3.5 py-3.5">
          <div className="grid grid-cols-3 gap-2">
            <QuantityInput label="Qty BC"       value={selected.qtyBc}             disabled={disabled} onChange={v => onUpdate({ qtyBc: v })} />
            <QuantityInput label="Sesuai"       value={selected.qtySesuaiBin}      disabled={disabled} onChange={v => onUpdate({ qtySesuaiBin: v })} />
            <QuantityInput label="Tidak sesuai" value={selected.qtyTidakSesuaiBin} disabled={disabled} onChange={v => onUpdate({ qtyTidakSesuaiBin: v })} />
          </div>
          <label className="block space-y-1">
            <span className="px-0.5 text-[11px] font-medium text-muted-foreground">Catatan BIN ini</span>
            <textarea value={selected.notes ?? ''} disabled={disabled} rows={2}
              onChange={e => onUpdate({ notes: e.target.value })}
              placeholder="Opsional…"
              className="w-full resize-none rounded-xl border border-border bg-secondary px-3.5 py-2.5 text-base outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
            />
          </label>
        </div>
      )}
    </article>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CekBinDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { requiresLocation } = useTaskLocationSetting('cek_bin');
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo(requiresLocation);

  const [taskData,     setTaskData]     = useState<CekBinData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState<string | null>(null);
  const [selectedBins, setSelectedBins] = useState<SelectedBinDraft[]>([]);
  const [notes,        setNotes]        = useState('');
  const [search,       setSearch]       = useState('');
  const [expandedId,   setExpandedId]   = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      const data = await res.json() as { tasks: { type: string; data: CekBinData }[] };
      const found = data.tasks?.find(t => t.type === 'cek_bin' && t.data.id === taskId);
      if (!found) { setTaskData(null); return; }
      const d = found.data;
      setTaskData(d);
      setNotes(d.notes ?? '');
      const restored = d.checkedBins.map(b => ({
        binId: Number(b.binId), qtyBc: b.qtyBc ?? 0,
        qtySesuaiBin: b.qtySesuaiBin ?? 0, qtyTidakSesuaiBin: b.qtyTidakSesuaiBin ?? 0,
        notes: b.notes ?? undefined,
      }));
      setSelectedBins(restored);
      setExpandedId(restored[0]?.binId ?? null);
    } catch (e) {
      console.error('[CekBinDetailPage] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '', taskData?.storeId ?? '', geo, geoReady, taskData?.status,
  );

  const taskIdNum = taskData ? Number(taskData.id) : 0;
  const { status: saveStatus, lastSaved, save: autoSave } = useAutoSave({
    url: '/api/employee/tasks/cek-bin', baseBody: { taskId: taskIdNum }, debounceMs: 700,
  });

  const taskStatus = taskData?.status;
  const readonly   = taskStatus === 'completed' || taskStatus === 'verified';
  const locked     = !readonly && !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');
  const dis = readonly || locked;

  const selectedById       = useMemo(() => new Map(selectedBins.map(b => [b.binId, b])), [selectedBins]);
  const totalStoreBins     = taskData?.totalStoreBins     || taskData?.availableBins.length || 0;
  const minimumBinsToCheck = taskData?.minimumBinsToCheck || Math.ceil(totalStoreBins * 0.3);
  const selectedCount      = selectedBins.length;
  const meetsMin           = selectedCount >= minimumBinsToCheck;

  const filteredBins = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bins = taskData?.availableBins ?? [];
    return q ? bins.filter(b => b.bin.toLowerCase().includes(q) || b.nama.toLowerCase().includes(q)) : bins;
  }, [taskData?.availableBins, search]);

  const canSubmit = !locked && !!taskData && totalStoreBins > 0 && meetsMin &&
    selectedBins.every(b =>
      Number.isInteger(b.qtyBc) && b.qtyBc >= 0 &&
      Number.isInteger(b.qtySesuaiBin) && b.qtySesuaiBin >= 0 &&
      Number.isInteger(b.qtyTidakSesuaiBin) && b.qtyTidakSesuaiBin >= 0,
    );

  function persistSelected(next: SelectedBinDraft[]) {
    setSelectedBins(next);
    autoSave({ selectedBins: next });
  }

  function toggleBin(bin: BinItem) {
    if (dis) return;
    const id = Number(bin.id);
    if (selectedById.has(id)) {
      const next = selectedBins.filter(b => b.binId !== id);
      persistSelected(next);
      if (expandedId === id) setExpandedId(next[0]?.binId ?? null);
    } else {
      const next = [...selectedBins, { binId: id, qtyBc: bin.qtyBc ?? 0, qtySesuaiBin: bin.qtySesuaiBin ?? 0, qtyTidakSesuaiBin: bin.qtyTidakSesuaiBin ?? 0 }];
      persistSelected(next);
      setExpandedId(id);
    }
  }

  function updateSelectedBin(binId: number, patch: Partial<SelectedBinDraft>) {
    persistSelected(selectedBins.map(b => b.binId === binId ? { ...b, ...patch } : b));
  }

  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null); setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/cek-bin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: Number(taskData.scheduleId), storeId: Number(taskData.storeId),
          geo: geo ?? null, skipGeo: geo === null, selectedBins, notes: notes || undefined,
        }),
      });
      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();
      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        setSubmitError(msg); toast.error(msg, { duration: 6000 }); return;
      }
      toast.success('Cek BIN berhasil disubmit! ✓', { duration: 4000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal terhubung ke server.';
      setSubmitError(msg); toast.error(msg, { duration: 6000 });
    } finally { setSubmitting(false); }
  }

  const submitHint = !taskData || locked ? '' :
    totalStoreBins === 0 ? 'Belum ada data BIN aktif untuk store ini.' :
    !meetsMin ? `Pilih minimal ${minimumBinsToCheck} BIN dari total ${totalStoreBins} BIN aktif.` : '';

  return (
    <>
      <TaskHeader
        title="Cek BIN"
        subtitle={shiftLabel(taskData?.shift)}
        status={taskStatus}
        saveIndicator={
          !readonly && !loading && taskData ? (
            <SaveIndicator status={saveStatus} lastSaved={lastSaved ?? null} />
          ) : null
        }
      />

      <PageBody bottomBar={!readonly && !loading && !!taskData}>
        {!readonly && !loading && taskData && (
          <AccessBanner accessStatus={accessStatus} accessLoading={accessLoading} geoReady={geoReady}
            geo={geo} geoError={geoError} onRefreshGeo={refreshGeo} onRefreshAccess={refreshAccess}
            requireGeo={requiresLocation} allowWithoutGeo />
        )}

        {submitError && (
          <Notice tone="error" title="Submit gagal" onDismiss={() => setSubmitError(null)}>
            {submitError}
          </Notice>
        )}

        <TaskReviewNotices status={taskStatus} notes={taskData?.notes} verifiedAt={taskData?.verifiedAt} />

        {!readonly && !locked && !loading && taskData && (
          <Notice tone="info" icon={Save}>
            Perubahan otomatis tersimpan. Rekan shift lain dapat melanjutkan task ini.
          </Notice>
        )}

        {loading ? (
          <SkeletonBlocks count={4} className="h-24" />
        ) : !taskData ? (
          <EmptyState icon={Box} title="Task tidak ditemukan" description="Task ini mungkin sudah tidak tersedia untuk jadwalmu hari ini." />
        ) : (
          <div className="relative space-y-5">
            {!readonly && <LockedOverlay accessStatus={accessStatus} requireGeo={requiresLocation} allowWithoutGeo />}

            {/* Progress */}
            <SummaryBox>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'Total BIN', val: totalStoreBins },
                  { label: 'Minimum',   val: minimumBinsToCheck },
                  { label: 'Dipilih',   val: selectedCount },
                ].map(({ label, val }) => (
                  <div key={label}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">{label}</p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{val}</p>
                  </div>
                ))}
              </div>
              <p className={cn(
                'border-t border-primary/15 pt-2.5 text-center text-xs font-semibold',
                meetsMin ? 'text-green-700' : 'text-amber-700',
              )}>
                {meetsMin
                  ? `${selectedCount} BIN dipilih — syarat terpenuhi ✓`
                  : `Pilih minimal ${minimumBinsToCheck} BIN (30% dari ${totalStoreBins})`}
              </p>
            </SummaryBox>

            {/* BIN list */}
            <Section title="Daftar BIN" meta={taskData.availableBins.length ? `${taskData.availableBins.length} BIN` : undefined}>
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Cari BIN atau nama barang…"
                    className={cn(inputClass, 'h-11 pl-10 pr-10')} />
                  {search && (
                    <button onClick={() => setSearch('')} aria-label="Hapus pencarian"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {taskData.availableBins.length === 0 ? (
                  <EmptyState
                    icon={Box}
                    title="Belum ada BIN aktif"
                    description="Hubungi admin/OPS untuk mengisi data BIN master store ini."
                    action={<ActionButton variant="secondary" icon={RefreshCw} onClick={load}>Muat ulang</ActionButton>}
                  />
                ) : filteredBins.length === 0 ? (
                  <p className="rounded-xl bg-secondary px-4 py-8 text-center text-sm text-muted-foreground">
                    Tidak ada BIN yang cocok dengan pencarian.
                  </p>
                ) : (
                  filteredBins.map(bin => {
                    const id = Number(bin.id);
                    return (
                      <BinCard key={bin.id} bin={bin}
                        selected={selectedById.get(id)}
                        isOpen={expandedId === id}
                        disabled={dis}
                        onToggle={() => toggleBin(bin)}
                        onToggleOpen={() => setExpandedId(p => p === id ? null : id)}
                        onUpdate={patch => updateSelectedBin(id, patch)}
                      />
                    );
                  })
                )}
              </div>
            </Section>

            {/* Read-only: checked bins summary */}
            {readonly && taskData.checkedBins.length > 0 && (
              <Section title="BIN yang sudah dicek" meta={`${taskData.checkedBins.length}`}>
                <div className="space-y-2">
                  {taskData.checkedBins.map(bin => (
                    <div key={bin.id} className="overflow-hidden rounded-xl border border-primary/40 bg-card">
                      <div className="flex items-center gap-3 px-3.5 py-3.5">
                        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary">
                          <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm font-bold text-foreground">{bin.bin}</p>
                          <p className="truncate text-xs text-muted-foreground">{bin.nama}</p>
                        </div>
                      </div>
                      <QtyStrip
                        tone="primary"
                        items={[
                          { label: 'Qty BC', val: bin.qtyBc },
                          { label: 'Sesuai', val: bin.qtySesuaiBin },
                          { label: 'Tidak sesuai', val: bin.qtyTidakSesuaiBin },
                        ]}
                      />
                      {bin.notes && <p className="border-t border-border px-3.5 py-2 text-xs text-muted-foreground">{bin.notes}</p>}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <NotesField
              label="Catatan task"
              value={notes}
              disabled={dis}
              rows={3}
              onChange={(v) => { setNotes(v); autoSave({ notes: v }); }}
              placeholder="Tambahkan catatan umum jika ada…"
            />
          </div>
        )}
      </PageBody>

      <TaskSubmitBar
        label="Submit Cek BIN"
        onSubmit={handleSubmit}
        submitting={submitting}
        disabled={!canSubmit || loading || !taskData}
        hidden={readonly || loading || !taskData}
        hint={!canSubmit ? submitHint : undefined}
      />
    </>
  );
}
