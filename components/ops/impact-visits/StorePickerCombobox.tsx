'use client';
// components/ops/impact-visits/StorePickerCombobox.tsx
//
// Searchable store picker — in place of a plain <select>, so Ops can type a
// store's name or code to filter instead of scrolling a long list (impact
// visits will eventually cover 40+ stores). Same pattern as the
// StorePickerCombobox in app/ops/schedules/page.tsx.

import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Store as StoreIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface StoreOption { id: number; storeNo: string; name: string; }
export interface AreaGroupOption { id: number; name: string; stores: StoreOption[]; }

interface StorePickerComboboxProps {
  storeGroups: AreaGroupOption[];
  /** The currently selected value (a store id as a string, or an extraOption's value). */
  selectedValue: string;
  /** Label shown on the trigger button. Caller resolves this from selectedValue. */
  triggerLabel: string;
  onSelect: (value: string) => void;
  placeholder?: string;
  /** An optional non-store item pinned above the store groups, e.g. "All stores". */
  extraOption?: { value: string; label: string; icon?: ReactNode };
}

export default function StorePickerCombobox({
  storeGroups,
  selectedValue,
  triggerLabel,
  onSelect,
  placeholder = 'Select a store…',
  extraOption,
}: StorePickerComboboxProps) {
  const [open, setOpen] = useState(false);
  const grouped = storeGroups.length > 1;
  const flatStores = storeGroups.flatMap((g) => g.stores);

  const renderItem = (s: StoreOption) => (
    <CommandItem
      key={s.id}
      value={`${s.name} ${s.storeNo}`}
      onSelect={() => { onSelect(String(s.id)); setOpen(false); }}
      className="gap-2"
    >
      <StoreIcon className="h-3.5 w-3.5 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{s.name}</p>
        <p className="truncate text-[10px] text-slate-400">{s.storeNo}</p>
      </div>
      {selectedValue === String(s.id) && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-11 w-full justify-between gap-2 rounded-xl border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:border-indigo-300 hover:bg-white focus-visible:ring-2 focus-visible:ring-indigo-100"
        >
          <span className="flex min-w-0 items-center gap-2">
            <StoreIcon className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate">{triggerLabel || placeholder}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search store name or code…" />
          <CommandList>
            <CommandEmpty>No stores found.</CommandEmpty>
            {extraOption && (
              <CommandGroup>
                <CommandItem
                  value={extraOption.label}
                  onSelect={() => { onSelect(extraOption.value); setOpen(false); }}
                  className="gap-2"
                >
                  {extraOption.icon ?? <StoreIcon className="h-3.5 w-3.5 text-slate-400" />}
                  <span className="flex-1 text-sm font-semibold">{extraOption.label}</span>
                  {selectedValue === extraOption.value && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
                </CommandItem>
              </CommandGroup>
            )}
            {grouped ? (
              storeGroups.map((g) => (
                <CommandGroup key={g.id} heading={g.name}>
                  {g.stores.map(renderItem)}
                </CommandGroup>
              ))
            ) : (
              <CommandGroup>{flatStores.map(renderItem)}</CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
