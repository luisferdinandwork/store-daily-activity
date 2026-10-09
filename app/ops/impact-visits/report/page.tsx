"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Minus,
  Navigation,
  Video,
  X,
} from "lucide-react";
import OpsPageHeader from "@/components/ops/layout/OpsPageHeader";
import { OpsSearchInput } from "@/components/ops/layout/OpsToolbar";
import StorePickerCombobox, {
  type AreaGroupOption,
} from "@/components/ops/impact-visits/StorePickerCombobox";
import {
  IMPACT_CHECKLIST,
  VM_CHECKLIST,
} from "@/lib/impact-visit/checklist-config";
import type { ReportCell, StoreReportRow } from "@/lib/impact-visit/report";
import { jakartaDateKey } from "@/lib/day-bucket";
import { cn } from "@/lib/utils";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];
type VisitType = "onLocation" | "virtual";
type Checklist = "checklist" | "vm";

function Cell({
  cell,
  itemId,
  checklist,
}: {
  cell: ReportCell | null;
  itemId: string;
  checklist: Checklist;
}) {
  const response = (
    checklist === "checklist"
      ? cell?.checklistResponses
      : cell?.vmChecklistResponses
  )?.[itemId];
  const answer = response?.answer;
  const label = !cell
    ? "Tidak ada kunjungan"
    : !answer
      ? "Belum dijawab"
      : answer === "ya"
        ? "Ya"
        : "Tidak";
  return (
    <span
      title={[label, response?.note].filter(Boolean).join(" · ")}
      aria-label={label}
      className={cn(
        "mx-auto flex h-7 w-8 items-center justify-center rounded-md",
        answer === "ya"
          ? "bg-emerald-50 text-emerald-600"
          : answer === "tidak"
            ? "bg-rose-100 text-rose-700"
            : cell
              ? "bg-amber-50 text-amber-700"
              : "text-slate-300",
      )}
    >
      {answer === "ya" ? (
        <Check className="h-3.5 w-3.5" />
      ) : answer === "tidak" ? (
        <X className="h-3.5 w-3.5" />
      ) : cell ? (
        <span className="text-xs">?</span>
      ) : (
        <Minus className="h-3 w-3" />
      )}
    </span>
  );
}

export default function ImpactVisitReportPage() {
  const [year, setYear] = useState(() =>
    Number(jakartaDateKey(new Date()).slice(0, 4)),
  );
  const [data, setData] = useState<{
    stores: StoreReportRow[];
    groups: AreaGroupOption[];
  } | null>(null);
  const [storeId, setStoreId] = useState("");
  const [visitType, setVisitType] = useState<VisitType>("onLocation");
  const [checklist, setChecklist] = useState<Checklist>("checklist");
  const [query, setQuery] = useState("");
  const [negativeOnly, setNegativeOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [reportResponse, storeResponse] = await Promise.all([
          fetch(`/api/ops/impact-visits/report?year=${year}`, {
            signal: controller.signal,
            cache: "no-store",
          }),
          fetch("/api/ops/stores", {
            signal: controller.signal,
            cache: "no-store",
          }),
        ]);
        const [report, stores] = await Promise.all([
          reportResponse.json(),
          storeResponse.json(),
        ]);
        if (
          !reportResponse.ok ||
          !storeResponse.ok ||
          !report.success ||
          !stores.success
        )
          throw new Error("Gagal memuat laporan. Silakan coba lagi.");
        if (controller.signal.aborted) return;
        setData({ stores: report.stores, groups: stores.data });
        setStoreId(
          (current) =>
            current ||
            report.stores[0]?.storeId ||
            String(stores.data[0]?.stores[0]?.id ?? ""),
        );
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Gagal memuat laporan.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [year, revision]);

  const store = data?.groups
    .flatMap((g) => g.stores)
    .find((s) => String(s.id) === storeId);
  const area = data?.groups.find((g) =>
    g.stores.some((s) => String(s.id) === storeId),
  );
  const report = data?.stores.find((s) => s.storeId === storeId);
  const months = MONTHS.map(
    (_, i) => report?.months[String(i + 1)]?.[visitType] ?? null,
  );
  const visits = months.filter((c): c is ReportCell => c !== null);
  const latest = visits.at(-1);
  const definitions =
    checklist === "checklist" ? IMPACT_CHECKLIST : VM_CHECKLIST;
  const items = definitions.filter(
    (i) =>
      `${i.criteria} ${i.section} ${i.hint}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!negativeOnly ||
        months.some(
          (c) =>
            (checklist === "checklist"
              ? c?.checklistResponses
              : c?.vmChecklistResponses)?.[i.id]?.answer === "tidak",
        )),
  );
  const sections = [...new Set(items.map((i) => i.section))];
  const latestNegatives = latest
    ? [
        ...Object.values(latest.checklistResponses),
        ...Object.values(latest.vmChecklistResponses),
      ].filter((r) => r.answer === "tidak").length
    : 0;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        title="Laporan Bulanan"
        scope="Impact Visit / Laporan"
        subtitle="Pantau perubahan standar toko dari bulan ke bulan."
        className="bg-white"
        onRefresh={() => setRevision((r) => r + 1)}
        refreshing={loading}
      />
      {/* This stacking context keeps every frozen table cell below the page header. */}
      <div className="relative z-0 mx-auto max-w-[1600px] space-y-5 p-4 lg:p-6">
        <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="min-w-56 flex-1">
            <p className="mb-2 text-xs font-semibold text-slate-500">Toko</p>
            <StorePickerCombobox
              storeGroups={data?.groups ?? []}
              selectedValue={storeId}
              triggerLabel={store?.name ?? ""}
              placeholder="Pilih toko…"
              onSelect={setStoreId}
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-500">
              Tahun laporan
            </p>
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
              <span className="px-3 text-sm font-bold tabular-nums">
                {year}
              </span>
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
          <div
            className="flex h-11 items-center rounded-xl bg-slate-100 p-1"
            aria-label="Jenis kunjungan"
          >
            {(
              [
                { value: "onLocation", label: "On Location", Icon: Navigation },
                { value: "virtual", label: "Virtual", Icon: Video },
              ] as const
            ).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={visitType === value}
                onClick={() => setVisitType(value)}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-semibold",
                  visitType === value
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-500",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </section>

        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700"
          >
            {error}{" "}
            <button
              type="button"
              className="ml-2 font-bold underline"
              onClick={() => setRevision((r) => r + 1)}
            >
              Coba lagi
            </button>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-24">
            <Loader2
              aria-label="Memuat laporan"
              className="h-7 w-7 animate-spin text-indigo-500"
            />
          </div>
        ) : !store ? (
          <p className="py-20 text-center text-sm text-slate-500">
            Pilih toko untuk melihat laporan.
          </p>
        ) : (
          <>
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5">
                <div>
                  <p className="text-xs font-medium text-indigo-600">
                    {store.storeNo} · {area?.name}
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-slate-900">
                    {store.name}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Kunjungan terakhir yang disubmit per bulan ·{" "}
                    {visitType === "virtual" ? "Virtual" : "On Location"}
                  </p>
                </div>
                <div className="flex gap-6">
                  <div>
                    <p className="text-2xl font-bold tabular-nums text-slate-900">
                      {visits.length}
                      <span className="text-sm font-normal text-slate-400">
                        {" "}
                        / 12
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">Bulan terisi</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums text-rose-600">
                      {latest ? latestNegatives : "—"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Temuan visit terakhir
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 divide-x divide-slate-100 sm:grid-cols-6 xl:grid-cols-12">
                {months.map((cell, i) => (
                  <div
                    key={i}
                    className={cn(
                      "border-b border-slate-100 p-3",
                      !cell && "bg-slate-50/60",
                    )}
                  >
                    <p className="mb-3 text-xs font-bold text-slate-500">
                      {MONTHS[i]}
                    </p>
                    {cell ? (
                      <Link
                        href={`/ops/impact-visits/${cell.visitId}`}
                        className="group block rounded focus-visible:outline-2 focus-visible:outline-indigo-500"
                        title={`${cell.visitorName ?? "Ops"} · Buka visit`}
                      >
                        <div className="flex items-baseline justify-between">
                          <strong
                            className={cn(
                              "text-lg tabular-nums",
                              cell[checklist].pass
                                ? "text-emerald-700"
                                : "text-rose-700",
                            )}
                          >
                            {cell[checklist].score}
                          </strong>
                          <ArrowUpRight className="h-3 w-3 text-slate-400 group-hover:text-indigo-600" />
                        </div>
                        <div className="my-2 h-1 overflow-hidden rounded bg-slate-100">
                          <div
                            className={cn(
                              "h-full",
                              cell[checklist].pass
                                ? "bg-emerald-500"
                                : "bg-rose-400",
                            )}
                            style={{
                              width: `${(cell[checklist].score / cell[checklist].max) * 100}%`,
                            }}
                          />
                        </div>
                        <p className="text-[10px] text-slate-500">
                          dari {cell[checklist].max} poin
                        </p>
                      </Link>
                    ) : (
                      <>
                        <span className="text-lg text-slate-300">—</span>
                        <p className="mt-3 text-[10px] text-slate-400">
                          Belum ada visit
                        </p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                      <ClipboardCheck className="h-4 w-4 text-indigo-500" />
                      Perbandingan checklist
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Nilai asli saat visit. Verifikasi perbaikan tersedia di
                      menu Hasil Visit.
                    </p>
                  </div>
                  <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                    {(["checklist", "vm"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        aria-pressed={checklist === tab}
                        onClick={() => setChecklist(tab)}
                        className={cn(
                          "rounded-lg px-4 py-2 text-xs font-semibold",
                          checklist === tab
                            ? "bg-white text-indigo-700 shadow-sm"
                            : "text-slate-500",
                        )}
                      >
                        {tab === "checklist" ? "Impact Visit" : "VM Checklist"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <OpsSearchInput
                    value={query}
                    onChange={setQuery}
                    placeholder="Cari poin pemeriksaan…"
                  />
                  <label className="flex min-h-10 cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={negativeOnly}
                      onChange={(e) => setNegativeOnly(e.target.checked)}
                      className="h-4 w-4 accent-rose-600"
                    />
                    Hanya pernah Tidak
                  </label>
                  <span className="text-xs text-slate-400">
                    {items.length} poin
                  </span>
                </div>
                <div className="flex flex-wrap gap-4 text-[11px] text-slate-500">
                  <span className="text-emerald-700">✓ Ya</span>
                  <span className="text-rose-700">× Tidak</span>
                  <span className="text-amber-700">? Belum dijawab</span>
                  <span>— Tidak ada visit</span>
                </div>
              </div>
              <div
                role="region"
                aria-label="Tabel perbandingan bulanan"
                tabIndex={0}
                className="relative isolate max-h-[65vh] overflow-auto border-t border-slate-200 focus-visible:outline-2 focus-visible:outline-indigo-500"
              >
                <table className="w-full min-w-[980px] border-separate border-spacing-0 text-xs">
                  <caption className="sr-only">
                    Perbandingan{" "}
                    {checklist === "vm" ? "VM Checklist" : "Impact Visit"}{" "}
                    {store.name}, {year}
                  </caption>
                  <thead className="sticky top-0 z-20">
                    <tr>
                      <th
                        scope="col"
                        className="sticky left-0 z-30 w-80 min-w-80 border-b border-r border-slate-200 bg-slate-100 px-4 py-3 text-left text-slate-600"
                      >
                        Poin pemeriksaan
                      </th>
                      {MONTHS.map((m) => (
                        <th
                          key={m}
                          scope="col"
                          className="min-w-12 border-b border-slate-200 bg-slate-100 px-2 py-3 text-slate-600"
                        >
                          {m}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map((section) => (
                      <Fragment key={section}>
                        <tr>
                          <th
                            scope="rowgroup"
                            className="sticky left-0 z-10 border-b border-r border-slate-100 bg-indigo-50 px-4 py-2 text-left text-[11px] font-bold text-indigo-700"
                          >
                            {section}
                          </th>
                          <td
                            colSpan={12}
                            className="border-b border-slate-100 bg-indigo-50"
                          />
                        </tr>
                        {items
                          .filter((i) => i.section === section)
                          .map((item) => (
                            <tr key={item.id} className="group">
                              <th
                                scope="row"
                                title={item.hint}
                                className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-4 py-3 text-left font-medium leading-relaxed text-slate-700 group-hover:bg-slate-50"
                              >
                                {item.criteria}
                                <span className="ml-2 text-[10px] font-normal text-slate-400">
                                  {item.points} pt
                                </span>
                              </th>
                              {months.map((cell, i) => (
                                <td
                                  key={i}
                                  className="border-b border-slate-100 px-1 py-2 group-hover:bg-slate-50"
                                >
                                  <Cell
                                    cell={cell}
                                    checklist={checklist}
                                    itemId={item.id}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {items.length === 0 && (
                  <p className="p-12 text-center text-sm text-slate-500">
                    Tidak ada poin yang cocok dengan filter.
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
