'use client';
// app/employee/tasks/cek-uang-modal/[id]/page.tsx

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, CloudOff, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { useTaskLocationSetting } from '@/lib/hooks/useTaskLocationSetting';
import {
  AccessBanner, LockedOverlay, TaskHeader, TaskSubmitBar, SaveIndicator, shiftLabel,
} from '@/components/employee/tasks';
import {
  Chip, EmptyState, ListGroup, Notice, NotesField, PageBody, Section, SkeletonBlocks,
  SummaryBox, TaskReviewNotices, inputClass,
} from '@/components/employee/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'pending'
  | 'verified'
  | 'rejected';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface CekUangModalDenomination {
  id?: string;
  taskId?: string;
  userId?: string;
  storeId?: string;
  denominationValue: number;
  quantity: number;
  amount?: string | null;
  notes?: string | null;
  createdAt?: string | null;
}

interface CekUangModalData {
  id: string;
  scheduleId: string;
  userId: string;
  storeId: string;
  shift: 'morning' | 'evening' | 'full_day' | string;
  date: string;
  status: TaskStatus;
  notes: string | null;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  totalAmount: string | null;
  maxAmount?: string | null;
  remainingAmount?: string | null;
  isPartial?: boolean | null;
  denominations: CekUangModalDenomination[];
}

const MAX_UANG_MODAL_TOTAL = 500_000;

const DEFAULT_DENOMINATIONS = [
  100_000,
  50_000,
  20_000,
  10_000,
  5_000,
  2_000,
  1_000,
  500,
  200,
  100,
] as const;

function formatRupiah(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

function toQty(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function buildDenominationRows(
  existing: CekUangModalDenomination[] | undefined,
): CekUangModalDenomination[] {
  const byValue = new Map<number, CekUangModalDenomination>();

  for (const row of existing ?? []) {
    byValue.set(Number(row.denominationValue), {
      ...row,
      denominationValue: Number(row.denominationValue),
      quantity: toQty(row.quantity),
    });
  }

  return DEFAULT_DENOMINATIONS.map((denominationValue) => {
    const current = byValue.get(denominationValue);

    return {
      id: current?.id,
      taskId: current?.taskId,
      userId: current?.userId,
      storeId: current?.storeId,
      denominationValue,
      quantity: current?.quantity ?? 0,
      amount: current?.amount ?? String(denominationValue * (current?.quantity ?? 0)),
      notes: current?.notes ?? null,
      createdAt: current?.createdAt ?? null,
    };
  });
}

function payloadRows(rows: CekUangModalDenomination[]) {
  return rows.map((row) => ({
    denominationValue: row.denominationValue,
    quantity: toQty(row.quantity),
    notes: row.notes || undefined,
  }));
}

function totalRows(rows: CekUangModalDenomination[]) {
  return rows.reduce(
    (sum, row) => sum + row.denominationValue * toQty(row.quantity),
    0,
  );
}

function parseMoney(value: number | string | null | undefined, fallback: number) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}


function fmt(iso: string | null | undefined) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Geo hook ─────────────────────────────────────────────────────────────────

function useGeo(required: boolean) {
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);

  const refresh = useCallback(() => {
    if (!required) {
      setGeo(null);
      setGeoError(null);
      setGeoReady(true);
      return;
    }
    setGeoReady(false);
    setGeoError(null);

    if (!navigator.geolocation) {
      setGeoError('Geolocation tidak didukung.');
      setGeoReady(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoReady(true);
      },
      () => {
        setGeoError('Lokasi tidak dapat diperoleh.');
        setGeoReady(true);
      },
      { timeout: 10_000, maximumAge: 0 },
    );
  }, [required]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { geo, geoError, geoReady, refresh };
}

// ─── Access hook ──────────────────────────────────────────────────────────────

function useAccessStatus(
  scheduleId: string,
  storeId: string,
  geo: { lat: number; lng: number } | null,
  geoReady: boolean,
  taskStatus: TaskStatus | undefined,
) {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const fetchAccess = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) {
      setAccessStatus({ status: 'ok' });
      setAccessLoading(false);
      return;
    }

    if (!scheduleId || !storeId) return;

    setAccessLoading(true);

    try {
      const params = new URLSearchParams({ scheduleId, storeId });

      if (geo) {
        params.set('lat', String(geo.lat));
        params.set('lng', String(geo.lng));
      }

      const res = await fetch(`/api/employee/tasks/access?${params}`);
      const data = (await res.json()) as AccessStatus;
      setAccessStatus(data);
    } catch {
      setAccessStatus({ status: 'geo_unavailable' });
    } finally {
      setAccessLoading(false);
    }
  }, [scheduleId, storeId, geo, taskStatus]);

  useEffect(() => {
    if (geoReady) void fetchAccess();
  }, [geoReady, fetchAccess]);

  return { accessStatus, accessLoading, refreshAccess: fetchAccess };
}

// ─── Small UI components ──────────────────────────────────────────────────────

function DenominationRow({
  row,
  disabled,
  maxQuantity,
  onQuantityChange,
  markEmpty,
}: {
  row: CekUangModalDenomination;
  disabled?: boolean;
  maxQuantity: number;
  onQuantityChange: (quantity: number) => void;
  /** In the completed/read-only view, flag denominations left at 0. */
  markEmpty?: boolean;
}) {
  const quantity = toQty(row.quantity);
  const amount = row.denominationValue * quantity;
  const showEmptyMark = markEmpty && quantity === 0;

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3.5 py-3 transition-colors',
        quantity > 0 ? 'bg-primary/[0.03]' : showEmptyMark ? 'bg-amber-50' : 'bg-card',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold tabular-nums text-foreground">
          {formatRupiah(row.denominationValue)}
        </p>
        <p className={cn('mt-0.5 text-xs tabular-nums', showEmptyMark ? 'font-semibold text-amber-700' : 'text-muted-foreground')}>
          {showEmptyMark
            ? 'Belum terisi'
            : quantity > 0
              ? `= ${formatRupiah(amount)}`
              : !disabled ? `maks ${maxQuantity.toLocaleString('id-ID')} lembar/keping` : '–'}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">×</span>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          max={maxQuantity}
          step="1"
          aria-label={`Jumlah ${formatRupiah(row.denominationValue)}`}
          value={quantity === 0 ? '' : quantity}
          disabled={disabled}
          onChange={(e) => onQuantityChange(toQty(e.target.value))}
          placeholder="0"
          className={cn(inputClass, 'h-11 w-20 px-3 text-right font-bold tabular-nums')}
        />
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CekUangModalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { requiresLocation } = useTaskLocationSetting('cek_uang_modal');
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo(requiresLocation);

  const [taskData, setTaskData] = useState<CekUangModalData | null>(null);
  const [rows, setRows] = useState<CekUangModalDenomination[]>(buildDenominationRows([]));
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/employee/tasks', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as {
        tasks?: Array<{ type: string; data: CekUangModalData }>;
      };

      const found = data.tasks?.find(
        (task) => task.type === 'cek_uang_modal' && task.data.id === taskId,
      );

      if (found) {
        const d = found.data;
        setTaskData(d);
        setRows(buildDenominationRows(d.denominations));
        setNotes(d.notes ?? '');
      } else {
        setTaskData(null);
      }
    } catch (e) {
      console.error('[CekUangModalDetailPage] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '',
    taskData?.storeId ?? '',
    geo,
    geoReady,
    taskData?.status,
  );

  const scheduleId = taskData ? parseInt(taskData.scheduleId, 10) : 0;
  const storeId = taskData ? parseInt(taskData.storeId, 10) : 0;
  const taskIdNum = taskData ? parseInt(taskData.id, 10) : 0;

  const {
    status: saveStatus,
    lastSaved,
    error: saveError,
    save: autoSave,
  } = useAutoSave({
    url: '/api/employee/tasks/cek-uang-modal',
    baseBody: { taskId: taskIdNum },
    debounceMs: 800,
  });

  const taskStatus = taskData?.status;
  const readonly = taskStatus === 'completed' || taskStatus === 'verified';
  const locked =
    !readonly &&
    !!accessStatus &&
    (accessStatus.status === 'not_checked_in' ||
      accessStatus.status === 'outside_geofence');

  const disabled = readonly || locked;
  const maxAmount = parseMoney(taskData?.maxAmount, MAX_UANG_MODAL_TOTAL);
  const totalAmount = totalRows(rows);
  const remainingAmount = Math.max(0, maxAmount - totalAmount);
  const totalPct = maxAmount > 0 ? Math.min(100, Math.round((totalAmount / maxAmount) * 100)) : 0;
  const filledRows = rows.filter((row) => toQty(row.quantity) > 0).length;
  const emptyRows = rows.length - filledRows;
  const isOverLimit = totalAmount > maxAmount;
  const isEmpty = totalAmount <= 0;
  // Some denominations left at 0 — only a warning once the task is done.
  const hasEmptyDenoms = readonly && emptyRows > 0 && totalAmount > 0;
  // "Uang modal belum penuh" — below the daily max. Allowed: the task still
  // completes, it's just marked for Ops. `taskData.isPartial` is the stored
  // mark after submit; before that we derive it live from the running total.
  const isPartial = readonly
    ? taskData?.isPartial === true
    : (!isEmpty && !isOverLimit && totalAmount < maxAmount);
  const canSubmit = !locked && !isEmpty && !isOverLimit;

  const submitHint = (() => {
    if (locked) return '';
    if (isEmpty) return 'Isi minimal satu pecahan uang modal.';
    if (isOverLimit) return `Total uang modal maksimal ${formatRupiah(maxAmount)}.`;
    return '';
  })();

  function updateQuantity(denominationValue: number, quantity: number) {
    setRows((prev) => {
      const otherTotal = prev.reduce((sum, row) => {
        if (row.denominationValue === denominationValue) return sum;
        return sum + row.denominationValue * toQty(row.quantity);
      }, 0);

      const maxQtyForRow = Math.max(
        0,
        Math.floor((maxAmount - otherTotal) / denominationValue),
      );
      const clampedQuantity = Math.min(quantity, maxQtyForRow);

      if (quantity > maxQtyForRow) {
        toast.error(`Maksimal uang modal ${formatRupiah(maxAmount)}. Qty pecahan ini dibatasi ke ${maxQtyForRow}.`);
      }

      const next = prev.map((row) =>
        row.denominationValue === denominationValue
          ? {
              ...row,
              quantity: clampedQuantity,
              amount: String(row.denominationValue * clampedQuantity),
            }
          : row,
      );

      autoSave({
        denominations: payloadRows(next),
        notes: notes || undefined,
      });

      return next;
    });
  }

  async function handleSubmit() {
    if (!taskData) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/employee/tasks/cek-uang-modal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: taskIdNum,
          scheduleId,
          storeId,
          lat: geo?.lat,
          lng: geo?.lng,
          skipGeo: geo === null,
          denominations: payloadRows(rows),
          notes: notes || undefined,
        }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        json = await res.json();
      }

      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        setSubmitError(msg);
        toast.error(msg, { duration: 6000 });
        return;
      }

      const incompleteAtSubmit = isPartial || emptyRows > 0;
      toast.success(
        incompleteAtSubmit
          ? `Cek Uang Modal selesai · ${formatRupiah(totalAmount)} (belum lengkap) ✓`
          : `Cek Uang Modal selesai · ${formatRupiah(totalAmount)} ✓`,
        { duration: 4000 },
      );
      router.back();
    } catch (e) {
      const msg =
        e instanceof Error
          ? `Koneksi gagal: ${e.message}`
          : 'Gagal terhubung ke server.';
      setSubmitError(msg);
      toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <TaskHeader
        title="Cek Uang Modal"
        subtitle={shiftLabel(taskData?.shift)}
        status={taskStatus}
        saveIndicator={
          !readonly && !loading && taskData ? (
            <SaveIndicator status={saveStatus} lastSaved={lastSaved ?? null} />
          ) : null
        }
      />

      <PageBody bottomBar={!readonly && !!taskData}>
        {!readonly && !loading && taskData && (
          <AccessBanner
            accessStatus={accessStatus}
            accessLoading={accessLoading}
            geoReady={geoReady}
            geo={geo}
            geoError={geoError}
            onRefreshGeo={refreshGeo}
            onRefreshAccess={refreshAccess}
            requireGeo={requiresLocation}
            allowWithoutGeo
          />
        )}

        {submitError && (
          <Notice tone="error" title="Submit gagal" onDismiss={() => setSubmitError(null)}>
            {submitError}
          </Notice>
        )}

        {saveError && !readonly && (
          <Notice tone="warning" icon={CloudOff}>Auto-save gagal: {saveError}</Notice>
        )}

        <TaskReviewNotices status={taskStatus} notes={taskData?.notes} verifiedAt={taskData?.verifiedAt} />

        {!readonly && !locked && !loading && taskData && (
          <Notice tone="info" icon={Save}>Perubahan otomatis tersimpan.</Notice>
        )}

        {loading ? (
          <SkeletonBlocks count={4} />
        ) : !taskData ? (
          <EmptyState title="Task tidak ditemukan" description="Task ini mungkin sudah tidak tersedia untuk jadwalmu hari ini." />
        ) : (
          <div className="relative">
            {!readonly && <LockedOverlay accessStatus={accessStatus} requireGeo={requiresLocation} allowWithoutGeo />}

            <div className="space-y-5">
              {/* ─── Summary ─────────────────────────────────────────────── */}
              <div className="space-y-3">
                <SummaryBox>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">
                        Total uang modal di kasir
                      </p>
                      <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
                        {formatRupiah(totalAmount)}
                      </p>
                    </div>
                    {readonly && (
                      <Chip tone={(isPartial || hasEmptyDenoms) ? 'warning' : 'success'}>
                        {(isPartial || hasEmptyDenoms) ? 'Belum lengkap' : 'Selesai'}
                      </Chip>
                    )}
                  </div>

                  <div className="space-y-1.5 border-t border-primary/15 pt-3">
                    <div className="h-2 overflow-hidden rounded-full bg-primary/10">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          isOverLimit ? 'bg-red-500' : (isPartial || hasEmptyDenoms) ? 'bg-amber-400' : 'bg-primary',
                        )}
                        style={{ width: `${totalPct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-primary/70">
                      <span>Limit {formatRupiah(maxAmount)}</span>
                      <span>Sisa {formatRupiah(remainingAmount)}</span>
                    </div>
                  </div>

                  {taskData.completedAt && (
                    <p className="text-[11px] text-primary/70">Selesai: {fmt(taskData.completedAt)}</p>
                  )}
                </SummaryBox>

                {isOverLimit && (
                  <Notice tone="error" title="Melebihi limit uang modal">
                    Total maksimal {formatRupiah(maxAmount)}. Kurangi pecahan sebelum submit.
                  </Notice>
                )}

                {(isPartial || hasEmptyDenoms) && (
                  <Notice tone="warning" title={hasEmptyDenoms && !isPartial ? 'Pecahan belum lengkap' : 'Uang modal belum lengkap'}>
                    {isPartial && <p>Kurang {formatRupiah(remainingAmount)} dari batas harian {formatRupiah(maxAmount)}.</p>}
                    {hasEmptyDenoms && <p>{emptyRows} pecahan belum terisi.</p>}
                    <p>
                      {readonly
                        ? 'Task tetap selesai — ditandai untuk Ops.'
                        : 'Tidak masalah — task tetap bisa diselesaikan dan akan ditandai.'}
                    </p>
                  </Notice>
                )}
              </div>

              {/* ─── Denominations ───────────────────────────────────────── */}
              <Section title="Pecahan uang" meta={`${filledRows}/${rows.length} terisi`}>
                <ListGroup>
                  {rows.map((row) => (
                    <DenominationRow
                      key={row.denominationValue}
                      row={row}
                      disabled={disabled}
                      markEmpty={readonly}
                      maxQuantity={Math.max(
                        toQty(row.quantity),
                        Math.floor((maxAmount - (totalAmount - row.denominationValue * toQty(row.quantity))) / row.denominationValue),
                      )}
                      onQuantityChange={(quantity) =>
                        updateQuantity(row.denominationValue, quantity)
                      }
                    />
                  ))}
                </ListGroup>
              </Section>

              <NotesField
                value={notes}
                disabled={disabled}
                rows={3}
                onChange={(value) => {
                  setNotes(value);
                  autoSave({
                    denominations: payloadRows(rows),
                    notes: value || undefined,
                  });
                }}
              />

              {readonly && (
                <Notice tone="success" icon={CheckCircle2}>
                  Data pecahan uang modal sudah tersimpan.
                </Notice>
              )}
            </div>
          </div>
        )}
      </PageBody>

      {taskData && (
        <TaskSubmitBar
          label="Submit Cek Uang Modal"
          onSubmit={handleSubmit}
          submitting={submitting}
          disabled={!canSubmit}
          hidden={readonly}
          hint={!canSubmit ? submitHint : undefined}
        />
      )}
    </>
  );
}
