'use client';
// app/ops/stores/page.tsx

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, MapPin, Store, TrendingUp, Users, Wallet } from 'lucide-react';

import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface StoreData {
  id: string;
  name: string;
  address: string;
  pettyCashBalance: string;
  stats: {
    total: number;
    completed: number;
    pending: number;
    completionRate: number;
  };
  attendance: {
    scheduled: number;
    present: number;
  };
}

function completionTone(rate: number) {
  if (rate >= 80) return 'text-emerald-600';
  if (rate >= 50) return 'text-amber-600';
  return 'text-rose-600';
}

export default function OpsStoresPage() {
  const [stores, setStores] = useState<StoreData[]>([]);
  const [loading, setLoading] = useState(true);

  const loadStores = useCallback(async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/ops/stores', { cache: 'no-store' });
      const data = await res.json();

      if (data.success) setStores(data.data ?? []);
      else setStores([]);
    } catch (err) {
      console.error(err);
      setStores([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStores();
  }, [loadStores]);

  const totalStores = stores.length;
  const totalTasks = stores.reduce((sum, store) => sum + store.stats.total, 0);
  const completedTasks = stores.reduce((sum, store) => sum + store.stats.completed, 0);
  const avgCompletion = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Overview"
        title="Stores"
        subtitle={`${totalStores} store${totalStores !== 1 ? 's' : ''} · ${avgCompletion}% average task completion today`}
        onRefresh={loadStores}
        refreshing={loading}
        contentClassName="w-full"
      />

      <div className="mx-auto max-w-7xl space-y-5 p-6 lg:p-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="border-slate-200 bg-white">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50">
                <Store className="h-5 w-5 text-indigo-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{totalStores}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Stores</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
                <TrendingUp className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{avgCompletion}%</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Avg. Completion</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
                <Users className="h-5 w-5 text-violet-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">
                  {stores.reduce((sum, store) => sum + store.attendance.present, 0)}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Present Today</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {loading
            ? Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="border-slate-200 bg-white">
                  <CardContent className="p-5">
                    <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
                  </CardContent>
                </Card>
              ))
            : stores.map((store) => (
                <Card key={store.id} className="overflow-hidden border-slate-200 bg-white shadow-sm">
                  <CardHeader className="border-b border-slate-100 bg-slate-50/70 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                          <Store className="h-4 w-4 text-indigo-500" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="truncate text-base font-semibold text-slate-900">
                            {store.name}
                          </CardTitle>
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{store.address}</span>
                          </div>
                        </div>
                      </div>

                      <Link href={`/ops/stores/${store.id}`}>
                        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-indigo-600 hover:text-indigo-700">
                          Details <ChevronRight className="h-3 w-3" />
                        </Button>
                      </Link>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4 p-5">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-500">Task Completion</span>
                        <span className={`font-bold ${completionTone(store.stats.completionRate)}`}>
                          {Math.round(store.stats.completionRate)}%
                        </span>
                      </div>
                      <Progress value={store.stats.completionRate} className="h-2" />
                      <p className="mt-1 text-[10px] text-slate-500">
                        {store.stats.completed} / {store.stats.total} tasks done today
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl bg-slate-50 p-2.5 text-center ring-1 ring-slate-100">
                        <p className="text-lg font-bold text-slate-900">{store.stats.pending}</p>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Pending</p>
                      </div>

                      <div className="rounded-xl bg-slate-50 p-2.5 text-center ring-1 ring-slate-100">
                        <p className="text-lg font-bold text-slate-900">
                          {store.attendance.present}/{store.attendance.scheduled}
                        </p>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Present</p>
                      </div>

                      <div className="rounded-xl bg-slate-50 p-2.5 text-center ring-1 ring-slate-100">
                        <div className="flex items-center justify-center gap-1">
                          <Wallet className="h-3.5 w-3.5 text-slate-400" />
                          <p className="text-lg font-bold text-slate-900">
                            {Number(store.pettyCashBalance).toLocaleString('id-ID', {
                              notation: 'compact',
                            })}
                          </p>
                        </div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Cash</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
        </div>

        {!loading && stores.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <Badge variant="secondary" className="mb-3">No stores</Badge>
            <p className="text-sm font-semibold text-slate-700">No stores are visible for your OPS scope.</p>
            <p className="mt-1 text-xs text-slate-400">Check area assignment or store setup.</p>
          </div>
        )}
      </div>
    </div>
  );
}
