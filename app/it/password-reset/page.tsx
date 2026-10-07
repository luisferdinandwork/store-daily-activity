'use client';
// app/it/password-reset/page.tsx — IT only.
//
// "Lupa password" queue. Staff ask from the login screen with NIK + store
// email; each request lands here. IT checks it (e.g. calls the store), then
// "Verifikasi & kirim link" emails a one-time link to the store mailbox — it
// only works for that NIK. Expired / locked links can be sent again; anything
// suspicious is rejected. When the person sets the new password the row turns
// "Berhasil". Rules: lib/db/utils/password-reset.ts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  MailWarning,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  PASSWORD_RESET_CHANGED_EVENT,
  PASSWORD_RESET_STATUS_LABEL,
  RESET_LINK_TTL_HOURS,
  RESET_MAX_NIK_ATTEMPTS,
  RESET_REJECT_REASON_MAX,
  type PasswordResetCounts,
  type PasswordResetRow,
  type PasswordResetStatus,
  type SendLinkOutcome,
} from '@/lib/password-reset';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';

function relative(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.round(hours / 24)} hari lalu`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

const STATUS_STYLE: Record<PasswordResetStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  link_sent: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  expired: 'bg-slate-100 text-slate-600 ring-slate-200',
  locked: 'bg-rose-50 text-rose-700 ring-rose-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rejected: 'bg-slate-100 text-slate-500 ring-slate-200',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
};

function StatusBadge({ status }: { status: PasswordResetStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        STATUS_STYLE[status],
      )}
    >
      {PASSWORD_RESET_STATUS_LABEL[status]}
    </span>
  );
}

type Filter = 'action' | 'link_sent' | 'completed' | 'closed' | 'all';

const FILTERS: { key: Filter; label: string; match: (s: PasswordResetStatus) => boolean }[] = [
  { key: 'action', label: 'Perlu tindakan', match: (s) => s === 'pending' || s === 'expired' || s === 'locked' },
  { key: 'link_sent', label: 'Link terkirim', match: (s) => s === 'link_sent' },
  { key: 'completed', label: 'Berhasil', match: (s) => s === 'completed' },
  { key: 'closed', label: 'Ditolak / batal', match: (s) => s === 'rejected' || s === 'cancelled' },
  { key: 'all', label: 'Semua', match: () => true },
];

const canSend = (s: PasswordResetStatus) => s === 'pending' || s === 'link_sent' || s === 'expired' || s === 'locked';

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error ?? 'Request gagal');
  return json;
}

// ─── Send-link dialog ─────────────────────────────────────────────────────────

function SendLinkDialog({ row, onClose, onDone }: { row: PasswordResetRow; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SendLinkOutcome | null>(null);
  const resend = row.status !== 'pending';

  async function send() {
    setBusy(true);
    try {
      const json = await api(`/api/it/password-reset/${row.id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'send_link' }),
      });
      const result = json.outcome as SendLinkOutcome;
      setOutcome(result);
      onDone();
      if (result.mode === 'graph') toast.success(`Link terkirim ke ${result.email}`);
      else if (result.emailError) toast.error('Link dibuat, tetapi email gagal dikirim.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link disalin.');
    } catch {
      toast.error('Gagal menyalin — pilih dan salin manual.');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-cyan-600" />
            {resend ? 'Kirim ulang link' : 'Verifikasi & kirim link'}
          </DialogTitle>
          <DialogDescription>
            {outcome
              ? 'Link reset password sudah dibuat.'
              : `Pastikan permintaan ini benar dari orangnya (misalnya telepon toko) sebelum mengirim.`}
          </DialogDescription>
        </DialogHeader>

        {!outcome && (
          <div className="space-y-3 text-sm">
            <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {[
                ['Untuk', `${row.name} · NIK ${row.nik}`],
                ['Toko', row.storeNo ? `${row.storeNo} · ${row.storeName}` : '-'],
                ['Dikirim ke', row.email],
                ['Berlaku', `${RESET_LINK_TTL_HOURS} jam, sekali pakai`],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3 px-3 py-2">
                  <dt className="w-24 shrink-0 text-xs text-slate-500">{k}</dt>
                  <dd className="min-w-0 break-words text-xs font-semibold text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600" />
              Link hanya bisa dipakai dengan NIK {row.nik}. NIK lain mendapat pesan &quot;Link ini bukan untuk NIK
              Anda&quot;; setelah {RESET_MAX_NIK_ATTEMPTS}× salah, link terkunci.
              {resend && ' Link lama untuk orang ini otomatis tidak berlaku.'}
            </p>
          </div>
        )}

        {outcome && (
          <div className="space-y-3 text-sm">
            {outcome.mode === 'graph' && (
              <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-semibold text-emerald-800">Email terkirim</p>
                  <p className="text-xs text-emerald-700">
                    Ke {outcome.email}, berlaku sampai {fmt(outcome.expiresAt)} WIB.
                  </p>
                </div>
              </div>
            )}
            {outcome.mode === 'console' && (
              <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <MailWarning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div>
                  <p className="font-semibold text-amber-800">Mode dev — email tidak benar-benar dikirim</p>
                  <p className="text-xs text-amber-700">
                    Email Azure belum dikonfigurasi, jadi isinya dicetak di log server. Gunakan link di bawah untuk mencoba.
                  </p>
                </div>
              </div>
            )}
            {outcome.emailError && (
              <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                <div className="min-w-0">
                  <p className="font-semibold text-rose-800">Email gagal dikirim</p>
                  <p className="break-words text-xs text-rose-700">{outcome.emailError}</p>
                  <p className="mt-1 text-xs text-rose-700">
                    Link tetap aktif — salin dan kirim lewat jalur resmi toko, atau coba kirim ulang nanti.
                  </p>
                </div>
              </div>
            )}
            {outcome.link && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Link (hanya untuk NIK {row.nik})
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700">
                    {outcome.link}
                  </code>
                  <Button type="button" size="sm" variant="outline" onClick={() => copyLink(outcome.link!)} className="gap-1.5">
                    <Copy className="h-3.5 w-3.5" />
                    Salin
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {outcome ? (
            <Button type="button" onClick={onClose} className="bg-cyan-600 hover:bg-cyan-700">
              Selesai
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Batal
              </Button>
              <Button type="button" onClick={send} disabled={busy} className="gap-1.5 bg-cyan-600 hover:bg-cyan-700">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {resend ? 'Kirim ulang' : 'Kirim link'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reject dialog ────────────────────────────────────────────────────────────

function RejectDialog({ row, onClose, onDone }: { row: PasswordResetRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function reject() {
    setBusy(true);
    try {
      await api(`/api/it/password-reset/${row.id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'reject', reason }),
      });
      toast.success('Permintaan ditolak. Email toko diberi tahu.');
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-rose-600" />
            Tolak permintaan
          </DialogTitle>
          <DialogDescription>
            {row.name} (NIK {row.nik}). {row.status !== 'pending' && 'Link yang sudah terkirim langsung tidak berlaku. '}
            Email toko ({row.email}) diberi tahu.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor="reject-reason" className="text-xs font-semibold text-slate-600">
            Alasan <span className="font-normal text-slate-400">(opsional, ikut di email)</span>
          </label>
          <Textarea
            id="reject-reason"
            value={reason}
            maxLength={RESET_REJECT_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder="mis. Tidak dapat diverifikasi — hubungi IT langsung."
            rows={3}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button type="button" variant="destructive" onClick={reject} disabled={busy} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Tolak
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function RequestRow({
  row,
  onSend,
  onReject,
}: {
  row: PasswordResetRow;
  onSend: () => void;
  onReject: () => void;
}) {
  const open = canSend(row.status);
  return (
    <li className="@container px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center">
        {/* Who */}
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-xs font-bold text-cyan-700">
            {initials(row.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="truncate font-semibold text-slate-900">{row.name}</p>
              <span className="rounded bg-slate-100 px-1.5 py-px font-mono text-[10px] font-bold text-slate-600">
                {row.nik}
              </span>
              <StatusBadge status={row.status} />
              {!row.userActive && (
                <span className="rounded bg-slate-800 px-1.5 py-px text-[10px] font-bold text-white">Akun nonaktif</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              {row.storeNo && (
                <span className="inline-flex items-center gap-1">
                  <span className="rounded bg-slate-100 px-1 font-mono text-[10px] font-bold text-slate-500">{row.storeNo}</span>
                  {row.storeName}
                </span>
              )}
              <span className="inline-flex min-w-0 items-center gap-1">
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">{row.email}</span>
              </span>
            </div>

            {/* Timeline */}
            <div className="mt-2 space-y-0.5 text-[11px] text-slate-500">
              <p className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Diminta {fmt(row.createdAt)} · {relative(row.createdAt)}
                {row.requestIp && <span className="text-slate-400"> · IP {row.requestIp}</span>}
              </p>
              {row.linkSentAt && row.status !== 'pending' && (
                <p>
                  Link dikirim {fmt(row.linkSentAt)}
                  {row.linkSentByName && ` oleh ${row.linkSentByName}`}
                  {row.tokenExpiresAt && (row.status === 'link_sent' || row.status === 'expired') && (
                    <> · {row.status === 'expired' ? 'kedaluwarsa' : 'berlaku s/d'} {fmt(row.tokenExpiresAt)}</>
                  )}
                </p>
              )}
              {row.failedAttempts > 0 && (row.status === 'link_sent' || row.status === 'locked') && (
                <p className="inline-flex items-center gap-1 font-semibold text-rose-600">
                  <ShieldAlert className="h-3 w-3" />
                  {row.failedAttempts}× dicoba dengan NIK lain
                  {row.status === 'locked' && ' — link terkunci'}
                </p>
              )}
              {row.status === 'completed' && row.completedAt && (
                <p className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Password diganti {fmt(row.completedAt)}
                </p>
              )}
              {(row.status === 'rejected' || row.status === 'cancelled') && (
                <p>
                  {row.status === 'rejected' ? 'Ditolak' : 'Dibatalkan'}
                  {row.rejectedAt && ` ${fmt(row.rejectedAt)}`}
                  {row.rejectedByName && ` oleh ${row.rejectedByName}`}
                  {row.rejectReason && <span className="text-slate-400"> — {row.rejectReason}</span>}
                </p>
              )}
              {row.lastEmailError && (
                <p className="flex items-start gap-1 font-medium text-amber-700">
                  <MailWarning className="mt-px h-3 w-3 shrink-0" />
                  <span className="break-words">Email terakhir gagal: {row.lastEmailError}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        {open && (
          <div className="flex shrink-0 gap-2 pl-[52px] @3xl:pl-0">
            <Button
              type="button"
              size="sm"
              onClick={onSend}
              disabled={!row.userActive}
              className="gap-1.5 bg-cyan-600 hover:bg-cyan-700"
            >
              <Send className="h-3.5 w-3.5" />
              {row.status === 'pending' ? 'Verifikasi & kirim link' : 'Kirim ulang'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onReject} className="gap-1.5 text-rose-600 hover:text-rose-700">
              <X className="h-3.5 w-3.5" />
              Tolak
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ItPasswordResetPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [rows, setRows] = useState<PasswordResetRow[]>([]);
  const [counts, setCounts] = useState<PasswordResetCounts | null>(null);
  const [mail, setMail] = useState<{ configured: boolean; from: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('action');
  const [q, setQ] = useState('');
  const [sending, setSending] = useState<PasswordResetRow | null>(null);
  const [rejecting, setRejecting] = useState<PasswordResetRow | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt) router.replace('/');
  }, [authStatus, session, isIt, router]);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    try {
      const json = await api('/api/it/password-reset', { cache: 'no-store' });
      setRows(json.rows);
      setCounts(json.counts);
      setMail(json.mail);
    } catch (err) {
      if (!quiet) toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isIt) return;
    load();
    // New requests come in from the login screen — keep the queue fresh.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [isIt, load]);

  const changed = useCallback(() => {
    load(true);
    window.dispatchEvent(new Event(PASSWORD_RESET_CHANGED_EVENT));
  }, [load]);

  const filterCounts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter((r) => f.match(r.status)).length])) as Record<Filter, number>,
    [rows],
  );

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        f.match(r.status) &&
        (!needle ||
          [r.name, r.nik, r.email, r.storeNo ?? '', r.storeName ?? ''].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [rows, filter, q]);

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can view this page.</p>
    </div>
  );

  const tiles = [
    { label: 'Menunggu verifikasi', value: counts?.pending ?? 0, Icon: Clock, color: '#d97706' },
    { label: 'Link aktif', value: counts?.linkSent ?? 0, Icon: Send, color: '#0891b2' },
    { label: 'Link kedaluwarsa / terkunci', value: counts?.stuck ?? 0, Icon: AlertTriangle, color: '#e11d48' },
    { label: 'Berhasil (30 hari)', value: counts?.completed30d ?? 0, Icon: CheckCircle2, color: '#059669' },
  ];

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-5 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">IT</p>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <KeyRound className="h-5 w-5 text-cyan-600" />
              Reset Password
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              Permintaan &quot;Lupa password&quot; dari staf toko — verifikasi, lalu kirim link sekali pakai ke email toko.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mail && (
              <span
                title={mail.configured ? `Dikirim sebagai ${mail.from}` : 'AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET belum diisi'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset',
                  mail.configured ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200',
                )}
              >
                {mail.configured ? <Mail className="h-3 w-3" /> : <MailWarning className="h-3 w-3" />}
                {mail.configured ? mail.from : 'Email belum dikonfigurasi'}
              </span>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5">
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              Muat ulang
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map(({ label, value, Icon, color }) => (
            <div key={label} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${color}15` }}>
                <Icon className="h-5 w-5" style={{ color }} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold tabular-nums" style={{ color }}>{loading ? '–' : value}</p>
                <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari nama, NIK, toko, email…"
                aria-label="Cari permintaan"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ('')}
                  aria-label="Hapus pencarian"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-slate-300 hover:text-slate-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  filter === key ? 'bg-cyan-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
                )}
              >
                {label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] tabular-nums',
                    filter === key ? 'bg-white/20' : key === 'action' && filterCounts.action > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {filterCounts[key]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-cyan-400" /></div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50">
              <ShieldCheck className="h-6 w-6 text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-600">
              {filter === 'action' && !q ? 'Tidak ada permintaan yang menunggu.' : 'Tidak ada permintaan yang cocok.'}
            </p>
            <p className="max-w-sm text-xs text-slate-400">
              Staf mengajukan dari halaman masuk → &quot;Lupa password?&quot; dengan NIK dan email toko. Pastikan email toko
              sudah diisi di Store Management.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {visible.map((row) => (
              <RequestRow key={row.id} row={row} onSend={() => setSending(row)} onReject={() => setRejecting(row)} />
            ))}
          </ul>
        )}
      </div>

      {sending && <SendLinkDialog row={sending} onClose={() => setSending(null)} onDone={changed} />}
      {rejecting && <RejectDialog row={rejecting} onClose={() => setRejecting(null)} onDone={changed} />}
    </div>
  );
}
