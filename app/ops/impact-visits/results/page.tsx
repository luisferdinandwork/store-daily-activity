"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, ClipboardCheck, UserRound } from "lucide-react";
import OpsPageHeader from "@/components/ops/layout/OpsPageHeader";
import {
  OpsList,
  OpsListRow,
  OpsListSkeleton,
} from "@/components/ops/layout/OpsList";
import {
  OpsChipTabs,
  OpsFilterSelect,
  OpsSearchInput,
} from "@/components/ops/layout/OpsToolbar";
import { CheckProgress } from "@/components/shared/ImpactFollowUp";
import type { ImpactVisitResultSummary } from "@/lib/impact-visit/results";

type Result = ImpactVisitResultSummary & {
  visitedBy: string;
  store: { id: number; name: string; storeNo: string };
  areaName: string | null;
};
type Filter = "all" | "due" | "open" | "done";

export default function ImpactResultsPage() {
  const router = useRouter();
  const [visits, setVisits] = useState<Result[]>([]);
  const [isHO, setIsHO] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [creator, setCreator] = useState("all");
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/ops/impact-visits/results", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok || !data.success)
          throw new Error(data.error ?? "Gagal memuat hasil visit.");
        if (!controller.signal.aborted) {
          setVisits(data.visits);
          setIsHO(data.isHO);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Gagal memuat hasil visit.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  const creators = [
    ...new Map(
      visits.map((v) => [v.visitedBy, v.visitedByName ?? "Ops"]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const matching = visits.filter(
    (v) =>
      (creator === "all" || v.visitedBy === creator) &&
      `${v.store.name} ${v.store.storeNo} ${v.areaName} ${v.visitedByName}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const counts = {
    all: matching.length,
    due: matching.filter((v) => v.followUp.dueThisWeek > 0).length,
    open: matching.filter((v) => v.followUp.total > v.followUp.verified).length,
    done: matching.filter((v) => v.followUp.total === v.followUp.verified)
      .length,
  };
  const visible = matching.filter(
    (v) =>
      filter === "all" ||
      (filter === "due"
        ? v.followUp.dueThisWeek > 0
        : filter === "open"
          ? v.followUp.total > v.followUp.verified
          : v.followUp.total === v.followUp.verified),
  );
  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        title="Hasil Visit"
        scope="Impact Visit / Tindak lanjut"
        subtitle={
          isHO
            ? "Pantau temuan dan pemeriksaan mingguan oleh pembuat visit."
            : "Periksa kembali temuan dari visit yang Anda buat."
        }
        className="bg-white"
        onRefresh={() => setRevision((r) => r + 1)}
        refreshing={loading}
      />
      <div className="relative z-0 mx-auto max-w-7xl space-y-5 p-4 lg:p-6 @container">
        <div className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
          <CalendarCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
          <div>
            <p className="text-sm font-semibold text-indigo-950">
              Pemeriksaan setiap minggu
            </p>
            <p className="mt-1 text-xs leading-relaxed text-indigo-700">
              Minggu berjalan: Senin–Minggu (WIB). Periksa poin yang belum
              selesai, lalu simpan status dan catatannya. Hasilnya dapat dilihat
              tim toko.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <OpsSearchInput
            value={query}
            onChange={setQuery}
            placeholder="Cari toko, kode, area, atau Ops…"
          />
          {isHO && (
            <OpsFilterSelect
              label="Pembuat visit"
              value={creator}
              onChange={setCreator}
            >
              <option value="all">Semua pembuat visit</option>
              {creators.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </OpsFilterSelect>
          )}
        </div>
        <OpsChipTabs
          value={filter}
          onChange={setFilter}
          items={[
            { key: "all", label: "Semua", count: counts.all },
            { key: "due", label: "Perlu cek minggu ini", count: counts.due },
            { key: "open", label: "Belum selesai", count: counts.open },
            { key: "done", label: "Selesai", count: counts.done },
          ]}
        />
        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700"
          >
            {error}
          </p>
        ) : loading ? (
          <OpsListSkeleton />
        ) : !visible.length ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
            <ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <p className="text-sm font-semibold text-slate-700">
              Belum ada hasil visit yang cocok
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Hasil muncul setelah visit disubmit. Coba ubah filter Anda.
            </p>
          </div>
        ) : (
          <OpsList>
            {visible.map((v) => (
              <OpsListRow
                key={v.id}
                className="md:flex-wrap @4xl:flex-nowrap"
                onClick={() =>
                  router.push(`/ops/impact-visits/results/${v.id}`)
                }
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-xs text-slate-400">
                    {v.store.storeNo} · {v.areaName}
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {v.store.name}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(v.visitDate).toLocaleDateString("id-ID", {
                      timeZone: "Asia/Jakarta",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}{" "}
                    ·{" "}
                    {v.visitType === "virtual"
                      ? "Virtual"
                      : v.visitType === "on_location"
                        ? "On Location"
                        : "Visit"}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <UserRound className="h-3.5 w-3.5" />
                    {v.visitedByName ?? "Ops"}
                  </p>
                </div>
                <div className="w-full space-y-2 @4xl:w-64">
                  <CheckProgress summary={v.followUp} />
                  {v.followUp.dueThisWeek > 0 && (
                    <p className="text-xs font-semibold text-amber-700">
                      {v.followUp.dueThisWeek} poin perlu dicek minggu ini
                    </p>
                  )}
                </div>
              </OpsListRow>
            ))}
          </OpsList>
        )}
      </div>
    </div>
  );
}
