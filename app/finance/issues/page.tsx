'use client';

import PanelPageHeader from '@/components/shared/PanelPageHeader';

// app/finance/issues/page.tsx — Finance issue inbox
//
// Same table, search, sort and filters as Ops (components/issues/IssueInbox,
// lib/issue-inbox.ts) in Finance's emerald, plus the follow-up drawer. No area
// scoping — Finance sees every store.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Shield } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/utils';
import { IssueInbox } from '@/components/issues/IssueInbox';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import type { InboxIssue, InboxStatus } from '@/lib/issue-inbox';

export default function FinanceIssuesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = session?.user?.role;
  const isFinance = role === 'finance' || role === 'it';

  const [issuesList, setIssuesList] = useState<InboxIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<InboxIssue | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isFinance) router.replace('/');
  }, [authStatus, session, isFinance, router]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetch('/api/finance/issues', { cache: 'no-store' });
      const data = await res.json();
      setIssuesList(data.issues ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { if (isFinance) load(); }, [isFinance, load]);

  async function handleAdvance(id: string, next: InboxStatus) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/finance/issues/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
      const { issue: updated } = await res.json();
      const patch = {
        status: updated.status as InboxStatus,
        reviewedAt: updated.reviewedAt ?? null,
        reviewedBy: updated.reviewedBy ?? null,
        updatedAt: updated.updatedAt,
      };
      setIssuesList(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
      setSelected(prev => prev?.id === id ? { ...prev, ...patch } : prev);
    } catch {
      // silent
    } finally {
      setUpdating(false);
    }
  }

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></div>
  );

  if (!isFinance) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only Finance users can review issue reports.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      {/* Header */}
      <PanelPageHeader
        scope="Finance"
        title="Issue Reports"
        subtitle={<>

              {issuesList.length} issue{issuesList.length !== 1 ? 's' : ''} routed to Finance

        </>}
        actions={
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      <div className="px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <IssueInbox
          issues={issuesList}
          loading={loading}
          theme="emerald"
          showArea
          selectedId={selected?.id}
          onSelect={setSelected}
          emptyHint="Everything routed to Finance is clear."
        />
      </div>

      {selected && (
        <IssueDrawer
          issue={selected}
          theme="emerald"
          updating={updating}
          onAdvance={handleAdvance}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
