'use client';
// app/ops/tasks/settings/page.tsx — OPS "Task Management" settings.
//
// Replaces the old per-task-type "monitor every store" pages. This page does
// ONE thing: lets OPS decide, per task type, whether employees must grant
// location before they can work on it. Everything else about a task type
// (label, icon, shift assignment) still lives in "Shift & Tasks".

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Store, Sunrise, UserCheck, Wallet, Boxes, ClipboardCheck, Megaphone,
  PackageOpen, Undo2, Banknote, MessagesSquare, Repeat, MoonStar,
  MapPin, MapPinOff, Search, Loader2, Shield, Sparkles, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { Switch } from '@/components/ui/switch';
import { paletteOf, type PaletteKey, type TaskDefinitionDTO } from '@/lib/shift-tasks';

// ─── Icon resolution ────────────────────────────────────────────────────────
// Covers every icon name used in lib/shift-tasks.ts's TASK_CATALOG.

const TASK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Store, Sunrise, UserCheck, Wallet, Boxes, ClipboardCheck, Megaphone,
  PackageOpen, Undo2, Banknote, MessagesSquare, Repeat, MoonStar,
};

function TaskGlyph({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && TASK_ICONS[name]) || ClipboardCheck;
  return <Icon className={className} />;
}

// ─── Auth guard (matches the "Shift & Tasks" admin page) ────────────────────
// Task Management is IT-only — regular Ops (area or HO) can no longer edit it.

function useIsIt() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role as string | undefined;
  return role === 'it';
}

// ─── Task card ────────────────────────────────────────────────────────────────

function TaskCard({
  task, saving, onToggle,
}: {
  task: TaskDefinitionDTO;
  saving: boolean;
  onToggle: (next: boolean) => void;
}) {
  const pal = paletteOf(task.accent as PaletteKey | null);

  return (
    <div
      className="group relative overflow-hidden rounded-2xl border bg-white p-4 shadow-sm transition-all hover:shadow-md"
      style={{ borderColor: pal.border }}
    >
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-40 blur-xl transition-opacity group-hover:opacity-60"
        style={{ background: pal.dot }}
      />

      <div className="relative flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: pal.bg, color: pal.text }}
        >
          <TaskGlyph name={task.icon} className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-bold text-slate-900">{task.label}</p>
            {task.isPersonal && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold text-violet-600">
                <Users className="h-2.5 w-2.5" /> Personal
              </span>
            )}
          </div>
          <p className="truncate text-[10px] text-slate-400 font-mono">{task.code}</p>
        </div>
      </div>

      {task.description && (
        <p className="relative mt-2.5 text-xs leading-snug text-slate-500">{task.description}</p>
      )}

      <div className="relative mt-3.5 flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {task.requiresLocation
            ? <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            : <MapPinOff className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
          <span className={cn(
            'truncate text-xs font-semibold',
            task.requiresLocation ? 'text-emerald-700' : 'text-slate-500',
          )}>
            {task.requiresLocation ? 'Wajib lokasi' : 'Tanpa lokasi'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          <Switch
            checked={task.requiresLocation}
            onCheckedChange={onToggle}
            disabled={saving}
            aria-label={`Wajib lokasi untuk ${task.label}`}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({
  icon: Icon, label, value, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: 'emerald' | 'slate' | 'indigo';
}) {
  const tones = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', iconBg: 'bg-emerald-100' },
    slate:   { bg: 'bg-slate-50',   text: 'text-slate-700',   iconBg: 'bg-slate-200' },
    indigo:  { bg: 'bg-indigo-950', text: 'text-white',       iconBg: 'bg-indigo-800' },
  } as const;
  const t = tones[tone];

  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border border-slate-200 p-4', t.bg, tone === 'indigo' && 'border-indigo-900')}>
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', t.iconBg)}>
        <Icon className={cn('h-5 w-5', tone === 'indigo' ? 'text-indigo-200' : t.text)} />
      </div>
      <div className="min-w-0">
        <p className={cn('text-2xl font-black tabular-nums', t.text)}>{value}</p>
        <p className={cn('truncate text-[11px] font-semibold', tone === 'indigo' ? 'text-indigo-300' : 'text-slate-400')}>
          {label}
        </p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsTaskSettingsPage() {
  const { status: authStatus, data: session } = useSession();
  const router = useRouter();
  const isIt = useIsIt();

  const [tasks, setTasks]     = useState<TaskDefinitionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt)    router.replace('/');
  }, [authStatus, session, isIt, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/ops/task-definitions', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load tasks');
      setTasks((json.tasks as TaskDefinitionDTO[]).filter(t => t.isActive));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) void load(); }, [isIt, load]);

  async function handleToggle(task: TaskDefinitionDTO, next: boolean) {
    const prev = tasks;
    setSavingId(task.id);
    // Optimistic update — settings pages should feel instant.
    setTasks(cur => cur.map(t => (t.id === task.id ? { ...t, requiresLocation: next } : t)));

    try {
      const res  = await fetch(`/api/ops/task-definitions/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requiresLocation: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Update failed');
      toast.success(
        next
          ? `${task.label} sekarang wajib lokasi`
          : `${task.label} tidak lagi butuh lokasi`,
      );
    } catch (e) {
      setTasks(prev); // roll back
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan perubahan');
    } finally {
      setSavingId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(t =>
      t.label.toLowerCase().includes(q) ||
      t.code.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q),
    );
  }, [tasks, search]);

  const requiresLocationList = filtered.filter(t => t.requiresLocation);
  const noLocationList       = filtered.filter(t => !t.requiresLocation);

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can manage task settings.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Configuration"
        title="Task Management"
        subtitle={`${tasks.length} task type${tasks.length !== 1 ? 's' : ''} · atur wajib-tidaknya lokasi per task`}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="mx-auto space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {/* ── Stats ── */}
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile icon={Sparkles} label="Total task type" value={tasks.length} tone="indigo" />
          <StatTile icon={MapPin} label="Wajib lokasi" value={tasks.filter(t => t.requiresLocation).length} tone="emerald" />
          <StatTile icon={MapPinOff} label="Tanpa lokasi" value={tasks.filter(t => !t.requiresLocation).length} tone="slate" />
        </div>

        {/* ── Search ── */}
        <label className="relative block max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cari task…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <Search className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Tidak ada task ditemukan</p>
            <p className="mt-1 text-xs text-slate-400">Coba kata kunci pencarian lain.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {requiresLocationList.length > 0 && (
              <section>
                <p className="mb-2.5 flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                  <MapPin className="h-3 w-3" /> Wajib Lokasi · {requiresLocationList.length}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {requiresLocationList.map(t => (
                    <TaskCard key={t.id} task={t} saving={savingId === t.id} onToggle={(v) => handleToggle(t, v)} />
                  ))}
                </div>
              </section>
            )}

            {noLocationList.length > 0 && (
              <section>
                <p className="mb-2.5 flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <MapPinOff className="h-3 w-3" /> Tanpa Lokasi · {noLocationList.length}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {noLocationList.map(t => (
                    <TaskCard key={t.id} task={t} saving={savingId === t.id} onToggle={(v) => handleToggle(t, v)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
