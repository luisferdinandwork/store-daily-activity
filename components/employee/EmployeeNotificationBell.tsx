'use client';
// components/employee/EmployeeNotificationBell.tsx
//
// Employee-side counterpart to components/ops/layout/NotificationBell.tsx —
// same polling/read-state behavior, styled for the primary-colored top bar
// and sized for a mobile touch target (44px hit area on the trigger).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
const PREVIEW_COUNT = 6;

export default function EmployeeNotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/notifications', { cache: 'no-store' });
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
      void fetch(`/api/employee/notifications/${item.id}`, { method: 'PATCH' });
    }
    if (item.link) router.push(item.link);
  }

  async function handleMarkAllRead() {
    setItems((prev) => prev.map((i) => ({ ...i, isRead: true })));
    setUnreadCount(0);
    await fetch('/api/employee/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllRead: true }),
    });
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-primary-foreground/90 transition-colors hover:bg-white/10 active:scale-95"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-primary">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-[calc(100vw-2rem)] max-w-80 overflow-hidden rounded-2xl border border-border bg-card text-left shadow-xl">
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
                {items.slice(0, PREVIEW_COUNT).map((item) => (
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

          <Link
            href="/employee/announcements"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-3.5 py-2.5 text-center text-[11px] font-semibold text-primary hover:bg-secondary"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
