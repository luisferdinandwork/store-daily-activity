// app/pic/settings/page.tsx
//
// PIC account settings — currently just self-service password change. PIC
// users share the `employee` role but run in the /pic shell, where
// /employee/settings isn't reachable on desktop, so they get their own copy.

import ChangePasswordCard from '@/components/shared/ChangePasswordCard';
import ProfilePictureCard from '@/components/shared/ProfilePictureCard';
import PanelPageHeader from '@/components/shared/PanelPageHeader';

export default function PicSettingsPage() {
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <PanelPageHeader scope="PIC" title="Profil & Keamanan" subtitle="Kelola foto profil dan kata sandi akun Anda." />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <ProfilePictureCard />
        <ChangePasswordCard />
      </div>
    </div>
  );
}
