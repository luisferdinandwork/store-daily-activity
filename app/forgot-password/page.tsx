// app/forgot-password/page.tsx — public "Lupa password" request (lib/auth/access.ts → isPublicPath).
import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata: Metadata = {
  title: 'Lupa password — PRISM',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
