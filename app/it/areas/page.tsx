'use client';
// app/it/areas/page.tsx — IT Area Management.
//
// Thin page wrapper (IT chrome) around the shared area-management body in
// components/ops/areas/AreaManagementView.tsx — the same component
// app/ops/areas/page.tsx mounts. IT is treated as OPS HO by every endpoint
// this view calls (getOpsActor/resolveOpsScope), so no API changes were
// needed to surface this in the IT panel.

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, MapPinned, Shield } from 'lucide-react';
import AreaManagementView from '@/components/ops/areas/AreaManagementView';

export default function ItAreasPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [info, setInfo] = useState({ loading: true, areaCount: 0, storeCount: 0, reload: () => {} });

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
      <p className="text-sm text-slate-500">Only IT can manage areas.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-5 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">IT</p>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <MapPinned className="h-5 w-5 text-cyan-600" />
              Area Management
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              {info.areaCount} area · {info.storeCount} toko
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-5 p-6 lg:p-8">
        <AreaManagementView onReady={setInfo} />
      </div>
    </div>
  );
}
