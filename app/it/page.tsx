'use client';
// app/it/page.tsx — IT dashboard landing page.

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight, KeyRound, ClipboardCheck, Layers, Store, Users,
  AlertTriangle, Repeat, Loader2, Shield, AlertCircle, Eye, CheckCircle2,
} from 'lucide-react';

type IssueStatus = 'reported' | 'in_review' | 'solved' | 'completed';

interface ItIssue {
  id: string;
  status: IssueStatus;
}

export default function ItDashboardPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role as string | undefined;
  const isIt = role === 'it';

  const [issues, setIssues]   = useState<ItIssue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt)    router.replace('/');
  }, [authStatus, session, isIt, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/it/issues', { cache: 'no-store' });
      const data = await res.json();
      setIssues(data.issues ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) load(); }, [isIt, load]);

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can view this page.</p>
    </div>
  );

  const stats = {
    reported:  issues.filter(i => i.status === 'reported').length,
    in_review: issues.filter(i => i.status === 'in_review').length,
    solved:    issues.filter(i => i.status === 'solved').length,
    completed: issues.filter(i => i.status === 'completed').length,
  };

  const statCards = [
    { label: 'Reported',  value: stats.reported,  color: '#f59e0b', Icon: AlertCircle },
    { label: 'In Review', value: stats.in_review, color: '#3b82f6', Icon: Eye },
    { label: 'Solved',    value: stats.solved,    color: '#8b5cf6', Icon: CheckCircle2 },
    { label: 'Completed', value: stats.completed, color: '#10b981', Icon: CheckCircle2 },
  ];

  const settingsLinks = [
    { href: '/it/users', label: 'Users', desc: 'Create accounts, assign roles, deactivate access.', Icon: Users },
    { href: '/it/switch-role', label: 'Switch Role', desc: 'Preview the app as another role, then switch back.', Icon: Repeat },
    { href: '/ops/stores', label: 'Store Locations', desc: 'Set store geofence lat/lng/radius.', Icon: Store },
    { href: '/ops/tasks/settings', label: 'Task Management', desc: 'Configure location requirements per task.', Icon: ClipboardCheck },
    { href: '/ops/shift-tasks', label: 'Shift & Tasks', desc: 'Configure shifts and their task assignments.', Icon: Layers },
    { href: '/ops/settings/bc-credentials', label: 'BC Credentials', desc: 'Manage Business Central API credentials.', Icon: KeyRound },
  ];

  const issueLinks = [
    { href: '/it/issues', label: 'IT Issues' },
    { href: '/ops/issues', label: 'Ops Issues' },
    { href: '/finance/issues', label: 'Finance Issues' },
    { href: '/audit/issues', label: 'Audit Issues' },
  ];

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-5 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">IT</p>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-0.5 text-xs text-slate-400">Super-admin — full access across every role.</p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-8 p-6 lg:p-8">
        <section>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            IT issue queue {loading ? '' : `· ${issues.length} total`}
          </p>
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-cyan-400" /></div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {statCards.map(({ label, value, color, Icon }) => (
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
        </section>

        <section>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Management &amp; settings</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {settingsLinks.map(({ href, label, desc, Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-cyan-300"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-600">
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800">{label}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{desc}</p>
                </div>
                <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-slate-300" />
              </Link>
            ))}
          </div>
        </section>

        <section>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Issue queues</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {issueLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-bold text-slate-800 shadow-sm transition-colors hover:border-cyan-300"
              >
                <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-slate-400" />{label}</span>
                <ArrowRight className="h-4 w-4 text-slate-300" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
