'use client';

import { ArrowDownWideNarrow } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SORT_OPTIONS, type RequestSort } from '@/lib/employee-petty-cash-view';

const SORT_DESCRIPTION: Record<RequestSort, string> = {
  attention: 'Perlu perbaikan dan tindakan lebih dulu',
  newest: 'Request paling baru lebih dulu',
  oldest: 'Request paling lama lebih dulu',
  amount_desc: 'Nominal besar ke kecil',
  amount_asc: 'Nominal kecil ke besar',
};

export function PettyCashSortControl({
  value,
  onChange,
}: {
  value: RequestSort;
  onChange: (value: RequestSort) => void;
}) {
  const selected = SORT_OPTIONS.find((option) => option.key === value);

  return (
    <Select value={value} onValueChange={(next) => onChange(next as RequestSort)}>
      <SelectTrigger
        aria-label={`Urutkan request: ${selected?.label}`}
        className="w-full min-w-0 cursor-pointer rounded-xl border-border bg-background px-3 text-left shadow-none hover:bg-secondary/50 focus-visible:border-primary focus-visible:ring-primary/20 data-[size=default]:h-16"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowDownWideNarrow className="size-3.5" aria-hidden="true" />
            Urutkan
          </span>
          <span className="truncate text-sm font-semibold text-foreground">
            <SelectValue>{selected?.label}</SelectValue>
          </span>
        </span>
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="end"
        className="w-72 max-w-[calc(100vw-2rem)] rounded-2xl p-1 shadow-lg motion-reduce:animate-none"
      >
        <SelectGroup>
          <SelectLabel className="px-3 py-2">Urutkan request</SelectLabel>
          {SORT_OPTIONS.map((option) => (
            <SelectItem
              key={option.key}
              value={option.key}
              textValue={option.label}
              className="min-h-14 cursor-pointer rounded-xl py-2.5 pl-3 data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{option.label}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {SORT_DESCRIPTION[option.key]}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
