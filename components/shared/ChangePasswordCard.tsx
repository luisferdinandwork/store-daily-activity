'use client';
// components/shared/ChangePasswordCard.tsx
//
// Self-service "change my password" card used by the Ops / Finance / Audit
// settings pages. Posts to the role-agnostic /api/account/change-password,
// which also resets the 90-day password-policy clock.

import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

function PasswordField({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={label.toLowerCase().includes('current') ? 'current-password' : 'new-password'}
          className="h-10 w-full rounded-lg border border-border bg-background px-3 pr-10 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-muted-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}

export default function ChangePasswordCard() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 6 &&
    newPassword === confirmPassword;

  async function handleSubmit() {
    if (!canSubmit) {
      if (newPassword.length > 0 && newPassword.length < 6) {
        toast.error('Kata sandi baru minimal 6 karakter.');
      } else if (newPassword !== confirmPassword) {
        toast.error('Kata sandi baru dan konfirmasi tidak sama.');
      }
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal mengganti kata sandi');

      toast.success('Kata sandi berhasil diperbarui');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengganti kata sandi');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <KeyRound className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">Ganti Kata Sandi</p>
          <p className="text-xs text-muted-foreground">Gunakan kata sandi yang sulit ditebak</p>
        </div>
      </div>

      <div className="space-y-3">
        <PasswordField label="Kata Sandi Saat Ini" value={currentPassword} onChange={setCurrentPassword} />
        <PasswordField label="Kata Sandi Baru" value={newPassword} onChange={setNewPassword} placeholder="Minimal 6 karakter" />
        <PasswordField label="Konfirmasi Kata Sandi Baru" value={confirmPassword} onChange={setConfirmPassword} />

        <button
          type="button"
          disabled={!canSubmit || saving}
          onClick={handleSubmit}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Perbarui Kata Sandi
        </button>
      </div>
    </div>
  );
}
