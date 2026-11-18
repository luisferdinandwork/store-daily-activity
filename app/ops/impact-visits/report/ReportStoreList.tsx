"use client";
// app/ops/impact-visits/report/ReportStoreList.tsx
//
// Impact Visit · Monthly Report — every store in scope (OPS Area: their own area, HO / IT: all, with an area
// filter) × the 12 months of a year. Each month shows the score of that month's submitted visit for the
// Impact Visit checklist and the VM Checklist side by side (green = lulus / grade A, red = tidak lulus), then
// per store the average — of the year, or of all time ("Rata-rata" switch) — and, in its own column, an arrow
// saying whether that average went up or down against last month (no number, by request). A store row opens
// the store's own page (./[storeId]) with the month strip and the item-by-item comparison.
// Logic: lib/impact-visit/report.ts; data: GET /api/ops/impact-visits/report.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Navigation,
  Store,
  Video,
} from "lucide-react";

import OpsPageHeader from "@/components/ops/layout/OpsPageHeader";
import {
  OpsFilterSelect,
  OpsSearchInput,
  OpsSortControl,
} from "@/components/ops/layout/OpsToolbar";
import {
  IMPACT_CHECKLIST_PASS_THRESHOLD,
  VM_CHECKLIST_PASS_THRESHOLD,
} from "@/lib/impact-visit/scoring";
import {
  IMPACT_CHECKLIST_MAX_SCORE,
  VM_CHECKLIST_MAX_SCORE,
} from "@/lib/impact-visit/checklist-config";
import {
  REPORT_MONTHS,
  REPORT_SORT_OPTIONS,
  buildListRows,
  defaultReportSortDir,
  isAverageScope,
  monthLabel,
  reportListHref,
  reportTotals,
  sortReportRows,
  storeReportHref,
  type AverageScope,
  type ImpactReportResponse,
  type ReportCellSummary,
  type ReportListRow,
  type ReportSortKey,
  type ReportVisitType,
  type ScoreKind,
} from "@/lib/impact-visit/report";
import { matchesQuery } from "@/lib/ops-petty-cash";
import { TONES } from "@/lib/status-theme";
import { jakartaDateKey } from "@/lib/day-bucket";
import { cn } from "@/lib/utils";

type Show = "both" | ScoreKind;

const KIND_META: Record<ScoreKind, { short: string; label: string; pass: number; max: number }> = {
  checklist: {
    short: "IV",
    label: "Impact Visit",
    pass: IMPACT_CHECKLIST_PASS_THRESHOLD,
    max: IMPACT_CHECKLIST_MAX_SCORE,
  },
  vm: { short: "VM", label: "VM Checklist", pass: VM_CHECKLIST_PASS_THRESHOLD, max: VM_CHECKLIST_MAX_SCORE },
};

const PASS_PILL = `${TONES.success.soft} ${TONES.success.outline}`;
const FAIL_PILL = `${TONES.danger.soft} ${TONES.danger.outline}`;

const fmtScore = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });

function fmtVisitDay(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
  });
}

/** One score in a month cell: "IV 92" — green when it passed, red when not. */
function ScorePill({ kind, cell, compact }: { kind: ScoreKind; cell: ReportCellSummary; compact: boolean }) {
  const s = cell[kind];
  return (
    <span
      className={cn(
        "flex items-center justify-between gap-1 rounded-md font-bold tabular-nums",
        compact ? "h-5 px-1.5 text-[11px]" : "h-7 px-2 text-sm",
        s.pass ? PASS_PILL : FAIL_PILL,
      )}
    >
      {compact && <span className="text-[9px] font-semibold opacity-60">{KIND_META[kind].short}</span>}
      <span>{s.score}</span>
    </span>
  );
}

function cellTitle(month: string, cell: ReportCellSummary) {
  return [
    `${month} · ${fmtVisitDay(cell.visitDate)}${cell.visitorName ? ` · ${cell.visitorName}` : ""}`,
    `Impact Visit ${cell.checklist.score}/${cell.checklist.max} (${cell.checklist.pass ? "lulus" : "tidak lulus"}) · ${cell.findings.checklist} temuan`,
    `VM Checklist ${cell.vm.score}/${cell.vm.max} (${cell.vm.pass ? "lulus" : "tidak lulus"}) · ${cell.findings.vm} temuan`,
    `Uang kas ${cell.money.ok ? "sesuai" : "tidak sesuai"}`,
  ].join("\n");
}

function MonthCell({ cell, month, show, future }: { cell: ReportCellSummary | null; month: string; show: Show; future: boolean }) {
  if (!cell) {
    return (
      <span
        className={cn(
          "flex items-center justify-center text-xs",
          show === "both" ? "h-[2.75rem]" : "h-7",
          future ? "text-slate-200" : "text-slate-300",
        )}
        aria-label="Belum ada visit"
      >
        —
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-0.5" title={cellTitle(month, cell)}>
      {(show === "both" || show === "checklist") && <ScorePill kind="checklist" cell={cell} compact={show === "both"} />}
      {(show === "both" || show === "vm") && <ScorePill kind="vm" cell={cell} compact={show === "both"} />}
    </span>
  );
}

/** The average of one checklist (this year or all time), coloured against its pass line. */
function AverageLine({ row, kind, compact }: { row: ReportListRow; kind: ScoreKind; compact: boolean }) {
  const avg = row.average.avg[kind];
  const meta = KIND_META[kind];
  if (avg == null) return <span className="flex h-5 items-center justify-end text-xs text-slate-300">—</span>;
  const pass = avg >= meta.pass;
  return (
    <span
      className="flex h-5 items-center justify-end gap-1.5 whitespace-nowrap text-xs"
      title={`${meta.label}: rata-rata ${row.average.months} bulan`}
    >
      {compact && <span className="text-[10px] font-semibold text-slate-400">{meta.short}</span>}
      <span className={cn("font-bold tabular-nums", pass ? TONES.success.strong : TONES.danger.strong)}>{fmtScore(avg)}</span>
    </span>
  );
}

/** Which way that average went against last month — an arrow only, no number. */
function TrendMark({ row, kind, compact }: { row: ReportListRow; kind: ScoreKind; compact: boolean }) {
  const trend = row.average.trend[kind];
  const meta = KIND_META[kind];
  const { latestMonth, previousMonth } = row.average;
  const span = "flex h-5 items-center justify-center gap-1";
  if (trend == null || !latestMonth || !previousMonth) {
    return (
      <span className={span} title="Belum ada bulan sebelumnya untuk dibandingkan">
        {compact && <span className="text-[10px] font-semibold text-slate-300">{meta.short}</span>}
        <span className="text-xs text-slate-300">—</span>
      </span>
    );
  }
  const words = trend === "up" ? "naik" : trend === "down" ? "turun" : "tetap";
  const Icon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : ArrowRight;
  return (
    <span
      className={span}
      title={`${meta.label}: rata-rata ${words} dibanding bulan lalu (s/d ${monthLabel(previousMonth)} → s/d ${monthLabel(latestMonth)})`}
      aria-label={`${meta.label} ${words}`}
    >
      {compact && <span className="text-[10px] font-semibold text-slate-400">{meta.short}</span>}
      <Icon
        className={cn(
          "h-4 w-4",
          trend === "up" ? TONES.success.text : trend === "down" ? TONES.danger.text : "text-slate-400",
        )}
        strokeWidth={2.5}
      />
    </span>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pass" | "fail" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          tone === "pass" ? TONES.success.strong : tone === "fail" ? TONES.danger.strong : "text-slate-900",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; Icon?: React.ElementType }[];
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-slate-500">{label}</p>
      <div className="flex h-11 items-center rounded-xl bg-slate-100 p-1" role="group" aria-label={label}>
        {options.map(({ value: v, label: l, Icon }) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "flex h-9 items-center gap-2 rounded-lg px-3.5 text-xs font-semibold transition-colors",
              value === v ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ReportStoreList({
  initialYear,
  initialType,
  initialAvg,
}: {
  initialYear: number;
  initialType: ReportVisitType;
  initialAvg: AverageScope;
}) {
  const router = useRouter();
  const [year, setYear] = useState(initialYear);
  const [visitType, setVisitType] = useState<ReportVisitType>(initialType);
  const [show, setShow] = useState<Show>("both");
  const [avgScope, setAvgScope] = useState<AverageScope>(initialAvg);
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<"all" | number>("all");
  const [visitedOnly, setVisitedOnly] = useState(false);
  const [sort, setSort] = useState<{ key: ReportSortKey; dir: "asc" | "desc" }>({ key: "store", dir: "asc" });

  const [data, setData] = useState<ImpactReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  // Keep the year + visit type (+ the average's scope) in the address bar (the store page's "back" and a
  // reload land on the same view).
  useEffect(() => {
    const href = reportListHref(year, visitType) + (avgScope === "all" ? "&avg=all" : "");
    window.history.replaceState(window.history.state, "", href);
  }, [year, visitType, avgScope]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/ops/impact-visits/report?year=${year}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await res.json();
        if (!res.ok || !body.success) throw new Error("Gagal memuat laporan. Silakan coba lagi.");
        if (!controller.signal.aborted) setData(body as ImpactReportResponse);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Gagal memuat laporan.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [year, revision]);

  const isHO = data?.isHO === true;
  const areaOptions = useMemo(
    () => (data?.groups ?? []).map((g) => ({ id: g.id, name: g.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  const allRows = useMemo(
    () =>
      data
        ? buildListRows(data.groups, data.stores, visitType, { year: data.year, scope: avgScope, history: data.history })
        : [],
    [data, visitType, avgScope],
  );
  const rows = allRows.filter(
    (r) =>
      (area === "all" || r.areaId === area) &&
      (!visitedOnly || r.summary.visited > 0) &&
      matchesQuery([r.storeNo, r.storeName, r.areaName], query),
  );
  const sorted = sortReportRows(rows, sort.key, sort.dir);
  const totals = reportTotals(rows);

  const today = jakartaDateKey(new Date());
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7)); // 1–12
  const isFuture = (i: number) => year > thisYear || (year === thisYear && i + 1 > thisMonth);
  const isCurrent = (i: number) => year === thisYear && i + 1 === thisMonth;

  const filtersActive = query.trim() !== "" || area !== "all" || visitedOnly;
  const clear = () => {
    setQuery("");
    setArea("all");
    setVisitedOnly(false);
  };

  const typeLabel = visitType === "virtual" ? "Virtual" : "On Location";
  const avgScopeLabel = avgScope === "all" ? `sepanjang waktu (s/d ${year})` : `tahun ${year}`;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        title="Laporan Bulanan"
        scope="Impact Visit / Laporan"
        subtitle={`Skor Impact Visit & VM Checklist setiap toko per bulan · ${year} · ${typeLabel}`}
        className="bg-white"
        onRefresh={() => setRevision((r) => r + 1)}
        refreshing={loading}
      />

      {/* This stacking context keeps the frozen table cells below the page header. */}
      <div className="relative z-0 space-y-5 p-4 lg:p-6">
        <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-500">Tahun laporan</p>
            <div className="flex h-11 items-center rounded-xl border border-slate-200">
              <button
                type="button"
                aria-label="Tahun sebelumnya"
                disabled={year <= 2001}
                onClick={() => setYear((y) => y - 1)}
                className="p-3 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 text-sm font-bold tabular-nums">{year}</span>
              <button
                type="button"
                aria-label="Tahun berikutnya"
                disabled={year >= 2199}
                onClick={() => setYear((y) => y + 1)}
                className="p-3 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <Segmented
            label="Jenis kunjungan"
            value={visitType}
            onChange={setVisitType}
            options={[
              { value: "onLocation", label: "On Location", Icon: Navigation },
              { value: "virtual", label: "Virtual", Icon: Video },
            ]}
          />
          <Segmented
            label="Tampilkan skor"
            value={show}
            onChange={setShow}
            options={[
              { value: "both", label: "Impact Visit + VM" },
              { value: "checklist", label: "Impact Visit" },
              { value: "vm", label: "VM Checklist" },
            ]}
          />
          <Segmented
            label="Rata-rata"
            value={avgScope}
            onChange={(v) => isAverageScope(v) && setAvgScope(v)}
            options={[
              { value: "year", label: `Tahun ${year}` },
              { value: "all", label: "Sepanjang waktu" },
            ]}
          />
        </section>

        {error ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
            {error}{" "}
            <button type="button" className="ml-2 font-bold underline" onClick={() => setRevision((r) => r + 1)}>
              Coba lagi
            </button>
          </div>
        ) : loading && !data ? (
          <div className="flex justify-center py-24">
            <Loader2 aria-label="Memuat laporan" className="h-7 w-7 animate-spin text-indigo-500" />
          </div>
        ) : data ? (
          <>
            {/* Key numbers (follow the filters) */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile
                label="Toko dikunjungi"
                value={`${totals.visitedStores} / ${totals.stores}`}
                sub={`${typeLabel}, ${year}`}
              />
              <Tile label="Total visit" value={String(totals.visits)} sub="1 visit per toko per bulan dihitung" />
              <Tile
                label="Rata-rata Impact Visit"
                value={totals.avg.checklist == null ? "—" : fmtScore(totals.avg.checklist)}
                sub={
                  totals.passRate.checklist == null
                    ? `dari ${IMPACT_CHECKLIST_MAX_SCORE} poin · ${avgScopeLabel}`
                    : `dari ${IMPACT_CHECKLIST_MAX_SCORE} · ${totals.passRate.checklist}% visit lulus (≥ ${IMPACT_CHECKLIST_PASS_THRESHOLD}) · ${avgScopeLabel}`
                }
                tone={totals.avg.checklist == null ? undefined : totals.avg.checklist >= IMPACT_CHECKLIST_PASS_THRESHOLD ? "pass" : "fail"}
              />
              <Tile
                label="Rata-rata VM Checklist"
                value={totals.avg.vm == null ? "—" : fmtScore(totals.avg.vm)}
                sub={
                  totals.passRate.vm == null
                    ? `dari ${VM_CHECKLIST_MAX_SCORE} poin · ${avgScopeLabel}`
                    : `dari ${VM_CHECKLIST_MAX_SCORE} · ${totals.passRate.vm}% visit lulus (≥ ${VM_CHECKLIST_PASS_THRESHOLD}) · ${avgScopeLabel}`
                }
                tone={totals.avg.vm == null ? undefined : totals.avg.vm >= VM_CHECKLIST_PASS_THRESHOLD ? "pass" : "fail"}
              />
            </div>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {/* Search / filter / sort */}
              <div className="space-y-3 border-b border-slate-100 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <OpsSearchInput value={query} onChange={setQuery} placeholder="Cari toko atau kode…" className="max-w-md" />
                  {isHO && areaOptions.length > 1 && (
                    <OpsFilterSelect
                      label="Area"
                      value={String(area)}
                      onChange={(v) => setArea(v === "all" ? "all" : Number(v))}
                    >
                      <option value="all">Semua area</option>
                      {areaOptions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </OpsFilterSelect>
                  )}
                  <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={visitedOnly}
                      onChange={(e) => setVisitedOnly(e.target.checked)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    Hanya toko yang ada visit
                  </label>
                  {filtersActive && (
                    <button type="button" onClick={clear} className="text-xs font-semibold text-slate-500 underline hover:text-slate-700">
                      Hapus filter
                    </button>
                  )}
                  <div className="ml-auto">
                    <OpsSortControl
                      options={REPORT_SORT_OPTIONS}
                      sortKey={sort.key}
                      sortDir={sort.dir}
                      onChange={({ key, dir, keyChanged }) =>
                        setSort({ key, dir: keyChanged ? defaultReportSortDir(key) : dir })
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("h-3 w-5 rounded", PASS_PILL)} /> Lulus (grade A)
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("h-3 w-5 rounded", FAIL_PILL)} /> Tidak lulus
                  </span>
                  <span>— Belum ada visit</span>
                  <span className="text-slate-400">
                    Batas lulus: Impact Visit ≥ {IMPACT_CHECKLIST_PASS_THRESHOLD}/{IMPACT_CHECKLIST_MAX_SCORE} · VM ≥{" "}
                    {VM_CHECKLIST_PASS_THRESHOLD}/{VM_CHECKLIST_MAX_SCORE}
                  </span>
                  <span className="ml-auto text-slate-400">
                    {sorted.length} toko · klik toko untuk detail
                  </span>
                </div>
              </div>

              {sorted.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                  <Store className="h-9 w-9 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-600">
                    {filtersActive ? "Tidak ada toko yang cocok dengan filter." : "Belum ada toko di area Anda."}
                  </p>
                  {filtersActive && (
                    <button
                      type="button"
                      onClick={clear}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Hapus filter
                    </button>
                  )}
                </div>
              ) : (
                <div
                  role="region"
                  aria-label="Skor bulanan per toko"
                  tabIndex={0}
                  className={cn(
                    "relative isolate max-h-[70vh] overflow-auto focus-visible:outline-2 focus-visible:outline-indigo-500",
                    loading && "opacity-60",
                  )}
                >
                  <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-xs">
                    <caption className="sr-only">
                      Skor Impact Visit dan VM Checklist per toko per bulan, {year}, {typeLabel}
                    </caption>
                    <thead className="sticky top-0 z-20">
                      <tr>
                        <th
                          scope="col"
                          className="sticky left-0 z-30 w-64 min-w-64 border-b border-r border-slate-200 bg-slate-100 px-4 py-3 text-left text-slate-600"
                        >
                          Toko
                        </th>
                        {REPORT_MONTHS.map((m, i) => (
                          <th
                            key={m}
                            scope="col"
                            className={cn(
                              "min-w-[3.75rem] border-b border-slate-200 px-1.5 py-3 text-center",
                              isCurrent(i) ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600",
                            )}
                          >
                            {m}
                          </th>
                        ))}
                        <th
                          scope="col"
                          className="min-w-24 border-b border-l border-slate-200 bg-slate-100 px-3 py-3 text-right text-slate-600"
                          title={`Rata-rata ${avgScopeLabel}`}
                        >
                          Rata-rata
                          <span className="block text-[10px] font-normal text-slate-400">
                            {avgScope === "all" ? "Sepanjang waktu" : `Tahun ${year}`}
                          </span>
                        </th>
                        <th
                          scope="col"
                          className="min-w-20 border-b border-slate-200 bg-slate-100 px-2 py-3 text-center text-slate-600"
                          title="Rata-rata naik / turun dibanding bulan lalu"
                        >
                          Tren
                          <span className="block text-[10px] font-normal text-slate-400">vs bulan lalu</span>
                        </th>
                        <th
                          scope="col"
                          className="min-w-16 border-b border-slate-200 bg-slate-100 px-3 py-3 text-center text-slate-600"
                          title="Bulan dengan visit"
                        >
                          Bulan
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r) => {
                        const href = storeReportHref(r.storeId, year, visitType);
                        const empty = r.summary.visited === 0;
                        return (
                          <tr
                            key={r.storeId}
                            onClick={() => router.push(href)}
                            className="group cursor-pointer"
                          >
                            <th
                              scope="row"
                              className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-4 py-2.5 text-left font-normal group-hover:bg-indigo-50/60"
                            >
                              <Link
                                href={href}
                                onClick={(e) => e.stopPropagation()}
                                className={cn(
                                  "block truncate text-sm font-bold hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-500",
                                  empty ? "text-slate-500" : "text-slate-800",
                                )}
                              >
                                {r.storeName}
                              </Link>
                              <span className="block truncate text-[11px] text-slate-400">
                                <span className="font-mono">{r.storeNo}</span>
                                {isHO && <> · {r.areaName}</>}
                                {empty && <> · belum ada visit</>}
                              </span>
                            </th>
                            {r.cells.map((cell, i) => (
                              <td
                                key={i}
                                className={cn(
                                  "border-b border-slate-100 px-1 py-1.5 group-hover:bg-indigo-50/40",
                                  isCurrent(i) && "bg-indigo-50/30",
                                )}
                              >
                                <MonthCell cell={cell} month={REPORT_MONTHS[i]} show={show} future={isFuture(i)} />
                              </td>
                            ))}
                            <td className="border-b border-l border-slate-100 px-3 py-1.5 group-hover:bg-indigo-50/40">
                              <span className="flex flex-col gap-1">
                                {(show === "both" || show === "checklist") && (
                                  <AverageLine row={r} kind="checklist" compact={show === "both"} />
                                )}
                                {(show === "both" || show === "vm") && <AverageLine row={r} kind="vm" compact={show === "both"} />}
                              </span>
                            </td>
                            <td className="border-b border-slate-100 px-2 py-1.5 group-hover:bg-indigo-50/40">
                              <span className="flex flex-col gap-1">
                                {(show === "both" || show === "checklist") && (
                                  <TrendMark row={r} kind="checklist" compact={show === "both"} />
                                )}
                                {(show === "both" || show === "vm") && <TrendMark row={r} kind="vm" compact={show === "both"} />}
                              </span>
                            </td>
                            <td className="border-b border-slate-100 px-3 py-1.5 text-center group-hover:bg-indigo-50/40">
                              <span className={cn("font-bold tabular-nums", empty ? "text-slate-300" : "text-slate-700")}>
                                {r.summary.visited}
                              </span>
                              <span className="text-[10px] text-slate-400">/12</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
              <ClipboardCheck className="mt-px h-3.5 w-3.5 shrink-0 text-indigo-400" />
              Skor = nilai asli saat visit disubmit (visit terakhir bulan itu bila ada lebih dari satu). Rata-rata dihitung
              dari bulan yang ada visit — tahun {year} saja, atau sepanjang waktu (semua visit sampai akhir {year}). Tren =
              rata-rata naik (↗) atau turun (↘) dibanding bulan lalu: rata-rata dengan bulan visit terakhir dibanding
              rata-rata sebelum bulan itu. Arahkan kursor ke sel untuk tanggal, pengunjung dan jumlah temuan.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
