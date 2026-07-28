'use client';
// app/ops/manage/page.tsx

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, Shield } from 'lucide-react';
import { toast } from 'sonner';

import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { ManageWorkspace } from '@/components/ops/manage/manage-workspace';
import type { WorkspaceData } from '@/components/ops/manage/types';

export default function OpsManagePage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const user = session?.user as any;
  const role = user?.role as string | undefined;
  const isOps = role === 'ops' || role === 'it';

  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus === 'loading') return;

    if (!session) {
      router.replace('/login');
      return;
    }

    if (!isOps) router.replace('/');
  }, [authStatus, session, isOps, router]);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/ops/users/workspace', { cache: 'no-store' });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error ?? 'Failed to load workspace.');

      setData(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOps) void loadWorkspace();
  }, [isOps, loadWorkspace]);

  if (authStatus === 'loading' || !session) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    );
  }

  if (!isOps) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-100">
          <Shield className="h-8 w-8 text-rose-500" />
        </div>
        <div>
          <p className="text-base font-bold text-slate-800">Akses Dibatasi</p>
          <p className="mt-1 text-sm text-slate-500">
            Hanya pengguna OPS atau Admin yang dapat mengelola karyawan.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · People"
        title="Manage Workspace"
        subtitle="Kelola karyawan, assignment toko, role, dan akses operasional."
        onRefresh={loadWorkspace}
        refreshing={loading}
        contentClassName="w-full"
      />

      <div className="mx-auto p-6 lg:p-8">
        {loading || !data ? (
          <div className="flex min-h-[360px] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50">
                <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
              </div>
              <p className="text-sm font-medium text-slate-400">Memuat workspace…</p>
            </div>
          </div>
        ) : (
          <ManageWorkspace data={data} onReload={loadWorkspace} />
        )}
      </div>
    </div>
  );
}
