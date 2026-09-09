'use client';
// components/shared/UserAvatar.tsx
//
// Presentational user avatar: shows the profile picture when set, otherwise the
// person's initials. Thin wrapper over components/ui/avatar.tsx so every place
// that shows "who is this" (header button, profile hero, sidebar footers) reads
// the same.

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default function UserAvatar({
  src,
  name,
  className,
  fallbackClassName,
}: {
  src?: string | null;
  name?: string | null;
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Avatar className={cn('h-8 w-8', className)}>
      {src ? <AvatarImage src={src} alt={name ?? 'Profile picture'} className="object-cover" /> : null}
      <AvatarFallback className={cn('bg-secondary font-semibold text-secondary-foreground', fallbackClassName)}>
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}
