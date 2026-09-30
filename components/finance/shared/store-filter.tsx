'use client';
// components/finance/shared/store-filter.tsx
//
// Searchable store dropdown for Finance's filter bars: type a store code or
// part of the name, pick one — or "Semua toko" to clear it.

import { useState } from 'react';
import { Check, ChevronsUpDown, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

export interface StoreOption {
  id: number;
  storeNo: string;
  name: string;
}

const ITEM =
  'data-[selected=true]:bg-emerald-50 data-[selected=true]:text-emerald-800';

export function StoreFilter({
  stores,
  value,
  onChange,
}: {
  stores: StoreOption[];
  /** Selected store id, or null for every store. */
  value: number | null;
  onChange: (storeId: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
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
          aria-label="Filter toko"
          className={cn(
            'inline-flex h-9 w-64 items-center gap-2 rounded-md border bg-white px-3 text-sm hover:bg-slate-50',
            selected ? 'border-emerald-600 text-slate-900' : 'border-slate-300 text-slate-600',
          )}
        >
          <Store className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="flex-1 truncate text-left">
            {selected ? (
              <>
                <span className="font-mono text-xs font-semibold text-slate-500">{selected.storeNo}</span>{' '}
                {selected.name}
              </>
            ) : (
              'Semua toko'
            )}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" sideOffset={6} className="w-80 p-0">
        {/* Plain substring match — cmdk's default fuzzy scoring lets "daan" match unrelated names. */}
        <Command filter={(value, search) => (value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Cari kode / nama toko…" />
          <CommandList>
            <CommandEmpty>Toko tidak ditemukan.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="semua toko" onSelect={() => pick(null)} className={ITEM}>
                <span className="flex-1 font-medium">Semua toko</span>
                {value == null && <Check className="h-4 w-4 text-emerald-600" />}
              </CommandItem>
              {stores.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.storeNo} ${s.name}`}
                  onSelect={() => pick(s.id)}
                  className={ITEM}
                >
                  <span className="w-16 shrink-0 font-mono text-xs font-semibold text-slate-500">{s.storeNo}</span>
                  <span className="flex-1 truncate">{s.name}</span>
                  {value === s.id && <Check className="h-4 w-4 text-emerald-600" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
