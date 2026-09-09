'use client';
// app/employee/profile/page.tsx
//
// Single employee account screen — account info + profile picture + password.
// (The old /employee/settings now redirects here.)

import { useSession, signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  IdCard, Briefcase, Store, Clock, LogOut, Sun, Moon, Loader2,
} from 'lucide-react';
import UserAvatar from '@/components/shared/UserAvatar';
import ProfilePictureCard from '@/components/shared/ProfilePictureCard';
import ChangePasswordCard from '@/components/shared/ChangePasswordCard';

interface TodaySchedule {
  shift: 'morning' | 'evening' | null;
  storeName: string | null;
}

const EMP_TYPE_LABEL: Record<string, string> = {
  pic_1: 'PIC 1', pic_2: 'PIC 2', so: 'SO', sa: 'SA',
};

export default function EmployeeProfilePage() {
  const { data: session } = useSession();
  const user = session?.user;

  const [todayData, setTodayData] = useState<TodaySchedule>({ shift: null, storeName: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.homeStoreId) { setLoading(false); return; }
    fetch('/api/employee/today-schedule')
      .then(r => r.json())
      .then(data => {
        setTodayData({
          shift: data.shift ?? null,
          storeName: data.storeName ?? null,
        });
      })
      .catch(() => {/* ignore, show fallback */})
      .finally(() => setLoading(false));
  }, [user?.homeStoreId]);

  const shift = todayData.shift;
  const isEvening = shift === 'evening';

  const infoRows = [
    { icon: IdCard, label: 'NIK', value: user?.nik ?? '—' },
    {
      icon: Briefcase,
      label: 'Employee Type',
      value: user?.employeeType ? (EMP_TYPE_LABEL[user.employeeType] ?? user.employeeType) : '—',
    },
    { icon: Store, label: 'Store', value: loading ? '…' : (todayData.storeName ?? '—') },
    {
      icon: Clock,
      label: "Today's Shift",
      value: loading ? '…' : shift ? `${shift.charAt(0).toUpperCase() + shift.slice(1)} shift` : 'No shift today',
    },
  ];

  return (
    <div className="flex flex-col">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden bg-primary px-6 pb-8 pt-8 text-center">
        <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-10 top-4 h-28 w-28 rounded-full bg-white/5" />

        <UserAvatar
          src={user?.image}
          name={user?.name}
          className="relative mx-auto h-20 w-20 border-2 border-white/25"
          fallbackClassName="bg-white/10 text-xl text-primary-foreground"
        />

        <h1 className="relative mt-4 text-xl font-bold text-primary-foreground">
          {user?.name ?? '—'}
        </h1>
        <p className="relative mt-1 text-xs font-semibold uppercase tracking-widest text-primary-foreground/50">
          {user?.role ?? 'Employee'}
        </p>

        <div className="relative mt-4 flex flex-wrap justify-center gap-2">
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
      <div className="space-y-4 p-4">
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

        <ProfilePictureCard />
        <ChangePasswordCard />

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
