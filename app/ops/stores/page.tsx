'use client';
// app/ops/stores/page.tsx
//
// Thin page wrapper: OPS header chrome. The actual store list/management
// body lives in components/ops/stores/StoreManagementView.tsx, shared with
// app/it/stores/page.tsx.

import { useState } from 'react';
import { Plus } from 'lucide-react';

import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { Button } from '@/components/ui/button';
import StoreManagementView from '@/components/ops/stores/StoreManagementView';

export default function OpsStoresPage() {
  const [info, setInfo] = useState({
    loading: true,
    totalAreas: 0,
    totalStores: 0,
    avgRate: 0,
    onAddStore: () => {},
    reload: () => {},
  });

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Overview"
        title="Stores"
        subtitle={
          info.loading
            ? 'Loading…'
            : `${info.totalAreas} area${info.totalAreas !== 1 ? 's' : ''} · ${info.totalStores} store${info.totalStores !== 1 ? 's' : ''} · ${info.avgRate}% avg completion today`
        }
        onRefresh={info.reload}
        refreshing={info.loading}
        contentClassName="w-full"
        actions={
          <Button
            type="button"
            size="sm"
            onClick={info.onAddStore}
            className="h-10 gap-2 rounded-xl px-4 text-sm font-semibold"
          >
            <Plus className="h-4 w-4" />
            Add Store
          </Button>
        }
      />

      <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
        <StoreManagementView onReady={setInfo} />
      </div>
    </div>
  );
}
