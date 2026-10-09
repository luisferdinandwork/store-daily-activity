"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  Loader2,
  Save,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import OpsPageHeader from "@/components/ops/layout/OpsPageHeader";
import { OpsChipTabs } from "@/components/ops/layout/OpsToolbar";
import {
  CheckProgress,
  CheckStatus,
  CheckTimeline,
  checkDate,
} from "@/components/shared/ImpactFollowUp";
import {
  FOLLOW_UP_LABEL,
  FOLLOW_UP_CHOICES,
  followUpChoice,
  followUpSummary,
  type FollowUpCheck,
  type FollowUpStatus,
} from "@/lib/impact-visit/follow-up";
import {
  groupBySection,
  type NegativeItem,
  type OpsImpactVisitResult,
} from "@/lib/impact-visit/results";

function ReviewPoint({
  item,
  checks,
  canReview,
  busy,
  onSave,
}: {
  item: NegativeItem;
  checks: FollowUpCheck[];
  canReview: boolean;
  busy: boolean;
  onSave: (
    itemId: string,
    status: FollowUpStatus,
    note: string,
  ) => Promise<void>;
}) {
  const [status, setStatus] = useState<FollowUpStatus>(
    followUpChoice(item.followUp?.status ?? "needs_fix"),
  );
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const due = followUpSummary([item.id], checks).dueThisWeek > 0;
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold leading-relaxed text-slate-900">
            {item.criteria}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {item.hint}
          </p>
        </div>
        <CheckStatus status={item.followUp?.status} />
      </div>
      {item.note && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
            Catatan saat visit
          </p>
          <p className="mt-1 whitespace-pre-line text-xs text-amber-950">
            {item.note}
          </p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div>
          <p className="text-xs text-slate-500">
            {item.followUp
              ? `Terakhir diperiksa ${checkDate(item.followUp.checkedAt)} WIB`
              : "Belum pernah diperiksa ulang"}
          </p>
          {due && (
            <p className="mt-1 text-xs font-semibold text-amber-700">
              Perlu pemeriksaan minggu ini
            </p>
          )}
        </div>
        {canReview && !editing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
            className="rounded-xl bg-indigo-50 px-4 py-2.5 text-xs font-semibold text-indigo-700 disabled:opacity-50"
          >
            Catat pemeriksaan
          </button>
        )}
      </div>
      {item.followUp?.note && (
        <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
          {item.followUp.note}
        </p>
      )}
      {canReview && editing && (
        <form
          className="mt-4 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await onSave(item.id, status, note);
          }}
        >
          <fieldset disabled={busy} className="space-y-3">
            <legend className="mb-2 text-xs font-semibold text-indigo-950">
              Hasil pemeriksaan minggu ini
            </legend>
            <div className="flex flex-wrap gap-2">
              {FOLLOW_UP_CHOICES.map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700 has-checked:border-indigo-400 has-checked:bg-indigo-50"
                >
                  <input
                    type="radio"
                    name={`status-${item.id}`}
                    value={value}
                    checked={status === value}
                    onChange={() => setStatus(value)}
                    className="accent-indigo-600"
                  />
                  {FOLLOW_UP_LABEL[value]}
                </label>
              ))}
            </div>
            <label className="block text-xs font-semibold text-slate-600">
              Catatan pemeriksaan (opsional)
              <textarea
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Jelaskan perkembangan perbaikan atau hasil pengecekan…"
                className="mt-2 block w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-base font-normal md:text-sm focus:outline-2 focus:outline-indigo-400"
              />
            </label>
            <p className="text-[11px] text-slate-500">
              Pilih Sudah diperbaiki bila perbaikan telah selesai dan diperiksa.
              Status dapat dikembalikan ke Belum diperbaiki jika masalah berulang.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-500"
              >
                Batal
              </button>
              <button
                type="submit"
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Simpan pemeriksaan
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <div className="mt-3">
        <CheckTimeline checks={checks} />
      </div>
    </article>
  );
}

export default function ImpactResultPage() {
  const { id } = useParams<{ id: string }>();
  const [visit, setVisit] = useState<OpsImpactVisitResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<"main" | "vm">("main");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/ops/impact-visits/results/${id}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok || !data.success)
          throw new Error(data.error ?? "Gagal memuat hasil visit.");
        if (!controller.signal.aborted) {
          setVisit(data.visit);
          if (!data.visit.mainNegatives.length) setTab("vm");
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
  }, [id, revision]);

  async function save(itemId: string, status: FollowUpStatus, note: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ops/impact-visits/results/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, status, note }),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error ?? "Gagal menyimpan pemeriksaan.");
      setVisit(data.visit);
      toast.success(
        "Pemeriksaan tersimpan. Status sudah diperbarui untuk tim toko.",
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Gagal menyimpan pemeriksaan.",
      );
    } finally {
      setBusy(false);
    }
  }

  const items = visit
    ? tab === "main"
      ? visit.mainNegatives
      : visit.vmNegatives
    : [];
  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        title={visit?.store.name ?? "Hasil Visit"}
        scope="Impact Visit / Tindak lanjut"
        subtitle={
          visit
            ? `${visit.store.storeNo} · ${visit.areaName ?? ""} · ${new Date(visit.visitDate).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })}`
            : "Pemeriksaan mingguan"
        }
        className="bg-white"
        actions={
          <Link
            href="/ops/impact-visits/results"
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
          >
            <ArrowLeft className="h-4 w-4" />
            Semua hasil
          </Link>
        }
      />
      <div className="relative z-0 mx-auto max-w-6xl space-y-5 p-4 lg:p-6 @container">
        {loading ? (
          <Loader2
            aria-label="Memuat hasil"
            className="mx-auto my-20 h-7 w-7 animate-spin text-indigo-500"
          />
        ) : error || !visit ? (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700"
          >
            {error || "Hasil tidak ditemukan."}
            <button
              type="button"
              onClick={() => setRevision((r) => r + 1)}
              className="ml-3 underline"
            >
              Coba lagi
            </button>
          </div>
        ) : (
          <>
            <div className="grid gap-5 @3xl:grid-cols-[1fr_300px]">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <UserRound className="h-4 w-4 text-indigo-500" />
                  Pembuat visit: {visit.visitedByName ?? "Ops"}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  Nilai saat visit: Impact {visit.main.score}/
                  {visit.main.maxScore} · VM {visit.vm.score}/
                  {visit.vm.maxScore}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-slate-600">
                  {visit.canReview
                    ? "Anda dapat mencatat pemeriksaan ulang untuk setiap poin Tidak. Hasil dan catatan dapat dilihat karyawan toko."
                    : "Mode pemantauan. Pemeriksaan dicatat oleh Ops yang membuat visit ini."}
                </p>
                {visit.notes && (
                  <p className="mt-3 whitespace-pre-line border-t border-slate-100 pt-3 text-sm text-slate-600">
                    {visit.notes}
                  </p>
                )}
              </div>
              <CheckProgress summary={visit.followUp} />
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-indigo-50 p-4 text-xs text-indigo-800">
              <CalendarCheck className="h-5 w-5 shrink-0" />
              {visit.followUp.dueThisWeek > 0
                ? `${visit.followUp.dueThisWeek} poin belum diperiksa minggu ini. Periode Senin–Minggu (WIB).`
                : visit.followUp.total === visit.followUp.verified
                  ? "Semua temuan sudah selesai. Riwayat pemeriksaan tetap tersimpan."
                  : "Semua poin terbuka sudah diperiksa minggu ini. Lanjutkan pemeriksaan minggu depan."}
            </div>
            <OpsChipTabs
              value={tab}
              onChange={setTab}
              items={[
                {
                  key: "main",
                  label: "Impact Visit",
                  count: visit.mainNegatives.length,
                },
                {
                  key: "vm",
                  label: "VM Checklist",
                  count: visit.vmNegatives.length,
                },
              ]}
            />
            {!items.length ? (
              <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center">
                <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
                <p className="text-sm font-semibold text-slate-700">
                  Tidak ada temuan negatif pada checklist ini.
                </p>
              </div>
            ) : (
              groupBySection(items).map((group) => (
                <section key={group.section} className="space-y-3">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {group.section} · {group.items.length} poin
                  </h2>
                  {group.items.map((item) => (
                    <ReviewPoint
                      key={`${item.id}-${item.followUp?.id ?? 0}`}
                      item={item}
                      checks={visit.checks.filter((c) => c.itemId === item.id)}
                      canReview={visit.canReview}
                      busy={busy}
                      onSave={save}
                    />
                  ))}
                </section>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
