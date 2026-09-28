'use client';
// components/shared/ConfirmDialog.tsx
//
// A small confirmation modal to use instead of window.confirm() — for deletes
// (tone "danger") and bulk adds / other consequential actions ("primary").
// Controlled: the parent owns `open`, runs its action in `onConfirm`, and
// closes the dialog when it's done. While `busy`, the dialog can't be
// dismissed and the confirm button shows a spinner.

import type { ComponentType, ReactNode } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Batal',
  tone = 'primary',
  icon,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  /** Defaults to a trash can for "danger"; none for "primary". */
  icon?: ComponentType<{ className?: string }>;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const Icon = icon ?? (tone === 'danger' ? Trash2 : null);

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <AlertDialogContent className="max-w-md rounded-2xl">
        <AlertDialogHeader className="flex-row items-start gap-3 text-left sm:flex">
          {Icon && (
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                tone === 'danger' ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600',
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 space-y-1.5">
            <AlertDialogTitle className="text-base font-bold text-slate-900">{title}</AlertDialogTitle>
            {description && (
              <AlertDialogDescription asChild>
                <div className="text-sm text-slate-500">{description}</div>
              </AlertDialogDescription>
            )}
          </div>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          {/* A plain button (not AlertDialogAction) so the dialog stays open
              while the parent's async action runs. */}
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'gap-1.5',
              tone === 'danger'
                ? 'bg-rose-600 text-white hover:bg-rose-700'
                : 'bg-indigo-600 text-white hover:bg-indigo-500',
            )}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmDialog;
