'use client';
// app/audit/page.tsx — Audit dashboard landing page.

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, Loader2, AlertCircle, Shield } from 'lucide-react';

type IssueStatus = 'reported' | 'in_review' | 'solved' | 'completed';

interface AuditIssue {
  id: string;
  status: IssueStatus;
}

export default function AuditDashboardPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role as string | undefined;
  const isAudit = role === 'audit' || role === 'it';

  const [issues, setIssues]   = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session)  { router.replace('/login'); return; }
    if (!isAudit)  router.replace('/');
  }, [authStatus, session, isAudit, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/audit/issues', { cache: 'no-store' });
      const data = await res.json();
      setIssues(data.issues ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAudit) load(); }, [isAudit, load]);

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-amber-400" /></div>
  );

  if (!isAudit) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only Audit users can view this page.</p>
    </div>
  );

  const stats = {
    reported:  issues.filter(i => i.status === 'reported').length,
    in_review: issues.filter(i => i.status === 'in_review').length,
    solved:    issues.filter(i => i.status === 'solved').length,
    completed: issues.filter(i => i.status === 'completed').length,
  };

  const cards = [
    { label: 'Reported',  value: stats.reported,  color: '#f59e0b', Icon: AlertCircle },
    { label: 'In Review', value: stats.in_review, color: '#3b82f6', Icon: Eye },
    { label: 'Solved',    value: stats.solved,    color: '#8b5cf6', Icon: CheckCircle2 },
    { label: 'Completed', value: stats.completed, color: '#10b981', Icon: CheckCircle2 },
  ];

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-5 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Audit</p>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {issues.length} issue{issues.length !== 1 ? 's' : ''} routed to Audit
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-400" /></div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cards.map(({ label, value, color, Icon }) => (
              <div key={label} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: color + '15' }}>
                  <Icon className="h-5 w-5" style={{ color }} />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <Link
          href="/audit/issues"
          className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-700 transition-colors hover:bg-amber-100"
        >
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Review issue reports</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
