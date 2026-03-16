// components/employee/schedule/ImportScheduleButton.tsx
/**
 * Drop-in import button for the PIC 1 / OPS schedule page.
 *
 * Usage (in page.tsx):
 *   import { ImportScheduleButton } from '@/components/schedule/ImportScheduleButton';
 *
 *   <ImportScheduleButton storeId={storeId} onImported={load} />
 *
 * Props:
 *   storeId      – the store UUID (used as the DEFAULT mapping for PIC 1)
 *   storeMap     – optional explicit section-to-store mapping for OPS
 *                  e.g. { 'FF DMG': 'uuid-a', 'FO DMG': 'uuid-b' }
 *   onImported   – callback fired after a successful import (usually triggers a data reload)
 */

'use client';

import { useRef, useState } from 'react';
import {
  Upload, FileSpreadsheet, X, CheckCircle2,
  AlertCircle, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ImportResult {
  success:          boolean;
  schedulesCreated: number;
  skipped:          number;
  errors:           string[];
  notFound:         string[];
  month?:           string;
  sheet?:           string;
}

interface Props {
  storeId:    string;
  storeMap?:  Record<string, string>;
  onImported?: () => void;
}

export function ImportScheduleButton({ storeId, storeMap, onImported }: Props) {
  const inputRef              = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result,    setResult]    = useState<ImportResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  function handleClick() {
    setResult(null);
    inputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so re-uploading same file works
    e.target.value = '';

    setImporting(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (storeMap) {
        formData.append('storeMap', JSON.stringify(storeMap));
      }

      const res  = await fetch('/api/pic/schedule/import', {
        method: 'POST',
        body:   formData,
      });
      const json = await res.json() as ImportResult;
      setResult(json);

      if (json.success && json.schedulesCreated > 0) {
        toast.success(`Imported ${json.schedulesCreated} schedule entries`);
        onImported?.();
      } else if (json.schedulesCreated > 0) {
        toast.warning(`Imported with warnings — ${json.errors.length} error(s)`);
        onImported?.();
      } else if (!json.success) {
        toast.error('Import failed — see details below');
      } else {
        toast.info('No new schedules to import (all already exist)');
      }
    } catch (err) {
      toast.error('Network error during import');
      setResult({ success: false, schedulesCreated: 0, skipped: 0, errors: [String(err)], notFound: [] });
    } finally {
      setImporting(false);
    }
  }

  const hasWarnings = (result?.errors.length ?? 0) > 0 || (result?.notFound.length ?? 0) > 0;

  return (
    <div className="space-y-2">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFile}
      />

      {/* Trigger button */}
      <button
        type="button"
        onClick={handleClick}
        disabled={importing}
        className={cn(
          'flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 text-sm font-bold transition-all',
          importing
            ? 'cursor-not-allowed border-border bg-secondary text-muted-foreground'
            : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100 active:scale-[0.98]',
        )}
      >
        {importing
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</>
          : <><Upload className="h-4 w-4" /> Import Schedule (.xlsx)</>
        }
      </button>

      {/* Result card */}
      {result && (
        <div className={cn(
          'overflow-hidden rounded-2xl border text-sm',
          result.success && !hasWarnings
            ? 'border-emerald-200 bg-emerald-50'
            : hasWarnings
            ? 'border-amber-200 bg-amber-50'
            : 'border-red-200 bg-red-50',
        )}>
          {/* Summary row */}
          <div className="flex items-center gap-3 px-4 py-3">
            {result.success && !hasWarnings
              ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />
              : <AlertCircle  className="h-4 w-4 flex-shrink-0 text-amber-500"   />
            }
            <div className="flex-1 min-w-0">
              <p className={cn(
                'font-bold',
                result.success && !hasWarnings ? 'text-emerald-800'
                : hasWarnings ? 'text-amber-800' : 'text-red-800',
              )}>
                {result.success && !hasWarnings
                  ? 'Import successful'
                  : hasWarnings ? 'Imported with warnings' : 'Import failed'
                }
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {result.schedulesCreated} new entries
                {result.skipped > 0 && ` · ${result.skipped} skipped`}
                {result.sheet && ` · Sheet: ${result.sheet}`}
              </p>
            </div>
            {hasWarnings && (
              <button
                onClick={() => setShowErrors(v => !v)}
                className="flex items-center gap-1 text-[11px] font-semibold text-amber-700"
              >
                Details {showErrors ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
            <button
              onClick={() => setResult(null)}
              className="text-muted-foreground/50 hover:text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Expandable details */}
          {hasWarnings && showErrors && (
            <div className="border-t border-amber-200 bg-white/50 px-4 py-3 space-y-2">
              {result.notFound.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 mb-1">
                    Employees not found in database
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {result.notFound.map(name => (
                      <span key={name} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        {name}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Make sure the employee's name in the database matches the Excel exactly.
                  </p>
                </div>
              )}
              {result.errors.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-700 mb-1">
                    Errors ({result.errors.length})
                  </p>
                  <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-[11px] text-red-700 font-mono">{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Helper text */}
      {!result && !importing && (
        <div className="flex items-center gap-2 px-1">
          <FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40" />
          <p className="text-[10px] text-muted-foreground/60">
            Upload the monthly schedule Excel file. E = Morning · L = Evening · F/FULL = Both shifts.
          </p>
        </div>
      )}
    </div>
  );
}