'use client';
// components/employee/CashCountCard.tsx
//
// Daily cashier cash-count + buddy selfie — a step on the Attendance page.
// One shared record per store per day. A morning / full_day employee counts
// the total cash in the drawer, picks a co-scheduled colleague as a witness,
// and the two take a selfie together. Required before check-out.

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Camera, Check, Loader2, Wallet, RotateCcw } from 'lucide-react';
import { formatRupiah } from '@/lib/utils';
import { toast } from 'sonner';
import CameraCapture from '@/components/shared/CameraCapture';

export interface CoScheduledEmployee {
  userId: string;
  name: string;
  shiftLabel: string | null;
}

export interface CashCountPayload {
  required: boolean;
  done: boolean;
  record: {
    totalAmount: number;
    countedByName: string | null;
    witnessName: string | null;
    selfiePhoto: string;
    completedAt: string | null;
  } | null;
  coScheduledEmployees: CoScheduledEmployee[];
}

function AmountInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const numeric = parseFloat(value);
  const display =
    !focused && value !== '' && !isNaN(numeric) ? formatRupiah(numeric, false) : value;

  return (
    <div className="flex items-center overflow-hidden rounded-xl border border-border bg-background focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
      <span className="pl-3 pr-1 text-sm font-semibold text-muted-foreground">Rp</span>
      <input
        type="text"
        inputMode="numeric"
        placeholder="0"
        value={display}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        disabled={disabled}
        className="w-full bg-transparent py-2.5 pr-3 text-sm font-bold tabular-nums text-foreground outline-none"
      />
    </div>
  );
}

export default function CashCountCard({
  cashCount,
  onDone,
}: {
  cashCount: CashCountPayload;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [witnessId, setWitnessId] = useState('');
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Already done for today ────────────────────────────────────────────────
  if (cashCount.done && cashCount.record) {
    const r = cashCount.record;
    return (
      <Card className="gap-0 overflow-hidden py-0 shadow-sm">
        <div className="h-1 bg-emerald-500" />
        <CardContent className="flex items-center gap-3 p-3.5">
          {r.selfiePhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.selfiePhoto}
              alt="Foto hitung kas kasir"
              className="h-12 w-12 flex-shrink-0 rounded-xl object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold tabular-nums text-foreground">
              {formatRupiah(r.totalAmount)}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {r.countedByName ?? '—'} &amp; {r.witnessName ?? '—'}
            </p>
          </div>
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50">
            <Check className="h-4 w-4 text-emerald-600" strokeWidth={3} />
          </span>
        </CardContent>
      </Card>
    );
  }

  if (!cashCount.required) return null;

  const amountNum = parseFloat(amount);
  const amountValid = amount !== '' && !isNaN(amountNum) && amountNum > 0;
  const canSubmit = amountValid && witnessId !== '' && !!selfieUrl && !submitting;

  async function handleCapture(file: File) {
    setCameraOpen(false);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('photoType', 'cashier_cash_selfie');
      const res = await fetch('/api/employee/tasks/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || 'Upload gagal');
      setSelfieUrl(json.url as string);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengunggah foto');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cashcount',
          totalAmount: Math.round(amountNum),
          witnessUserId: witnessId,
          selfiePhoto: selfieUrl,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Gagal menyimpan');
      toast.success('Hitung kas kasir tersimpan.');
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan');
      setSubmitting(false);
    }
  }

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-sm">
      <div className="h-1 bg-sky-500" />
      <CardContent className="space-y-3.5 p-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-sky-50">
            <Wallet className="h-4 w-4 text-sky-600" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">Hitung Kas Kasir</p>
            <p className="text-[11px] text-muted-foreground">
              Hitung total uang di kasir, pilih rekan, lalu foto bersama.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Total uang di kasir
          </label>
          <AmountInput value={amount} onChange={setAmount} disabled={submitting} />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Rekan untuk foto bersama
          </label>
          {cashCount.coScheduledEmployees.length === 0 ? (
            <p className="rounded-xl border border-border bg-secondary px-3 py-2.5 text-[11px] text-muted-foreground">
              Tidak ada rekan lain yang terjadwal hari ini.
            </p>
          ) : (
            <select
              value={witnessId}
              onChange={(e) => setWitnessId(e.target.value)}
              disabled={submitting}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
            >
              <option value="">Pilih rekan…</option>
              {cashCount.coScheduledEmployees.map((e) => (
                <option key={e.userId} value={e.userId}>
                  {e.name}
                  {e.shiftLabel ? ` · ${e.shiftLabel}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Foto bersama
          </label>
          {selfieUrl ? (
            <div className="flex items-center gap-3 rounded-xl border border-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selfieUrl}
                alt="Foto bersama"
                className="h-14 w-14 flex-shrink-0 rounded-lg object-cover"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setCameraOpen(true)}
                disabled={submitting || uploading}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Ambil ulang
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full gap-2"
              onClick={() => setCameraOpen(true)}
              disabled={submitting || uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
              {uploading ? 'Mengunggah…' : 'Ambil Foto Bersama'}
            </Button>
          )}
        </div>

        <Button
          className="h-11 w-full gap-2 font-bold"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {submitting ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </CardContent>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCapture}
        facingMode="user"
        title="Foto bersama rekan"
      />
    </Card>
  );
}
