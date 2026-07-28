// components/employee/MobileOnlyGuard.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Smartphone } from 'lucide-react';

interface Props {
  /**
   * PIC users have a real desktop area at /pic. Instead of getting stuck
   * behind the "mobile only" block screen, they get bounced there the
   * moment the viewport is desktop-sized — no need to shrink the window.
   * Everyone else keeps the exact previous behavior.
   */
  isPic?: boolean;
  /**
   * PIC explicitly asked to use the employee app right now (see
   * lib/pic-view.ts) — never block or redirect while this is on, on any
   * viewport size. The parent layout is responsible for actually showing
   * the mobile shell on desktop when this is true.
   */
  forceEmployeeView?: boolean;
}

export default function MobileOnlyGuard({ isPic = false, forceEmployeeView = false }: Props) {
  const router = useRouter();
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // Matches Tailwind's `md` breakpoint, same one this component's own
    // `md:flex` class uses below — keep these in sync.
    const mql = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (forceEmployeeView) return;
    if (isPic && isDesktop) router.replace('/pic');
  }, [isPic, isDesktop, forceEmployeeView, router]);

  // Explicit opt-in to the mobile app: never block, never redirect.
  if (forceEmployeeView) return null;

  // PIC + desktop: bouncing to /pic, render nothing so the block screen
  // never flashes for them.
  if (isPic && isDesktop) return null;

  // Everyone else: unchanged — a pure CSS block that only shows at md+.
  return (
    <div className="fixed inset-0 z-[9999] hidden md:flex flex-col items-center justify-center bg-foreground text-center px-10">
      <div className="mb-6 flex h-20 w-20 animate-bounce items-center justify-center rounded-2xl bg-primary/20">
        <Smartphone className="h-10 w-10 text-primary" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-background">Mobile Only</h1>
      <p className="mt-3 max-w-sm text-sm text-background/50 leading-relaxed">
        The employee portal is designed exclusively for mobile devices. Please open this page on
        your phone or tablet.
      </p>
      <div className="mt-8 flex items-center gap-2 rounded-full border border-background/20 px-5 py-2 text-xs text-background/40">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        Scan QR or open on mobile
      </div>
    </div>
  );
}
