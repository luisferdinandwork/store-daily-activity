// app/employee/announcements/page.tsx
'use client';

import { useState } from 'react';
import PageHeader from '@/components/employee/ui/page-header';

export default function AnnouncementsPage() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="ANNOUNCEMENTS"
        icon="📢"
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showTime={true}
        backgroundColor="bg-blue-600"
      />
      
      {/* Rest of your page content */}
      <div className="px-6 py-6">
        {/* Your announcements content here */}
      </div>
    </div>
  );
}