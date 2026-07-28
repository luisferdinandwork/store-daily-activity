'use client';
// app/employee/knowledge/page.tsx
//
// Knowledge Manual — read-only list of store-operations manuals uploaded by
// Ops HO. Reached from the floating "More" menu (replaces the old dead
// "Help & FAQ" link). Secondary utility page, so it follows the same simple
// sticky back-button header convention as Petty Cash rather than the hero
// header used by the 6 primary bottom-nav pages.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  ChevronLeft,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';

type ManualRow = {
  id: string;
  title: string;
  description: string | null;
  fileUrl: string;
  fileType: string;
  createdAt: string;
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const SHEET_EXTS = new Set(['xls', 'xlsx']);

function fileIcon(fileType: string) {
  const ext = fileType.toLowerCase();
  if (IMAGE_EXTS.has(ext)) return { Icon: ImageIcon, color: 'text-sky-500', bg: 'bg-sky-50' };
  if (SHEET_EXTS.has(ext)) return { Icon: FileSpreadsheet, color: 'text-emerald-500', bg: 'bg-emerald-50' };
  return { Icon: FileText, color: 'text-rose-500', bg: 'bg-rose-50' };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function KnowledgeManualPage() {
  const [manuals, setManuals] = useState<ManualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/employee/manuals', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load manuals');
        setManuals(json.manuals);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load manuals');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="flex h-full flex-col bg-background pb-16">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/90 px-4 py-3.5 backdrop-blur">
        <Link
          href="/employee"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>

        <div>
          <p className="text-xs font-semibold text-muted-foreground">Store Operations</p>
          <p className="text-sm font-bold leading-none text-foreground">Knowledge Manual</p>
        </div>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-rose-500">{error}</p>
          </div>
        ) : manuals.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <BookOpen className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">No manuals yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Store manuals will appear here once uploaded.</p>
            </div>
          </div>
        ) : (
          manuals.map((m) => {
            const { Icon, color, bg } = fileIcon(m.fileType);
            return (
              <a
                key={m.id}
                href={m.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-sm transition-colors hover:bg-secondary/60 active:scale-[0.99]"
              >
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${bg}`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{m.title}</p>
                  {m.description && (
                    <p className="truncate text-xs text-muted-foreground">{m.description}</p>
                  )}
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/70">
                    <span className="uppercase">{m.fileType}</span>
                    <span>&middot;</span>
                    <span>{fmtDate(m.createdAt)}</span>
                  </p>
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground/50" />
              </a>
            );
          })
        )}
      </div>
    </div>
  );
}
