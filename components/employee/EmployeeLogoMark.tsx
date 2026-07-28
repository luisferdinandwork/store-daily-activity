// components/employee/EmployeeLogoMark.tsx
// PRI brand mark ("PRi" icon + "PRESTASI RETAIL INNOVATION" wordmark) for
// panel headers/sidebars. The source file is a wide 16:9 horizontal lockup —
// size it by WIDTH (`className="w-28"` etc.), never by a small fixed height,
// or the wordmark shrinks to illegible mush. Height follows automatically.

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface EmployeeLogoMarkProps {
  /** 'white' for colored/dark hero backgrounds, 'color' for white backgrounds. */
  variant?: 'white' | 'color';
  /** Set a width (e.g. "w-28"); height is derived from the image's real 16:9 ratio. */
  className?: string;
}

export default function EmployeeLogoMark({ variant = 'white', className }: EmployeeLogoMarkProps) {
  const src = variant === 'white' ? '/logo/LogoPRI-white.png' : '/logo/LogoPRI.png';

  return (
    <Image
      src={src}
      alt="Prestasi Retail Innovation"
      width={160}
      height={90}
      className={cn('h-auto w-28 object-contain', className)}
    />
  );
}
