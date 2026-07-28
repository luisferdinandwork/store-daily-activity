'use client';
// app/employee/settings/page.tsx
//
// Simple employee settings page — currently just password change. Reached
// from the floating "More" menu (the link previously 404'd).

import { useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { ChevronLeft, Eye, EyeOff, KeyRound, Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';

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
          className="h-11 w-full rounded-xl border border-border bg-card px-3.5 pr-10 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-muted-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}

export default function EmployeeSettingsPage() {
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
        toast.error('New password must be at least 6 characters.');
      } else if (newPassword !== confirmPassword) {
        toast.error('New password and confirmation do not match.');
      }
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/employee/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to change password');

      toast.success('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background pb-16">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/90 px-4 py-3.5 backdrop-blur">
        <Link
          href="/employee"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>

        <div>
          <p className="text-xs font-semibold text-muted-foreground">Account</p>
          <p className="text-sm font-bold leading-none text-foreground">Settings</p>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <KeyRound className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Change Password</p>
              <p className="text-xs text-muted-foreground">Use a password that's hard to guess</p>
            </div>
          </div>

          <div className="space-y-3">
            <PasswordField label="Current Password" value={currentPassword} onChange={setCurrentPassword} />
            <PasswordField label="New Password" value={newPassword} onChange={setNewPassword} placeholder="At least 6 characters" />
            <PasswordField label="Confirm New Password" value={confirmPassword} onChange={setConfirmPassword} />

            <button
              type="button"
              disabled={!canSubmit || saving}
              onClick={handleSubmit}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Update Password
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-200 text-sm font-semibold text-rose-500 transition-colors hover:bg-rose-50"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
