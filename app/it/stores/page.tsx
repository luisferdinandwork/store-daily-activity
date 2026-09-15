'use client';
// app/it/stores/page.tsx — IT Store Management.
//
// Thin page wrapper (IT chrome) around the shared store-management body in
// components/ops/stores/StoreManagementView.tsx — the same component
// app/ops/stores/page.tsx mounts. The roster's "Assign"/"Remove" actions are
// IT-only (gated inside the view via session.user.role === 'it') and call
// /api/it/users, so this page is where that capability is actually reachable
// for IT day to day.

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Shield, Store as StoreIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StoreManagementView from '@/components/ops/stores/StoreManagementView';

export default function ItStoresPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [info, setInfo] = useState({
    loading: true,
    totalAreas: 0,
    totalStores: 0,
    avgRate: 0,
    onAddStore: () => {},
    reload: () => {},
  });

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt) router.replace('/');
  }, [authStatus, session, isIt, router]);

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can manage stores.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-5 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">IT</p>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <StoreIcon className="h-5 w-5 text-cyan-600" />
              Store Management
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              {info.loading
                ? 'Loading…'
                : `${info.totalAreas} area${info.totalAreas !== 1 ? 's' : ''} · ${info.totalStores} store${info.totalStores !== 1 ? 's' : ''} · ${info.avgRate}% avg completion today`}
            </p>
          </div>
          <Button onClick={info.onAddStore} className="gap-1.5 bg-cyan-600 hover:bg-cyan-700">
            <Plus className="h-4 w-4" />
            Add Store
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
        <StoreManagementView onReady={setInfo} />
      </div>
    </div>
  );
}
