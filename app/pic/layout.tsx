// app/pic/layout.tsx
import { ReactNode } from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import PicShell from '@/components/pic/layout/PicShell';

export default async function PicLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const isPic =
    session.user.employeeType === 'pic_1' || session.user.employeeType === 'pic_2';

  // Not a PIC user — send them back to where they actually belong.
  if (!isPic) redirect('/employee');

  return <PicShell>{children}</PicShell>;
}
