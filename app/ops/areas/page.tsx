'use client';
// app/ops/areas/page.tsx — OPS HO only.
//
// Thin page wrapper: auth guard + OPS header chrome. The actual "Area
// Management" body (monitoring + settings tabs) lives in
// components/ops/areas/AreaManagementView.tsx, shared with app/it/areas/page.tsx.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Loader2, Shield } from 'lucide-react';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import AreaManagementView from '@/components/ops/areas/AreaManagementView';

function useIsOpsHo() {
  const { data: session } = useSession();
  return session?.user?.isOpsHo === true || session?.user?.role === 'it';
}

export default function OpsAreasPage() {
  const { status: authStatus, data: session } = useSession();
  const router = useRouter();
  const isOpsHo = useIsOpsHo();

  const [info, setInfo] = useState({ loading: true, areaCount: 0, storeCount: 0, reload: () => {} });

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOpsHo) router.replace('/ops');
  }, [authStatus, session, isOpsHo, router]);

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  );

  if (!isOpsHo) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only OPS HO can manage areas.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Head Office"
        title="Area Management"
        subtitle={`${info.areaCount} area · ${info.storeCount} toko`}
        onRefresh={info.reload}
        refreshing={info.loading}
      />

      <div className="mx-auto space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <AreaManagementView onReady={setInfo} />
      </div>
    </div>
  );
}
