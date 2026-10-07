// app/reset-password/[token]/page.tsx — the emailed one-time link (public; see
// lib/db/utils/password-reset.ts). No referrer, so the token never leaves in a header.
import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = {
  title: 'Buat password baru — PRISM',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ResetPasswordForm token={token} />;
}
