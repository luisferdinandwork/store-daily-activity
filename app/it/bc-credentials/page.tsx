'use client';
// app/it/bc-credentials/page.tsx
//
// Manage Business Central API credentials used by
// lib/performance/business-central-settings.ts /
// lib/performance/business-central-sales.ts.
//
// IT-only (enforced server-side in /api/ops/settings/bc-credentials via
// resolveItScope).

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  Plug,
  Plus,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';

// ─── Types ────────────────────────────────────────────────────────────────────

type BcSetting = {
  id: number;
  code: string;
  name: string;
  apiUrl: string;
  authType: 'basic' | 'bearer';
  username: string | null;
  hasPassword: boolean;
  maskedPassword: string | null;
  hasBearerToken: boolean;
  maskedBearerToken: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type FormState = {
  code: string;
  name: string;
  apiUrl: string;
  authType: 'basic' | 'bearer';
  username: string;
  password: string;
  bearerToken: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  code: 'sales_entries',
  name: 'Business Central Sales Entries',
  apiUrl: '',
  authType: 'basic',
  username: '',
  password: '',
  bearerToken: '',
  isActive: true,
};

// ─── SettingForm ──────────────────────────────────────────────────────────────

function SettingForm({ initial, mode, onSubmit, onCancel, submitting }: {
  initial: FormState;
  mode: 'create' | 'edit';
  onSubmit: (form: FormState) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">
          Nama Konfigurasi
          <input value={form.name} onChange={(e) => update('name', e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
        </label>

        <label className="text-xs font-semibold text-slate-600">
          Code
          <input value={form.code} onChange={(e) => update('code', e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
        </label>

        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
          API URL
          <input value={form.apiUrl} onChange={(e) => update('apiUrl', e.target.value)}
            placeholder="https://bc.example.com/.../ppQueryTransSalesEntries?$schemaversion=2.0"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
        </label>

        <label className="text-xs font-semibold text-slate-600">
          Auth Type
          <select value={form.authType} onChange={(e) => update('authType', e.target.value as 'basic' | 'bearer')}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
            <option value="basic">Basic Auth</option>
            <option value="bearer">Bearer Token</option>
          </select>
        </label>

        <label className="flex items-center gap-2 pt-5 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={form.isActive} onChange={(e) => update('isActive', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
          Jadikan konfigurasi aktif
        </label>

        {form.authType === 'basic' ? (
          <>
            <label className="text-xs font-semibold text-slate-600">
              Username
              <input value={form.username} onChange={(e) => update('username', e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Password
              <input type="password" value={form.password} onChange={(e) => update('password', e.target.value)}
                placeholder={mode === 'edit' ? 'Kosongkan jika tidak diubah' : ''}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            </label>
          </>
        ) : (
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
            Bearer Token
            <input type="password" value={form.bearerToken} onChange={(e) => update('bearerToken', e.target.value)}
              placeholder={mode === 'edit' ? 'Kosongkan jika tidak diubah' : ''}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
        )}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
          Batal
        </button>
        <button type="button" onClick={() => onSubmit(form)} disabled={submitting}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
          {submitting ? 'Menyimpan…' : mode === 'create' ? 'Tambah Konfigurasi' : 'Simpan Perubahan'}
        </button>
      </div>
    </div>
  );
}

// ─── SettingCard ──────────────────────────────────────────────────────────────

function SettingCard({ setting, onUpdated, onDeleted }: {
  setting: BcSetting;
  onUpdated: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formFromSetting = (): FormState => ({
    code: setting.code,
    name: setting.name,
    apiUrl: setting.apiUrl,
    authType: setting.authType,
    username: setting.username ?? '',
    password: '',
    bearerToken: '',
    isActive: setting.isActive,
  });

  const handleSave = async (form: FormState) => {
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        code: form.code,
        name: form.name,
        apiUrl: form.apiUrl,
        authType: form.authType,
        isActive: form.isActive,
      };
      if (form.authType === 'basic') {
        body.username = form.username;
        if (form.password) body.password = form.password;
      } else if (form.bearerToken) {
        body.bearerToken = form.bearerToken;
      }

      const res = await fetch(`/api/ops/settings/bc-credentials/${setting.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menyimpan konfigurasi.');
      setEditing(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan konfigurasi.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Hapus konfigurasi "${setting.name}"?`)) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/ops/settings/bc-credentials/${setting.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menghapus konfigurasi.');
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus konfigurasi.');
      setSubmitting(false);
    }
  };

  const handleActivate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/settings/bc-credentials/${setting.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal mengaktifkan konfigurasi.');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengaktifkan konfigurasi.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/ops/settings/bc-credentials/${setting.id}/test`, { method: 'POST' });
      const json = await res.json();
      setTestResult({ success: !!json.success, message: json.message ?? json.error ?? 'Tidak diketahui.' });
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Koneksi gagal.' });
    } finally {
      setTesting(false);
    }
  };

  if (editing) {
    return (
      <SettingForm
        initial={formFromSetting()}
        mode="edit"
        onSubmit={handleSave}
        onCancel={() => setEditing(false)}
        submitting={submitting}
      />
    );
  }

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            setting.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400',
          )}>
            {setting.isActive ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-slate-900">{setting.name}</p>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{setting.code}</span>
              {setting.isActive && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">Aktif</span>
              )}
            </div>
            <p className="mt-0.5 break-all text-[11px] text-slate-400">{setting.apiUrl}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span className="font-semibold uppercase tracking-wide text-slate-400">{setting.authType}</span>
              {setting.authType === 'basic' ? (
                <>
                  <span>User: <span className="font-semibold text-slate-700">{setting.username ?? '—'}</span></span>
                  <span>Pass: <span className="font-mono font-semibold text-slate-700">{setting.maskedPassword ?? '—'}</span></span>
                </>
              ) : (
                <span>Token: <span className="font-mono font-semibold text-slate-700">{setting.maskedBearerToken ?? '—'}</span></span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!setting.isActive && (
            <button type="button" onClick={handleActivate} disabled={submitting}
              className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-600 hover:bg-emerald-100 disabled:opacity-60">
              Aktifkan
            </button>
          )}
          <button type="button" onClick={handleTest} disabled={testing}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
            Test
          </button>
          <button type="button" onClick={() => setEditing(true)}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
            <Pencil className="h-3 w-3" /> Edit
          </button>
          <button type="button" onClick={handleDelete} disabled={submitting}
            className="flex items-center gap-1 rounded-lg border border-red-100 bg-white px-2.5 py-1 text-[11px] font-bold text-red-500 hover:bg-red-50 disabled:opacity-60">
            <Trash2 className="h-3 w-3" /> Hapus
          </button>
        </div>
      </div>

      {testResult && (
        <div className={cn(
          'mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-semibold',
          testResult.success ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-600',
        )}>
          {testResult.success ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{testResult.message}</span>
        </div>
      )}

      {error && <p className="mt-2 text-xs font-semibold text-red-500">{error}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BcCredentialsPage() {
  const [settings, setSettings] = useState<BcSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ops/settings/bc-credentials', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memuat konfigurasi.');
      setSettings(json.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat konfigurasi.');
      setSettings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (form: FormState) => {
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        code: form.code,
        name: form.name,
        apiUrl: form.apiUrl,
        authType: form.authType,
        isActive: form.isActive,
      };
      if (form.authType === 'basic') {
        body.username = form.username;
        body.password = form.password;
      } else {
        body.bearerToken = form.bearerToken;
      }

      const res = await fetch('/api/ops/settings/bc-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menambah konfigurasi.');
      setShowAddForm(false);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah konfigurasi.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="IT · Settings"
        title="BC Credentials"
        subtitle="Konfigurasi koneksi API Business Central untuk data penjualan"
        onRefresh={load}
        refreshing={loading}
      />

      <div className="mx-auto max-w-3xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-bold">Gagal memuat data</p>
              <p className="mt-0.5 text-xs">{error}</p>
            </div>
          </div>
        )}

        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <KeyRound className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Business Central API</h2>
                <p className="text-xs text-slate-500">
                  Digunakan oleh lib/performance/business-central-sales.ts. Hanya satu konfigurasi per code yang aktif.
                </p>
              </div>
            </div>
            {!showAddForm && (
              <button type="button" onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">
                <Plus className="h-3.5 w-3.5" /> Tambah
              </button>
            )}
          </div>

          <div className="space-y-3 p-4 sm:p-5">
            {showAddForm && (
              <SettingForm
                initial={EMPTY_FORM}
                mode="create"
                onSubmit={handleCreate}
                onCancel={() => setShowAddForm(false)}
                submitting={creating}
              />
            )}

            {loading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
              ))
            ) : settings.length === 0 && !showAddForm ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
                <p className="text-sm font-semibold text-slate-700">Belum ada konfigurasi BC</p>
                <p className="mt-1 text-xs text-slate-400">
                  Tanpa konfigurasi, sistem akan menggunakan environment variable (BC_SALES_ENTRIES_URL, dst).
                </p>
              </div>
            ) : (
              settings.map((setting) => (
                <SettingCard key={setting.id} setting={setting} onUpdated={load} onDeleted={load} />
              ))
            )}
          </div>
        </article>
      </div>
    </div>
  );
}