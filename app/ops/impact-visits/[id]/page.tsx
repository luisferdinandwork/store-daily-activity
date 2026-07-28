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

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft, Loader2, Shield, CheckCircle2, XCircle, Circle,
  ClipboardCheck, Wallet, Sparkles, Send, Trash2, Save, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import {
  IMPACT_CHECKLIST,
  IMPACT_CHECKLIST_SECTIONS,
  VM_CHECKLIST,
  VM_CHECKLIST_SECTIONS,
  CASH_DENOMINATIONS,
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface Visit {
  id: string;
  storeId: string;
  visitDate: string;
  targetBulanBerjalan: string | null;
  periodeTanggal: string | null;
  pencapaianPct: string | null;
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

// ─── Small atoms ──────────────────────────────────────────────────────────────

function ScoreBanner({ score, max, grade, passThreshold }: { score: number; max: number; grade: string | null; passThreshold: number }) {
  const pass = grade === 'A';
  return (
    <div className={cn(
      'flex items-center justify-between rounded-2xl border px-4 py-3',
      pass ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50',
    )}>
      <div>
        <p className="text-2xl font-black tabular-nums text-slate-900">{score}<span className="text-sm font-semibold text-slate-400"> / {max}</span></p>
        <p className="text-[11px] text-slate-500">Pass at {passThreshold}+</p>
      </div>
      <span className={cn(
        'flex h-10 w-10 items-center justify-center rounded-full text-sm font-black',
        pass ? 'bg-emerald-500 text-white' : 'bg-amber-400 text-white',
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
  item, response, onAnswer, onNote, disabled,
}: {
  item: ChecklistItem;
  response: ChecklistResponses[string] | undefined;
  onAnswer: (id: string, answer: ChecklistAnswer) => void;
  onNote: (id: string, note: string) => void;
  disabled: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(!!response?.note);

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
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
  title, target, rows, onChange, disabled,
}: {
  title: string;
  target?: number;
  rows: CashDenominationRow[];
  onChange: (rows: CashDenominationRow[]) => void;
  disabled: boolean;
}) {
  const total = cashRowTotal(rows);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
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

  const role = (session?.user as any)?.role as string | undefined;
  const employeeType = (session?.user as any)?.employeeType as string | undefined;
  const isOps = role === 'it' || employeeType === 'ops_area' || employeeType === 'ops_ho';

  const [visit, setVisit] = useState<Visit | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('checklist');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const setHeaderField = useCallback((field: 'targetBulanBerjalan' | 'periodeTanggal' | 'notes', value: string) => {
    setVisit((prev) => {
      if (!prev) return prev;
      save({ [field]: value || null });
      return { ...prev, [field]: value || null };
    });
  }, [save]);

  async function handleSubmit() {
    if (!visit) return;
    const ok = window.confirm('Submit this Impact Visit? It will be locked and can no longer be edited.');
    if (!ok) return;

    setSubmitting(true);
    setActionError(null);
    try {
      const res  = await fetch(`/api/ops/impact-visits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'submitted' }),
      });
      const data = await res.json();
      if (!data.success) { setActionError(data.error ?? 'Failed to submit.'); return; }
      setVisit(data.visit);
    } catch {
      setActionError('Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    const ok = window.confirm('Delete this draft visit? This cannot be undone.');
    if (!ok) return;

    setDeleting(true);
    try {
      const res  = await fetch(`/api/ops/impact-visits/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) router.push('/ops/impact-visits');
      else setActionError(data.error ?? 'Failed to delete.');
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

  return (
    <div className="min-h-full bg-slate-50 pb-16">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
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
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-4 p-4">
        {actionError && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {actionError}
          </div>
        )}

        {!locked && saveStatus !== 'idle' && (
          <p className="text-right text-[11px] text-slate-400">
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed — will retry' : ''}
          </p>
        )}

        {/* Header fields */}
        <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Target Bulan Berjalan</label>
            <input
              type="text"
              value={visit.targetBulanBerjalan ?? ''}
              disabled={locked}
              onChange={(e) => setHeaderField('targetBulanBerjalan', e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200 px-2.5 text-sm focus:border-indigo-300 focus:outline-none disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Periode Tanggal</label>
            <input
              type="text"
              value={visit.periodeTanggal ?? ''}
              disabled={locked}
              onChange={(e) => setHeaderField('periodeTanggal', e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200 px-2.5 text-sm focus:border-indigo-300 focus:outline-none disabled:opacity-60"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
          {([
            { key: 'checklist' as const, label: 'Checklist', Icon: ClipboardCheck },
            { key: 'cash' as const, label: 'Cash Money', Icon: Wallet },
            { key: 'vm' as const, label: 'VM Checklist', Icon: Sparkles },
          ]).map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors',
                tab === key ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === 'checklist' && (
          <div className="space-y-4">
            <ScoreBanner score={visit.checklistScore} max={visit.checklistMaxScore} grade={visit.checklistGrade} passThreshold={IMPACT_CHECKLIST_PASS_THRESHOLD} />
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
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'cash' && (
          <div className="space-y-4">
            <CashDenominationGrid title="Uang Modal" target={UANG_MODAL_TARGET} rows={cash.uangModal} onChange={(rows) => setCashRows('uangModal', rows)} disabled={locked} />
            <CashDenominationGrid title="Uang Sisa Setoran" rows={cash.uangSisaSetoran} onChange={(rows) => setCashRows('uangSisaSetoran', rows)} disabled={locked} />
            <CashDenominationGrid title="Uang Petty Cash" target={UANG_PETTY_CASH_TARGET} rows={cash.uangPettyCash} onChange={(rows) => setCashRows('uangPettyCash', rows)} disabled={locked} />
            <CashDenominationGrid title="Uang Sales Cash" rows={cash.uangSalesCash} onChange={(rows) => setCashRows('uangSalesCash', rows)} disabled={locked} />
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Cash Out</label>
              <input
                type="number"
                value={cash.cashOut ?? ''}
                disabled={locked}
                onChange={(e) => setCashOut(e.target.value === '' ? null : Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-slate-200 px-2.5 text-sm focus:border-indigo-300 focus:outline-none disabled:opacity-60"
                placeholder="0"
              />
            </div>
          </div>
        )}

        {tab === 'vm' && (
          <div className="space-y-4">
            <ScoreBanner score={visit.vmChecklistScore} max={visit.vmChecklistMaxScore} grade={visit.vmChecklistGrade} passThreshold={VM_CHECKLIST_PASS_THRESHOLD} />
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

        {/* Actions */}
        {!locked && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!visit.canDelete || deleting}
              onClick={handleDelete}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 text-sm font-bold text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete Draft
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-sm font-bold text-white transition-all hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit Visit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
