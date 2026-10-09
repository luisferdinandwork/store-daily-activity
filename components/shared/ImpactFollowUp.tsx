import { CheckCircle2, CircleDashed, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FOLLOW_UP_LABEL,
  type FollowUpCheck,
  type FollowUpStatus,
  type FollowUpSummary,
} from "@/lib/impact-visit/follow-up";

export function CheckStatus({
  status = "needs_fix",
}: {
  status?: FollowUpStatus;
}) {
  const Icon =
    status === "verified"
      ? CheckCircle2
      : status === "not_done"
        ? CircleDashed
        : Clock3;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        status === "verified"
          ? "bg-emerald-50 text-emerald-700"
          : status === "not_done"
            ? "bg-rose-50 text-rose-700"
            : "bg-amber-50 text-amber-800",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {FOLLOW_UP_LABEL[status]}
    </span>
  );
}

export function CheckProgress({ summary }: { summary: FollowUpSummary }) {
  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-700">Tindak lanjut</span>
        <span className="tabular-nums text-slate-600">
          {summary.verified}/{summary.total} sudah diperbaiki
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Poin sudah diperbaiki"
        aria-valuenow={summary.verified}
        aria-valuemin={0}
        aria-valuemax={summary.total || 1}
        className="h-1.5 overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{
            width: `${summary.total ? (summary.verified / summary.total) * 100 : 100}%`,
          }}
        />
      </div>
      <p className="text-[11px] text-slate-500">
        {summary.total === 0
          ? "Tidak ada temuan negatif."
          : summary.verified === summary.total
            ? "Semua temuan sudah diperbaiki."
            : `${summary.needsFix + summary.notDone} belum diperbaiki`}
      </p>
    </div>
  );
}

export function checkDate(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CheckTimeline({ checks }: { checks: FollowUpCheck[] }) {
  if (!checks.length)
    return (
      <p className="text-xs text-slate-500">
        Belum ada pemeriksaan ulang dari Ops.
      </p>
    );
  return (
    <details className="text-xs">
      <summary className="cursor-pointer py-2 font-semibold text-indigo-700">
        Riwayat pemeriksaan ({checks.length})
      </summary>
      <ol className="mt-2 max-h-72 space-y-4 overflow-y-auto border-l-2 border-slate-100 pl-3">
        {checks.map((c) => (
          <li key={c.id} className="space-y-1.5">
            <CheckStatus status={c.status} />
            <p className="text-[11px] text-slate-500">
              {checkDate(c.checkedAt)} WIB · {c.reviewerName ?? "Ops"}
            </p>
            {c.note && (
              <p className="whitespace-pre-line break-words text-slate-700">
                {c.note}
              </p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
