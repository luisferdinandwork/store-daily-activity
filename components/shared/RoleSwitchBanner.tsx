'use client';
// components/shared/RoleSwitchBanner.tsx
//
// Two related cases, both surfaced here:
//
//   1. An IT user REALLY switched their own role (via /it/switch-role) to
//      preview another role — `switchedFromRoleId` is set on the session.
//      Shows "Previewing as X — Return to IT", which calls the switch-role
//      API's `return` action (a real DB change back) before redirecting.
//
//   2. An IT user is simply BROWSING an ops/finance/audit page directly
//      (e.g. a link from the IT dashboard) — their role is still 'it', no
//      DB change happened, so there's nothing to "return" from. Without
//      this, they'd land on e.g. /ops with no way back except the browser
//      back button. Shows a plain "Back to IT" link instead.

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

export default function RoleSwitchBanner() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [submitting, setSubmitting] = useState(false);

  const role = (session?.user as any)?.role as string | undefined;
  const switchedFromRoleLabel = (session?.user as any)?.switchedFromRoleLabel as string | null | undefined;
  const switchedFromRoleId = (session?.user as any)?.switchedFromRoleId as number | null | undefined;

  async function handleReturn() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/it/switch-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'return' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Failed to return to IT.');

      await update();
      toast.success('Back to IT.');
      router.push(data.redirectTo ?? '/it');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to return to IT.');
    } finally {
      setSubmitting(false);
    }
  }

  // Case 1: really switched — offer the real "return" action.
  if (switchedFromRoleId) {
    return (
      <div className="flex items-center justify-between gap-3 bg-cyan-700 px-4 py-2 text-white">
        <p className="text-xs font-semibold">
          Previewing as this role{switchedFromRoleLabel ? ` — real role: ${switchedFromRoleLabel}` : ''}
        </p>
        <button
          onClick={handleReturn}
          disabled={submitting}
          className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold transition-colors hover:bg-white/20 disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
          Return to IT
        </button>
      </div>
    );
  }

  // Case 2: still literally 'it', just browsing another role's pages — plain nav link.
  if (role === 'it' && !pathname?.startsWith('/it')) {
    return (
      <div className="flex items-center justify-between gap-3 bg-cyan-700 px-4 py-2 text-white">
        <p className="text-xs font-semibold">Viewing as IT</p>
        <Link
          href="/it"
          className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold transition-colors hover:bg-white/20"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to IT dashboard
        </Link>
      </div>
    );
  }

  return null;
}
