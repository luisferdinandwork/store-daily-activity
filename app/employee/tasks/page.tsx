"use client";
// app/employee/tasks/page.tsx

import { useEffect, useState, useCallback, type ElementType } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  Camera,
  ChevronRight,
  Inbox,
  Store,
  Wallet,
  Box,
  Truck,
  Users,
  CreditCard,
  ClipboardList,
  User,
  Sun,
  Moon,
  AlertTriangle,
  Zap,
  LogIn,
  LogOut,
  RefreshCw,
  Loader2,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Task types ────────────────────────────────────────────────────────────────

export type TaskType =
  | "store_opening"
  | "setoran"
  | "cek_bin"
  | "store_front"
  | "vm_checklist"
  | "marketing_check"
  | "item_dropping"
  | "briefing"
  | "serah_terima"
  | "store_closing"
  | "grooming";

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "discrepancy"
  | "verified"
  | "rejected";

type ShiftCode = string;
type ShiftTaskMap = Record<string, TaskType[]>;

interface AttendanceShiftSlot {
  schedule: {
    scheduleId?: number;
    shift?: ShiftCode;
    shiftCode?: ShiftCode;
    shiftLabel?: string | null;
    storeId?: number;
    date?: string;
  };
  attendance?: {
    attendanceId?: number;
    scheduleId?: number;
    status?: string;
    shift?: ShiftCode;
    shiftCode?: ShiftCode;
    checkInTime?: string | null;
    checkOutTime?: string | null;
    onBreak?: boolean;
    notes?: string | null;
  } | null;
}

type AttendanceStatus = {
  hasSchedule: boolean;
  checkedIn: boolean;
  checkedOut: boolean;
  checkInAt: string | null;
  checkOutAt: string | null;
};

interface TaskBase {
  id: string;
  scheduleId: string;

  // Shared task rows can be created by another employee's schedule.
  // scheduleId is always the logged-in employee's acting schedule for guards.
  // originalScheduleId/assignedUserId keep the stored shared row metadata.
  originalScheduleId?: string | null;
  assignedUserId?: string | null;

  userId: string;
  storeId: string;
  shift: ShiftCode;
  date: string;
  status: TaskStatus;
  notes: string | null;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export interface StoreOpeningData extends TaskBase {
  loginPos: boolean;
  checkAbsenSunfish: boolean;
  tarikSohSales: boolean;
  fiveR: boolean;
  cekLamp: boolean;
  cekSoundSystem: boolean;
  cashDrawerPhotos: string[];
  fiveRAreaKasirPhotos: string[];
  fiveRAreaDepanPhotos: string[];
  fiveRAreaKananPhotos: string[];
  fiveRAreaKiriPhotos: string[];
  fiveRAreaGudangPhotos: string[];
}
export interface SetoranData extends TaskBase {
  // Old names kept by /api/employee/tasks for compatibility.
  amount: string | null;
  expectedAmount: string | null;
  carriedDeficit: string | null;
  carriedDeficitFetchedAt: string | null;
  unpaidAmount: string | null;

  // New clearer money-storage names.
  actualReceivedAmount?: string | null;
  previousUnpaidAmount?: string | null;
  requiredStoreAmount?: string | null;
  storedAmount?: string | null;

  resiPhoto: string | null;
  atmCardSelfiePhoto: string | null;
}
export interface StoreFrontData extends TaskBase {
  storefrontPhotos: string[];
  rollingDoorClosedPhoto: string | null;
}
export interface MarketingCheckData extends TaskBase {
  promoName: boolean;
  promoPeriod: boolean;
  promoMechanism: boolean;
  randomShoeItems: boolean;
  randomNonShoeItems: boolean;
  sellTag: boolean;
}
export interface CekBinData extends TaskBase {
  totalStoreBins: number;
  minimumBinsToCheck: number;
  checkedBinsCount: number;
  selectedBinIds: string[];
  availableBins: Array<{
    id: string;
    storeId: string;
    bin: string;
    nama: string | null;
    qtyBc: number | null;
    qtySesuaiBin: number | null;
    qtyTidakSesuaiBin: number | null;
  }>;
  checkedBins: Array<{
    id: string;
    taskId: string;
    binId: string;
    bin: string;
    nama: string | null;
    qtyBc: number | null;
    qtySesuaiBin: number | null;
    qtyTidakSesuaiBin: number | null;
    notes: string | null;
  }>;
}
export interface VmChecklistData extends TaskBase {
  shoeLaceShoeFillerPriceTagHangtagLabelK3L: boolean;
  lastPairAndPigskinHangtag: boolean;
  popPromoUpdate: boolean;
  displayTableWallShelvingShowcaseHangbarStackingPedestal: boolean;
  floorDisplayCleanliness: boolean;
  vmToolsStorage: boolean;
}
export interface ItemDroppingData extends TaskBase {
  hasDropping: boolean;
  entries: Array<{
    id: string;
    taskId: string;
    userId: string;
    storeId: string;
    toNumber: string;
    quantity: number;
    dropTime: string | null;
    droppingPhotos: string[];
    notes: string | null;
    createdAt: string | null;
  }>;
}
export interface BriefingData extends TaskBase {
  done: boolean;
  isBalanced: boolean | null;
  parentTaskId: number | null;
}
export interface StoreClosingData extends TaskBase {
  eodZReportDone: boolean;
  eodZReportBy?: string | null;
  eodZReportAt?: string | null;

  /** Required evidence: photo of EOD and EDC settlement side by side. */
  eodEdcSettlementPhoto: string | null;
  eodEdcSettlementPhotoBy?: string | null;
  eodEdcSettlementPhotoAt?: string | null;

  edcSettlementDone: boolean;
  edcSettlementNotes: string | null;
  edcSettlementBy?: string | null;
  edcSettlementAt?: string | null;

  edcSummaryDone: boolean;
  edcSummaryNotes: string | null;
  edcSummaryBy?: string | null;
  edcSummaryAt?: string | null;

  openStatementDecision: "post_statement" | "on_hold" | null;
  openStatementHoldReason: string | null;
  openStatementBy?: string | null;
  openStatementAt?: string | null;

  isOnHold: boolean;
  holdIssueId: string | number | null;
  heldBy: string | null;
  heldAt: string | null;
  holdResolvedAt?: string | null;
  reopenedAt?: string | null;
}

export interface GroomingData extends TaskBase {
  uniformActive: boolean;
  hairActive: boolean;
  smellActive: boolean;
  makeUpActive: boolean;
  shoeActive: boolean;
  nameTagActive: boolean;
  uniformChecked: boolean | null;
  hairChecked: boolean | null;
  smellChecked: boolean | null;
  makeUpChecked: boolean | null;
  shoeChecked: boolean | null;
  nameTagChecked: boolean | null;
  selfiePhotos: string[];
}

export interface SerahTerimaData extends TaskBase {
  handoverText: string | null;
  items: Array<{
    id: string;
    taskId: string;
    receiverTaskId: string | null;
    message: string;
    isCompleted: boolean;
    completedBy: string | null;
    completedAt: string | null;
    createdAt: string | null;
  }>;
}

export type TaskItem =
  | { type: "store_opening"; shift: ShiftCode; data: StoreOpeningData }
  | { type: "setoran"; shift: ShiftCode; data: SetoranData }
  | { type: "store_front"; shift: ShiftCode; data: StoreFrontData }
  | { type: "cek_bin"; shift: ShiftCode; data: CekBinData }
  | { type: "vm_checklist"; shift: ShiftCode; data: VmChecklistData }
  | { type: "marketing_check"; shift: ShiftCode; data: MarketingCheckData }
  | { type: "item_dropping"; shift: ShiftCode; data: ItemDroppingData }
  | { type: "briefing"; shift: ShiftCode; data: BriefingData }
  | { type: "store_closing"; shift: ShiftCode; data: StoreClosingData }
  | { type: "grooming"; shift: ShiftCode; data: GroomingData }
  | { type: "serah_terima"; shift: ShiftCode; data: SerahTerimaData };

type Filter = "all" | "pending" | "in_progress" | "completed";

// ─── Config ────────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<
  TaskStatus,
  {
    Icon: ElementType;
    label: string;
    badgeCls: string;
    accentCls: string;
  }
> = {
  discrepancy: {
    Icon: AlertTriangle,
    label: "Discrepancy",
    badgeCls: "bg-amber-100 text-amber-700 hover:bg-amber-100",
    accentCls: "bg-amber-400",
  },
  in_progress: {
    Icon: Clock,
    label: "Active",
    badgeCls: "bg-primary/10 text-primary hover:bg-primary/10",
    accentCls: "bg-primary",
  },
  pending: {
    Icon: Circle,
    label: "Pending",
    badgeCls: "bg-amber-50 text-amber-600 hover:bg-amber-50",
    accentCls: "bg-amber-200",
  },
  completed: {
    Icon: CheckCircle2,
    label: "Done",
    badgeCls: "bg-green-50 text-green-700 hover:bg-green-50",
    accentCls: "bg-green-500",
  },
  verified: {
    Icon: CheckCircle2,
    label: "Verified",
    badgeCls: "bg-green-100 text-green-800 hover:bg-green-100",
    accentCls: "bg-green-600",
  },
  rejected: {
    Icon: XCircle,
    label: "Rejected",
    badgeCls: "bg-red-50 text-red-600 hover:bg-red-50",
    accentCls: "bg-red-500",
  },
};

const STATUS_PRIORITY: Record<TaskStatus, number> = {
  discrepancy: 0,
  in_progress: 1,
  pending: 2,
  rejected: 3,
  completed: 4,
  verified: 5,
};

const TASK_META: Record<
  TaskType,
  { title: string; description: string; Icon: ElementType; hasPhoto: boolean }
> = {
  store_opening: {
    title: "Store Opening",
    description: "Opening checklist, 5R, lampu, sound, dan cash drawer.",
    Icon: Store,
    hasPhoto: true,
  },
  store_front: {
    title: "Store Front",
    description: "Foto dua orang di storefront dan rolling door tertutup.",
    Icon: Camera,
    hasPhoto: true,
  },
  setoran: {
    title: "Setoran Penjualan",
    description: "Uang diterima, uang disetor, dan sisa unpaid.",
    Icon: Wallet,
    hasPhoto: true,
  },
  cek_bin: {
    title: "Cek Bin",
    description: "Input total bin dan pilih minimal 30% bin untuk dicek.",
    Icon: Box,
    hasPhoto: false,
  },
  vm_checklist: {
    title: "VM Checklist",
    description: "Checklist harian Visual Merchandising.",
    Icon: ClipboardList,
    hasPhoto: false,
  },
  item_dropping: {
    title: "Item Dropping",
    description: "Log delivery arrival & receipt.",
    Icon: Truck,
    hasPhoto: true,
  },
  briefing: {
    title: "Briefing",
    description: "Selesaikan briefing shift pagi atau malam.",
    Icon: Users,
    hasPhoto: false,
  },
  store_closing: {
    title: "Store Closing",
    description:
      "Checklist EOD Z-Report, EDC settlement, EDC summary, foto EOD+EDC, dan Open Statement.",
    Icon: CreditCard,
    hasPhoto: true,
  },
  grooming: {
    title: "Grooming Check",
    description: "Uniform check + full-body selfie.",
    Icon: User,
    hasPhoto: true,
  },
  marketing_check: {
    title: "Marketing Check",
    description: "Promo, random checking, dan sell tag.",
    Icon: ClipboardList,
    hasPhoto: false,
  },
  serah_terima: {
    title: "Serah Terima",
    description: "Tulis pesan handover untuk shift berikutnya.",
    Icon: ClipboardList,
    hasPhoto: false,
  },
};

const TASK_ROUTES: Record<TaskType, string> = {
  store_opening: "store-opening",
  store_front: "store-front",
  setoran: "setoran",
  cek_bin: "cek-bin",
  vm_checklist: "vm-checklist",
  item_dropping: "item-dropping",
  briefing: "briefing",
  store_closing: "store-closing",
  grooming: "grooming",
  marketing_check: "marketing-check",
  serah_terima: "serah-terima",
};

const DEFAULT_SHIFT_TASK_MAP: ShiftTaskMap = {
  morning: [
    "store_opening",
    "store_front",
    "setoran",
    "cek_bin",
    "vm_checklist",
    "marketing_check",
    "item_dropping",
    "briefing",
    "serah_terima",
    "grooming",
  ],
  evening: [
    "item_dropping",
    "briefing",
    "serah_terima",
    "store_closing",
    "grooming",
  ],
  full_day: [
    "store_opening",
    "store_front",
    "setoran",
    "cek_bin",
    "vm_checklist",
    "marketing_check",
    "item_dropping",
    "briefing",
    "serah_terima",
    "store_closing",
    "grooming",
  ],
};

function normaliseShiftTaskMap(value: unknown): ShiftTaskMap {
  if (!value || typeof value !== "object") return DEFAULT_SHIFT_TASK_MAP;

  const input = value as Record<string, unknown>;
  const out: ShiftTaskMap = {};

  for (const [shiftCode, rawTaskTypes] of Object.entries(input)) {
    if (!shiftCode || !Array.isArray(rawTaskTypes)) continue;

    const validTypes = rawTaskTypes
      .map(normaliseTaskType)
      .filter((taskType): taskType is TaskType => taskType !== null);

    if (validTypes.length) {
      out[shiftCode] = Array.from(new Set(validTypes));
    }
  }

  // Backward-compatible fallback while seed/API is still empty.
  return Object.keys(out).length ? out : DEFAULT_SHIFT_TASK_MAP;
}

function normaliseTaskType(type: unknown): TaskType | null {
  if (typeof type !== "string") return null;

  const value = type.trim().replaceAll("-", "_") as TaskType;

  if (value in TASK_META) return value;

  return null;
}

function normaliseTaskItem(raw: unknown): TaskItem | null {
  if (!raw || typeof raw !== "object") return null;

  const row = raw as Record<string, unknown>;
  const type = normaliseTaskType(row.type);

  if (!type || !row.data || typeof row.data !== "object") return null;

  const data = row.data as Record<string, unknown>;
  const shiftValue = row.shift ?? data.shift;
  const shift: ShiftCode =
    typeof shiftValue === "string" && shiftValue.trim()
      ? shiftValue.trim()
      : "morning";

  const status: TaskStatus = isValidTaskStatus(data.status)
    ? data.status
    : "pending";

  return {
    ...row,
    type,
    shift,
    data: {
      ...data,
      shift,
      status,
    },
  } as TaskItem;
}

function getTaskRoute(type: TaskType): string {
  return TASK_ROUTES[type] ?? type.replaceAll("_", "-");
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "Active" },
  { key: "completed", label: "Done" },
];

const SHIFT_SCOPED_SHARED_TASK_TYPES = new Set<TaskType>([
  "briefing",
  "item_dropping",
  "serah_terima",
]);

function isValidTaskStatus(value: unknown): value is TaskStatus {
  return (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "discrepancy" ||
    value === "verified" ||
    value === "rejected"
  );
}

function getTaskDayKey(value: string | null | undefined): string {
  if (!value) return "unknown-date";

  // Your API usually sends an ISO date. Slice first to avoid timezone shifting
  // a midnight timestamp into the previous/next day on the client.
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toISOString().slice(0, 10);
}

function getTaskStoreKey(task: TaskItem): string {
  return String(task.data.storeId ?? "unknown-store");
}

function getTaskScheduleKey(task: TaskItem): string {
  return String(task.data.scheduleId ?? "unknown-schedule");
}

function getShiftScopedDisplayShift(task: TaskItem): ShiftCode {
  // Legacy safety: if old full_day rows still exist for these shared tasks,
  // treat them as the morning row. New seed/util logic should create only
  // morning/evening rows for these task types.
  return task.shift === "evening" ? "evening" : "morning";
}

function rankShiftScopedCandidate(task: TaskItem): number {
  // Prefer a real morning/evening row over a legacy full_day row, then prefer
  // tasks needing attention so employees don't miss active/discrepancy work.
  const shiftRank = task.shift === "full_day" ? 10 : 0;
  return shiftRank + (STATUS_PRIORITY[task.data.status] ?? 99);
}

function getDisplayShift(task: TaskItem): ShiftCode {
  if (SHIFT_SCOPED_SHARED_TASK_TYPES.has(task.type)) {
    return getShiftScopedDisplayShift(task);
  }

  // Legacy full_day rows are shown in Morning to avoid duplicate sections.
  if (task.shift === "full_day") return "morning";

  return task.shift || "morning";
}

function canShowForOwnShifts(
  task: TaskItem,
  ownShifts: Set<ShiftCode>,
  shiftTaskMap: ShiftTaskMap,
): boolean {
  if (ownShifts.size === 0) return true;

  const allowedForShift = (shiftCode: ShiftCode) =>
    shiftTaskMap[shiftCode]?.includes(task.type) ?? false;

  // Full-day remains a special legacy/default shift that can see the full task set.
  if (ownShifts.has("full_day") && allowedForShift("full_day")) return true;

  // Store-level shared tasks can be materialised under a different employee/schedule
  // row. If the employee's shift assignment contains this task type, show it.
  if (task.type !== "grooming") {
    return Array.from(ownShifts).some(allowedForShift);
  }

  // Personal tasks stay tied to the actual employee shift row.
  if (task.shift === "full_day") {
    return Array.from(ownShifts).some(allowedForShift);
  }

  return Array.from(ownShifts).some(
    (shiftCode) => task.shift === shiftCode && allowedForShift(shiftCode),
  );
}

function normaliseVisibleTasks(
  tasks: TaskItem[],
  ownShifts: Set<ShiftCode>,
  shiftTaskMap: ShiftTaskMap,
): TaskItem[] {
  const regularSeen = new Set<string>();
  const shiftScopedByKey = new Map<string, TaskItem>();
  const result: TaskItem[] = [];

  for (const task of tasks) {
    if (SHIFT_SCOPED_SHARED_TASK_TYPES.has(task.type)) {
      const displayShift = getShiftScopedDisplayShift(task);
      const key = [
        task.type,
        getTaskStoreKey(task),
        getTaskDayKey(task.data.date),
        displayShift,
      ].join("::");

      const normalizedTask = {
        ...task,
        shift: displayShift,
        data: {
          ...task.data,
          shift: displayShift,
        },
      } as TaskItem;

      const existing = shiftScopedByKey.get(key);
      if (
        !existing ||
        rankShiftScopedCandidate(normalizedTask) <
          rankShiftScopedCandidate(existing)
      ) {
        shiftScopedByKey.set(key, normalizedTask);
      }

      continue;
    }

    // Personal tasks must stay per schedule; shared tasks can dedupe by type/store/day/shift.
    const key =
      task.type === "grooming"
        ? [task.type, getTaskScheduleKey(task), task.data.id].join("::")
        : [
            task.type,
            getTaskStoreKey(task),
            getTaskDayKey(task.data.date),
            task.shift,
            task.data.id,
          ].join("::");

    if (regularSeen.has(key)) continue;
    regularSeen.add(key);
    result.push(task);
  }

  result.push(...shiftScopedByKey.values());

  return result.filter((task) =>
    canShowForOwnShifts(task, ownShifts, shiftTaskMap),
  );
}

// ─── Ring progress (moved here from dashboard) ─────────────────────────────────

function fmtAttendanceTime(value: string | null | undefined) {
  if (!value) return "—";

  return new Date(value).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AttendanceCheckCard({
  attendance,
  loading,
  onRefresh,
}: {
  attendance: AttendanceStatus | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <div>
          <p className="text-sm font-bold text-foreground">Mengecek absensi…</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Task akan aktif setelah status absensi terbaca.
          </p>
        </div>
      </div>
    );
  }

  if (!attendance) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700 shadow-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Status absensi belum terbaca</p>
          <p className="mt-0.5 text-xs">
            Cek ulang absensi sebelum membuka task.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-bold text-amber-700 hover:bg-amber-200"
        >
          <RefreshCw className="h-3 w-3" />
          Cek ulang
        </button>
      </div>
    );
  }

  if (!attendance.hasSchedule) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-card px-4 py-3 shadow-sm">
        <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">
            Tidak ada jadwal hari ini
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Kamu tidak memiliki shift yang perlu dikerjakan hari ini.
          </p>
        </div>
      </div>
    );
  }

  if (!attendance.checkedIn) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 shadow-sm">
        <LogIn className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Belum absen masuk</p>
          <p className="mt-0.5 text-xs">
            Kamu harus melakukan absensi masuk terlebih dahulu sebelum
            mengerjakan task.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-200"
        >
          <RefreshCw className="h-3 w-3" />
          Cek ulang
        </button>
      </div>
    );
  }

  if (attendance.checkedOut) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-card px-4 py-3 shadow-sm">
        <LogOut className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">
            Sudah absen pulang
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Check-in {fmtAttendanceTime(attendance.checkInAt)} · Check-out{" "}
            {fmtAttendanceTime(attendance.checkOutAt)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 shadow-sm">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Sudah absen masuk</p>
        <p className="mt-0.5 text-xs">
          Check-in {fmtAttendanceTime(attendance.checkInAt)}. Task sudah bisa
          dikerjakan.
        </p>
      </div>
    </div>
  );
}

function RingProgress({ pct }: { pct: number }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  return (
    <svg width={104} height={104} viewBox="0 0 104 104" className="-rotate-90">
      <circle
        cx={52}
        cy={52}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={8}
        className="text-primary-foreground/15"
      />
      <circle
        cx={52}
        cy={52}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        className="text-primary-foreground transition-all duration-700"
      />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeTasksPage() {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [shift, setShift] = useState<ShiftCode | null>(null);
  const [myShifts, setMyShifts] = useState<Set<ShiftCode>>(new Set());
  const [shiftTaskMap, setShiftTaskMap] = useState<ShiftTaskMap>(
    DEFAULT_SHIFT_TASK_MAP,
  );
  const [attendance, setAttendance] = useState<AttendanceStatus | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/employee/tasks", { cache: "no-store" });
      const data = (await res.json()) as {
        tasks?: unknown[];
        shift?: ShiftCode | null;
        shifts?: string[];
        shiftTaskMap?: unknown;
        assignedTaskTypes?: TaskType[];
      };

      const normalisedTasks = (data.tasks ?? [])
        .map(normaliseTaskItem)
        .filter((item): item is TaskItem => item !== null);

      setTasks(normalisedTasks);
      setShift(data.shift ?? null);
      setShiftTaskMap(normaliseShiftTaskMap(data.shiftTaskMap));

      // Fallback while /api/employee/attendance is still loading or if it fails.
      // The attendance endpoint will override this with the complete shift set.
      if (Array.isArray(data.shifts) && data.shifts.length > 0) {
        setMyShifts(new Set<ShiftCode>(data.shifts));
      } else if (data.shift) {
        setMyShifts(new Set<ShiftCode>([data.shift]));
      }
    } catch (e) {
      console.error("[EmployeeTasksPage] task load error:", e);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAttendance = useCallback(async () => {
    setAttendanceLoading(true);

    try {
      const res = await fetch("/api/employee/attendance", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = (await res.json()) as {
        success: boolean;
        shifts?: AttendanceShiftSlot[];
        error?: string;
      };

      if (!json.success) {
        throw new Error(json.error ?? "Failed to load attendance.");
      }

      const slots = json.shifts ?? [];

      const ownShifts = new Set<ShiftCode>();
      for (const slot of slots) {
        const code = slot.schedule.shiftCode ?? slot.schedule.shift;
        if (typeof code === "string" && code.trim()) {
          ownShifts.add(code.trim());
        }
      }
      setMyShifts(ownShifts);

      if (slots.length === 0) {
        setAttendance({
          hasSchedule: false,
          checkedIn: false,
          checkedOut: false,
          checkInAt: null,
          checkOutAt: null,
        });
        return;
      }

      const checkInTimes: string[] = [];
      const checkOutTimes: string[] = [];
      let slotsWithCheckIn = 0;
      let slotsWithCheckOut = 0;

      for (const slot of slots) {
        const att = slot.attendance;
        if (!att) continue;

        if (att.checkInTime) {
          checkInTimes.push(att.checkInTime);
          slotsWithCheckIn += 1;
        }

        if (att.checkOutTime) {
          checkOutTimes.push(att.checkOutTime);
          slotsWithCheckOut += 1;
        }
      }

      const earliestCheckIn = checkInTimes.length
        ? checkInTimes.reduce((a, b) => (new Date(a) <= new Date(b) ? a : b))
        : null;

      const latestCheckOut = checkOutTimes.length
        ? checkOutTimes.reduce((a, b) => (new Date(a) >= new Date(b) ? a : b))
        : null;

      setAttendance({
        hasSchedule: true,
        checkedIn: slotsWithCheckIn > 0,
        checkedOut:
          slotsWithCheckIn > 0 && slotsWithCheckOut === slotsWithCheckIn,
        checkInAt: earliestCheckIn,
        checkOutAt: latestCheckOut,
      });
    } catch (e) {
      console.error("[EmployeeTasksPage] attendance load error:", e);
      setAttendance(null);
      // Keep the fallback shift collected from /api/employee/tasks.
    } finally {
      setAttendanceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;

    void load();
    void loadAttendance();
  }, [sessionStatus, load, loadAttendance]);

  const openTask = useCallback(
    async (item: TaskItem) => {
      if (attendanceLoading) return;

      if (!attendance || !attendance.hasSchedule || !attendance.checkedIn) {
        void loadAttendance();
        return;
      }

      const { status, id } = item.data;

      if (status === "pending") {
        setTasks((prev) =>
          prev.map((t) =>
            t.data.id === id
              ? ({
                  ...t,
                  data: { ...t.data, status: "in_progress" as const },
                } as TaskItem)
              : t,
          ),
        );

        fetch("/api/employee/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: id,
            taskType: item.type,
            status: "in_progress",
          }),
        }).catch(console.error);
      }

      router.push(`/employee/tasks/${getTaskRoute(item.type)}/${id}`);
    },
    [attendance, attendanceLoading, loadAttendance, router],
  );

  const visibleTasks = normaliseVisibleTasks(tasks, myShifts, shiftTaskMap);

  const countFilter = (f: Filter) => {
    if (f === "all") return visibleTasks.length;

    if (f === "in_progress") {
      return visibleTasks.filter(
        (task) =>
          task.data.status === "in_progress" ||
          task.data.status === "discrepancy",
      ).length;
    }

    return visibleTasks.filter((task) => task.data.status === f).length;
  };

  const filtered = visibleTasks
    .filter((task) => {
      if (filter === "all") return true;

      if (filter === "in_progress") {
        return (
          task.data.status === "in_progress" ||
          task.data.status === "discrepancy"
        );
      }

      return task.data.status === filter;
    })
    .sort(
      (a, b) =>
        (STATUS_PRIORITY[a.data.status] ?? 9) -
        (STATUS_PRIORITY[b.data.status] ?? 9),
    );

  const tasksByDisplayShift = new Map<ShiftCode, TaskItem[]>();
  for (const task of filtered) {
    const displayShift = getDisplayShift(task);
    const bucket = tasksByDisplayShift.get(displayShift) ?? [];
    bucket.push(task);
    tasksByDisplayShift.set(displayShift, bucket);
  }

  const shiftSectionOrder = ["morning", "full_day", "evening"];
  const orderedShiftSections = Array.from(tasksByDisplayShift.entries()).sort(
    (a, b) => {
      const ai = shiftSectionOrder.indexOf(a[0]);
      const bi = shiftSectionOrder.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    },
  );
  const noSchedule =
    !loading && !attendanceLoading && attendance?.hasSchedule === false;
  const noVisibleTasks = !loading && visibleTasks.length === 0;

  // Stats for the ring
  const stats = {
    pending: visibleTasks.filter((task) => task.data.status === "pending")
      .length,
    inProgress: visibleTasks.filter(
      (task) =>
        task.data.status === "in_progress" ||
        task.data.status === "discrepancy",
    ).length,
    completed: visibleTasks.filter(
      (task) =>
        task.data.status === "completed" || task.data.status === "verified",
    ).length,
    total: visibleTasks.length,
  };

  const pct =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-primary px-6 pb-6 pt-12">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 bottom-0 h-24 w-24 rounded-full bg-white/5" />

        <div className="relative flex items-end justify-between gap-4">
          {/* Left: title + date + shift pill */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">
              Today
            </p>
            <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">
              My Tasks
            </h1>
            <p className="mt-1 text-xs text-primary-foreground/50">
              {new Date().toLocaleDateString("id-ID", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>

            {shift && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1">
                {shift === "morning" && (
                  <Sun className="h-3.5 w-3.5 text-yellow-300" />
                )}
                {shift === "evening" && (
                  <Moon className="h-3.5 w-3.5 text-blue-300" />
                )}
                {shift === "full_day" && (
                  <Zap className="h-3.5 w-3.5 text-orange-300" />
                )}
                <span className="text-xs font-semibold capitalize text-primary-foreground">
                  {shift === "morning"
                    ? "Morning Shift"
                    : shift === "evening"
                      ? "Evening Shift"
                      : shift === "full_day"
                        ? "Full Day Shift"
                        : `${shift.replaceAll("_", " ")} Shift`}
                </span>
              </div>
            )}

            {/* Stat pills row */}
            {!loading && stats.total > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  {
                    label: "Pending",
                    value: stats.pending,
                    color: "bg-amber-400/25 text-amber-200",
                  },
                  {
                    label: "Active",
                    value: stats.inProgress,
                    color: "bg-white/20 text-white",
                  },
                  {
                    label: "Done",
                    value: stats.completed,
                    color: "bg-green-400/25 text-green-200",
                  },
                ].map(({ label, value, color }) => (
                  <span
                    key={label}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold",
                      color,
                    )}
                  >
                    <span className="text-sm font-bold">{value}</span>
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Right: ring progress chart */}
          <div className="relative shrink-0">
            <RingProgress pct={loading ? 0 : pct} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold text-primary-foreground">
                {loading ? "—" : `${pct}%`}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-primary-foreground/50">
                done
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-border bg-card px-4 py-2.5">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all",
                filter === key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary text-muted-foreground hover:bg-border",
              )}
            >
              {label}
              <span
                className={cn(
                  "flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold",
                  filter === key
                    ? "bg-white/20 text-primary-foreground"
                    : "bg-border text-foreground",
                )}
              >
                {countFilter(key)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Attendance check ───────────────────────────────────────────── */}
      <div className="px-4 pt-4">
        <AttendanceCheckCard
          attendance={attendance}
          loading={attendanceLoading}
          onRefresh={() => {
            void loadAttendance();
          }}
        />
      </div>

      {/* ── Task sections ────────────────────────────────────────────────── */}
      <div className="flex-1 p-4 space-y-6">
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl bg-secondary"
              />
            ))}
          </div>
        ) : noSchedule ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Inbox className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-foreground">
              No shift today
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              You are not scheduled for any shift today.
            </p>
          </div>
        ) : noVisibleTasks ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Inbox className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-foreground">
              No tasks today
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              There are no tasks available for your scheduled shift.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckCircle2 className="mb-3 h-10 w-10 text-green-400" />
            <p className="text-sm font-semibold text-foreground">All clear!</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No tasks in this category.
            </p>
          </div>
        ) : (
          <>
            {orderedShiftSections.map(([shiftCode, items]) => (
              <section key={shiftCode}>
                <div className="mb-2.5 flex items-center gap-2">
                  {shiftCode === "evening" ? (
                    <Moon className="h-4 w-4 text-blue-500" />
                  ) : shiftCode === "full_day" ? (
                    <Zap className="h-4 w-4 text-orange-500" />
                  ) : (
                    <Sun className="h-4 w-4 text-amber-500" />
                  )}
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    {shiftCode.replaceAll("_", " ")} Shift
                  </h2>
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {items.map((item) => (
                    <TaskCard
                      key={`${item.type}-${item.data.id}`}
                      item={item}
                      onOpen={openTask}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Task card ────────────────────────────────────────────────────────────────

function TaskCard({
  item,
  onOpen,
}: {
  item: TaskItem;
  onOpen: (item: TaskItem) => void;
}) {
  const status = item.data.status ?? "pending";

  const cfg = STATUS_CFG[status] ?? STATUS_CFG.pending;

  const meta = TASK_META[item.type] ?? {
    title: item.type.replaceAll("_", " "),
    description: "Task belum memiliki konfigurasi tampilan.",
    Icon: ClipboardList,
    hasPhoto: false,
  };

  const StatusIcon = cfg.Icon;
  const TaskIcon = meta.Icon;

  const isTerminal = status === "completed" || status === "verified";
  const isRejected = status === "rejected";
  const isDiscrepancy = status === "discrepancy";
  const isStoreClosingHold =
    item.type === "store_closing" &&
    ((item.data as StoreClosingData).isOnHold ||
      (item.data as StoreClosingData).openStatementDecision === "on_hold");

  const showCarryForward =
    isDiscrepancy &&
    (item.type === "item_dropping" ||
      item.type === "store_closing" ||
      item.type === "serah_terima");

  const carryForwardDescription: Partial<Record<TaskType, string>> = {
    store_closing:
      "Store Closing tertahan karena Open Statement On Hold — tap untuk lanjutkan setelah issue resolved.",
    serah_terima:
      "Ada pesan serah terima yang belum selesai — tap untuk lanjutkan.",
  };

  const itemDroppingLabel = (() => {
    if (item.type !== "item_dropping" || !isDiscrepancy) return null;
    const d = item.data as ItemDroppingData;
    const firstEntry = d.entries?.[0];
    if (!d.hasDropping || !firstEntry?.dropTime)
      return "Item belum diterima — tap untuk konfirmasi.";
    const diffMin = Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(firstEntry.dropTime).getTime()) / 60_000,
      ),
    );
    const hours = Math.floor(diffMin / 60);
    const minutes = diffMin % 60;
    const elapsed =
      hours >= 24
        ? `${Math.floor(hours / 24)}h ${hours % 24}j lalu`
        : hours > 0
          ? `${hours}j ${minutes}m lalu`
          : `${minutes}m lalu`;
    return `Belum diterima · Drop ${elapsed}`;
  })();

  const setoranDeficitLabel = (() => {
    if (item.type !== "setoran") return null;

    const d = item.data as SetoranData;
    const unpaid = Number(d.unpaidAmount ?? 0);
    const previousUnpaid = Number(
      d.previousUnpaidAmount ?? d.carriedDeficit ?? 0,
    );

    if ((d.status === "completed" || d.status === "verified") && unpaid > 0) {
      return `Masih kurang: Rp ${unpaid.toLocaleString("id-ID")} — jadi kebutuhan setoran besok`;
    }

    if (
      (d.status === "pending" || d.status === "in_progress") &&
      previousUnpaid > 0
    ) {
      return `Wajib bayar sisa kemarin: Rp ${previousUnpaid.toLocaleString("id-ID")}`;
    }

    return null;
  })();

  const hasSetoranDeficit = item.type === "setoran" && !!setoranDeficitLabel;
  const needsAttention = isDiscrepancy || hasSetoranDeficit || isRejected;

  const storeClosingHoldLabel =
    isStoreClosingHold && !isTerminal
      ? "Open Statement sedang On Hold. Setelah issue resolved, task ini akan bisa diselesaikan lagi."
      : null;

  const description = itemDroppingLabel
    ? itemDroppingLabel
    : setoranDeficitLabel
      ? setoranDeficitLabel
      : storeClosingHoldLabel
        ? storeClosingHoldLabel
        : showCarryForward
          ? (carryForwardDescription[item.type] ?? meta.description)
          : meta.description;

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-border shadow-sm transition-all cursor-pointer active:scale-[0.99]",
        isTerminal && "opacity-75",
        isRejected && "border-red-200",
        isDiscrepancy && "border-amber-300",
        hasSetoranDeficit && !isDiscrepancy && "border-amber-300",
      )}
      onClick={() => onOpen(item)}
    >
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1",
          cfg.accentCls,
          status === "in_progress" && "animate-pulse",
          isDiscrepancy && "animate-pulse",
        )}
      />

      <CardContent className="py-3.5 pl-4 pr-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl",
              needsAttention ? "bg-amber-100" : "bg-secondary",
            )}
          >
            <TaskIcon
              className={cn(
                "h-[18px] w-[18px]",
                needsAttention ? "text-amber-700" : "text-foreground",
              )}
              strokeWidth={2}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-semibold leading-tight text-foreground">
                {meta.title}
              </p>
              {isTerminal && item.data.completedAt ? (
                <span className="flex-shrink-0 text-[10px] font-medium text-green-600">
                  ✓{" "}
                  {new Date(item.data.completedAt).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              ) : (
                <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
              )}
            </div>

            <p
              className={cn(
                "mt-1 line-clamp-2 text-[11.5px] leading-snug",
                needsAttention
                  ? "text-amber-700 font-medium"
                  : "text-muted-foreground",
              )}
            >
              {description}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1">
              <Badge
                className={cn(
                  "h-[18px] gap-1 px-1.5 text-[10px] font-semibold",
                  cfg.badgeCls,
                )}
              >
                <StatusIcon className="h-2.5 w-2.5" />
                {cfg.label}
              </Badge>

              {item.type === "grooming" ? (
                <Badge
                  variant="outline"
                  className="h-[18px] px-1.5 text-[10px] text-violet-600 border-violet-200"
                >
                  Personal
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="h-[18px] px-1.5 text-[10px]"
                >
                  Shared
                </Badge>
              )}

              {isStoreClosingHold && (
                <Badge className="h-[18px] gap-1 px-1.5 text-[10px] font-semibold bg-indigo-500 text-white hover:bg-indigo-500">
                  <History className="h-2.5 w-2.5" />
                  On Hold
                </Badge>
              )}

              {meta.hasPhoto && (
                <Badge
                  variant="outline"
                  className="h-[18px] gap-1 px-1.5 text-[10px]"
                >
                  <Camera className="h-2.5 w-2.5" />
                </Badge>
              )}

              {showCarryForward && (
                <Badge className="h-[18px] gap-1 px-1.5 text-[10px] font-semibold bg-amber-500 text-white hover:bg-amber-500">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Carry-forward
                </Badge>
              )}

              {hasSetoranDeficit && !isDiscrepancy && (
                <Badge className="h-[18px] gap-1 px-1.5 text-[10px] font-semibold bg-amber-500 text-white hover:bg-amber-500">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Kekurangan
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
