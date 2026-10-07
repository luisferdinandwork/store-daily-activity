'use client';
// components/auth/reset-steps.tsx
//
// The three "Lupa password" steps, shown beside the forms so staff know what
// happens next: full list on the desktop brand panel, a compact stepper on phones.

import { Check, MailCheck, ShieldCheck, KeyRound } from 'lucide-react';

import { cn } from '@/lib/utils';

/** 4 = every step done. */
export type ResetStep = 1 | 2 | 3 | 4;

const STEPS = [
  {
    n: 1 as const,
    icon: MailCheck,
    title: 'Ajukan permintaan',
    short: 'Ajukan',
    desc: 'Isi NIK dan email toko Anda. Notifikasi dikirim ke email toko.',
  },
  {
    n: 2 as const,
    icon: ShieldCheck,
    title: 'Verifikasi oleh IT',
    short: 'Verifikasi IT',
    desc: 'Tim IT memeriksa permintaan, lalu mengirim link ke email toko.',
  },
  {
    n: 3 as const,
    icon: KeyRound,
    title: 'Buat password baru',
    short: 'Password baru',
    desc: 'Buka link, isi NIK Anda, password baru, dan konfirmasinya.',
  },
];

export function ResetStepsAside({ current, title, subtitle }: { current: ResetStep; title: string; subtitle: string }) {
  return (
    <div className="space-y-8">
      <div>
        <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.25em] text-primary-foreground/35">
          Keamanan akun
        </p>
        <h2 className="text-[2.4rem] font-extrabold leading-[1.08] tracking-tight text-primary-foreground">{title}</h2>
        <p className="mt-4 max-w-[340px] text-sm leading-relaxed text-primary-foreground/55">{subtitle}</p>
      </div>

      <ol className="relative space-y-5">
        <span className="absolute bottom-4 left-[17px] top-4 w-px bg-white/15" aria-hidden />
        {STEPS.map(({ n, icon: Icon, title: stepTitle, desc }) => {
          const done = n < current;
          const active = n === current;
          return (
            <li key={n} className="relative flex items-start gap-4">
              <div
                className={cn(
                  'relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-4 ring-primary transition-colors',
                  active && 'bg-white text-primary',
                  done && 'bg-white/25 text-primary-foreground',
                  !active && !done && 'bg-white/10 text-primary-foreground/45',
                )}
              >
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="pt-1">
                <p
                  className={cn(
                    'text-sm font-semibold',
                    active ? 'text-primary-foreground' : 'text-primary-foreground/60',
                  )}
                >
                  {n}. {stepTitle}
                </p>
                <p
                  className={cn(
                    'mt-0.5 max-w-[320px] text-xs leading-relaxed',
                    active ? 'text-primary-foreground/70' : 'text-primary-foreground/40',
                  )}
                >
                  {desc}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ResetStepsCompact({ current }: { current: ResetStep }) {
  return (
    <ol className="flex w-full max-w-90 items-start" aria-label="Langkah reset password">
      {STEPS.map(({ n, short }, i) => {
        const done = n < current;
        const active = n === current;
        return (
          <li key={n} className="flex flex-1 flex-col items-center gap-1.5" aria-current={active ? 'step' : undefined}>
            <div className="flex w-full items-center">
              <span className={cn('h-0.5 flex-1 rounded-full', i === 0 ? 'opacity-0' : n <= current ? 'bg-primary' : 'bg-border')} />
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                  active && 'bg-primary text-primary-foreground shadow-md shadow-primary/25',
                  done && 'bg-primary/15 text-primary',
                  !active && !done && 'bg-background text-muted-foreground ring-1 ring-border',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </span>
              <span
                className={cn(
                  'h-0.5 flex-1 rounded-full',
                  i === STEPS.length - 1 ? 'opacity-0' : n < current ? 'bg-primary' : 'bg-border',
                )}
              />
            </div>
            <span
              className={cn(
                'text-[10px] font-semibold',
                active ? 'text-foreground' : 'text-muted-foreground/70',
              )}
            >
              {short}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
