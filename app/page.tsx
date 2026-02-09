// app/page.tsx
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export default async function Home() {
  const session = await auth();

  if (!session) {
    redirect('/login');
  }

  // Redirect based on user role
  switch (session.user.role) {
    case 'employee':
      redirect('/employee');
    case 'ops':
      redirect('/ops');
    case 'finance':
      redirect('/finance');
    default:
      redirect('/login');
  }
}