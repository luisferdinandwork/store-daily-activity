// app/ops/stores/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { MapPin, Users, TrendingUp, ChevronRight, Store } from 'lucide-react';

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

export default function OpsStoresPage() {
  const [stores, setStores] = useState<StoreData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch stores + today's stats for each
    fetch('/api/ops/stores')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setStores(data.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Stores</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Overview of all stores and today's progress
        </p>
      </div>

      {/* Store cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {loading
          ? Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-5">
                  <div className="h-32 animate-pulse rounded bg-secondary" />
                </CardContent>
              </Card>
            ))
          : stores.map((store) => (
              <Card key={store.id} className="overflow-hidden">
                <CardHeader className="pb-3 bg-secondary/40">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                        <Store className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-semibold">{store.name}</CardTitle>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {store.address}
                        </div>
                      </div>
                    </div>
                    <Link href={`/ops/stores/${store.id}`}>
                      <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-primary">
                        Details <ChevronRight className="h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                </CardHeader>

                <CardContent className="p-5 space-y-4">
                  {/* Completion */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-muted-foreground">Task Completion</span>
                      <span
                        className={`font-bold ${
                          store.stats.completionRate >= 80
                            ? 'text-green-600'
                            : store.stats.completionRate >= 50
                            ? 'text-amber-600'
                            : 'text-destructive'
                        }`}
                      >
                        {Math.round(store.stats.completionRate)}%
                      </span>
                    </div>
                    <Progress value={store.stats.completionRate} className="h-2" />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {store.stats.completed} / {store.stats.total} tasks done today
                    </p>
                  </div>

                  {/* Bottom stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md bg-secondary p-2.5 text-center">
                      <p className="text-lg font-bold text-foreground">
                        {store.stats.pending}
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Pending
                      </p>
                    </div>
                    <div className="rounded-md bg-secondary p-2.5 text-center">
                      <p className="text-lg font-bold text-foreground">
                        {store.attendance.present}/{store.attendance.scheduled}
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Present
                      </p>
                    </div>
                    <div className="rounded-md bg-secondary p-2.5 text-center">
                      <p className="text-lg font-bold text-foreground">
                        {Number(store.pettyCashBalance).toLocaleString('id-ID', {
                          notation: 'compact',
                        })}
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Cash
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>
    </div>
  );
}