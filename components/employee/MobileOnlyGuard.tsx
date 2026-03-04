// components/employee/MobileOnlyGuard.tsx
'use client';

import { Smartphone } from 'lucide-react';

export default function MobileOnlyGuard() {
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