'use client';
// components/audit/stock-opname/SuperRewardView.tsx — Audit "Super Reward" of one Stock Opname
// (/audit/berita-acara-so/[id]/super-reward): the Lampiran Regular Reward Stock Opname, one card per employee.
//
// No, Employee No., Employee Name, Tgl SO Audit and PIC come from PRISM (the store's staff) and can't be typed. The
// auditor fills Tgl Masuk Toko Awal + Rincian Tgl SO; Ket Durasi, Jumlah SO, Keterangan Incentive and the Regular
// Reward follow those (lib/audit-super-reward.ts) — tagged "Otomatis" — until the auditor picks something else
// ("Diubah", one tap back to Otomatis). The A4 preview under the form is the printed page, live.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  Banknote,
  CalendarPlus,
  Info,
  Loader2,
  Minus,
  PenLine,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Ticket,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

import PanelPageHeader from '@/components/shared/PanelPageHeader';
import { cn } from '@/lib/utils';
import { TONES } from '@/lib/status-theme';
import { SO_TEXT_MAX, longDateId, shortDateId, type StockOpnameRecord } from '@/lib/audit-stock-opname';
import {
  DURATION_LABEL,
  REWARD_CHOICE_LABEL,
  REWARD_NAME_MAX,
  REWARD_NIK_MAX,
  REWARD_ROWS_MAX,
  REWARD_TIERS,
  REWARD_TYPES,
  SO_COUNT_MAX,
  SO_PERIODS,
  autoDuration,
  autoIncentive,
  autoReward,
  countSoDates,
  resolveReward,
  rewardRoleLabels,
  rewardRupiah,
  sortRewardRows,
  summarizeReward,
  type RewardChoice,
  type RewardDuration,
  type RewardIncentive,
  type RewardType,
  type SoRewardRow,
} from '@/lib/audit-super-reward';
import { SavedStamp, SectionCard, fetchJson } from '@/components/audit/cash-check/kit';
import SoTabs from './SoTabs';
import { SoPaperPreview, SoPrintPortal, printSoDocument } from './SoPrint';

// ─── State ───────────────────────────────────────────────────────────────────

interface Staff {
  userId: string;
  nik: string;
  name: string;
  type: RewardType | null;
}

interface Loaded {
  so: StockOpnameRecord;
  rows: SoRewardRow[];
  staff: Staff[];
  suggestions: Record<string, SoRewardRow>;
  carried: Record<string, string>;
}

type DraftRow = SoRewardRow & { key: string };

interface Signers {
  auditorName: string;
  auditorCaption: string;
  approvedName: string;
  approvedTitle: string;
  irName: string;
  irTitle: string;
  knownName: string;
  knownTitle: string;
}

interface Form {
  rows: DraftRow[];
  signers: Signers;
}

let keySeq = 0;
const newKey = () => `m${Date.now().toString(36)}${(keySeq++).toString(36)}`;

const withKey = (row: SoRewardRow): DraftRow => ({ ...row, key: row.userId ?? newKey() });
const stripKey = (draft: DraftRow): SoRewardRow => {
  const row: Partial<DraftRow> = { ...draft };
  delete row.key;
  return row as SoRewardRow;
};

const signersOf = (so: StockOpnameRecord): Signers => ({
  auditorName: so.auditorName,
  auditorCaption: so.auditorCaption,
  approvedName: so.approved.name,
  approvedTitle: so.approved.title,
  irName: so.ir.name,
  irTitle: so.ir.title,
  knownName: so.known.name,
  knownTitle: so.known.title,
});

const formOf = (d: Pick<Loaded, 'so' | 'rows'>): Form => ({ rows: sortRewardRows(d.rows.map(withKey)), signers: signersOf(d.so) });

const snapshot = (f: Form) => JSON.stringify({ rows: f.rows.map(stripKey), signers: f.signers });

/** The record as it will print — the saved one with this form's rows and signatures. */
function previewOf(so: StockOpnameRecord, f: Form): StockOpnameRecord {
  const s = f.signers;
  return {
    ...so,
    reward: f.rows.map(stripKey),
    auditorName: s.auditorName,
    auditorCaption: s.auditorCaption,
    approved: { name: s.approvedName, title: s.approvedTitle },
    ir: { name: s.irName, title: s.irTitle },
    known: { name: s.knownName, title: s.knownTitle },
  };
}

const blankManualRow = (soDate: string): DraftRow => ({
  key: newKey(),
  userId: null,
  nik: '',
  name: '',
  type: 'sa',
  joinDate: null,
  soDates: [soDate, ...Array.from({ length: SO_PERIODS - 1 }, () => null)],
  duration: null,
  soCount: null,
  incentive: null,
  reward: null,
});

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SuperRewardView({ id }: { id: number }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await fetchJson<Loaded>(`/api/audit/stock-opname/${id}/reward`);
      setData(d);
      const f = formOf(d);
      setForm(f);
      setBaseline(snapshot(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = form != null && snapshot(form) !== baseline;

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  const so = data?.so ?? null;
  const preview = useMemo(() => (so && form ? previewOf(so, form) : null), [so, form]);
  const summary = useMemo(() => (so && form ? summarizeReward(form.rows, so.soDate) : null), [so, form]);

  const setRows = (fn: (rows: DraftRow[]) => DraftRow[]) => setForm((f) => (f ? { ...f, rows: sortRewardRows(fn(f.rows)) } : f));
  const patchRow = (key: string, patch: Partial<SoRewardRow>) => setRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function removeRow(row: DraftRow) {
    setRows((rows) => rows.filter((r) => r.key !== row.key));
    toast(`${row.name || 'Baris'} dihapus dari daftar`, {
      action: { label: 'Batalkan', onClick: () => setRows((rows) => (rows.some((r) => r.key === row.key) ? rows : [...rows, row])) },
    });
  }

  function addStaff(person: Staff) {
    if (!data || !form || form.rows.length >= REWARD_ROWS_MAX) return;
    const row = data.suggestions[person.userId];
    if (row) setRows((rows) => [...rows, withKey(row)]);
  }

  function addManual() {
    if (!so || !form || form.rows.length >= REWARD_ROWS_MAX) return;
    setRows((rows) => [...rows, blankManualRow(so.soDate)]);
  }

  function restart() {
    if (!data) return;
    if (!window.confirm('Ganti daftar dengan karyawan toko saat ini? Isian di form ini hilang (yang tersimpan tetap sampai Anda Simpan).')) return;
    const rows = sortRewardRows(data.staff.map((s) => data.suggestions[s.userId]).filter(Boolean));
    setForm((f) => (f ? { ...f, rows: rows.map(withKey) } : f));
  }

  async function save(): Promise<boolean> {
    if (!form) return false;
    const unnamed = form.rows.find((r) => !r.name.trim());
    if (unnamed) {
      toast.error('Nama karyawan wajib diisi', { description: 'Isi nama di baris manual, atau hapus barisnya.' });
      return false;
    }
    setSaving(true);
    try {
      const d = await fetchJson<{ so: StockOpnameRecord }>(`/api/audit/stock-opname/${id}/reward`, {
        method: 'PUT',
        body: JSON.stringify({ rows: form.rows.map(stripKey), signers: form.signers }),
      });
      const next = data ? { ...data, so: d.so, rows: d.so.reward ?? [] } : null;
      if (next) {
        setData(next);
        const f = formOf(next);
        setForm(f);
        setBaseline(snapshot(f));
      }
      toast.success('Super Reward tersimpan');
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function print() {
    if (!preview) return;
    if (dirty && !(await save())) return;
    printSoDocument(preview, 'reward');
  }

  if (error && !data) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center">
        <Award className="h-10 w-10 text-slate-300" />
        <p className="text-sm font-semibold text-slate-700">{error}</p>
        <button type="button" onClick={() => void load()} className="text-sm font-bold text-amber-700 hover:underline">
          Coba lagi
        </button>
      </div>
    );
  }
  if (!data || !so || !form || !preview || !summary) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
      </div>
    );
  }

  const listed = new Set(form.rows.map((r) => r.userId).filter(Boolean));
  const notListed = data.staff.filter((s) => !listed.has(s.userId));
  const roles = rewardRoleLabels(form.rows);
  const full = form.rows.length >= REWARD_ROWS_MAX;

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <PanelPageHeader
        scope="Audit · Berita Acara SO"
        title={<><Award />Super Reward</>}
        subtitle={`${so.storeNo} · ${so.storeName} · SO ${longDateId(so.soDate)} · No. ${so.docNumber}`}
        tabs={<SoTabs />}
        hideTabsOnPhone
        compactActions
        actions={
          <button
            type="button"
            onClick={() => void print()}
            disabled={saving}
            aria-label="Cetak"
            className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-xl bg-amber-500 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60 md:w-auto md:px-4"
          >
            <Printer className="h-4 w-4" /> <span className="hidden md:inline">Cetak</span>
          </button>
        }
      />

      <div className="flex-1 space-y-3 p-3 sm:space-y-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href={`/audit/berita-acara-so/${so.id}`}
            onClick={(e) => {
              if (dirty && !window.confirm('Perubahan belum disimpan. Tinggalkan halaman ini?')) e.preventDefault();
            }}
            className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" /> Berita Acara SO {so.storeNo}
          </Link>
          <SavedStamp at={so.rewardCheckedAt} by={so.rewardCheckedBy} />
        </div>

        {!so.reward && (
          <div className={cn('flex gap-2.5 rounded-2xl border px-4 py-3 text-sm', TONES.info.chip)}>
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <b>Belum disimpan.</b> Daftar diambil dari karyawan aktif toko {so.storeNo}. Isi <b>Tgl Masuk Toko Awal</b> dan{' '}
              <b>Rincian Tgl SO</b> — kolom lain mengikuti otomatis — lalu Simpan.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile icon={Users} label="Karyawan" value={String(summary.employees)} hint={summary.open ? `${summary.open} belum lengkap` : 'Semua lengkap'} hintTone={summary.open ? 'warning' : undefined} />
          <Tile icon={Award} label="Dapat reward" value={`${summary.dapat} / ${summary.employees}`} hint={summary.tidak ? `${summary.tidak} tidak dapat` : undefined} />
          <Tile
            icon={Ticket}
            label="Voucher cash"
            value={rewardRupiah(summary.voucher)}
            hint={tierHint(summary.byTier.voucher_300, '300rb', summary.byTier.voucher_500, '500rb')}
          />
          <Tile icon={Banknote} label="Cash" value={rewardRupiah(summary.cash)} hint={summary.byTier.cash_500 ? `${summary.byTier.cash_500} × 500rb` : undefined} />
        </div>

        <SectionCard
          icon={Users}
          title="Karyawan"
          subtitle={
            <>
              No, Employee No., Employee Name, Tgl SO Audit dan PIC diambil dari PRISM. Isi Tgl Masuk Toko Awal dan Rincian Tgl SO; kolom bertanda{' '}
              <AutoTagDemo /> mengikuti aturan dan bisa diubah.
            </>
          }
          action={
            <button
              type="button"
              onClick={restart}
              className="flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:bg-amber-50"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Ambil ulang dari data toko
            </button>
          }
        >
          <div className="space-y-3 bg-slate-50/60 p-3 sm:p-4">
            {form.rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                Belum ada karyawan di daftar. Tambahkan dari data toko atau secara manual di bawah.
              </p>
            ) : (
              <ol className="space-y-3">
                {form.rows.map((row, i) => (
                  <EmployeeCard
                    key={row.key}
                    no={i + 1}
                    row={row}
                    role={roles[i]}
                    soDate={so.soDate}
                    carriedFrom={so.reward ? null : row.userId ? (data.carried[row.userId] ?? null) : null}
                    onPatch={(p) => patchRow(row.key, p)}
                    onRemove={() => removeRow(row)}
                  />
                ))}
              </ol>
            )}

            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-3 sm:p-4">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                <UserPlus className="h-3.5 w-3.5" /> Tambah karyawan
              </p>
              {notListed.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {notListed.map((s) => (
                    <button
                      key={s.userId}
                      type="button"
                      disabled={full}
                      onClick={() => addStaff(s)}
                      className="flex min-h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white pl-2 pr-3 text-xs font-semibold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5 text-amber-600" />
                      {s.name}
                      <span className="text-slate-400">{REWARD_TYPES.find((t) => t.key === s.type)?.label ?? ''}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  disabled={full}
                  onClick={addManual}
                  className="flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-sm font-bold text-amber-700 hover:text-amber-800 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" /> Tambah manual
                </button>
                <span className="text-xs text-slate-400">
                  {notListed.length ? 'untuk karyawan yang belum terdaftar di PRISM' : 'Semua karyawan toko sudah di daftar — tambah manual untuk yang belum terdaftar di PRISM'}
                </span>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon={PenLine}
          title="Tanda tangan"
          subtitle="Dibuat, Disetujui dan Diketahui sama dengan Berita Acara SO — mengubahnya di sini ikut mengubah BA. Dept IR hanya di Super Reward."
        >
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <SignerFields
              heading="Dibuat"
              name={form.signers.auditorName}
              title={form.signers.auditorCaption}
              onChange={(name, title) => setForm({ ...form, signers: { ...form.signers, auditorName: name, auditorCaption: title } })}
            />
            <SignerFields
              heading="Disetujui"
              name={form.signers.approvedName}
              title={form.signers.approvedTitle}
              onChange={(name, title) => setForm({ ...form, signers: { ...form.signers, approvedName: name, approvedTitle: title } })}
            />
            <SignerFields
              heading="Dept IR"
              name={form.signers.irName}
              title={form.signers.irTitle}
              onChange={(name, title) => setForm({ ...form, signers: { ...form.signers, irName: name, irTitle: title } })}
            />
            <SignerFields
              heading="Diketahui"
              name={form.signers.knownName}
              title={form.signers.knownTitle}
              onChange={(name, title) => setForm({ ...form, signers: { ...form.signers, knownName: name, knownTitle: title } })}
            />
          </div>
        </SectionCard>

        {/* A landscape sheet at 50 % is not readable on a phone — the cards above are the view there; Cetak (top right) prints it. */}
        <div className="space-y-4 max-md:hidden">
          <SoPaperPreview record={preview} kind="reward" />
          <p className="text-[11px] text-slate-400">
            Cetak menyimpan dulu bila ada perubahan, lalu membuka dialog print browser — pilih printer, atau &quot;Simpan sebagai PDF&quot; (A4 landscape, skala 50 % seperti sheet Excel).
          </p>
        </div>
      </div>

      <SoPrintPortal record={preview} kind="reward" />

      <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)] backdrop-blur supports-[backdrop-filter]:bg-white/85 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total reward</p>
            <p className="truncate text-sm font-extrabold tabular-nums text-slate-900">
              {rewardRupiah(summary.total)}
              <span className="font-semibold text-slate-500">
                {' '}
                · {summary.dapat} dari {summary.employees} karyawan
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void print()}
            disabled={saving}
            className="hidden h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:flex"
          >
            <Printer className="h-4 w-4" /> Cetak
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || (!dirty && !!so.reward)}
            className={cn(
              'flex h-11 shrink-0 items-center gap-2 rounded-xl px-5 text-sm font-bold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
              dirty || !so.reward ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-900 text-white',
            )}
          >
            {saving ? 'Menyimpan…' : dirty || !so.reward ? 'Simpan' : 'Tersimpan'}
          </button>
        </div>
      </div>
    </div>
  );
}

function tierHint(a: number, aLabel: string, b: number, bLabel: string): string | undefined {
  const parts = [a ? `${a} × ${aLabel}` : '', b ? `${b} × ${bLabel}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

// ─── One employee ────────────────────────────────────────────────────────────

function EmployeeCard({
  no,
  row,
  role,
  soDate,
  carriedFrom,
  onPatch,
  onRemove,
}: {
  no: number;
  row: DraftRow;
  role: string;
  soDate: string;
  carriedFrom: string | null;
  onPatch: (p: Partial<SoRewardRow>) => void;
  onRemove: () => void;
}) {
  const r = resolveReward(row, soDate);
  const manual = row.userId == null;
  const filledDates = row.soDates.filter((d): d is string => !!d);
  const hasSoDay = filledDates.includes(soDate);
  const emptySlot = row.soDates.findIndex((d) => !d);

  // What each rule says right now (picking that value = back to Otomatis).
  const ruleDuration = autoDuration(row.joinDate, soDate);
  const ruleCount = countSoDates(row.soDates);
  const ruleIncentive = autoIncentive(r.duration);
  const ruleReward = autoReward(r.incentive, r.soCount);

  const warnings: string[] = [];
  if (row.joinDate && row.joinDate > soDate) warnings.push('Tgl masuk toko setelah tanggal SO ini.');
  if (filledDates.some((d) => d > soDate)) warnings.push('Ada Tgl SO periode setelah tanggal SO ini.');
  if (new Set(filledDates).size < filledDates.length) warnings.push('Ada Tgl SO periode yang sama.');
  if (r.incentive === 'tidak' && r.reward && r.reward !== 'none') warnings.push('Keterangan "Tidak Dapat" tapi reward dipilih.');
  if (r.incentive === 'dapat' && r.reward === 'none') warnings.push('Keterangan "Dapat" tapi tidak ada reward yang dicentang.');

  const setDate = (i: number, value: string | null) => onPatch({ soDates: row.soDates.map((d, j) => (j === i ? value : d)) });

  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      {/* Identity — from PRISM (manual rows: typed) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold tabular-nums text-slate-600">{no}</span>
        {manual ? (
          <div className="grid min-w-[11rem] flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_160px_120px]">
            <input
              value={row.name}
              maxLength={REWARD_NAME_MAX}
              onChange={(e) => onPatch({ name: e.target.value })}
              placeholder="Nama karyawan"
              aria-label="Nama karyawan"
              className={inputCls}
            />
            <input
              value={row.nik}
              maxLength={REWARD_NIK_MAX}
              onChange={(e) => onPatch({ nik: e.target.value.toUpperCase() })}
              placeholder="Employee No."
              aria-label="Employee No."
              className={cn(inputCls, 'font-mono')}
            />
            <select
              value={row.type ?? ''}
              onChange={(e) => onPatch({ type: (e.target.value || null) as RewardType | null })}
              aria-label="PIC"
              className={inputCls}
            >
              {REWARD_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          // A floor on the name's width so the chips wrap under it on a phone instead of squeezing it to "O…".
          <div className="min-w-[11rem] flex-1">
            <p className="truncate text-sm font-bold text-slate-900">{row.name}</p>
            <p className="truncate text-xs text-slate-500">
              <span className="font-mono">{row.nik}</span> · Tgl SO Audit {shortDateId(soDate)}
            </p>
          </div>
        )}
        <div className="flex items-center gap-2 max-sm:w-full max-sm:pl-11">
          {role && <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">{role}</span>}
          {manual && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Manual</span>}
          <OutcomeChip reward={r.reward} incentive={r.incentive} />
          <button
            type="button"
            onClick={onRemove}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            aria-label={`Hapus ${row.name || 'baris'} dari daftar`}
            title="Hapus dari daftar"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* What the auditor types */}
      <div className="grid gap-x-5 gap-y-4 px-4 pt-4 md:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[180px_220px_minmax(0,1fr)]">
        <div>
          <FieldLabel label="Tgl Masuk Toko Awal" />
          <DateInput value={row.joinDate} max={soDate} onChange={(v) => onPatch({ joinDate: v })} ariaLabel={`Tgl Masuk Toko Awal ${row.name}`} />
        </div>
        <div>
          <FieldLabel label="Ket Durasi" auto={r.duration == null && row.duration == null ? null : r.durationAuto} onReset={() => onPatch({ duration: null })} />
          <Choice<RewardDuration>
            options={[
              { value: 'over', label: DURATION_LABEL.over },
              { value: 'under', label: DURATION_LABEL.under },
            ]}
            value={r.duration}
            onChange={(v) => onPatch({ duration: v === ruleDuration ? null : v })}
          />
          {r.duration == null && <p className="mt-1 text-[11px] text-slate-400">Terisi setelah Tgl Masuk diisi.</p>}
        </div>
        <div className="md:col-span-2 xl:col-span-1">
          <FieldLabel label="Rincian Tgl SO" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {row.soDates.map((d, i) => (
              <div key={i} className="min-w-0">
                <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-slate-400">SO Periode {i + 1}</span>
                <DateInput value={d} max={soDate} onChange={(v) => setDate(i, v)} ariaLabel={`SO Periode ${i + 1} ${row.name}`} />
              </div>
            ))}
          </div>
          {!hasSoDay && emptySlot >= 0 && (
            <button
              type="button"
              onClick={() => setDate(emptySlot, soDate)}
              className="mt-1.5 flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
            >
              <CalendarPlus className="h-3.5 w-3.5" /> Isi tgl SO ini ({shortDateId(soDate)}) ke Periode {emptySlot + 1}
            </button>
          )}
        </div>
      </div>

      {/* What follows the rules */}
      <div className="mt-4 grid gap-x-5 gap-y-4 border-t border-dashed border-slate-200 bg-slate-50/50 px-4 py-4 md:grid-cols-[150px_minmax(0,1fr)] xl:grid-cols-[150px_300px_minmax(0,1fr)]">
        <div>
          <FieldLabel label="Jumlah SO" auto={r.soCountAuto} onReset={() => onPatch({ soCount: null })} />
          <Stepper value={r.soCount} onChange={(n) => onPatch({ soCount: n === ruleCount ? null : n })} />
        </div>
        <div>
          <FieldLabel label="Keterangan Incentive" auto={r.incentive == null && row.incentive == null ? null : r.incentiveAuto} onReset={() => onPatch({ incentive: null })} />
          <Choice<RewardIncentive>
            options={[
              { value: 'dapat', label: 'Dapat' },
              { value: 'tidak', label: 'Tidak dapat' },
            ]}
            value={r.incentive}
            onChange={(v) => onPatch({ incentive: v === ruleIncentive ? null : v })}
          />
        </div>
        <div className="md:col-span-2 xl:col-span-1">
          <FieldLabel label="Regular Reward" auto={r.reward == null && row.reward == null ? null : r.rewardAuto} onReset={() => onPatch({ reward: null })} />
          <Choice<RewardChoice>
            options={[...REWARD_TIERS.map((t) => ({ value: t.key as RewardChoice, label: REWARD_CHOICE_LABEL[t.key] })), { value: 'none', label: REWARD_CHOICE_LABEL.none }]}
            value={r.reward}
            onChange={(v) => onPatch({ reward: v === ruleReward ? null : v })}
          />
        </div>
      </div>

      {(carriedFrom || warnings.length > 0) && (
        <div className="space-y-1 border-t border-slate-100 px-4 py-2.5">
          {carriedFrom && (
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" /> Tgl Masuk dan Tgl SO sebelumnya diambil dari Super Reward SO {shortDateId(carriedFrom)} — periksa lagi.
            </p>
          )}
          {warnings.map((w) => (
            <p key={w} className={cn('flex items-center gap-1.5 text-[11px] font-semibold', TONES.warning.strong)}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

function OutcomeChip({ reward, incentive }: { reward: RewardChoice | null; incentive: RewardIncentive | null }) {
  const tier = REWARD_TIERS.find((t) => t.key === reward);
  const [tone, text] = tier
    ? (['success', REWARD_CHOICE_LABEL[tier.key]] as const)
    : incentive === 'tidak' || reward === 'none'
      ? (['neutral', 'Tidak dapat'] as const)
      : (['warning', 'Belum lengkap'] as const);
  return <span className={cn('rounded-md border px-2 py-0.5 text-[11px] font-bold', TONES[tone].chip)}>{text}</span>;
}

// ─── Small inputs ────────────────────────────────────────────────────────────

const inputCls =
  'h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-base text-slate-900 shadow-xs outline-none placeholder:text-slate-300 focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:text-sm';

function AutoTagDemo() {
  return <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500">Otomatis</span>;
}

/** auto: true = follows the rule · false = picked by the auditor (tap = back to the rule) · null/undefined = no tag. */
function FieldLabel({ label, auto, onReset }: { label: string; auto?: boolean | null; onReset?: () => void }) {
  return (
    <div className="mb-1.5 flex min-h-5 items-center gap-1.5">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      {auto === true && <AutoTagDemo />}
      {auto === false && (
        <button
          type="button"
          onClick={onReset}
          title="Kembalikan ke otomatis"
          className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800 hover:bg-amber-200"
        >
          Diubah <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-h-10 rounded-lg border px-3 text-sm font-semibold transition',
              on ? 'border-amber-500 bg-amber-500 text-white shadow-xs' : 'border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:bg-amber-50',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function DateInput({ value, onChange, max, ariaLabel }: { value: string | null; onChange: (v: string | null) => void; max?: string; ariaLabel: string }) {
  return (
    <div className="relative">
      <input
        type="date"
        value={value ?? ''}
        max={max}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={ariaLabel}
        className={cn(inputCls, 'pr-9', !value && 'text-slate-400')}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label={`Kosongkan ${ariaLabel}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.min(Math.max(n, 0), SO_COUNT_MAX));
  return (
    <div className="flex h-10 w-[132px] items-center overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs">
      <button type="button" onClick={() => set(value - 1)} disabled={value <= 0} className="flex h-full w-10 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30" aria-label="Kurangi">
        <Minus className="h-4 w-4" />
      </button>
      <input
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => set(Number(e.target.value.replace(/\D/g, '') || 0))}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Jumlah SO"
        className="h-full min-w-0 flex-1 border-x border-slate-100 text-center text-base font-bold tabular-nums text-slate-900 outline-none sm:text-sm"
      />
      <button type="button" onClick={() => set(value + 1)} disabled={value >= SO_COUNT_MAX} className="flex h-full w-10 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30" aria-label="Tambah">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function SignerFields({ heading, name, title, onChange }: { heading: string; name: string; title: string; onChange: (name: string, title: string) => void }) {
  return (
    <fieldset className="min-w-0 space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-100">
      <legend className="sr-only">{heading}</legend>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{heading}</p>
      <input value={name} maxLength={SO_TEXT_MAX} onChange={(e) => onChange(e.target.value, title)} placeholder="Nama" aria-label={`${heading} — nama`} className={inputCls} />
      <input
        value={title}
        maxLength={SO_TEXT_MAX}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder="Jabatan (dicetak tebal + garis bawah)"
        aria-label={`${heading} — jabatan`}
        className={cn(inputCls, 'font-semibold')}
      />
    </fieldset>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  hint,
  hintTone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
  hintTone?: 'warning';
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
      <p className="flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-1 truncate text-lg font-extrabold tabular-nums text-slate-900 md:text-xl">{value}</p>
      {hint && <p className={cn('truncate text-[11px]', hintTone ? TONES[hintTone].strong : 'text-slate-400')}>{hint}</p>}
    </div>
  );
}
