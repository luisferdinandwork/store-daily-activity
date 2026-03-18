// components/auth/login-form.tsx
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { Mail, Lock, Eye, EyeOff, ArrowRight, CheckCircle2 } from 'lucide-react';

const FEATURES = [
  {
    title: 'Attendance Tracking',
    desc: 'Real-time check-in, check-out, and break monitoring for every shift.',
  },
  {
    title: 'Daily Task Management',
    desc: 'Assign, track, and verify opening tasks, grooming checks, and more.',
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
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [error, setError]         = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('Invalid email or password. Please try again.');
      } else {
        router.push('/');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">

      {/* ══════════════════════════════════════
          LEFT PANEL — brand / info
      ══════════════════════════════════════ */}
      <div className="relative hidden w-[52%] flex-col overflow-hidden bg-primary lg:flex">

        {/* Background geometry */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Soft blurred orb — top right */}
          <div className="absolute -right-40 -top-40 h-[560px] w-[560px] rounded-full bg-white/5 blur-3xl" />
          {/* Concentric rings — bottom left */}
          <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full border border-white/[0.07]" />
          <div className="absolute -bottom-12 -left-12 h-56 w-56 rounded-full border border-white/[0.07]" />
          <div className="absolute -bottom-2  -left-2  h-36 w-36 rounded-full border border-white/[0.07]" />
          {/* Diagonal grid */}
          <svg
            className="absolute inset-0 h-full w-full opacity-[0.035]"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <pattern id="grid" x="0" y="0" width="44" height="44" patternUnits="userSpaceOnUse">
                <path d="M-11 11 L11 -11 M0 44 L44 0 M33 55 L55 33" stroke="white" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
          {/* Bottom gradient */}
          <div className="absolute bottom-0 left-0 right-0 h-56 bg-gradient-to-t from-black/10 to-transparent" />
        </div>

        {/* Panel content */}
        <div className="relative flex flex-1 flex-col justify-between p-12">

          {/* ── Logo */}
          <div className="flex items-center wflex gap-3">
            <div className="flex h-12 w-24 items-center justify-center rounded-xl ">
              <Image
                src="/logo/LogoPri-white.png"
                alt="Daily Store"
                width={200}
                height={200}
                className="object-contain"
              />
            </div>
            <span className="text-2xl text-primary-foreground/40">|</span>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-primary-foreground/40">
                Daily Store
              </p>
              <p className="text-sm font-semibold leading-tight text-primary-foreground/90">
                Application
              </p>
            </div>
          </div>

          {/* ── Hero copy + feature list */}
          <div className="space-y-8">
            <div>
              <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.25em] text-primary-foreground/35">
                Operations Platform
              </p>
              <h2 className="text-[2.6rem] font-extrabold leading-[1.08] tracking-tight text-primary-foreground">
                Run your store<br />
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

          {/* ── Footer rule */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary-foreground/25">
              Trusted by your team
            </p>
            <div className="h-px flex-1 bg-white/10" />
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════
          RIGHT PANEL — login form
      ══════════════════════════════════════ */}
      <div className="flex flex-1 flex-col items-center justify-center bg-secondary px-6 py-12 lg:px-14">

        {/* Mobile logo (hidden on desktop) */}
        <div className="mb-8 flex flex-col items-center gap-2.5 lg:hidden">
          <div className="flex h-12 w-28 items-center justify-center">
            <Image src="/logo/LogoPri.png" alt="loog pri" width={200} height={200} className="object-contain" />
          </div>
        </div>

        <div className="w-full max-w-90 flex flex-col h-full justify-center">

          {/* Heading */}
          <div className="mb-8">
            <span className="text-base uppercase tracking-tighter font-bold text-primary lg:hidden">Daily Store Application</span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Welcome back
            </h1>

            <p className="mt-1.5 text-sm text-muted-foreground">
              Sign in to your account to continue
            </p>
          </div>

          {/* ── Form */}
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Email field */}
            <div className="space-y-1.5">
              <Label
                htmlFor="email"
                className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground"
              >
                Email address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-xl border-border bg-background pl-10 text-sm shadow-sm placeholder:text-muted-foreground/35 focus-visible:ring-primary/25"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password field */}
            <div className="space-y-1.5">
              <Label
                htmlFor="password"
                className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground"
              >
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-xl border-border bg-background pl-10 pr-11 text-sm shadow-sm placeholder:text-muted-foreground/35 focus-visible:ring-primary/25"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((p) => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/45 transition-colors hover:text-muted-foreground"
                  tabIndex={-1}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Error alert */}
            {error && (
              <Alert variant="destructive" className="rounded-xl py-2.5">
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className={cn(
                'group relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl',
                'bg-primary text-sm font-semibold text-primary-foreground',
                'shadow-md shadow-primary/20 transition-all duration-200',
                'hover:brightness-105 hover:shadow-lg hover:shadow-primary/30',
                'active:scale-[0.98]',
                'disabled:pointer-events-none disabled:opacity-60',
              )}
            >
              {isLoading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          {/* Help card */}
          <div className="mt-7 rounded-xl border border-border bg-background/70 px-4 py-3.5">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Need access?</span>{' '}
              Contact your store manager or system administrator to receive your login credentials.
            </p>
          </div>
        </div>

        {/* Page footer */}
        <p className="mt-auto pt-10 text-[10px] text-muted-foreground/40">
          © {new Date().getFullYear()} Daily Store Application
        </p>
      </div>
    </div>
  );
}