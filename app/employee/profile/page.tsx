// app/employee/profile/page.tsx
'use client';

import { useSession, signOut } from 'next-auth/react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  UserCircle,
  Mail,
  Briefcase,
  Store,
  Clock,
  LogOut,
  Sun,
  Moon,
} from 'lucide-react';

export default function EmployeeProfilePage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isEvening = user?.shift === 'evening';

  const infoRows = [
    { icon: Mail,      label: 'Email',         value: user?.email ?? '—' },
    { icon: Briefcase, label: 'Employee Type',  value: user?.employeeType?.toUpperCase() ?? '—' },
    { icon: Store,     label: 'Store',          value: user?.storeName ?? user?.storeId ?? '—' },
    { icon: Clock,     label: 'Shift',          value: user?.shift ? `${user.shift} shift` : '—' },
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

        {/* Shift + type badges */}
        <div className="relative mt-4 flex justify-center gap-2">
          {user?.employeeType && (
            <Badge className="h-6 bg-white/10 px-3 text-[11px] font-bold uppercase text-primary-foreground hover:bg-white/10">
              {user.employeeType}
            </Badge>
          )}
          {user?.shift && (
            <Badge className="h-6 gap-1 bg-white/10 px-3 text-[11px] font-bold text-primary-foreground hover:bg-white/10">
              {isEvening ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
              {user.shift} shift
            </Badge>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="space-y-3 p-4">
        {/* Account info card */}
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
                      <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
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

        {/* Sign out */}
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