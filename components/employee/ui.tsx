'use client';
// components/employee/ui.tsx
//
// Shared building blocks for the employee (mobile) app, lifted from the
// Setoran task page — the reference look: one calm column, uppercase section
// labels, grouped rows inside a single rounded border, h-12 inputs, soft
// primary summary box, bottom-sheet modals, and one tone scale for notices.
// Use these instead of re-styling the same things per page.

import { useEffect, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertCircle, AlertTriangle, Camera, Check, CheckCircle2, ChevronRight, Info, Loader2, X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import TaskHeader from '@/components/employee/tasks/TaskHeader';

// ─── Layout ──────────────────────────────────────────────────────────────────

/**
 * Page content column. `bottomBar` reserves room for a TaskSubmitBar (or any
 * other bar fixed above the bottom nav) so the last field is never covered.
 */
export function PageBody({
  children, className, bottomBar = false,
}: {
  children: ReactNode;
  className?: string;
  bottomBar?: boolean;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-md space-y-5 px-4 pt-4', bottomBar ? 'pb-36' : 'pb-8', className)}>
      {children}
    </div>
  );
}

export function SectionLabel({
  children, meta, action, className,
}: {
  children: ReactNode;
  /** Lower-case aside next to the label, e.g. "opsional" or "2/5". */
  meta?: ReactNode;
  /** Right-aligned slot, e.g. a small link button. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-2 flex items-center justify-between gap-2 px-0.5', className)}>
      <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
        {meta != null && <span className="ml-1 font-normal normal-case tracking-normal">{meta}</span>}
      </p>
      {action}
    </div>
  );
}

export function Section({
  title, meta, action, children, className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <SectionLabel meta={meta} action={action}>{title}</SectionLabel>
      {children}
    </section>
  );
}

/** Plain content card. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border border-border bg-card', className)}>{children}</div>;
}

/** Rows stacked inside one rounded border with hairline dividers (Setoran's photo list). */
export function ListGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('divide-y divide-border overflow-hidden rounded-xl border border-border bg-card', className)}>
      {children}
    </div>
  );
}

/** The soft primary box used for the headline numbers of a task. */
export function SummaryBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-2.5 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-4', className)}>
      {children}
    </div>
  );
}

export function SummaryStat({
  label, value, emphasis = false, className,
}: {
  label: ReactNode;
  value: ReactNode;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">{label}</p>
      <p className={cn('mt-0.5 font-bold tabular-nums', emphasis ? 'text-2xl text-foreground' : 'text-xl text-primary')}>
        {value}
      </p>
    </div>
  );
}

/** Label / value line inside a ListGroup or card. */
export function InfoRow({
  label, value, className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-3.5 py-3 text-sm', className)}>
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

// ─── Notices ─────────────────────────────────────────────────────────────────

export type Tone = 'error' | 'warning' | 'success' | 'info' | 'neutral';

const NOTICE_TONE: Record<Tone, { box: string; icon: string; title: string; body: string; action: string; Icon: LucideIcon }> = {
  error:   { box: 'border-red-200 bg-red-50',       icon: 'text-red-600',     title: 'text-red-700',     body: 'text-red-600',          action: 'bg-red-100 text-red-700',     Icon: AlertCircle },
  warning: { box: 'border-amber-200 bg-amber-50',   icon: 'text-amber-600',   title: 'text-amber-800',   body: 'text-amber-700',        action: 'bg-amber-100 text-amber-800', Icon: AlertTriangle },
  success: { box: 'border-green-200 bg-green-50',   icon: 'text-green-600',   title: 'text-green-800',   body: 'text-green-700',        action: 'bg-green-100 text-green-800', Icon: CheckCircle2 },
  info:    { box: 'border-primary/20 bg-primary/5', icon: 'text-primary',     title: 'text-foreground',  body: 'text-muted-foreground', action: 'bg-primary/10 text-primary',  Icon: Info },
  neutral: { box: 'border-border bg-secondary',     icon: 'text-muted-foreground', title: 'text-foreground', body: 'text-muted-foreground', action: 'bg-card text-foreground', Icon: Info },
};

export function Notice({
  tone = 'info', icon, title, children, onDismiss, action, className,
}: {
  tone?: Tone;
  icon?: ComponentType<{ className?: string }> | null;
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  action?: { label: string; onClick: () => void; icon?: ComponentType<{ className?: string }> };
  className?: string;
}) {
  const t = NOTICE_TONE[tone];
  const Icon = icon === null ? null : icon ?? t.Icon;
  const ActionIcon = action?.icon;
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-3', t.box, className)}>
      {Icon && <Icon className={cn('mt-0.5 h-4 w-4 flex-shrink-0', t.icon)} />}
      <div className="min-w-0 flex-1">
        {title && <p className={cn('text-xs font-bold', t.title)}>{title}</p>}
        {children && <div className={cn('text-xs leading-relaxed break-words', title && 'mt-0.5', t.body)}>{children}</div>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={cn('flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-opacity active:opacity-70', t.action)}
        >
          {ActionIcon && <ActionIcon className="h-3 w-3" />}
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Tutup" className={cn('flex-shrink-0 opacity-60 transition-opacity hover:opacity-100', t.icon)}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** The OPS review outcome shown at the top of every task: rejected note / verified stamp. */
export function TaskReviewNotices({
  status, notes, verifiedAt,
}: {
  status?: string | null;
  notes?: string | null;
  verifiedAt?: string | null;
}) {
  if (status === 'rejected' && notes) {
    return (
      <Notice tone="error" title="Ditolak oleh OPS">
        <p>{notes}</p>
        <p className="mt-1.5 font-semibold text-red-700">Perbaiki dan submit ulang.</p>
      </Notice>
    );
  }
  if (status === 'verified' && verifiedAt) {
    return (
      <Notice tone="success" title="Task telah diverifikasi">
        {new Date(verifiedAt).toLocaleString('id-ID', {
          day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })}
      </Notice>
    );
  }
  return null;
}

// ─── Chips ───────────────────────────────────────────────────────────────────

export type ChipTone = 'success' | 'warning' | 'danger' | 'primary' | 'neutral' | 'info';

const CHIP_TONE: Record<ChipTone, string> = {
  success: 'bg-green-50 text-green-700',
  warning: 'bg-amber-50 text-amber-700',
  danger:  'bg-red-50 text-red-700',
  primary: 'bg-primary/10 text-primary',
  info:    'bg-sky-50 text-sky-700',
  neutral: 'bg-secondary text-muted-foreground',
};

export function Chip({
  tone = 'neutral', icon: Icon, children, className,
}: {
  tone?: ChipTone;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', CHIP_TONE[tone], className)}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

// ─── Form fields ─────────────────────────────────────────────────────────────

/** Shared input look — 16px text so iOS Safari doesn't zoom in on focus. */
export const inputClass =
  'h-12 w-full rounded-xl border border-border bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:opacity-60';

export function FieldLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-0.5">
      <span className="text-xs font-medium text-muted-foreground">{children}</span>
      {action}
    </div>
  );
}

export function FieldHint({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <p className={cn('px-0.5 text-[11px]', error ? 'font-medium text-red-600' : 'text-muted-foreground')}>
      {children}
    </p>
  );
}

export function AmountField({
  label, value, onChange, onBlur, disabled, placeholder, error, hint, action,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  const formatted = value ? Number(value).toLocaleString('id-ID') : '';
  return (
    <div className="space-y-1.5">
      <FieldLabel
        action={action && (
          <button type="button" onClick={action.onClick} className="text-[11px] font-semibold text-primary hover:underline">
            {action.label}
          </button>
        )}
      >
        {label}
      </FieldLabel>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
          Rp
        </span>
        <input
          inputMode="numeric"
          disabled={disabled}
          value={formatted}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={onBlur}
          placeholder={placeholder}
          className={cn(inputClass, 'pl-10 pr-3 font-semibold tabular-nums', error && 'border-red-400 focus:border-red-500')}
        />
      </div>
      {error ? <FieldHint error>{error}</FieldHint> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

export function NotesField({
  label = 'Catatan', optional = true, value, onChange, onBlur, disabled, rows = 2,
  placeholder = 'Tambahkan catatan jika ada…',
}: {
  label?: string;
  optional?: boolean;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <Section title={label} meta={optional ? 'opsional' : undefined}>
      <textarea
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-none rounded-xl border border-border bg-secondary px-3.5 py-2.5 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
      />
    </Section>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

/**
 * One compact photo row (Setoran's) — thumbnail or icon, title, hint, and the
 * state chip on the right. `count`/`required` switch it to a multi-photo row
 * ("2/3 foto") that opens a photo modal instead of the camera.
 */
export function PhotoRow({
  title, hint, photo, count, required, onClick, disabled, loading, icon,
}: {
  title: string;
  hint?: string;
  photo?: string | null;
  count?: number;
  required?: number;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}) {
  const multi = count != null;
  const done = multi ? count >= (required ?? 1) : Boolean(photo);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 bg-card px-3.5 py-3 text-left transition active:bg-secondary disabled:opacity-60"
    >
      {photo ? (
        <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-background">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt={title} className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : icon ?? <Camera className="h-4 w-4" />}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {(hint || (!multi && photo)) && (
          <p className="mt-0.5 text-xs text-muted-foreground">{!multi && photo ? 'Tap untuk ganti' : hint}</p>
        )}
      </div>

      {multi ? (
        <Chip tone={done ? 'success' : count > 0 ? 'warning' : 'primary'} icon={done ? Check : Camera}>
          {count}/{required ?? 1}
        </Chip>
      ) : done ? (
        <Chip tone="success" icon={Check}>Ada</Chip>
      ) : (
        <Chip tone="primary" icon={Camera}>Foto</Chip>
      )}
    </button>
  );
}

/**
 * Multi-photo row: same header as PhotoRow, plus a strip of the uploaded
 * thumbnails underneath so people can see what they took without opening
 * the photo modal. Tapping anywhere opens the modal.
 */
export function PhotoSetRow({
  title, hint, photos, required, onClick, disabled, icon,
}: {
  title: string;
  hint?: string;
  photos: string[];
  required: number;
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const count = photos.length;
  const done = count >= required;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="block w-full bg-card px-3.5 py-3 text-left transition active:bg-secondary disabled:opacity-60"
    >
      <span className="flex items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
          {icon ?? <Camera className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
        </span>
        <Chip tone={done ? 'success' : count > 0 ? 'warning' : 'primary'} icon={done ? Check : Camera}>
          {count}/{required}
        </Chip>
      </span>

      {count > 0 && (
        <span className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
          {photos.map((url, i) => (
            <span key={`${url}-${i}`} className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-secondary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`${title} ${i + 1}`} className="h-full w-full object-cover" />
              <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 text-[9px] font-bold leading-4 text-white">{i + 1}</span>
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

/** Tappable checklist row for use inside a ListGroup. */
export function CheckRow({
  label, hint, checked, onToggle, disabled, trailing, warn = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
  /** Amber state — checked but still missing something (e.g. photos). */
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onToggle(); }}
      disabled={disabled}
      aria-pressed={checked}
      className={cn(
        'flex w-full items-center gap-3 px-3.5 py-3.5 text-left transition active:bg-secondary disabled:opacity-60',
        warn ? 'bg-amber-50' : checked ? 'bg-primary/[0.03]' : 'bg-card',
      )}
    >
      <span
        className={cn(
          'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          warn ? 'border-amber-400 bg-amber-100' : checked ? 'border-primary bg-primary' : 'border-border bg-background',
        )}
      >
        {checked && !warn && <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {hint && (
          <span className={cn('mt-0.5 block text-xs', warn ? 'font-medium text-amber-700' : 'text-muted-foreground')}>
            {hint}
          </span>
        )}
      </span>
      {trailing}
    </button>
  );
}

/**
 * Checklist row that is ticked by adding photos in a modal (Log-in POS, 5R…).
 * Amber while it's marked but still short of the required photos.
 */
export function PhotoCheckRow({
  label, hint, checked, photoCount, requiredCount, onClick, disabled,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  photoCount: number;
  requiredCount: number;
  onClick: () => void;
  disabled?: boolean;
}) {
  const needsMore = checked && photoCount < requiredCount;
  return (
    <CheckRow
      label={label}
      hint={hint}
      checked={checked && !needsMore}
      warn={needsMore}
      onToggle={onClick}
      disabled={disabled}
      trailing={
        <Chip
          tone={photoCount === 0 ? 'neutral' : photoCount >= requiredCount ? 'success' : 'warning'}
          icon={Camera}
        >
          {photoCount}/{requiredCount}
        </Chip>
      }
    />
  );
}

/** Link row with icon tile + chevron — menus and quick actions. */
export function NavRow({
  href, onClick, icon: Icon, iconClassName, title, description, trailing,
}: {
  href?: string;
  onClick?: () => void;
  icon: ComponentType<{ className?: string }>;
  iconClassName?: string;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
}) {
  const inner = (
    <>
      <span className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-primary', iconClassName)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
      {trailing}
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/60" />
    </>
  );
  const cls = 'flex w-full items-center gap-3 bg-card px-3.5 py-3 text-left transition active:bg-secondary';
  return href
    ? <Link href={href} className={cls}>{inner}</Link>
    : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

// ─── Segmented control ───────────────────────────────────────────────────────

export function Segmented<T extends string>({
  options, value, onChange, className,
}: {
  options: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-1 rounded-xl bg-secondary p-1', className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-all',
              active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            <span className="truncate">{o.label}</span>
            {o.count != null && o.count > 0 && (
              <span className={cn('rounded-full px-1.5 text-[10px] font-bold', active ? 'bg-primary text-primary-foreground' : 'bg-border text-muted-foreground')}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

const BUTTON_VARIANT = {
  primary:   'bg-primary text-primary-foreground font-bold',
  secondary: 'border border-border bg-card text-foreground font-semibold',
  soft:      'bg-primary/10 text-primary font-semibold',
  danger:    'bg-red-600 text-white font-bold',
} as const;

export function ActionButton({
  variant = 'primary', loading, icon: Icon, children, className, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANT;
  loading?: boolean;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm transition-all active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        BUTTON_VARIANT[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

// ─── Bottom sheet ────────────────────────────────────────────────────────────

/**
 * Setoran's modal: slides up from the bottom on phones (grab handle, rounded
 * top), centred card on wider screens. Body scrolls; footer stays put and
 * clears the iPhone home indicator.
 */
export function BottomSheet({
  open, onClose, title, description, children, footer, dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** false while a request is in flight — backdrop / X won't close it. */
  dismissible?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissible) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center"
      onClick={() => { if (dismissible) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative flex max-h-[90dvh] w-full flex-col rounded-t-3xl bg-background shadow-2xl sm:mx-2 sm:max-w-sm sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pb-1 pt-3 sm:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        <div className="flex items-start justify-between gap-3 border-b border-border px-5 pb-4 pt-2 sm:pt-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold leading-snug text-foreground">{title}</h3>
            {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
              aria-label="Tutup"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {children != null && <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">{children}</div>}

        {footer && (
          <div
            className="flex gap-2 border-t border-border px-5 pt-3"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Loading / empty ─────────────────────────────────────────────────────────

export function SkeletonBlocks({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Memuat">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn('h-20 animate-pulse rounded-2xl bg-secondary', className)} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Info, title, description, action, className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary">
        <Icon className="h-6 w-6" />
      </div>
      <p className="mt-4 text-sm font-bold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Whole-page loading state for a task detail page (header + skeletons). */
export function TaskLoadingScreen({ title }: { title: string }) {
  return (
    <>
      <TaskHeader title={title} />
      <PageBody>
        <SkeletonBlocks count={4} />
      </PageBody>
    </>
  );
}

/** Whole-page "can't load / not found" state for a task detail page. */
export function TaskMissingScreen({ title, message }: { title: string; message?: string | null }) {
  return (
    <>
      <TaskHeader title={title} />
      <PageBody>
        <EmptyState
          icon={AlertCircle}
          title="Task tidak ditemukan"
          description={message ?? 'Task ini mungkin sudah tidak tersedia untuk jadwalmu hari ini.'}
          action={
            <Link href="/employee/tasks" className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">
              Kembali ke daftar task
            </Link>
          }
        />
      </PageBody>
    </>
  );
}
