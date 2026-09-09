// app/pic/settings/page.tsx
//
// PIC account settings — currently just self-service password change. PIC
// users share the `employee` role but run in the /pic shell, where
// /employee/settings isn't reachable on desktop, so they get their own copy.

import ChangePasswordCard from '@/components/shared/ChangePasswordCard';
import ProfilePictureCard from '@/components/shared/ProfilePictureCard';

export default function PicSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Profil &amp; Keamanan</h1>
      <p className="mt-1 text-sm text-muted-foreground">Kelola foto profil dan kata sandi akun Anda.</p>
      <div className="mt-6 space-y-6">
        <ProfilePictureCard />
        <ChangePasswordCard />
      </div>
    </div>
  );
}
