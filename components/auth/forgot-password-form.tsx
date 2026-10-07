'use client';
// components/auth/forgot-password-form.tsx
//
// "Lupa password" (step 1): NIK + store email → POST /api/password-reset/request.
// The API answers the same whether or not they matched (no NIK probing), so the
// success screen says what to expect instead of "we found you".

import { useState } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, ArrowRight, IdCard, Info, Mail, MailCheck } from 'lucide-react';

import { isValidEmail } from '@/lib/password-reset';
import {
  AUTH_SECONDARY_BUTTON,
  AuthInput,
  AuthLabel,
  AuthShell,
  AuthStatePanel,
  AuthSubmitButton,
} from './auth-ui';
import { ResetStepsAside, ResetStepsCompact } from './reset-steps';

export function ForgotPasswordForm() {
  const [nik, setNik] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanNik = nik.trim();
    const cleanEmail = email.trim();

    if (!cleanNik || !cleanEmail) {
      setError('NIK dan email toko wajib diisi.');
      return;
    }
    if (!isValidEmail(cleanEmail)) {
      setError('Format email toko tidak valid.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nik: cleanNik, email: cleanEmail }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error ?? 'Permintaan gagal dikirim. Coba lagi.');
        return;
      }
      setSent(true);
    } catch {
      setError('Tidak dapat terhubung ke server. Periksa koneksi Anda lalu coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      aside={
        <ResetStepsAside
          current={sent ? 2 : 1}
          title="Lupa password?"
          subtitle="Kami bantu buat password baru dengan aman — diverifikasi tim IT dan dikirim lewat email toko Anda."
        />
      }
      mobileTop={<ResetStepsCompact current={sent ? 2 : 1} />}
    >
      {sent ? (
        <AuthStatePanel
          icon={MailCheck}
          tone="success"
          title="Permintaan terkirim"
          actions={
            <Link href="/login" className={AUTH_SECONDARY_BUTTON}>
              <ArrowLeft className="h-4 w-4" />
              Kembali ke halaman masuk
            </Link>
          }
        >
          <p>
            Jika NIK dan email toko sesuai dengan data kami, notifikasi sudah dikirim ke{' '}
            <span className="font-semibold text-foreground">{email.trim().toLowerCase()}</span>.
          </p>
          <p>
            Tim IT akan memverifikasi permintaan Anda, lalu mengirim <strong className="text-foreground">link untuk
            membuat password baru</strong> ke email toko yang sama.
          </p>
          <div className="rounded-xl border border-border bg-background/70 px-4 py-3 text-left text-xs">
            <p className="font-semibold text-foreground">Tidak ada email masuk?</p>
            <p className="mt-0.5">
              Cek folder spam. Jika tetap tidak ada, pastikan NIK dan email toko sudah benar, atau hubungi tim IT.
            </p>
          </div>
        </AuthStatePanel>
      ) : (
        <>
          <div className="mb-7">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Lupa password</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Masukkan NIK dan email toko tempat Anda bekerja. Link untuk membuat password baru akan dikirim ke email
              toko setelah diverifikasi IT.
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
                onChange={(e) => setNik(e.target.value)}
                autoComplete="username"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={64}
                required
              />
            </div>

            <div className="space-y-1.5">
              <AuthLabel htmlFor="store-email">Email toko</AuthLabel>
              <AuthInput
                id="store-email"
                icon={Mail}
                type="email"
                inputMode="email"
                placeholder="contoh: daanmogot@fisikfootball.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={254}
                required
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                Email resmi toko Anda — bukan email pribadi.
              </p>
            </div>

            {error && (
              <Alert variant="destructive" className="rounded-xl py-2.5">
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            <AuthSubmitButton loading={loading} loadingText="Mengirim…">
              Kirim permintaan
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </AuthSubmitButton>
          </form>

          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-border bg-background/70 px-4 py-3.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Akun tanpa toko (Ops, Finance, Audit)? Hubungi tim IT langsung untuk reset password.
            </p>
          </div>

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
