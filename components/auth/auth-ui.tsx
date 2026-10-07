'use client';
// components/auth/auth-ui.tsx
//
// The signed-out screens' shared look: login, "Lupa password" and the emailed
// reset link. Desktop = brand panel left (its middle content is `aside`) + form
// right; mobile = logo on top and the form, scrolling freely (keyboards and
// small phones never clip a field).

import { forwardRef, useState, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

// ─── Shell ────────────────────────────────────────────────────────────────────

export function AuthShell({
  aside,
  children,
  mobileTop,
}: {
  /** Middle of the desktop brand panel. */
  aside: ReactNode;
  children: ReactNode;
  /** Shown under the logo on phones only (e.g. a compact step indicator). */
  mobileTop?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full lg:h-dvh lg:overflow-hidden">
      {/* LEFT PANEL — desktop */}
      <div className="relative hidden w-[52%] flex-col overflow-hidden bg-primary lg:flex">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -right-40 -top-40 h-[560px] w-[560px] rounded-full bg-white/5 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full border border-white/[0.07]" />
          <div className="absolute -bottom-12 -left-12 h-56 w-56 rounded-full border border-white/[0.07]" />
          <div className="absolute -bottom-2 -left-2 h-36 w-36 rounded-full border border-white/[0.07]" />

          <svg className="absolute inset-0 h-full w-full opacity-[0.035]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="auth-grid" x="0" y="0" width="44" height="44" patternUnits="userSpaceOnUse">
                <path d="M-11 11 L11 -11 M0 44 L44 0 M33 55 L55 33" stroke="white" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#auth-grid)" />
          </svg>

          <div className="absolute bottom-0 left-0 right-0 h-56 bg-gradient-to-t from-black/10 to-transparent" />
        </div>

        <div className="relative flex flex-1 flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-24 items-center justify-center rounded-xl">
              <Image
                src="/logo/LogoPRI-white.png"
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
              <p className="text-sm font-semibold leading-tight text-primary-foreground/90">Application</p>
            </div>
          </div>

          {aside}

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary-foreground/25">
              Trusted by your team
            </p>
            <div className="h-px flex-1 bg-white/10" />
          </div>
        </div>
      </div>

      {/* RIGHT PANEL — the form */}
      <div className="flex flex-1 flex-col items-center bg-secondary px-5 pb-6 pt-10 sm:px-6 lg:overflow-y-auto lg:px-14 lg:pt-12">
        <div className="mb-6 flex flex-col items-center gap-4 lg:hidden">
          <div className="flex h-12 w-28 items-center justify-center">
            <Image src="/logo/LogoPRI.png" alt="Daily Store" width={200} height={200} className="object-contain" />
          </div>
          {mobileTop}
        </div>

        <div className="flex w-full max-w-90 flex-1 flex-col justify-center">{children}</div>

        <p className="mt-auto pt-10 text-[10px] text-muted-foreground/40">
          © {new Date().getFullYear()} Daily Store Application
        </p>
      </div>
    </div>
  );
}

// ─── Form pieces ──────────────────────────────────────────────────────────────

export function AuthLabel({ htmlFor, children, className }: { htmlFor: string; children: ReactNode; className?: string }) {
  return (
    <Label
      htmlFor={htmlFor}
      className={cn('text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground', className)}
    >
      {children}
    </Label>
  );
}

const INPUT_CLS =
  'h-12 rounded-xl border-border bg-background pl-10 text-base shadow-sm placeholder:text-muted-foreground/35 focus-visible:ring-primary/25 sm:h-11 sm:text-sm';

type AuthInputProps = ComponentPropsWithoutRef<typeof Input> & {
  icon: ElementType;
  /** Button/adornment pinned to the right edge (password eye). */
  trailing?: ReactNode;
  invalid?: boolean;
};

/** Icon-led input, 48px tall on phones (16px text so iOS doesn't zoom), 44px from `sm`. */
export const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(function AuthInput(
  { icon: Icon, trailing, invalid, className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
      <Input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          INPUT_CLS,
          trailing && 'pr-11',
          invalid && 'border-destructive/60 focus-visible:ring-destructive/20',
          className,
        )}
        {...props}
      />
      {trailing && <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</div>}
    </div>
  );
});

/** AuthInput with a show/hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<AuthInputProps, 'type' | 'trailing'>>(
  function PasswordInput(props, ref) {
    const [show, setShow] = useState(false);
    return (
      <AuthInput
        ref={ref}
        type={show ? 'text' : 'password'}
        trailing={
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-secondary hover:text-muted-foreground"
            aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
        {...props}
      />
    );
  },
);

export function AuthSubmitButton({
  loading,
  loadingText,
  children,
  disabled,
}: {
  loading: boolean;
  loadingText: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className={cn(
        'group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl sm:h-11',
        'bg-primary text-sm font-semibold text-primary-foreground',
        'shadow-md shadow-primary/20 transition-all duration-200',
        'hover:brightness-105 hover:shadow-lg hover:shadow-primary/30',
        'active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-60',
      )}
    >
      {loading ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
          {loadingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Big centred icon + title + text — the success / problem states. */
export function AuthStatePanel({
  icon: Icon,
  tone,
  title,
  children,
  actions,
}: {
  icon: ElementType;
  tone: 'success' | 'warning' | 'danger' | 'info';
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const toneCls = {
    success: 'bg-emerald-100 text-emerald-600 ring-emerald-50',
    warning: 'bg-amber-100 text-amber-600 ring-amber-50',
    danger: 'bg-rose-100 text-rose-600 ring-rose-50',
    info: 'bg-primary/10 text-primary ring-primary/5',
  }[tone];

  return (
    <div className="flex flex-col items-center text-center">
      <div className={cn('mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ring-8', toneCls)}>
        <Icon className="h-7 w-7" />
      </div>
      <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
      {actions && <div className="mt-7 flex w-full flex-col gap-2.5">{actions}</div>}
    </div>
  );
}

export const AUTH_SECONDARY_BUTTON =
  'flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-background/70 sm:h-11';

export const AUTH_PRIMARY_LINK =
  'flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:brightness-105 active:scale-[0.98] sm:h-11';
