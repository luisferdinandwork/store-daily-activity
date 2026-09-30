'use client';
// components/shared/store-combobox.tsx
//
// Searchable store dropdown (shadcn Popover + Command): type a store code or part
// of the name, pick one. With `allLabel` an extra "all stores" row clears the
// selection (onChange(null)); without it a store is always required.

import { useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Search, Store } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface StoreComboboxOption {
  id: number;
  storeNo: string;
  name: string;
}

// Tailwind only sees whole class names, so each accent spells its classes out.
const ACCENTS = {
  cyan: {
    icon: 'bg-cyan-50 text-cyan-600',
    trigger: 'hover:border-cyan-300 focus-visible:border-cyan-400 focus-visible:ring-cyan-100',
    open: 'border-cyan-400 ring-cyan-100',
    code: 'text-cyan-700',
    item: 'data-[selected=true]:bg-cyan-50 data-[selected=true]:text-cyan-900',
    check: 'text-cyan-600',
  },
  emerald: {
    icon: 'bg-emerald-50 text-emerald-600',
    trigger: 'hover:border-emerald-300 focus-visible:border-emerald-400 focus-visible:ring-emerald-100',
    open: 'border-emerald-400 ring-emerald-100',
    code: 'text-emerald-700',
    item: 'data-[selected=true]:bg-emerald-50 data-[selected=true]:text-emerald-900',
    check: 'text-emerald-600',
  },
} as const;

export function StoreCombobox({
  stores,
  value,
  onChange,
  loading = false,
  allLabel,
  accent = 'cyan',
  className,
}: {
  stores: StoreComboboxOption[];
  /** Selected store id, or null for none / "all stores". */
  value: number | null;
  onChange: (id: number | null) => void;
  loading?: boolean;
  /** Adds an "all stores" row (e.g. "Semua toko") that selects null. */
  allLabel?: string;
  accent?: keyof typeof ACCENTS;
  /** Sizing of the trigger; defaults to full width up to `max-w-md`. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const a = ACCENTS[accent];
  const selected = value == null ? null : stores.find((s) => s.id === value) ?? null;

  function pick(id: number | null) {
    onChange(id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Pilih store"
          disabled={loading}
          className={cn(
            'group flex h-11 w-full max-w-md items-center gap-2.5 rounded-xl border bg-white px-3 text-left text-sm shadow-xs transition',
            'focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60',
            a.trigger,
            open ? a.open : 'border-slate-200',
            className,
          )}
        >
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', a.icon)}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {loading ? (
              <span className="text-slate-400">Memuat daftar store…</span>
            ) : selected ? (
              <>
                <span className={cn('font-mono text-xs font-semibold', a.code)}>{selected.storeNo}</span>
                <span className="ml-2 font-semibold text-slate-900">{selected.name}</span>
              </>
            ) : (
              <span className={allLabel ? 'font-semibold text-slate-700' : 'text-slate-400'}>
                {allLabel ?? 'Pilih store…'}
              </span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-slate-500" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-(--radix-popover-trigger-width) min-w-72 overflow-hidden rounded-xl border-slate-200 p-0 shadow-lg"
      >
        {/* Plain substring match — cmdk's default fuzzy scoring lets "daan" match unrelated names. */}
        <Command
          className="bg-white"
          filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder="Cari kode atau nama store…" className="h-11" />
          <CommandList className="max-h-72 p-1.5">
            <CommandEmpty>
              <Search className="mx-auto mb-1.5 h-5 w-5 text-slate-300" />
              <span className="text-slate-500">Store tidak ditemukan</span>
            </CommandEmpty>
            <CommandGroup className="p-0">
              {allLabel && (
                <CommandItem
                  value={allLabel}
                  onSelect={() => pick(null)}
                  className={cn('gap-3 rounded-lg px-2.5 py-2', a.item)}
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">{allLabel}</span>
                  {value == null && <Check className={cn('h-4 w-4 shrink-0', a.check)} />}
                </CommandItem>
              )}
              {stores.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.storeNo} ${s.name}`}
                  onSelect={() => pick(s.id)}
                  className={cn('gap-3 rounded-lg px-2.5 py-2', a.item)}
                >
                  <span className="w-16 shrink-0 font-mono text-xs font-semibold text-slate-500">{s.storeNo}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  {value === s.id && <Check className={cn('h-4 w-4 shrink-0', a.check)} />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-400">
            {stores.length} store tersedia
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
