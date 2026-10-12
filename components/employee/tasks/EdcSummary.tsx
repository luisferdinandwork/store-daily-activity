'use client';
// components/employee/tasks/EdcSummary.tsx
//
// Store Closing · EDC Summary. The store counts the day's money off each bank's
// EDC — one card per bank (BCA, Mandiri, BRI, OCBC, Indodana) with an amount per
// payment method (QRIS / Debit / Credit) — plus one OP/ME/VOUCHER amount. Indodana
// also needs a photo of its dashboard once it has an amount. The rules (banks,
// methods, what blocks a submit) live in lib/store-closing-edc.ts; this file is
// only the form. The page owns the state and the auto-save; each save carries
// every cell the page has edited so far, so a debounced patch can never drop an
// earlier edit.

import { Check, Landmark, LayoutDashboard } from 'lucide-react';
import { cn, formatRupiah } from '@/lib/utils';
import { Chip, FieldHint, PhotoRow, SummaryBox, SummaryStat } from '@/components/employee/ui';
import {
  EDC_BANKS,
  EDC_MAX_AMOUNT,
  EDC_METHODS,
  EDC_METHOD_LABELS,
  INDODANA_PHOTO_LABEL,
  OP_ME_VOUCHER_LABEL,
  edcCellKey,
  summariseEdc,
  type EdcBank,
  type EdcBankCode,
  type EdcEntryInput,
  type EdcEntryLike,
  type EdcMethod,
  type EdcSummary,
} from '@/lib/store-closing-edc';

// ─── Form state ──────────────────────────────────────────────────────────────

/** `${bank}:${method}` → the digits typed ('' = blank, '0' = counted as nothing). */
export type EdcAmountState = Record<string, string>;

const MAX_DIGITS = String(EDC_MAX_AMOUNT).length;

/** What a field may hold: digits only, no leading zeros, within the amount cap. */
export function cleanEdcDigits(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS);
}

export function edcDigitsToAmount(digits: string): number | null {
  return digits === '' ? null : Number(digits);
}

export function edcStateFromEntries(entries: readonly EdcEntryLike[] | null | undefined): EdcAmountState {
  const state: EdcAmountState = {};
  for (const e of entries ?? []) state[edcCellKey(e.bank, e.method)] = String(Number(e.amount));
  return state;
}

/**
 * The cells for the API, blank ones as `amount: null`. All cells by default (the
 * submit sends what is on screen); with `only`, just those keys — the auto-save
 * sends the cells this page has edited, so a colleague's figures typed on the
 * same shared closing since this page loaded are never blanked out.
 */
export function edcEntriesFromState(state: EdcAmountState, only?: ReadonlySet<string>): EdcEntryInput[] {
  return EDC_BANKS.flatMap((bank) =>
    bank.methods
      .filter((method) => !only || only.has(edcCellKey(bank.code, method)))
      .map((method) => ({
        bank: bank.code,
        method,
        amount: edcDigitsToAmount(state[edcCellKey(bank.code, method)] ?? ''),
      })),
  );
}

export function edcSummaryFromState(state: EdcAmountState, opMeVoucher: string): EdcSummary {
  return summariseEdc(
    edcEntriesFromState(state).filter((e): e is EdcEntryInput & { amount: number } => e.amount !== null),
    edcDigitsToAmount(opMeVoucher),
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function AmountInput({
  value, onChange, disabled, label,
}: {
  value: string;
  onChange: (digits: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
        Rp
      </span>
      <input
        inputMode="numeric"
        aria-label={label}
        disabled={disabled}
        value={value ? Number(value).toLocaleString('id-ID') : ''}
        onChange={(e) => onChange(cleanEdcDigits(e.target.value))}
        placeholder="0"
        className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-right text-base font-semibold tabular-nums outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-primary disabled:opacity-60"
      />
    </div>
  );
}

function BankCard({
  bank, state, subtotal, filled, onChange, onZero, indodanaPhoto, onPhotoClick, disabled,
}: {
  bank: EdcBank;
  state: EdcAmountState;
  subtotal: number;
  filled: boolean;
  onChange: (method: EdcMethod, digits: string) => void;
  onZero: () => void;
  indodanaPhoto: string | null;
  onPhotoClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
          <Landmark className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{bank.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {filled ? 'Subtotal' : 'Belum diisi'}
          </p>
        </div>
        {filled ? (
          <span className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-foreground">
            <Check className="h-3.5 w-3.5 text-green-600" strokeWidth={3} />
            {formatRupiah(subtotal)}
          </span>
        ) : (
          !disabled && (
            <button
              type="button"
              onClick={onZero}
              className="flex-shrink-0 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-opacity active:opacity-70"
            >
              Tidak ada transaksi
            </button>
          )
        )}
      </div>

      <div className="divide-y divide-border border-t border-border">
        {bank.methods.map((method) => (
          <div key={method} className="flex items-center gap-3 px-3.5 py-2">
            <span className="w-14 flex-shrink-0 text-sm text-muted-foreground">{EDC_METHOD_LABELS[method]}</span>
            <div className="min-w-0 flex-1">
              <AmountInput
                label={`${bank.label} ${EDC_METHOD_LABELS[method]}`}
                value={state[edcCellKey(bank.code, method)] ?? ''}
                onChange={(digits) => onChange(method, digits)}
                disabled={disabled}
              />
            </div>
          </div>
        ))}
      </div>

      {bank.dashboardPhoto && (
        <div className="border-t border-border">
          <PhotoRow
            title={INDODANA_PHOTO_LABEL}
            hint="Opsional — foto / screenshot dashboard Indodana hari ini"
            photo={indodanaPhoto}
            onClick={onPhotoClick}
            disabled={disabled}
            icon={<LayoutDashboard className="h-4 w-4" />}
          />
        </div>
      )}
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

export default function EdcSummaryFields({
  amounts, onAmountChange, onBankZero,
  opMeVoucher, onOpMeVoucherChange,
  indodanaPhoto, onIndodanaPhotoClick,
  disabled,
}: {
  amounts: EdcAmountState;
  onAmountChange: (bank: EdcBankCode, method: EdcMethod, digits: string) => void;
  /** "Tidak ada transaksi" — fills every method of the bank with 0. */
  onBankZero: (bank: EdcBankCode) => void;
  opMeVoucher: string;
  onOpMeVoucherChange: (digits: string) => void;
  indodanaPhoto: string | null;
  onIndodanaPhotoClick: () => void;
  disabled?: boolean;
}) {
  const summary = edcSummaryFromState(amounts, opMeVoucher);

  return (
    <div className="space-y-3">
      {EDC_BANKS.map((bank) => {
        const s = summary.banks.find((b) => b.code === bank.code)!;
        return (
          <BankCard
            key={bank.code}
            bank={bank}
            state={amounts}
            subtotal={s.total}
            filled={s.filled}
            onChange={(method, digits) => onAmountChange(bank.code, method, digits)}
            onZero={() => onBankZero(bank.code)}
            indodanaPhoto={indodanaPhoto}
            onPhotoClick={onIndodanaPhotoClick}
            disabled={disabled}
          />
        );
      })}

      <div className="rounded-xl border border-border bg-card px-3.5 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">{OP_ME_VOUCHER_LABEL}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Boleh dikosongkan</p>
          </div>
          {summary.opMeVoucher === null && <Chip tone="neutral">Belum diisi</Chip>}
        </div>
        <div className="mt-2.5">
          <AmountInput
            label={OP_ME_VOUCHER_LABEL}
            value={opMeVoucher}
            onChange={onOpMeVoucherChange}
            disabled={disabled}
          />
        </div>
      </div>

      <SummaryBox>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Total EDC (semua bank)</span>
          <span className="font-semibold tabular-nums text-foreground">{formatRupiah(summary.banksTotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{OP_ME_VOUCHER_LABEL}</span>
          <span className="font-semibold tabular-nums text-foreground">{formatRupiah(summary.opMeVoucher ?? 0)}</span>
        </div>
        <SummaryStat
          className={cn('border-t border-primary/15 pt-2.5')}
          label="Total"
          value={formatRupiah(summary.total)}
          emphasis
        />
        <FieldHint>
          {summary.missingBanks.length > 0
            ? `Belum diisi (boleh dikosongkan): ${summary.missingBanks.map((b) => b.label).join(', ')}`
            : 'Semua bank sudah dihitung.'}
        </FieldHint>
      </SummaryBox>
    </div>
  );
}

// ─── Confirmation table ──────────────────────────────────────────────────────

/**
 * The same bank × QRIS / Debit / Credit table Ops and Finance see, shown to the
 * employee before a "Post Statement" submit. Blank fields read as a dash.
 */
export function EdcConfirmTable({ summary, indodanaPhoto }: { summary: EdcSummary; indodanaPhoto: string | null }) {
  const th = 'px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground';
  const td = 'whitespace-nowrap px-2 py-1.5 text-right tabular-nums';
  const num = (n: number) => n.toLocaleString('id-ID');

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-secondary">
              <th className={cn(th, 'pl-3 text-left')}>Bank (Rp)</th>
              {EDC_METHODS.map((m) => <th key={m} className={th}>{EDC_METHOD_LABELS[m]}</th>)}
              <th className={cn(th, 'pr-3')}>Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {summary.banks.map((b) => (
              <tr key={b.code}>
                <td className="whitespace-nowrap py-1.5 pl-3 pr-2 font-semibold text-foreground">{b.label}</td>
                {EDC_METHODS.map((m) => (
                  <td key={m} className={cn(td, b.cells[m] === undefined ? 'text-muted-foreground/50' : 'text-foreground')}>
                    {b.cells[m] === undefined ? '–' : num(b.cells[m])}
                  </td>
                ))}
                <td className={cn(td, 'pr-3 font-bold', b.filled ? 'text-foreground' : 'text-muted-foreground/50')}>
                  {b.filled ? num(b.total) : '–'}
                </td>
              </tr>
            ))}
            <tr className="bg-secondary/60">
              <td colSpan={EDC_METHODS.length + 1} className="py-1.5 pl-3 pr-2 font-semibold text-foreground">{OP_ME_VOUCHER_LABEL}</td>
              <td className={cn(td, 'pr-3 font-bold')}>{summary.opMeVoucher === null ? '–' : num(summary.opMeVoucher)}</td>
            </tr>
            <tr className="bg-primary/5">
              <td colSpan={EDC_METHODS.length + 1} className="py-1.5 pl-3 pr-2 font-bold text-foreground">Total</td>
              <td className={cn(td, 'pr-3 font-bold text-foreground')}>{num(summary.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-0.5 text-[11px] text-muted-foreground">
        {INDODANA_PHOTO_LABEL}: {indodanaPhoto ? 'ada' : 'tidak dilampirkan'}
      </p>
    </div>
  );
}
