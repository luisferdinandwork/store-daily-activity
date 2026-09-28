'use client';
// components/employee/CashCountCard.tsx
//
// Cashier cash-count + buddy selfie — a step on the Attendance page. One
// shared record per store per day per SOP session (Pagi, Siang 1, Siang 2,
// Sore, Malam — lib/cash-count-sessions.ts). The card shows the day as a
// timeline of the five sessions; tapping one opens a bottom sheet where the
// employee enters the total cash in the drawer, picks a co-scheduled colleague
// as a witness, and the two take a selfie together. All five sessions are
// mandatory — checkout is blocked until the ones due by that shift's end are
// on record (requiredCashCountSessionsForShift).

import { useState } from 'react';
import { Camera, Check, CheckCircle2, ChevronRight, Loader2, RotateCcw, Users, Wallet } from 'lucide-react';
import { cn, formatRupiah } from '@/lib/utils';
import { toast } from 'sonner';
import CameraCapture from '@/components/shared/CameraCapture';
import { ActionButton, AmountField, BottomSheet, Card, Chip, FieldHint, FieldLabel } from '@/components/employee/ui';
import {
  CASH_COUNT_SESSION_INFO,
  type CashCountSession,
} from '@/lib/cash-count-sessions';

export interface CoScheduledEmployee {
  userId: string;
  name: string;
  shiftLabel: string | null;
}

export interface CashCountRecord {
  totalAmount: number;
  countedByName: string | null;
  witnessName: string | null;
  selfiePhoto: string;
  completedAt: string | null;
}

export interface CashCountPayload {
  /** The viewer works at this store today, so they may record a session. */
  canSubmit: boolean;
  sessions: { session: CashCountSession; record: CashCountRecord | null }[];
  coScheduledEmployees: CoScheduledEmployee[];
}

// Step colours follow the SOP poster: 1 green, 2 blue, 3 orange, 4 purple, 5 red.
const SESSION_TONE: Record<CashCountSession, { solid: string; soft: string; text: string; ring: string }> = {
  pagi:    { solid: 'bg-emerald-600', soft: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  siang_1: { solid: 'bg-sky-600',     soft: 'bg-sky-50',     text: 'text-sky-700',     ring: 'ring-sky-200' },
  siang_2: { solid: 'bg-orange-500',  soft: 'bg-orange-50',  text: 'text-orange-700',  ring: 'ring-orange-200' },
  sore:    { solid: 'bg-violet-600',  soft: 'bg-violet-50',  text: 'text-violet-700',  ring: 'ring-violet-200' },
  malam:   { solid: 'bg-rose-600',    soft: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-200' },
};

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

// ─── Timeline ────────────────────────────────────────────────────────────────

function ProgressSegments({ sessions }: { sessions: CashCountPayload['sessions'] }) {
  return (
    <div className="flex gap-1" aria-hidden="true">
      {sessions.map(({ session, record }) => (
        <div
          key={session}
          className={cn('h-1.5 flex-1 rounded-full', record ? SESSION_TONE[session].solid : 'bg-secondary')}
        />
      ))}
    </div>
  );
}

function TimelineNode({ session, done, active }: { session: CashCountSession; done: boolean; active: boolean }) {
  const tone = SESSION_TONE[session];
  return (
    <span
      className={cn(
        'relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold',
        done && cn(tone.solid, 'text-white'),
        !done && active && cn(tone.solid, 'text-white ring-4', tone.ring),
        !done && !active && 'border-2 border-dashed border-border bg-card text-muted-foreground',
      )}
    >
      {done ? <Check className="h-4 w-4" strokeWidth={3} /> : CASH_COUNT_SESSION_INFO[session].step}
    </span>
  );
}

function SessionTimeline({
  cashCount,
  onSelect,
  onPreview,
}: {
  cashCount: CashCountPayload;
  onSelect: (session: CashCountSession) => void;
  onPreview: (url: string) => void;
}) {
  const next = cashCount.sessions.find((s) => !s.record)?.session;
  const last = cashCount.sessions.length - 1;

  return (
    <ol className="relative">
      {cashCount.sessions.map(({ session, record }, i) => {
        const info = CASH_COUNT_SESSION_INFO[session];
        const tone = SESSION_TONE[session];
        const isNext = session === next;
        const tappable = !record && cashCount.canSubmit;

        const content = (
          <>
            <div className="flex flex-col items-center self-stretch">
              <TimelineNode session={session} done={!!record} active={isNext && cashCount.canSubmit} />
              {i < last && (
                <span
                  className={cn('-mb-3 mt-1 w-0.5 flex-1 rounded-full', record ? tone.solid : 'bg-border')}
                  aria-hidden="true"
                />
              )}
            </div>

            <div className={cn('min-w-0 flex-1', i < last ? 'pb-4' : 'pb-0.5')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={cn('text-sm font-semibold', record || isNext ? 'text-foreground' : 'text-muted-foreground')}>
                    {info.label}
                    <span className="font-normal text-muted-foreground"> · {info.moment}</span>
                  </p>

                  {record && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {record.countedByName ?? '—'} &amp; {record.witnessName ?? '—'}
                      {record.completedAt ? ` · ${fmtTime(record.completedAt)}` : ''}
                    </p>
                  )}
                </div>

                {record ? (
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className="text-sm font-bold tabular-nums text-foreground">
                      {formatRupiah(record.totalAmount)}
                    </span>
                    {record.selfiePhoto && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); onPreview(record.selfiePhoto); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') onPreview(record.selfiePhoto); }}
                        className="block h-8 w-8 overflow-hidden rounded-lg border border-border"
                        aria-label="Lihat foto bersama"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={record.selfiePhoto} alt="" className="h-full w-full object-cover" />
                      </span>
                    )}
                  </div>
                ) : tappable ? (
                  <ChevronRight className="mt-1.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                ) : (
                  <span className="mt-0.5 flex-shrink-0 text-[11px] text-muted-foreground">Belum</span>
                )}
              </div>

              {isNext && tappable && (
                <span
                  className={cn(
                    'mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white',
                    tone.solid,
                  )}
                >
                  <Wallet className="h-3.5 w-3.5" />
                  Hitung sekarang
                </span>
              )}
            </div>
          </>
        );

        return (
          <li key={session}>
            {tappable ? (
              <button
                type="button"
                onClick={() => onSelect(session)}
                className={cn(
                  '-mx-2 flex w-[calc(100%+1rem)] gap-3 rounded-xl px-2 pt-2 text-left transition-colors active:bg-secondary',
                  isNext && tone.soft,
                )}
              >
                {content}
              </button>
            ) : (
              <div className="flex gap-3 pt-2">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Count form (bottom sheet) ───────────────────────────────────────────────

function WitnessPicker({
  employees,
  value,
  onChange,
  disabled,
}: {
  employees: CoScheduledEmployee[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  if (employees.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-border px-3.5 py-3">
        <Users className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Tidak ada rekan lain yang terjadwal hari ini.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {employees.map((e) => {
        const active = value === e.userId;
        return (
          <button
            key={e.userId}
            type="button"
            disabled={disabled}
            onClick={() => onChange(e.userId)}
            aria-pressed={active}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
              active ? 'border-primary bg-primary/5' : 'border-border bg-card active:bg-secondary',
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold',
                active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground',
              )}
            >
              {initials(e.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{e.name}</span>
              {e.shiftLabel && <span className="block text-[11px] text-muted-foreground">{e.shiftLabel}</span>}
            </span>
            <span
              className={cn(
                'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2',
                active ? 'border-primary bg-primary' : 'border-border',
              )}
            >
              {active && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export default function CashCountCard({
  cashCount,
  onDone,
}: {
  cashCount: CashCountPayload;
  onDone: () => void;
}) {
  const [session, setSession] = useState<CashCountSession | null>(null);
  const [amount, setAmount] = useState('');
  const [witnessId, setWitnessId] = useState('');
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const doneCount = cashCount.sessions.filter((s) => s.record).length;
  const total = cashCount.sessions.length;
  const allDone = doneCount === total;

  // A session someone else just counted (after a reload) can't stay selected.
  const selected =
    session && cashCount.sessions.some((s) => s.session === session && !s.record) ? session : null;
  const info = selected ? CASH_COUNT_SESSION_INFO[selected] : null;
  const tone = selected ? SESSION_TONE[selected] : null;

  const amountNum = parseFloat(amount);
  const amountValid = amount !== '' && !isNaN(amountNum) && amountNum > 0;
  const canSubmit = !!selected && amountValid && witnessId !== '' && !!selfieUrl && !submitting && !uploading;

  const missing = [
    !amountValid && 'total uang',
    witnessId === '' && 'rekan',
    !selfieUrl && 'foto bersama',
  ].filter(Boolean) as string[];

  function closeSheet() {
    if (submitting) return;
    setSession(null);
  }

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
    if (!canSubmit || !selected) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cashcount',
          session: selected,
          totalAmount: Math.round(amountNum),
          witnessUserId: witnessId,
          selfiePhoto: selfieUrl,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Gagal menyimpan');
      toast.success(`Hitung kas sesi ${CASH_COUNT_SESSION_INFO[selected].label} tersimpan.`);
      setSession(null);
      setAmount('');
      setWitnessId('');
      setSelfieUrl(null);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      {/* Header + day progress */}
      <div className="space-y-3 px-4 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl',
              allDone ? 'bg-green-50' : 'bg-sky-50',
            )}
          >
            {allDone ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" strokeWidth={2.2} />
            ) : (
              <Wallet className="h-5 w-5 text-sky-600" strokeWidth={2.2} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">Hitung Kas Kasir</p>
            <p className="text-[11px] text-muted-foreground">
              {allDone ? 'Kelima sesi hari ini sudah lengkap.' : `Wajib ${total}x sehari sesuai SOP`}
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="text-lg font-bold leading-none tabular-nums text-foreground">
              {doneCount}
              <span className="text-sm font-semibold text-muted-foreground">/{total}</span>
            </p>
            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">sesi</p>
          </div>
        </div>
        <ProgressSegments sessions={cashCount.sessions} />
      </div>

      <div className="border-t border-border px-4 pb-4 pt-1">
        <SessionTimeline cashCount={cashCount} onSelect={setSession} onPreview={setPreview} />
        {!cashCount.canSubmit && !allDone && (
          <FieldHint>Hanya staf yang bertugas di toko ini hari ini yang bisa mencatat hitung kas.</FieldHint>
        )}
      </div>

      {/* Count form */}
      <BottomSheet
        open={!!selected && !!info}
        onClose={closeSheet}
        dismissible={!submitting}
        title={
          info && tone ? (
            <span className="flex items-center gap-2">
              <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white', tone.solid)}>
                {info.step}
              </span>
              Sesi {info.label}
            </span>
          ) : ''
        }
        footer={
          <div className="w-full space-y-2">
            {missing.length > 0 && !submitting && (
              <p className="text-center text-[11px] text-muted-foreground">Lengkapi: {missing.join(', ')}</p>
            )}
            <ActionButton className="w-full" onClick={handleSubmit} disabled={!canSubmit} loading={submitting} icon={Check}>
              {submitting ? 'Menyimpan…' : `Simpan Sesi ${info?.label ?? ''}`}
            </ActionButton>
          </div>
        }
      >
        {info && tone && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {info.items.map((item) => (
                <Chip key={item} className={cn(tone.soft, tone.text)}>{item}</Chip>
              ))}
            </div>

            <AmountField
              label="Total uang di kasir"
              value={amount}
              onChange={setAmount}
              disabled={submitting}
              placeholder="0"
            />

            <div className="space-y-2">
              <FieldLabel>Rekan foto bersama</FieldLabel>
              <WitnessPicker
                employees={cashCount.coScheduledEmployees}
                value={witnessId}
                onChange={setWitnessId}
                disabled={submitting}
              />
              {selfieUrl ? (
                <div className="relative overflow-hidden rounded-xl border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={selfieUrl} alt="Foto bersama" className="aspect-[4/3] w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setCameraOpen(true)}
                    disabled={submitting || uploading}
                    className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur disabled:opacity-60"
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    Ambil ulang
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  disabled={submitting || uploading}
                  className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/40 text-muted-foreground transition-colors active:bg-secondary disabled:opacity-60"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-sm">
                    {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5 text-foreground" />}
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {uploading ? 'Mengunggah…' : 'Ambil foto bersama'}
                  </span>
                  <span className="text-[11px]">Kamu dan rekan dalam satu foto</span>
                </button>
              )}
            </div>
          </>
        )}
      </BottomSheet>

      {/* Recorded selfie preview */}
      <BottomSheet open={!!preview} onClose={() => setPreview(null)} title="Foto bersama">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Foto bersama" className="w-full rounded-xl object-cover" />
        )}
      </BottomSheet>

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
