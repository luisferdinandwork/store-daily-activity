'use client';
// components/ops/layout/NotificationBell.tsx

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NotificationRow {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const POLL_INTERVAL_MS = 60_000;

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ops/notifications', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setItems(json.notifications ?? []);
        setUnreadCount(json.unreadCount ?? 0);
      }
    } catch {
      // Silent — the bell just stays at its last known state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  async function handleSelect(item: NotificationRow) {
    setOpen(false);
    if (!item.isRead) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isRead: true } : i)));
      setUnreadCount((c) => Math.max(0, c - 1));
      void fetch(`/api/ops/notifications/${item.id}`, { method: 'PATCH' });
    }
    if (item.link) router.push(item.link);
  }

  async function handleMarkAllRead() {
    setItems((prev) => prev.map((i) => ({ ...i, isRead: true })));
    setUnreadCount(0);
    await fetch('/api/ops/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllRead: true }),
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
            <p className="text-xs font-bold text-foreground">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
              >
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">No notifications yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(item)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 px-3.5 py-2.5 text-left transition-colors hover:bg-secondary',
                        !item.isRead && 'bg-primary/5',
                      )}
                    >
                      <div className="flex w-full items-center gap-2">
                        {!item.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{item.title}</p>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
                      </div>
                      {item.body && <p className="line-clamp-2 text-[11px] text-muted-foreground">{item.body}</p>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
