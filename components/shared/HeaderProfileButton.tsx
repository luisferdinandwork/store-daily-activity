'use client';
// components/shared/HeaderProfileButton.tsx
//
// Round avatar button that sits in every panel's top bar, beside the
// notification bell. Clicking it opens that role's account page (profile
// picture + password).

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { accountPathForRole } from '@/lib/account-paths';
import UserAvatar from './UserAvatar';

export default function HeaderProfileButton({
  className,
  avatarClassName,
  fallbackClassName,
}: {
  className?: string;
  avatarClassName?: string;
  fallbackClassName?: string;
}) {
  const { data: session } = useSession();
  const pathname = usePathname();

  const user = session?.user;
  if (!user) return null;

  const href = accountPathForRole(user.role, { pic: pathname?.startsWith('/pic') });

  return (
    <Link
      href={href}
      aria-label="Profil saya"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full ring-offset-background transition-transform hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95',
        className,
      )}
    >
      <UserAvatar
        src={user.image}
        name={user.name}
        className={cn('h-8 w-8 border border-border', avatarClassName)}
        fallbackClassName={fallbackClassName}
      />
    </Link>
  );
}
