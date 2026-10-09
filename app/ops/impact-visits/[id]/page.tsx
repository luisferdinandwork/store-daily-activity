'use client';

// app/ops/impact-visits/[id]/page.tsx — fill/view an Impact Visit.
//
// Three sections (Checklist / Cash Money / VM Checklist) in a tab strip.
// Answers auto-save via useAutoSave (debounced PATCH); the server
// recomputes score/grade on every save that touches responses, so the
// live banner here just mirrors what the server already computed on the
// last round-trip using the same pure scoreChecklist() function client-side
// for instant feedback between saves.
// Once status === 'submitted' the whole page is read-only.
//
// When the store has earlier submitted visits, a "Riwayat" panel shows their
// "Tidak" points (docked beside the form when there's room, a sheet otherwise),
// and each checklist item that was "Tidak" last time is marked. Submitting
// first warns (in Indonesian) how many isian are still empty, with "Simpan
// sebagai Draft" as the way out. Only IT can delete a visit.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft, Loader2, Shield, CheckCircle2, XCircle,
  ClipboardCheck, Wallet, Sparkles, Send, Trash2, AlertTriangle,
  Video, Navigation, Upload, MapPin, ImageIcon, History, Save, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { useGeo } from '@/lib/hooks/useGeo';
import PhotoUploadGrid from '@/components/shared/PhotoUploadGrid';
import VisitHistoryPanel, { type HistoryTab } from '@/components/ops/impact-visits/VisitHistoryPanel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  IMPACT_CHECKLIST,
  IMPACT_CHECKLIST_SECTIONS,
  VM_CHECKLIST,
  VM_CHECKLIST_SECTIONS,
  UANG_MODAL_TARGET,
  UANG_PETTY_CASH_TARGET,
  cashRowTotal,
  emptyCashMoneyData,
  type ChecklistItem,
  type CashMoneyData,
  type CashDenominationRow,
} from '@/lib/impact-visit/checklist-config';
import {
  scoreChecklist,
  IMPACT_CHECKLIST_PASS_THRESHOLD,
  VM_CHECKLIST_PASS_THRESHOLD,
  type ChecklistResponses,
  type ChecklistAnswer,
} from '@/lib/impact-visit/scoring';
import { missingVisitFields, totalMissing, type MissingField } from '@/lib/impact-visit/completeness';
import type { ImpactVisitResultDetail } from '@/lib/impact-visit/results';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Visit {
  id: string;
  storeId: string;
  visitDate: string;
  visitType: 'virtual' | 'on_location' | null;
  screenshotUrl: string | null;
  visitPhotoUrl: string | null;
  visitLat: string | null;
  visitLng: string | null;
  targetBulanBerjalan: string | null;
  estimasiAchievement: string | null;
  checklistResponses: ChecklistResponses;
  checklistScore: number;
  checklistMaxScore: number;
  checklistGrade: string | null;
  cashMoneyData: CashMoneyData;
  vmChecklistResponses: ChecklistResponses;
  vmChecklistScore: number;
  vmChecklistMaxScore: number;
  vmChecklistGrade: string | null;
  notes: string | null;
  status: 'draft' | 'submitted';
  canEdit: boolean;
  canDelete: boolean;
  store: { name: string; storeNo: string };
  areaName: string | null;
}

type Tab = 'checklist' | 'cash' | 'vm';

/** Page width (px) from which the history panel sits beside the form instead of in a sheet. */
const DOCK_MIN_WIDTH = 1180;

const toHistoryTab = (t: Tab): HistoryTab | null => (t === 'checklist' ? 'main' : t === 'vm' ? 'vm' : null);
const itemAnchor = (itemId: string) => `iv-item-${itemId}`;

// ─── Small atoms ──────────────────────────────────────────────────────────────

// Compact score readout for the sticky control panel — lives next to the
// tabs so the current score stays visible while switching between sections,
// instead of the old full-size banner buried inside each tab's content.
function ScorePill({ score, max, grade, passThreshold }: { score: number; max: number; grade: string | null; passThreshold: number }) {
  const pass = grade === 'A';
  return (
    <div
      title={`Pass at ${passThreshold}+`}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full border pl-2.5 pr-1 py-1',
        pass ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50',
      )}
    >
      <span className="text-xs font-black tabular-nums text-slate-800">
        {score}<span className="font-semibold text-slate-400">/{max}</span>
      </span>
      <span className={cn(
        'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black text-white',
        pass ? 'bg-emerald-500' : 'bg-amber-400',
      )}>
        {grade ?? '—'}
      </span>
    </div>
  );
}

function AnswerToggle({ value, onChange, disabled }: { value: ChecklistAnswer | undefined; onChange: (v: ChecklistAnswer) => void; disabled: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('ya')}
        className={cn(
          'flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold transition-colors disabled:opacity-60',
          value === 'ya' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200',
        )}
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> Ya
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('tidak')}
        className={cn(
          'flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold transition-colors disabled:opacity-60',
          value === 'tidak' ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200',
        )}
      >
        <XCircle className="h-3.5 w-3.5" /> Tidak
      </button>
    </div>
  );
}

function ChecklistItemRow({
  item, response, onAnswer, onNote, disabled, prevNegative, highlighted,
}: {
  item: ChecklistItem;
  response: ChecklistResponses[string] | undefined;
  onAnswer: (id: string, answer: ChecklistAnswer) => void;
  onNote: (id: string, note: string) => void;
  disabled: boolean;
  /** Answered "tidak" on the store's previous visit. */
  prevNegative: boolean;
  /** Just jumped to from the history panel / submit warning. */
  highlighted: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(!!response?.note);

  return (
    <div
      id={itemAnchor(item.id)}
      className={cn(
        'scroll-mt-48 rounded-xl border bg-white p-3 transition-shadow duration-500',
        prevNegative ? 'border-rose-100' : 'border-slate-100',
        highlighted && 'ring-2 ring-indigo-400 ring-offset-2',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {prevNegative && (
            <span className="mb-1 inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
              <History className="h-3 w-3" /> Tidak di visit lalu
            </span>
          )}
          <p className="text-sm font-semibold text-slate-800">{item.criteria}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{item.hint}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-300">{item.points} pt</span>
          <AnswerToggle
            value={response?.answer}
            onChange={(v) => onAnswer(item.id, v)}
            disabled={disabled}
          />
        </div>
      </div>

      {!disabled && !noteOpen && (
        <button type="button" onClick={() => setNoteOpen(true)} className="mt-2 text-[11px] font-semibold text-indigo-500 hover:underline">
          + Add note
        </button>
      )}
      {(noteOpen || response?.note) && (
        <textarea
          value={response?.note ?? ''}
          onChange={(e) => onNote(item.id, e.target.value)}
          disabled={disabled}
          placeholder="Optional note…"
          rows={2}
          className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-300 focus:border-indigo-300 focus:outline-none disabled:opacity-60"
        />
      )}
    </div>
  );
}

function CashDenominationGrid({
  anchor, title, target, rows, onChange, disabled,
}: {
  anchor: string;
  title: string;
  target?: number;
  rows: CashDenominationRow[];
  onChange: (rows: CashDenominationRow[]) => void;
  disabled: boolean;
}) {
  const total = cashRowTotal(rows);
  return (
    <div id={anchor} className="scroll-mt-48 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        {target != null && (
          <span className="text-[11px] text-slate-400">Target Rp {target.toLocaleString('id-ID')}</span>
        )}
      </div>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={row.value} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs font-semibold text-slate-500">Rp {row.value.toLocaleString('id-ID')}</span>
            <span className="text-slate-300">×</span>
            <input
              type="number"
              min={0}
              value={row.qty || ''}
              disabled={disabled}
              onChange={(e) => {
                const qty = Math.max(0, Number(e.target.value) || 0);
                const next = [...rows];
                next[i] = { ...row, qty };
                onChange(next);
              }}
              className="h-8 w-20 rounded-lg border border-slate-200 px-2 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none disabled:opacity-60"
              placeholder="0"
            />
            <span className="ml-auto text-xs tabular-nums text-slate-500">Rp {(row.value * row.qty).toLocaleString('id-ID')}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
        <span className="text-xs font-bold text-slate-600">Total</span>
        <span className={cn(
          'text-sm font-black tabular-nums',
          target != null ? (total === target ? 'text-emerald-600' : 'text-amber-600') : 'text-slate-800',
        )}>
          Rp {total.toLocaleString('id-ID')}
        </span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImpactVisitDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();
  const id = params.id as string;

  const role = session?.user?.role;
  const employeeType = session?.user?.employeeType;
  const isOps = role === 'it' || employeeType === 'ops_area' || employeeType === 'ops_ho';

  const [visit, setVisit] = useState<Visit | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('checklist');
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Store history (earlier submitted visits) ─────────────────────────────
  const [history, setHistory] = useState<ImpactVisitResultDetail[]>([]);
  const [historyTab, setHistoryTab] = useState<HistoryTab>('main');
  /** null = default: docked open while the visit is still being filled. */
  const [historyPref, setHistoryPref] = useState<boolean | null>(null);
  const [historySheet, setHistorySheet] = useState(false);
  const [flashItem, setFlashItem] = useState<string | null>(null);

  // ── Layout measurements (for docking the history panel) ──────────────────
  // The scroll container is the OPS layout's <main>, not window.
  const topRef = useRef<HTMLDivElement | null>(null);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [headerEl, setHeaderEl] = useState<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState({ width: 0, headerH: 0, viewH: 0 });
  const rootRef = useCallback((el: HTMLDivElement | null) => {
    topRef.current = el;
    setRootEl(el);
  }, []);

  useEffect(() => {
    if (!rootEl || !headerEl) return;
    const main = rootEl.closest('main');
    const measure = () => setLayout({
      width: rootEl.clientWidth,
      headerH: headerEl.offsetHeight,
      viewH: main?.clientHeight ?? window.innerHeight,
    });
    const ro = new ResizeObserver(measure);
    ro.observe(rootEl);
    ro.observe(headerEl);
    if (main) ro.observe(main);
    return () => ro.disconnect();
  }, [rootEl, headerEl]);

  // Switching tabs swaps in a whole new section (often much shorter than the
  // one being left) — jump back to the top instead of leaving the reader
  // stranded mid-scroll in the old tab's content — unless the switch was a
  // jump to one item, which then scrolls to that item. scrollIntoView walks up
  // to whichever ancestor actually scrolls (the layout's <main>).
  const jumpTarget = useRef<string | null>(null);
  useEffect(() => {
    const target = jumpTarget.current;
    jumpTarget.current = null;
    if (target) {
      document.getElementById(target)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    topRef.current?.scrollIntoView({ block: 'start' });
  }, [tab]);

  function changeTab(next: Tab) {
    setTab(next);
    const ht = toHistoryTab(next);
    if (ht) setHistoryTab(ht);
  }

  /** Shows one spot of the form: switches tab if needed, scrolls there, flashes checklist items. */
  function jumpTo(anchor: string, toTab: Tab | null, itemId?: string) {
    if (itemId) {
      setFlashItem(itemId);
      setTimeout(() => setFlashItem((cur) => (cur === itemId ? null : cur)), 1800);
    }
    if (toTab && toTab !== tab) {
      jumpTarget.current = anchor;
      changeTab(toTab);
      return;
    }
    const el = document.getElementById(anchor);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (el instanceof HTMLInputElement) el.focus({ preventScroll: true });
  }

  // A jump asked for from inside a sheet / dialog runs once it has fully closed
  // (its onCloseAutoFocus) — handing focus back to the trigger mid-way would
  // cancel the scroll.
  const pendingJump = useRef<(() => void) | null>(null);
  const runPendingJump = (e: Event) => {
    const go = pendingJump.current;
    if (!go) return;
    e.preventDefault();
    pendingJump.current = null;
    go();
  };

  function jumpToHistoryItem(itemId: string, ht: HistoryTab) {
    const go = () => jumpTo(itemAnchor(itemId), ht === 'main' ? 'checklist' : 'vm', itemId);
    if (historySheet) {
      pendingJump.current = go;
      setHistorySheet(false);
    } else {
      go();
    }
  }

  function jumpToMissing(field: MissingField) {
    const anchor = field.firstItemId ? itemAnchor(field.firstItemId) : `iv-${field.key}`;
    pendingJump.current = () => jumpTo(anchor, field.tab, field.firstItemId);
    setConfirmSubmit(false);
  }

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOps)   router.replace('/');
  }, [authStatus, session, isOps, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/ops/impact-visits/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) setVisit(data.visit);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (isOps) load(); }, [isOps, load]);

  useEffect(() => {
    if (!isOps) return;
    fetch(`/api/ops/impact-visits/${id}/history`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.success) setHistory(d.visits ?? []); })
      .catch(() => {
        // Non-critical — the visit is still fillable without its history.
      });
  }, [isOps, id]);

  const { status: saveStatus, save } = useAutoSave({
    url: `/api/ops/impact-visits/${id}`,
    baseBody: {},
  });

  const locked = !visit || visit.status === 'submitted' || !visit.canEdit;

  // ── Checklist answer handlers ────────────────────────────────────────────
  const setChecklistAnswer = useCallback((itemId: string, answer: ChecklistAnswer) => {
    setVisit((prev) => {
      if (!prev) return prev;
      const responses = { ...prev.checklistResponses, [itemId]: { ...prev.checklistResponses[itemId], answer } };
      const result = scoreChecklist(IMPACT_CHECKLIST, responses, IMPACT_CHECKLIST_PASS_THRESHOLD);
      save({ checklistResponses: responses });
      return { ...prev, checklistResponses: responses, checklistScore: result.score, checklistGrade: result.grade };
    });
  }, [save]);

  const setChecklistNote = useCallback((itemId: string, note: string) => {
    setVisit((prev) => {
      if (!prev) return prev;
      const responses = { ...prev.checklistResponses, [itemId]: { ...prev.checklistResponses[itemId], note } };
      save({ checklistResponses: responses });
      return { ...prev, checklistResponses: responses };
    });
  }, [save]);

  const setVmAnswer = useCallback((itemId: string, answer: ChecklistAnswer) => {
    setVisit((prev) => {
      if (!prev) return prev;
      const responses = { ...prev.vmChecklistResponses, [itemId]: { ...prev.vmChecklistResponses[itemId], answer } };
      const result = scoreChecklist(VM_CHECKLIST, responses, VM_CHECKLIST_PASS_THRESHOLD);
      save({ vmChecklistResponses: responses });
      return { ...prev, vmChecklistResponses: responses, vmChecklistScore: result.score, vmChecklistGrade: result.grade };
    });
  }, [save]);

  const setVmNote = useCallback((itemId: string, note: string) => {
    setVisit((prev) => {
      if (!prev) return prev;
      const responses = { ...prev.vmChecklistResponses, [itemId]: { ...prev.vmChecklistResponses[itemId], note } };
      save({ vmChecklistResponses: responses });
      return { ...prev, vmChecklistResponses: responses };
    });
  }, [save]);

  const setCashRows = useCallback((key: keyof CashMoneyData, rows: CashDenominationRow[]) => {
    setVisit((prev) => {
      if (!prev) return prev;
      const cashMoneyData = { ...prev.cashMoneyData, [key]: rows };
      save({ cashMoneyData });
      return { ...prev, cashMoneyData };
    });
  }, [save]);

  const setCashOut = useCallback((cashOut: number | null) => {
    setVisit((prev) => {
      if (!prev) return prev;
      const cashMoneyData = { ...prev.cashMoneyData, cashOut };
      save({ cashMoneyData });
      return { ...prev, cashMoneyData };
    });
  }, [save]);

  const setHeaderField = useCallback((field: 'targetBulanBerjalan' | 'estimasiAchievement' | 'notes', value: string) => {
    setVisit((prev) => {
      if (!prev) return prev;
      save({ [field]: value || null });
      return { ...prev, [field]: value || null };
    });
  }, [save]);

  // ── Proof: screenshot (virtual) / geo-tag (on location) ─────────────────
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const [capturingGeo, setCapturingGeo] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { geo, geoError, refresh: refreshGeo } = useGeo();

  async function handleUploadScreenshot(file: File) {
    setUploadingScreenshot(true);
    setProofError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/ops/impact-visits/${id}/screenshot`, { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) { setProofError(data.error ?? 'Upload failed.'); return; }
      setVisit(data.visit);
    } catch {
      setProofError('Network error.');
    } finally {
      setUploadingScreenshot(false);
    }
  }

  async function handleCaptureLocation() {
    setCapturingGeo(true);
    setProofError(null);
    try {
      if (geoError || !geo) {
        setProofError(geoError ?? 'Location not available yet — try again.');
        return;
      }
      const res = await fetch(`/api/ops/impact-visits/${id}/geo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy }),
      });
      const data = await res.json();
      if (!data.success) { setProofError(data.error ?? 'Failed to capture location.'); return; }
      setVisit(data.visit);
    } catch {
      setProofError('Network error.');
    } finally {
      setCapturingGeo(false);
    }
  }

  async function handleUploadVisitPhoto(file: File): Promise<string> {
    setProofError(null);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/ops/impact-visits/${id}/photo`, { method: 'POST', body: form });
    const data = await res.json();
    if (!data.success) {
      setProofError(data.error ?? 'Upload failed.');
      throw new Error(data.error ?? 'Upload failed.');
    }
    setVisit(data.visit);
    return data.visit.visitPhotoUrl as string;
  }

  const missingProof = visit
    ? (visit.visitType === 'virtual' && !visit.screenshotUrl) ||
      (visit.visitType === 'on_location' && !(visit.visitLat && visit.visitLng && visit.visitPhotoUrl))
    : false;

  const missing = useMemo(() => (visit ? missingVisitFields(visit) : []), [visit]);
  const missingCount = totalMissing(missing);

  /** Writes every field once more (on top of auto-save), so "Simpan Draft" never leaves a debounced change behind. */
  async function persistAll(v: Visit) {
    const res = await fetch(`/api/ops/impact-visits/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checklistResponses: v.checklistResponses,
        vmChecklistResponses: v.vmChecklistResponses,
        cashMoneyData: v.cashMoneyData,
        targetBulanBerjalan: v.targetBulanBerjalan,
        estimasiAchievement: v.estimasiAchievement,
        notes: v.notes,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error ?? 'Gagal menyimpan draft.');
  }

  async function handleSaveDraft() {
    if (!visit) return;
    setSavingDraft(true);
    setActionError(null);
    try {
      await persistAll(visit);
      toast.success(`Draft disimpan — ${visit.store.name}. Lanjutkan kapan saja dari daftar Impact Visit.`);
      router.push('/ops/impact-visits');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal menyimpan draft.');
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSubmit() {
    if (!visit || missingProof) return;

    setSubmitting(true);
    setActionError(null);
    try {
      await persistAll(visit);
      const res  = await fetch(`/api/ops/impact-visits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'submitted' }),
      });
      const data = await res.json();
      if (!data.success) { setActionError(data.error ?? 'Failed to submit.'); return; }
      setVisit(data.visit);
      toast.success('Impact Visit berhasil disubmit.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res  = await fetch(`/api/ops/impact-visits/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Impact Visit deleted.');
        router.push('/ops/impact-visits');
      } else setActionError(data.error ?? 'Failed to delete.');
    } catch {
      setActionError('Network error.');
    } finally {
      setDeleting(false);
    }
  }

  const checklistBySection = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of IMPACT_CHECKLIST) {
      if (!map.has(item.section)) map.set(item.section, []);
      map.get(item.section)!.push(item);
    }
    return map;
  }, []);

  const vmBySection = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of VM_CHECKLIST) {
      if (!map.has(item.section)) map.set(item.section, []);
      map.get(item.section)!.push(item);
    }
    return map;
  }, []);

  /** Items answered "tidak" on the store's latest earlier visit. */
  const prevNegatives = useMemo(() => {
    const last = history[0];
    return new Set([...(last?.mainNegatives ?? []), ...(last?.vmNegatives ?? [])].map((i) => i.id));
  }, [history]);

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
  );

  if (!isOps) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
    </div>
  );

  if (loading || !visit) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50"><Loader2 className="h-8 w-8 animate-spin text-indigo-400" /></div>
  );

  const cash = visit.cashMoneyData ?? emptyCashMoneyData();

  const activeScore =
    tab === 'checklist' ? { score: visit.checklistScore, max: visit.checklistMaxScore, grade: visit.checklistGrade, passThreshold: IMPACT_CHECKLIST_PASS_THRESHOLD } :
    tab === 'vm'        ? { score: visit.vmChecklistScore, max: visit.vmChecklistMaxScore, grade: visit.vmChecklistGrade, passThreshold: VM_CHECKLIST_PASS_THRESHOLD } :
    null;

  const hasHistory = history.length > 0;
  const canDock = layout.width >= DOCK_MIN_WIDTH;
  const historyOpen = historyPref ?? !locked;
  const docked = hasHistory && canDock && historyOpen;
  const historyFixCount = hasHistory ? history[0].mainNegatives.length + history[0].vmNegatives.length : 0;

  function toggleHistory() {
    if (canDock) setHistoryPref(!historyOpen);
    else setHistorySheet(true);
  }

  const historyPanelProps = {
    visits: history,
    tab: historyTab,
    onTabChange: setHistoryTab,
    onJumpToItem: jumpToHistoryItem,
  };

  return (
    <div ref={rootRef} className="min-h-full bg-slate-50 pb-16">
      {/*
        Everything ops needs while filling this out — identity/status, the
        period fields, the section tabs, and the running score — lives in one
        floating panel so it's always in view while scrolling a long
        checklist. z-10 keeps it *below* OpsNavbar (z-20 in app/ops/layout),
        which is what actually contains the notification bell's dropdown —
        going any higher here would let this panel paint over that dropdown.
      */}
      <div ref={setHeaderEl} className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className={cn('mx-auto px-4 py-2.5', docked ? 'max-w-[1320px]' : 'max-w-4xl')}>
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/ops/impact-visits')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900">{visit.store.name}</p>
              <p className="text-[11px] text-slate-400">
                {visit.store.storeNo} {visit.areaName && `· ${visit.areaName}`} · {new Date(visit.visitDate).toLocaleDateString('id-ID')}
              </p>
            </div>
            <span className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold',
              visit.status === 'submitted' ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700',
            )}>
              {visit.status === 'submitted' ? 'Submitted' : 'Draft'}
            </span>
            {visit.visitType && (
              <span className={cn(
                'flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold',
                visit.visitType === 'virtual' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700',
              )}>
                {visit.visitType === 'virtual' ? <Video className="h-3 w-3" /> : <Navigation className="h-3 w-3" />}
                {visit.visitType === 'virtual' ? 'Virtual' : 'On Location'}
              </span>
            )}
            {hasHistory && (
              <button
                type="button"
                onClick={toggleHistory}
                aria-pressed={docked}
                title={`${history.length} visit sebelumnya di toko ini`}
                className={cn(
                  'flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition-colors',
                  docked
                    ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                <History className="h-3.5 w-3.5" />
                Riwayat
                {historyFixCount > 0 && (
                  <span className={cn(
                    'rounded-full px-1.5 text-[10px] tabular-nums',
                    docked ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700',
                  )}>
                    {historyFixCount}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Target / Estimasi Achievement — compact inline fields */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Target</span>
              <input
                id="iv-target"
                type="text"
                value={visit.targetBulanBerjalan ?? ''}
                disabled={locked}
                onChange={(e) => setHeaderField('targetBulanBerjalan', e.target.value)}
                className="h-7 w-32 rounded-md border border-slate-200 px-2 text-xs focus:border-indigo-300 focus:outline-none disabled:opacity-60"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Estimasi Achievement</span>
              <input
                id="iv-estimasi"
                type="text"
                value={visit.estimasiAchievement ?? ''}
                disabled={locked}
                onChange={(e) => setHeaderField('estimasiAchievement', e.target.value)}
                className="h-7 w-40 rounded-md border border-slate-200 px-2 text-xs focus:border-indigo-300 focus:outline-none disabled:opacity-60"
              />
            </label>
            {!locked && saveStatus !== 'idle' && (
              <span className="ml-auto text-[11px] text-slate-400">
                {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed — will retry' : ''}
              </span>
            )}
          </div>

          {/* Tabs + running score + actions */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-1 gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
              {([
                { key: 'checklist' as const, label: 'Checklist', Icon: ClipboardCheck },
                { key: 'cash' as const, label: 'Cash Money', Icon: Wallet },
                { key: 'vm' as const, label: 'VM Checklist', Icon: Sparkles },
              ]).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => changeTab(key)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                    tab === key ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-200',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            {activeScore && <ScorePill {...activeScore} />}
            {!locked && (
              <>
                <button
                  type="button"
                  disabled={savingDraft || submitting}
                  onClick={handleSaveDraft}
                  title="Simpan sebagai draft dan kembali ke daftar"
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-50"
                >
                  {savingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Simpan Draft
                </button>
                <button
                  type="button"
                  disabled={submitting || savingDraft || missingProof}
                  onClick={() => setConfirmSubmit(true)}
                  title={missingProof ? (visit.visitType === 'virtual' ? 'Upload a screenshot first' : 'Capture the store location and photo first') : undefined}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white transition-all hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Submit
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={cn('mx-auto flex items-start gap-6', docked ? 'max-w-[1320px] px-4' : 'max-w-4xl')}>
        <div className={cn('min-w-0 flex-1 space-y-4', docked ? 'py-4' : 'p-4')}>
          {actionError && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {actionError}
            </div>
          )}

          {/* History hint while the panel is put away */}
          {hasHistory && !docked && !locked && (
            <button
              type="button"
              onClick={toggleHistory}
              className="flex w-full items-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-left transition-colors hover:bg-indigo-50"
            >
              <History className="h-4 w-4 shrink-0 text-indigo-600" />
              <span className="min-w-0 flex-1 text-xs text-indigo-900">
                <span className="font-bold">Toko ini punya {history.length} visit sebelumnya.</span>{' '}
                {historyFixCount > 0
                  ? `${historyFixCount} poin dinilai “Tidak” di visit terakhir — buka Riwayat untuk cek ulang.`
                  : 'Semua poin sesuai di visit terakhir.'}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-indigo-400" />
            </button>
          )}

          {/* Proof — required before this visit can be submitted */}
          {visit.visitType === 'virtual' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-sky-600" />
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Bukti Screenshot</p>
              </div>
              {visit.screenshotUrl ? (
                <div className="mt-3 flex items-center gap-3">
                  <img src={visit.screenshotUrl} alt="Visit screenshot" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" /> Screenshot uploaded
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-slate-400">Upload a screenshot as proof this virtual visit was conducted.</p>
              )}
              {!locked && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadScreenshot(f); e.target.value = ''; }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingScreenshot}
                    className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {uploadingScreenshot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {visit.screenshotUrl ? 'Replace Screenshot' : 'Upload Screenshot'}
                  </button>
                </>
              )}
              {proofError && <p className="mt-2 text-xs text-rose-600">{proofError}</p>}
            </div>
          )}

          {visit.visitType === 'on_location' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-emerald-600" />
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Lokasi Toko</p>
              </div>
              {visit.visitLat && visit.visitLng ? (
                <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Lokasi tercatat — dalam radius toko
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-slate-400">Ambil geo-tag lokasi kamu sekarang — harus berada di dalam radius toko.</p>
              )}
              {!locked && (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCaptureLocation}
                    disabled={capturingGeo}
                    className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {capturingGeo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                    Capture Store Location
                  </button>
                  {(geoError) && (
                    <button type="button" onClick={refreshGeo} className="text-[11px] font-semibold text-indigo-600 hover:underline">
                      Retry location
                    </button>
                  )}
                </div>
              )}
              {proofError && <p className="mt-2 text-xs text-rose-600">{proofError}</p>}
            </div>
          )}

          {visit.visitType === 'on_location' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-emerald-600" />
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Foto Bukti Kunjungan</p>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Ambil foto langsung di toko sebagai bukti kunjungan on-location.</p>
              <div className="mt-3">
                <PhotoUploadGrid
                  photos={visit.visitPhotoUrl ? [visit.visitPhotoUrl] : []}
                  onChange={(urls) => setVisit((prev) => (prev ? { ...prev, visitPhotoUrl: urls[0] ?? null } : prev))}
                  upload={handleUploadVisitPhoto}
                  min={1}
                  max={1}
                  disabled={locked}
                  tileSize="lg"
                  cameraTitle="Foto Bukti Kunjungan"
                />
              </div>
            </div>
          )}

          {tab === 'checklist' && (
            <div className="space-y-4">
              {IMPACT_CHECKLIST_SECTIONS.map(({ section, total }) => (
                <div key={section}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{section}</p>
                    <span className="text-[11px] text-slate-400">{total} pts</span>
                  </div>
                  <div className="space-y-2">
                    {(checklistBySection.get(section) ?? []).map((item) => (
                      <ChecklistItemRow
                        key={item.id}
                        item={item}
                        response={visit.checklistResponses[item.id]}
                        onAnswer={setChecklistAnswer}
                        onNote={setChecklistNote}
                        disabled={locked}
                        prevNegative={prevNegatives.has(item.id)}
                        highlighted={flashItem === item.id}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'cash' && (
            <div className="space-y-4">
              <CashDenominationGrid anchor="iv-uangModal" title="Uang Modal" target={UANG_MODAL_TARGET} rows={cash.uangModal} onChange={(rows) => setCashRows('uangModal', rows)} disabled={locked} />
              <CashDenominationGrid anchor="iv-uangSisaSetoran" title="Uang Sisa Setoran" rows={cash.uangSisaSetoran} onChange={(rows) => setCashRows('uangSisaSetoran', rows)} disabled={locked} />
              <CashDenominationGrid anchor="iv-uangPettyCash" title="Uang Petty Cash" target={UANG_PETTY_CASH_TARGET} rows={cash.uangPettyCash} onChange={(rows) => setCashRows('uangPettyCash', rows)} disabled={locked} />
              <CashDenominationGrid anchor="iv-uangSalesCash" title="Uang Sales Cash" rows={cash.uangSalesCash} onChange={(rows) => setCashRows('uangSalesCash', rows)} disabled={locked} />
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <label htmlFor="iv-cashOut" className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Cash Out</label>
                <input
                  id="iv-cashOut"
                  type="number"
                  value={cash.cashOut ?? ''}
                  disabled={locked}
                  onChange={(e) => setCashOut(e.target.value === '' ? null : Number(e.target.value))}
                  className="h-9 w-full scroll-mt-48 rounded-lg border border-slate-200 px-2.5 text-sm focus:border-indigo-300 focus:outline-none disabled:opacity-60"
                  placeholder="0"
                />
              </div>
            </div>
          )}

          {tab === 'vm' && (
            <div className="space-y-4">
              {VM_CHECKLIST_SECTIONS.map(({ section, total }) => (
                <div key={section}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{section}</p>
                    <span className="text-[11px] text-slate-400">{total} pts</span>
                  </div>
                  <div className="space-y-2">
                    {(vmBySection.get(section) ?? []).map((item) => (
                      <ChecklistItemRow
                        key={item.id}
                        item={item}
                        response={visit.vmChecklistResponses[item.id]}
                        onAnswer={setVmAnswer}
                        onNote={setVmNote}
                        disabled={locked}
                        prevNegative={prevNegatives.has(item.id)}
                        highlighted={flashItem === item.id}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Notes</label>
            <textarea
              value={visit.notes ?? ''}
              disabled={locked}
              onChange={(e) => setHeaderField('notes', e.target.value)}
              rows={3}
              placeholder="General notes, acknowledgements…"
              className="w-full resize-none rounded-lg border border-slate-200 px-2.5 py-2 text-sm focus:border-indigo-300 focus:outline-none disabled:opacity-60"
            />
          </div>

          {/* Submit / draft live in the sticky header; only IT's destructive
              Delete stays down here — for drafts and submitted visits alike. */}
          {visit.canDelete && (
            <button
              type="button"
              disabled={deleting}
              onClick={() => setConfirmDelete(true)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 text-sm font-bold text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete Visit (IT)
            </button>
          )}
        </div>

        {/* Docked history panel */}
        {docked && (
          <aside
            className="sticky w-[360px] shrink-0 py-4"
            style={{ top: layout.headerH, height: Math.max(320, layout.viewH - layout.headerH) }}
          >
            <VisitHistoryPanel
              {...historyPanelProps}
              onClose={() => setHistoryPref(false)}
              className="h-full"
            />
          </aside>
        )}
      </div>

      {/* History as a sheet when there's no room to dock it */}
      {hasHistory && (
        <Sheet open={historySheet && !canDock} onOpenChange={setHistorySheet}>
          <SheetContent
            side="right"
            showCloseButton={false}
            onCloseAutoFocus={runPendingJump}
            className="w-full gap-0 bg-slate-50 p-3 sm:max-w-md"
          >
            <SheetTitle className="sr-only">Riwayat Visit</SheetTitle>
            <VisitHistoryPanel
              {...historyPanelProps}
              onClose={() => setHistorySheet(false)}
              className="h-full"
            />
          </SheetContent>
        </Sheet>
      )}

      {/* Submit — warns what is still empty, offers the draft instead */}
      <AlertDialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <AlertDialogContent className="sm:max-w-lg" onCloseAutoFocus={runPendingJump}>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit Impact Visit ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Setelah disubmit, visit dikunci dan tidak bisa diubah lagi.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {missingCount > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                Masih ada {missingCount} isian yang belum diisi
              </p>
              <ul className="mt-2 space-y-1">
                {missing.map((field) => (
                  <li key={field.key}>
                    <button
                      type="button"
                      onClick={() => jumpToMissing(field)}
                      className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-amber-900 transition-colors hover:bg-amber-100"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      <span className="min-w-0 flex-1">{field.label}</span>
                      <span className="flex shrink-0 items-center gap-0.5 font-semibold text-amber-700 opacity-70 group-hover:opacity-100">
                        Isi <ChevronRight className="h-3 w-3" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-amber-800">
                Poin checklist yang belum dijawab dihitung 0 (sama seperti &ldquo;Tidak&rdquo;). Belum selesai?
                Simpan sebagai draft dan lanjutkan nanti.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              Semua isian sudah lengkap.
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() => {
                setConfirmSubmit(false);
                void handleSaveDraft();
              }}
            >
              <Save className="h-4 w-4" />
              Simpan sebagai Draft
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                setConfirmSubmit(false);
                void handleSubmit();
              }}
            >
              <Send className="h-4 w-4" />
              {missingCount > 0 ? 'Tetap Submit' : 'Submit'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Impact Visit?</AlertDialogTitle>
            <AlertDialogDescription>
              The visit and all its answers are removed for good
              {visit.status === 'submitted' ? ' — it also leaves the Monthly Report and the store’s Impact Visit Result' : ''}.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => {
                setConfirmDelete(false);
                void handleDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
