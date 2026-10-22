'use client';

// app/ops/issues/page.tsx — OPS issue inbox
//
// A searchable, sortable, filterable table of every issue routed to Ops
// (components/issues/IssueInbox — shared with Finance; view logic in
// lib/issue-inbox.ts) plus the follow-up drawer (components/issues/IssueDrawer).
//
// Scope is enforced server-side (/api/ops/issues): Ops HO sees every Ops-routed
// issue; an area Ops sees only issues from stores in their area. Search, sort and
// filters run here on that list.
//
// Phones (below `md`) get a sticky title bar and the list as cards; the drawer
// becomes a bottom sheet (see lib/ops-mobile.ts).

import { useCallback, useEffect, useState } from 'react';
import { Globe2, Loader2, MapPin, Shield } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { MobilePageHeader } from '@/components/ops/mobile/MobileKit';
import { IssueInbox } from '@/components/issues/IssueInbox';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import type { InboxIssue, InboxStatus } from '@/lib/issue-inbox';

export default function OpsIssuesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = session?.user?.role;
  const isOps = role === 'ops' || role === 'it';

  const [issuesList, setIssuesList] = useState<InboxIssue[]>([]);
  const [isHO, setIsHO] = useState(false);
  const [areaName, setAreaName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<InboxIssue | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOps) router.replace('/');
  }, [authStatus, session, isOps, router]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetch('/api/ops/issues', { cache: 'no-store' });
      const data = await res.json();
      setIssuesList(data.issues ?? []);
      setIsHO(!!data.isHO);
      setAreaName(data.area?.name ?? null);
    } catch {
      // silent
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { if (isOps) load(); }, [isOps, load]);

  async function handleAdvance(id: string, next: InboxStatus) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/ops/issues/${id}`, {
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
    <div className="flex min-h-full items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
  );

  if (!isOps) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only OPS users can review issue reports.</p>
    </div>
  );

  const count = `${issuesList.length} issue${issuesList.length !== 1 ? 's' : ''} routed to Ops`;

  return (
    <div className="min-h-full bg-slate-50">
      {/* Phones */}
      <div className="md:hidden">
        <MobilePageHeader
          eyebrow={isHO ? 'OPS · All areas' : `OPS · ${areaName ?? 'Your area'}`}
          title="Issues"
          subtitle={count}
          onRefresh={() => load(true)}
          refreshing={refreshing}
        />
      </div>

      {/* Desktop */}
      <OpsPageHeader
        display="desktop"
        className="hidden md:block"
        scope={isHO ? 'OPS · Head Office' : 'OPS · Area Issues'}
        title="Issue Reports"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {isHO ? (
              <><Globe2 className="h-3.5 w-3.5" />All areas</>
            ) : (
              <><MapPin className="h-3.5 w-3.5" />{areaName ?? 'Your area'}</>
            )}
            <span>·</span>
            <span>{count}</span>
          </span>
        }
        onRefresh={() => load(true)}
        refreshing={refreshing}
        contentClassName="w-full"
      />

      <div className="px-4 pb-8 pt-3 md:px-6 md:pt-5 lg:px-8">
        <IssueInbox
          issues={issuesList}
          loading={loading}
          theme="indigo"
          showArea={isHO}
          selectedId={selected?.id}
          onSelect={setSelected}
          emptyHint="Everything routed to Ops is clear."
        />
      </div>

      {selected && (
        <IssueDrawer
          issue={selected}
          theme="indigo"
          updating={updating}
          onAdvance={handleAdvance}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
