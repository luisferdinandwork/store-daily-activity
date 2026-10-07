'use client';
// components/auth/reset-password-form.tsx
//
// The emailed link, /reset-password/<token> (step 3). Checks the link first
// (POST /api/password-reset/link), then asks for NIK + new password + confirm
// (POST /api/password-reset/complete). The link only works for the NIK that
// requested it — any other NIK gets "Link ini bukan untuk NIK Anda." and uses up
// one of RESET_MAX_NIK_ATTEMPTS tries.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  IdCard,
  KeyRound,
  Link2Off,
  Loader2,
  Lock,
  LockKeyhole,
  ShieldAlert,
  TimerOff,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password';
import {
  resetPasswordChecks,
  resetPasswordError,
  type ResetLinkCheck,
  type ResetLinkProblem,
} from '@/lib/password-reset';
import { cn } from '@/lib/utils';
import {
  AUTH_PRIMARY_LINK,
  AUTH_SECONDARY_BUTTON,
  AuthInput,
  AuthLabel,
  AuthShell,
  AuthStatePanel,
  AuthSubmitButton,
  PasswordInput,
} from './auth-ui';
import { ResetStepsAside, ResetStepsCompact } from './reset-steps';

type View = { kind: 'checking' } | { kind: 'form'; expiresAt: string } | { kind: 'problem'; problem: ResetLinkProblem } | { kind: 'done' };

function formatWib(iso: string): string {
  return `${new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })} WIB`;
}

// ─── Password strength (guidance only — the policy is resetPasswordChecks) ───

function strength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: '' };
  if (password.length < PASSWORD_MIN_LENGTH) return { score: 1, label: 'Terlalu pendek' };
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const long = password.length >= 12;
  const score = (1 + (variety >= 2 ? 1 : 0) + (variety >= 3 || long ? 1 : 0) + (variety >= 3 && long ? 1 : 0)) as 1 | 2 | 3 | 4;
  return { score, label: ['', 'Lemah', 'Cukup', 'Kuat', 'Sangat kuat'][score] };
}

const STRENGTH_COLOR = ['bg-border', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-600'];
const STRENGTH_TEXT = ['', 'text-rose-600', 'text-amber-600', 'text-emerald-600', 'text-emerald-700'];

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={cn('flex items-center gap-2 text-xs transition-colors', ok ? 'text-emerald-700' : 'text-muted-foreground')}>
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors',
          ok ? 'bg-emerald-500 text-white' : 'bg-background ring-1 ring-border',
        )}
      >
        {ok && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </span>
      {children}
    </li>
  );
}

// ─── Problem screens ─────────────────────────────────────────────────────────

const PROBLEM_COPY: Record<
  ResetLinkProblem,
  { icon: React.ElementType; tone: 'warning' | 'danger' | 'info'; title: string; body: string; retry: boolean }
> = {
  invalid: {
    icon: Link2Off,
    tone: 'danger',
    title: 'Link tidak valid',
    body: 'Link ini tidak dikenal atau sudah dibatalkan oleh IT. Pastikan Anda membuka link terbaru dari email toko, atau ajukan permintaan baru.',
    retry: true,
  },
  expired: {
    icon: TimerOff,
    tone: 'warning',
    title: 'Link sudah kedaluwarsa',
    body: 'Demi keamanan, link reset password hanya berlaku terbatas. Ajukan permintaan baru dari halaman masuk.',
    retry: true,
  },
  used: {
    icon: CheckCircle2,
    tone: 'info',
    title: 'Link sudah digunakan',
    body: 'Password untuk link ini sudah diganti. Silakan masuk dengan password baru Anda.',
    retry: false,
  },
  locked: {
    icon: Lock,
    tone: 'danger',
    title: 'Link dinonaktifkan',
    body: 'Terlalu banyak percobaan dengan NIK yang salah, jadi link ini dikunci. Minta tim IT mengirim link baru, atau ajukan permintaan baru.',
    retry: true,
  },
};

function ProblemPanel({ problem }: { problem: ResetLinkProblem }) {
  const c = PROBLEM_COPY[problem];
  return (
    <AuthStatePanel
      icon={c.icon}
      tone={c.tone}
      title={c.title}
      actions={
        c.retry ? (
          <>
            <Link href="/forgot-password" className={AUTH_PRIMARY_LINK}>
              Ajukan reset password baru
            </Link>
            <Link href="/login" className={AUTH_SECONDARY_BUTTON}>
              <ArrowLeft className="h-4 w-4" />
              Kembali ke halaman masuk
            </Link>
          </>
        ) : (
          <Link href="/login" className={AUTH_PRIMARY_LINK}>
            Masuk
          </Link>
        )
      }
    >
      <p>{c.body}</p>
    </AuthStatePanel>
  );
}

// ─── Form ────────────────────────────────────────────────────────────────────

export function ResetPasswordForm({ token }: { token: string }) {
  const [view, setView] = useState<View>({ kind: 'checking' });

  const [nik, setNik] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** Set when the server said this link belongs to another NIK. */
  const [nikMismatch, setNikMismatch] = useState<{ attemptsLeft: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/password-reset/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const json = (await res.json().catch(() => null)) as ResetLinkCheck | { success: false; error?: string } | null;
        if (cancelled) return;
        if (!json || !json.success) {
          setView({ kind: 'problem', problem: 'invalid' });
          return;
        }
        setView(json.state === 'valid' ? { kind: 'form', expiresAt: json.expiresAt } : { kind: 'problem', problem: json.state });
      } catch {
        if (!cancelled) setView({ kind: 'problem', problem: 'invalid' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const checks = resetPasswordChecks(password, confirm, nik);
  const meter = strength(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError('');

    if (!nik.trim()) {
      setError('NIK wajib diisi.');
      return;
    }
    const pwError = resetPasswordError(password, confirm, nik);
    if (pwError) {
      setError(pwError);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/password-reset/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, nik: nik.trim(), password, confirmPassword: confirm }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        setView({ kind: 'done' });
        return;
      }

      switch (json.code) {
        case 'NIK_MISMATCH':
          setNikMismatch({ attemptsLeft: Number(json.attemptsLeft) || 0 });
          break;
        case 'invalid':
        case 'expired':
        case 'used':
        case 'locked':
          setView({ kind: 'problem', problem: json.code });
          break;
        default:
          setError(json.error ?? 'Password gagal disimpan. Coba lagi.');
      }
    } catch {
      setError('Tidak dapat terhubung ke server. Periksa koneksi Anda lalu coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  // Past the last step once the password is saved.
  const step = view.kind === 'done' ? 4 : 3;

  return (
    <AuthShell
      aside={
        <ResetStepsAside
          current={step}
          title={view.kind === 'done' ? 'Selesai!' : 'Buat password baru.'}
          subtitle="Link ini dikirim ke email toko dan hanya bisa dipakai oleh NIK yang mengajukan permintaan."
        />
      }
      mobileTop={<ResetStepsCompact current={step} />}
    >
      {view.kind === 'checking' && (
        <div className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          Memeriksa link…
        </div>
      )}

      {view.kind === 'problem' && <ProblemPanel problem={view.problem} />}

      {view.kind === 'done' && (
        <AuthStatePanel
          icon={CheckCircle2}
          tone="success"
          title="Password berhasil diubah"
          actions={
            <Link href="/login?reset=success" className={AUTH_PRIMARY_LINK}>
              Masuk sekarang
            </Link>
          }
        >
          <p>Password baru Anda sudah aktif. Gunakan NIK dan password baru untuk masuk.</p>
          <p className="text-xs">Konfirmasi juga dikirim ke email toko, dan tim IT sudah menerima notifikasinya.</p>
        </AuthStatePanel>
      )}

      {view.kind === 'form' && (
        <>
          <div className="mb-6">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Buat password baru</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Isi NIK Anda untuk memastikan link ini memang untuk Anda, lalu buat password baru.
            </p>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
              <Clock className="h-3 w-3" />
              Berlaku sampai {formatWib(view.expiresAt)}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <AuthLabel htmlFor="nik">NIK</AuthLabel>
              <AuthInput
                id="nik"
                icon={IdCard}
                type="text"
                placeholder="Masukkan NIK Anda"
                value={nik}
                onChange={(e) => {
                  setNik(e.target.value);
                  if (nikMismatch) setNikMismatch(null);
                }}
                invalid={!!nikMismatch}
                autoComplete="username"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={64}
                required
              />
            </div>

            {nikMismatch && (
              <div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-rose-700">Link ini bukan untuk NIK Anda.</p>
                  <p className="text-xs leading-relaxed text-rose-700/80">
                    Link reset password hanya bisa dipakai oleh NIK yang mengajukan permintaan. Jika Anda juga lupa
                    password, ajukan permintaan sendiri dari halaman masuk.
                  </p>
                  <p className="text-[11px] font-semibold text-rose-700">
                    Sisa percobaan: {nikMismatch.attemptsLeft}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <AuthLabel htmlFor="new-password">Password baru</AuthLabel>
              <PasswordInput
                id="new-password"
                icon={KeyRound}
                placeholder={`Minimal ${PASSWORD_MIN_LENGTH} karakter`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                invalid={touched && (!checks.minLength || !checks.notTooLong || !checks.notNik)}
                required
              />
              {password && (
                <div className="flex items-center gap-2 pt-1" aria-live="polite">
                  <div className="flex flex-1 gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-1 flex-1 rounded-full transition-colors',
                          i <= meter.score ? STRENGTH_COLOR[meter.score] : 'bg-border',
                        )}
                      />
                    ))}
                  </div>
                  <span className={cn('w-20 text-right text-[11px] font-semibold', STRENGTH_TEXT[meter.score])}>
                    {meter.label}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <AuthLabel htmlFor="confirm-password">Konfirmasi password</AuthLabel>
              <PasswordInput
                id="confirm-password"
                icon={Lock}
                placeholder="Ulangi password baru"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                invalid={(touched || confirm.length > 0) && confirm.length > 0 && !checks.matches}
                required
              />
            </div>

            <ul className="space-y-1.5 rounded-xl border border-border bg-background/70 px-4 py-3">
              <Rule ok={checks.minLength && checks.notTooLong}>Minimal {PASSWORD_MIN_LENGTH} karakter</Rule>
              <Rule ok={!!password && !!nik.trim() && checks.notNik}>Tidak sama dengan NIK</Rule>
              <Rule ok={checks.matches}>Konfirmasi password cocok</Rule>
            </ul>

            {error && (
              <Alert variant="destructive" className="rounded-xl py-2.5">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            <AuthSubmitButton loading={loading} loadingText="Menyimpan…">
              Simpan password baru
            </AuthSubmitButton>
          </form>

          <Link
            href="/login"
            className="mt-6 inline-flex items-center justify-center gap-1.5 self-center text-sm font-semibold text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Kembali ke halaman masuk
          </Link>
        </>
      )}
    </AuthShell>
  );
}
