'use client';
// components/issues/IssueInbox.tsx
//
// The list part of the Ops and Finance issue pages: a search / filter / sort bar,
// status chips with counts, and the issues as a plain table (cards when the
// container is narrow — phones, or a tight Ops column). Everything is done on the
// list the page already loaded; paging is 25 rows at a time. The page owns the
// data, the drawer and the status change — this only draws and narrows the list.

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Paperclip,
  Search,
  SearchX,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  DEFAULT_FILTERS,
  INBOX_STATUSES,
  PERIOD_OPTIONS,
  SORT_OPTIONS,
  applyScopeFilters,
  areaOptions,
  countByStatus,
  defaultSortDir,
  fmtIssueDate,
  hasActiveFilters,
  inboxStatusLabel,
  issueRef,
  relativeTime,
  sortDirLabel,
  sortIssues,
  storeOptions,
  type InboxFilters,
  type InboxIssue,
  type InboxStatus,
  type PeriodKey,
  type SortDir,
  type SortKey,
} from '@/lib/issue-inbox';
import { STATUS_CFG, StatusBadge, THEME, type InboxTheme } from './shared';

const PAGE_SIZE = 25;

const CHIP_DOT: Record<InboxStatus, string> = {
  reported: 'bg-amber-500',
  in_review: 'bg-blue-500',
  solved: 'bg-violet-500',
  completed: 'bg-emerald-500',
};

// ─── Controls ────────────────────────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  onChange,
  active,
  theme,
  className,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  active: boolean;
  theme: InboxTheme;
  className?: string;
  children: React.ReactNode;
}) {
  const t = THEME[theme];
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          // 16px on phones — iOS zooms into anything smaller.
          'h-10 w-full appearance-none truncate rounded-lg border pl-3 pr-8 text-base font-medium focus:outline-none focus:ring-2 md:text-sm',
          t.focus,
          active ? t.selectOn : 'border-slate-200 bg-white text-slate-700',
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  theme,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  theme: InboxTheme;
  className?: string;
}) {
  const on = sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-3 py-2.5 text-left', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'group inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide',
          on ? THEME[theme].thSortOn : 'text-slate-500 hover:text-slate-800',
        )}
      >
        {label}
        {on ? (
          sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3 opacity-0 group-hover:opacity-40" />
        )}
      </button>
    </th>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

const photoCount = (i: InboxIssue) => i.attachmentUrls.length + i.baAttachmentUrls.length;

function IssueTableRow({
  issue,
  showArea,
  selected,
  theme,
  onOpen,
}: {
  issue: InboxIssue;
  showArea: boolean;
  selected: boolean;
  theme: InboxTheme;
  onOpen: () => void;
}) {
  const t = THEME[theme];
  const waiting = STATUS_CFG[issue.status].waiting;
  const photos = photoCount(issue);

  return (
    <tr
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      aria-label={`Open issue ${issueRef(issue.id)}: ${issue.title}`}
      className={cn(
        'cursor-pointer border-b border-slate-100 outline-none transition-colors last:border-b-0 focus-visible:bg-slate-50',
        selected ? t.rowOn : t.rowHover,
      )}
    >
      <td className="hidden px-3 py-2.5 align-top font-mono text-xs text-slate-400 @5xl:table-cell">{issueRef(issue.id)}</td>

      <td className="px-3 py-2.5 align-top">
        <p className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-slate-900">{issue.title}</span>
          {photos > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-slate-400" title={`${photos} attachment${photos === 1 ? '' : 's'}`}>
              <Paperclip className="h-3 w-3" />
              {photos}
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{issue.description}</p>
        {/* Below @5xl the Ref + Reporter columns fold into this line */}
        <p className="mt-0.5 truncate text-[11px] text-slate-400 @5xl:hidden">
          #{issueRef(issue.id)} · {issue.reporter.name}
        </p>
      </td>

      <td className="px-3 py-2.5 align-top">
        <p className="truncate text-sm text-slate-800">{issue.store.name}</p>
        {showArea && <p className="truncate text-[11px] text-slate-400">{issue.store.areaName ?? '—'}</p>}
      </td>

      <td className="hidden px-3 py-2.5 align-top @5xl:table-cell">
        <p className="truncate text-sm text-slate-800">{issue.reporter.name}</p>
        <p className="truncate font-mono text-[11px] text-slate-400">{issue.reporter.nik}</p>
      </td>

      <td className="px-3 py-2.5 align-top">
        <StatusBadge status={issue.status} />
        {waiting && <p className="mt-0.5 truncate text-[11px] text-slate-400">{waiting}</p>}
      </td>

      <td className="px-3 py-2.5 align-top">
        <p className="whitespace-nowrap text-sm text-slate-700">{fmtIssueDate(issue.createdAt)}</p>
        <p className="text-[11px] text-slate-400">{relativeTime(issue.createdAt)}</p>
      </td>
    </tr>
  );
}

function IssueCard({
  issue,
  showArea,
  onOpen,
}: {
  issue: InboxIssue;
  showArea: boolean;
  onOpen: () => void;
}) {
  const waiting = STATUS_CFG[issue.status].waiting;
  const photos = photoCount(issue);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-1.5 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 active:bg-slate-50"
    >
      <span className="flex items-center justify-between gap-2">
        <StatusBadge status={issue.status} />
        <span className="text-[11px] text-slate-400">{relativeTime(issue.createdAt)}</span>
      </span>
      <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-slate-900">{issue.title}</span>
      <span className="line-clamp-1 text-xs text-slate-500">{issue.description}</span>
      <span className="truncate text-[11px] text-slate-500">
        <span className="font-medium text-slate-700">{issue.store.name}</span>
        {showArea && issue.store.areaName && <> · {issue.store.areaName}</>}
      </span>
      <span className="flex items-center gap-1.5 truncate text-[11px] text-slate-400">
        <span className="truncate">{issue.reporter.name}</span>
        <span className="font-mono">#{issueRef(issue.id)}</span>
        {photos > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5">
            <Paperclip className="h-3 w-3" />
            {photos}
          </span>
        )}
      </span>
      {waiting && <span className="text-[11px] font-semibold" style={{ color: STATUS_CFG[issue.status].accent }}>{waiting} ›</span>}
    </button>
  );
}

// ─── Inbox ───────────────────────────────────────────────────────────────────

export function IssueInbox({
  issues,
  loading,
  theme,
  showArea,
  selectedId,
  onSelect,
  emptyHint,
}: {
  issues: InboxIssue[];
  loading: boolean;
  theme: InboxTheme;
  /** Show the Area column + area filter (Ops HO and Finance see every area). */
  showArea: boolean;
  selectedId?: string | null;
  onSelect: (issue: InboxIssue) => void;
  /** Shown when nothing is routed to this panel at all. */
  emptyHint: string;
}) {
  const t = THEME[theme];
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'created', dir: 'desc' });
  const [page, setPage] = useState(1);

  const patch = (next: Partial<InboxFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPage(1);
  };
  const changeSort = (key: SortKey, dir?: SortDir) => {
    setSort((s) => ({ key, dir: dir ?? (s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : defaultSortDir(key)) }));
    setPage(1);
  };

  const stores = useMemo(() => storeOptions(issues), [issues]);
  const areas = useMemo(() => areaOptions(issues), [issues]);

  // Stores narrow to the chosen area, so the two pickers never contradict.
  const storeChoices = useMemo(
    () => (filters.areaId === 'all' ? stores : stores.filter((s) => issues.some((i) => i.store.id === s.id && (i.store.areaId ?? '') === filters.areaId))),
    [stores, issues, filters.areaId],
  );

  const scoped = useMemo(() => applyScopeFilters(issues, filters), [issues, filters]);
  const counts = useMemo(() => countByStatus(scoped), [scoped]);
  const visible = useMemo(
    () => sortIssues(filters.status === 'all' ? scoped : scoped.filter((i) => i.status === filters.status), sort.key, sort.dir),
    [scoped, filters.status, sort],
  );

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const rows = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const first = visible.length === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const last = (current - 1) * PAGE_SIZE + rows.length;

  const narrowed = hasActiveFilters(filters) || filters.status !== 'all';
  const clearAll = () => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  };

  const chips: { key: InboxStatus | 'all'; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    ...INBOX_STATUSES.map((s) => ({ key: s, label: inboxStatusLabel(s), count: counts[s] })),
  ];

  return (
    <div className="@container space-y-3">
      {/* Search + filters + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-full flex-1 @3xl:min-w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
            placeholder="Search title, description, reporter, store or issue no.…"
            aria-label="Search issues"
            className={cn(
              'h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 md:text-sm',
              t.focus,
            )}
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => patch({ search: '' })}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-slate-300 hover:text-slate-500"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="grid w-full grid-cols-2 gap-2 @3xl:flex @3xl:w-auto @3xl:flex-wrap">
          {showArea && areas.length > 1 && (
            <FilterSelect
              label="Filter by area"
              value={filters.areaId}
              onChange={(v) => patch({ areaId: v, storeId: 'all' })}
              active={filters.areaId !== 'all'}
              theme={theme}
              className="@3xl:w-44"
            >
              <option value="all">All areas</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </FilterSelect>
          )}
          {storeChoices.length > 1 && (
            <FilterSelect
              label="Filter by store"
              value={filters.storeId}
              onChange={(v) => patch({ storeId: v })}
              active={filters.storeId !== 'all'}
              theme={theme}
              className="@3xl:w-48"
            >
              <option value="all">All stores</option>
              {storeChoices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </FilterSelect>
          )}
          <FilterSelect
            label="Filter by period"
            value={filters.period}
            onChange={(v) => patch({ period: v as PeriodKey })}
            active={filters.period !== 'all'}
            theme={theme}
            className="@3xl:w-36"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </FilterSelect>
          <div className="flex min-w-0 gap-2">
            <FilterSelect
              label="Sort by"
              value={sort.key}
              onChange={(v) => changeSort(v as SortKey, defaultSortDir(v as SortKey))}
              active={false}
              theme={theme}
              className="flex-1 @3xl:w-44 @3xl:flex-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>Sort: {o.label}</option>
              ))}
            </FilterSelect>
            <button
              type="button"
              onClick={() => changeSort(sort.key)}
              title={`${sortDirLabel(sort.key, sort.dir)} — click to reverse`}
              aria-label={`${sortDirLabel(sort.key, sort.dir)} — reverse the order`}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 @3xl:w-auto @3xl:px-3"
            >
              {sort.dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5 shrink-0" /> : <ArrowDown className="h-3.5 w-3.5 shrink-0" />}
              <span className="hidden whitespace-nowrap @3xl:inline">{sortDirLabel(sort.key, sort.dir)}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Status chips */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] @3xl:mx-0 @3xl:flex-wrap @3xl:px-0 [&::-webkit-scrollbar]:hidden">
        {chips.map((c) => {
          const on = filters.status === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => patch({ status: c.key })}
              aria-pressed={on}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors @3xl:h-8',
                on ? t.chipOn : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50',
              )}
            >
              {c.key !== 'all' && <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-white/80' : CHIP_DOT[c.key])} />}
              {c.label}
              <span className={cn('rounded-full px-1.5 text-[10px] font-bold tabular-nums', on ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>
                {c.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Result line */}
      {!loading && issues.length > 0 && (
        <p className="flex items-center gap-3 text-xs text-slate-500">
          <span>
            <span className="font-semibold tabular-nums text-slate-700">{visible.length}</span> of{' '}
            <span className="tabular-nums">{issues.length}</span> issue{issues.length === 1 ? '' : 's'}
          </span>
          {narrowed && (
            <button type="button" onClick={clearAll} className={cn('font-semibold underline', t.link)}>
              Clear filters
            </button>
          )}
        </p>
      )}

      {/* List */}
      {loading ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse border-b border-slate-100 bg-white last:border-b-0 even:bg-slate-50/60" />
          ))}
          <span className="sr-only"><Loader2 className="animate-spin" /> Loading issues</span>
        </div>
      ) : issues.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">No issues to show</p>
          <p className="mt-1 text-xs text-slate-400">{emptyHint}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <SearchX className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">No issues match</p>
          <p className="mt-1 text-xs text-slate-400">Try a different search or loosen a filter.</p>
          <button type="button" onClick={clearAll} className={cn('mt-3 text-xs font-semibold underline', t.link)}>
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            {/* Narrow container: cards */}
            <div className="@3xl:hidden">
              {rows.map((issue) => (
                <IssueCard key={issue.id} issue={issue} showArea={showArea} onOpen={() => onSelect(issue)} />
              ))}
            </div>

            {/* Wide container: table */}
            <table className="hidden w-full table-fixed border-collapse @3xl:table">
              <colgroup>
                <col className="hidden @5xl:table-column" style={{ width: 80 }} />
                <col />
                <col style={{ width: '20%' }} />
                <col className="hidden @5xl:table-column" style={{ width: '15%' }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 130 }} />
              </colgroup>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <SortableTh label="Ref" sortKey="ref" sort={sort} onSort={changeSort} theme={theme} className="hidden @5xl:table-cell" />
                  <SortableTh label="Issue" sortKey="title" sort={sort} onSort={changeSort} theme={theme} />
                  <SortableTh label="Store" sortKey="store" sort={sort} onSort={changeSort} theme={theme} />
                  <SortableTh label="Reporter" sortKey="reporter" sort={sort} onSort={changeSort} theme={theme} className="hidden @5xl:table-cell" />
                  <SortableTh label="Status" sortKey="status" sort={sort} onSort={changeSort} theme={theme} />
                  <SortableTh label="Reported" sortKey="created" sort={sort} onSort={changeSort} theme={theme} />
                </tr>
              </thead>
              <tbody>
                {rows.map((issue) => (
                  <IssueTableRow
                    key={issue.id}
                    issue={issue}
                    showArea={showArea}
                    selected={selectedId === issue.id}
                    theme={theme}
                    onOpen={() => onSelect(issue)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pager */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <p>
              Showing <span className="font-semibold tabular-nums">{first}–{last}</span> of{' '}
              <span className="font-semibold tabular-nums">{visible.length}</span>
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(1, current - 1))}
                  disabled={current <= 1}
                  aria-label="Previous page"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-16 text-center font-semibold tabular-nums">
                  {current} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(Math.min(totalPages, current + 1))}
                  disabled={current >= totalPages}
                  aria-label="Next page"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
