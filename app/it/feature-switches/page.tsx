'use client';
// app/it/feature-switches/page.tsx
//
// IT turns risky or optional features on and off for everyone. The switches
// themselves are declared in lib/feature-switches.ts (with their default);
// state lives in feature_switches via /api/it/feature-switches. Turning one on
// asks for confirmation first; turning it off doesn't.

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Shield, ToggleRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import type { FeatureSwitchKey, FeatureSwitchState } from '@/lib/feature-switches';

function formatChangedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SwitchCard({ item, saving, onChange }: {
  item: FeatureSwitchState;
  saving: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border bg-white p-4 shadow-sm transition-colors sm:p-5',
        item.enabled ? 'border-rose-200' : 'border-slate-200',
      )}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{item.appliesTo}</p>
          <p className="mt-0.5 text-sm font-bold text-slate-900">{item.title}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{item.description}</p>
          <p className="mt-2.5 text-[11px] text-slate-400">
            Default: {item.defaultEnabled ? 'on' : 'off'}
            {item.updatedAt
              ? ` · Last changed ${formatChangedAt(item.updatedAt)}${item.updatedByName ? ` by ${item.updatedByName}` : ''}`
              : ' · Never changed'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 pt-1">
          <div className="flex items-center gap-2">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
            <Switch
              checked={item.enabled}
              disabled={saving}
              onCheckedChange={onChange}
              aria-label={`${item.title}: ${item.enabled ? 'on' : 'off'}`}
              className="data-[state=checked]:bg-rose-600 data-[state=unchecked]:bg-slate-300"
            />
          </div>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
              item.enabled ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500',
            )}
          >
            {item.enabled ? 'On' : 'Off'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function FeatureSwitchesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [items, setItems] = useState<FeatureSwitchState[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<FeatureSwitchKey | null>(null);
  const [confirmOn, setConfirmOn] = useState<FeatureSwitchState | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt) router.replace('/');
  }, [authStatus, session, isIt, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/it/feature-switches', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to load feature switches.');
      setItems(data.switches ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load feature switches.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) void load(); }, [isIt, load]);

  async function save(key: FeatureSwitchKey, enabled: boolean) {
    setSavingKey(key);
    try {
      const res = await fetch('/api/it/feature-switches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, enabled }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Failed to save the switch.');
      setItems(data.switches ?? []);
      toast.success(data.message ?? 'Saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save the switch.');
    } finally {
      setSavingKey(null);
      setConfirmOn(null);
    }
  }

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can manage feature switches.</p>
    </div>
  );

  const onCount = items.filter((i) => i.enabled).length;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="IT · Configuration"
        title="Feature Switches"
        subtitle={loading ? 'Loading…' : `${items.length} switch${items.length !== 1 ? 'es' : ''} · ${onCount} on`}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="mx-auto max-w-3xl space-y-3 px-4 py-5 sm:px-6 lg:px-8">
        <p className="text-xs text-slate-500">
          Turn features on or off for everyone. A change takes effect right away.
        </p>

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-cyan-400" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <ToggleRight className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">No feature switches</p>
          </div>
        ) : (
          items.map((item) => (
            <SwitchCard
              key={item.key}
              item={item}
              saving={savingKey === item.key}
              onChange={(enabled) => (enabled ? setConfirmOn(item) : void save(item.key, false))}
            />
          ))
        )}
      </div>

      <ConfirmDialog
        open={confirmOn !== null}
        onOpenChange={(open) => { if (!open) setConfirmOn(null); }}
        title={`Turn on ${confirmOn?.title ?? ''}?`}
        description={confirmOn?.description}
        confirmLabel="Turn on"
        cancelLabel="Cancel"
        tone="danger"
        icon={ToggleRight}
        busy={savingKey !== null}
        onConfirm={() => { if (confirmOn) void save(confirmOn.key, true); }}
      />
    </div>
  );
}
