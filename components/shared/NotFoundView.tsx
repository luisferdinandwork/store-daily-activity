'use client';
// components/shared/NotFoundView.tsx
//
// The one "page not found" screen. Rendered inside the employee shell by
// app/employee/not-found.tsx (header + bottom nav stay) and standalone by
// app/not-found.tsx for every other unknown URL. Mobile-first, centred.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Compass, Home } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function NotFoundView({
  homeHref = '/',
  homeLabel = 'Ke Beranda',
  className,
}: {
  homeHref?: string;
  homeLabel?: string;
  className?: string;
}) {
  const router = useRouter();

  function goBack() {
    // A direct hit (typed URL, stale bookmark) has no history to go back to.
    if (window.history.length > 1) router.back();
    else router.push(homeHref);
  }

  return (
    <div className={cn('mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="relative">
        <p
          aria-hidden="true"
          className="select-none bg-gradient-to-b from-primary/25 to-primary/0 bg-clip-text text-[7.5rem] font-black leading-none tracking-tighter text-transparent"
        >
          404
        </p>
        <div className="absolute inset-x-0 bottom-3 mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
          <Compass className="h-8 w-8" />
        </div>
      </div>

      <h1 className="mt-6 text-lg font-bold text-foreground">Halaman tidak ditemukan</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        Halaman yang kamu cari tidak ada, sudah dipindahkan, atau link-nya salah ketik.
      </p>

      <div className="mt-8 flex w-full flex-col gap-2">
        <Link
          href={homeHref}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          <Home className="h-4 w-4" />
          {homeLabel}
        </Link>
        <button
          type="button"
          onClick={goBack}
          className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold text-foreground transition-transform active:scale-[0.98]"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali
        </button>
      </div>
    </div>
  );
}
