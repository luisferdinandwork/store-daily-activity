// components/auth/login-form.tsx
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Lock,
  ArrowRight,
  CheckCircle2,
  IdCard,
  Clock,
} from 'lucide-react';
import { AuthInput, AuthLabel, AuthShell, AuthSubmitButton, PasswordInput } from './auth-ui';

const FEATURES = [
  {
    title: 'Attendance Tracking',
    desc: 'Real-time check-in, check-out, and break monitoring for every shift.',
  },
  {
    title: 'Daily Task Management',
    desc: 'Assign, track, and complete opening tasks, grooming checks, and more.',
  },
  {
    title: 'Store Operations',
    desc: 'Petty cash, daily reports, and issue management in one place.',
  },
  {
    title: 'Schedule Management',
    desc: 'Monthly schedules with full cross-store deployment support.',
  },
];

export function LoginForm() {
  const [nik, setNik] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const timedOut = searchParams.get('reason') === 'timeout';
  // Back from the emailed reset link (components/auth/reset-password-form.tsx).
  const justReset = searchParams.get('reset') === 'success';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleanNik = nik.trim();

    if (!cleanNik || !password) {
      setError('NIK and password are required.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await signIn('credentials', {
        nik: cleanNik,
        password,
        redirect: false,
      });

      if (result?.error) {
        // 'TooManyAttempts' is thrown by authorize() when the login throttle trips (lib/auth.ts).
        setError(
          result.error === 'TooManyAttempts'
            ? 'Too many failed attempts. Please wait about 15 minutes and try again.'
            : 'Invalid NIK or password. Please try again.',
        );
      } else {
        router.push('/');
        router.refresh();
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell aside={<LoginAside />}>
      <div className="mb-8">
        <span className="text-base font-bold uppercase tracking-tighter text-primary lg:hidden">
          Daily Store Application
        </span>

        <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>

        <p className="mt-1.5 text-sm text-muted-foreground">Sign in with your NIK to continue</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <AuthLabel htmlFor="nik">NIK</AuthLabel>
          <AuthInput
            id="nik"
            icon={IdCard}
            type="text"
            inputMode="text"
            placeholder="Enter your NIK"
            value={nik}
            onChange={(e) => setNik(e.target.value)}
            required
            autoComplete="username"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <AuthLabel htmlFor="password">Password</AuthLabel>
            <Link href="/forgot-password" className="text-xs font-semibold text-primary hover:underline">
              Lupa password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            icon={Lock}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        {!error && justReset && (
          <Alert className="rounded-xl border-emerald-200 bg-emerald-50 py-2.5 text-emerald-800">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertDescription className="text-xs text-emerald-800">
              Password berhasil diubah. Silakan masuk dengan password baru Anda.
            </AlertDescription>
          </Alert>
        )}

        {!error && !justReset && timedOut && (
          <Alert className="rounded-xl py-2.5">
            <Clock className="h-4 w-4" />
            <AlertDescription className="text-xs">
              You were signed out after 15 minutes of inactivity. Please sign in again.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="rounded-xl py-2.5">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        <AuthSubmitButton loading={isLoading} loadingText="Signing in…">
          Sign in
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </AuthSubmitButton>
      </form>

      <div className="mt-7 rounded-xl border border-border bg-background/70 px-4 py-3.5">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Need access?</span>{' '}
          Contact your store manager or system administrator to receive your NIK and password.
        </p>
      </div>
    </AuthShell>
  );
}

function LoginAside() {
  return (
    <div className="space-y-8">
      <div>
        <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.25em] text-primary-foreground/35">
          Operations Platform
        </p>

        <h2 className="text-[2.6rem] font-extrabold leading-[1.08] tracking-tight text-primary-foreground">
          Run your store
          <br />
          <span className="text-primary-foreground/45">with confidence.</span>
        </h2>

        <p className="mt-4 max-w-[300px] text-sm leading-relaxed text-primary-foreground/55">
          A unified platform for store managers and employees to coordinate shifts,
          tasks, and daily operations — seamlessly.
        </p>
      </div>

      <ul className="space-y-4">
        {FEATURES.map(({ title, desc }) => (
          <li key={title} className="flex items-start gap-3">
            <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/15">
              <CheckCircle2 className="h-3 w-3 text-primary-foreground/75" />
            </div>

            <div>
              <p className="text-xs font-semibold text-primary-foreground/85">{title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-primary-foreground/45">{desc}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
