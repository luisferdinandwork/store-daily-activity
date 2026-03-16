'use client';
// app/employee/profile/page.tsx

import { useSession, signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  UserCircle, Mail, Briefcase, Store,
  Clock, LogOut, Sun, Moon, Loader2,
} from 'lucide-react';

interface TodaySchedule {
  shift: 'morning' | 'evening' | null;
  storeName: string | null;
}

export default function EmployeeProfilePage() {
  const { data: session } = useSession();
  const user = session?.user as any;

  const [todayData, setTodayData] = useState<TodaySchedule>({ shift: null, storeName: null });
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!user?.homeStoreId) { setLoading(false); return; }
    fetch('/api/employee/today-schedule')
      .then(r => r.json())
      .then(data => {
        setTodayData({
          shift:     data.shift     ?? null,
          storeName: data.storeName ?? null,
        });
      })
      .catch(() => {/* ignore, show fallback */})
      .finally(() => setLoading(false));
  }, [user?.homeStoreId]);

  const shift     = todayData.shift;
  const isEvening = shift === 'evening';

  const EMP_TYPE_LABEL: Record<string, string> = {
    pic_1: 'PIC 1', pic_2: 'PIC 2', so: 'SO',
  };

  const infoRows = [
    {
      icon:  Mail,
      label: 'Email',
      value: user?.email ?? '—',
    },
    {
      icon:  Briefcase,
      label: 'Employee Type',
      value: user?.employeeType ? (EMP_TYPE_LABEL[user.employeeType] ?? user.employeeType) : '—',
    },
    {
      icon:  Store,
      label: 'Store',
      value: loading ? '…' : (todayData.storeName ?? '—'),
    },
    {
      icon:  Clock,
      label: "Today's Shift",
      value: loading ? '…' : shift ? `${shift.charAt(0).toUpperCase() + shift.slice(1)} shift` : 'No shift today',
    },
  ];

  return (
    <div className="flex flex-col">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden bg-primary px-6 pb-8 pt-12 text-center">
        <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-10 top-4 h-28 w-28 rounded-full bg-white/5" />

        {/* Avatar */}
        <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-white/20 bg-white/10">
          <UserCircle className="h-10 w-10 text-primary-foreground/80" strokeWidth={1.5} />
        </div>

        <h1 className="relative mt-4 text-xl font-bold text-primary-foreground">
          {user?.name ?? '—'}
        </h1>
        <p className="relative mt-1 text-xs font-semibold uppercase tracking-widest text-primary-foreground/50">
          {user?.role ?? 'Employee'}
        </p>

        {/* Badges */}
        <div className="relative mt-4 flex justify-center gap-2 flex-wrap">
          {user?.employeeType && (
            <Badge className="h-6 bg-white/10 px-3 text-[11px] font-bold uppercase text-primary-foreground hover:bg-white/10">
              {EMP_TYPE_LABEL[user.employeeType] ?? user.employeeType}
            </Badge>
          )}
          {loading ? (
            <Badge className="h-6 gap-1 bg-white/10 px-3 text-[11px] text-primary-foreground hover:bg-white/10">
              <Loader2 className="h-3 w-3 animate-spin" />
            </Badge>
          ) : shift ? (
            <Badge className="h-6 gap-1 bg-white/10 px-3 text-[11px] font-bold text-primary-foreground hover:bg-white/10">
              {isEvening ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
              {shift} shift
            </Badge>
          ) : null}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="space-y-3 p-4">
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Account Information
            </p>
            <div className="space-y-0">
              {infoRows.map(({ icon: Icon, label, value }, i) => (
                <div key={label}>
                  <div className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-2.5 text-muted-foreground">
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      <span className="text-sm">{label}</span>
                    </div>
                    <span className="text-sm font-medium text-foreground">{value}</span>
                  </div>
                  {i < infoRows.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Button
          variant="outline"
          className="h-12 w-full gap-2 border-border text-sm font-semibold text-muted-foreground hover:border-destructive hover:text-destructive"
          onClick={() => signOut({ callbackUrl: '/login' })}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}