// components/ops/task-period-filter.tsx
'use client';

import { CalendarDays, ChevronDown, Search } from 'lucide-react';

export type TaskMonitorPeriod = 'daily' | 'weekly' | 'monthly';

export interface TaskMonitorStoreOption {
  id: number;
  name: string;
}

interface TaskPeriodFilterProps {
  period: TaskMonitorPeriod;
  date: string;
  storeId: string;
  stores: TaskMonitorStoreOption[];
  search: string;
  onPeriodChange: (period: TaskMonitorPeriod) => void;
  onDateChange: (date: string) => void;
  onStoreChange: (storeId: string) => void;
  onSearchChange: (value: string) => void;
}

const PERIODS: Array<{ value: TaskMonitorPeriod; label: string; helper: string }> = [
  { value: 'daily', label: 'Daily', helper: '1 day' },
  { value: 'weekly', label: 'Weekly', helper: 'Mon-Sun' },
  { value: 'monthly', label: 'Monthly', helper: 'Full month' },
];

export function TaskPeriodFilter({
  period,
  date,
  storeId,
  stores,
  search,
  onPeriodChange,
  onDateChange,
  onStoreChange,
  onSearchChange,
}: TaskPeriodFilterProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_180px_220px_1fr]">
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1">
          {PERIODS.map((item) => {
            const active = period === item.value;

            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onPeriodChange(item.value)}
                className={[
                  'rounded-xl px-2 py-2 text-left transition',
                  active ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-white',
                ].join(' ')}
              >
                <span className="block text-xs font-bold sm:text-sm">{item.label}</span>
                <span className={['hidden text-[10px] sm:block', active ? 'text-slate-300' : 'text-slate-400'].join(' ')}>
                  {item.helper}
                </span>
              </button>
            );
          })}
        </div>

        <label className="relative block">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
          />
        </label>

        <label className="relative block">
          <select
            value={storeId}
            onChange={(e) => onStoreChange(e.target.value)}
            className="h-12 w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 pr-10 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
          >
            <option value="all">All stores</option>
            {stores.map((store) => (
              <option key={store.id} value={String(store.id)}>{store.name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </label>

        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search store or employee..."
            className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
          />
        </label>
      </div>
    </div>
  );
}
