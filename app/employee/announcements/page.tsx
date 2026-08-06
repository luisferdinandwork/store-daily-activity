'use client';
// app/employee/announcements/page.tsx
//
// Full notifications inbox — the "View all" destination from
// EmployeeNotificationBell. Route chrome (title/back button) comes from the
// shared EmployeeHeader; this page only renders the list itself.

import { useCallback, useEffect, useState } from 'react';
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

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AnnouncementsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/employee/notifications', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setItems(json.notifications ?? []);
        setUnreadCount(json.unreadCount ?? 0);
      }
    } catch {
      // Leave the list at its last known state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSelect(item: NotificationRow) {
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
    <div className="flex min-h-full flex-col bg-slate-50 pb-16">
      <div className="flex items-center justify-between px-4 pt-5">
        <p className="text-xs font-semibold text-muted-foreground">
          {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        </p>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </button>
        )}
      </div>

      <div className="flex-1 space-y-2 px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary">
              <Bell className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground">No notifications yet</p>
            <p className="max-w-[220px] text-xs text-muted-foreground">
              You&apos;ll see updates about your tasks and reports here.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item)}
              className={cn(
                'flex w-full flex-col items-start gap-1 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-all active:scale-[0.99]',
                !item.isRead && 'border-primary/20 bg-primary/[0.03]',
              )}
            >
              <div className="flex w-full items-start gap-2">
                {!item.isRead && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">{item.title}</p>
                <span className="shrink-0 text-[10px] text-muted-foreground">{fmtDateTime(item.createdAt)}</span>
              </div>
              {item.body && (
                <p className={cn('text-xs text-muted-foreground', !item.isRead && 'pl-3.5')}>
                  {item.body}
                </p>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
