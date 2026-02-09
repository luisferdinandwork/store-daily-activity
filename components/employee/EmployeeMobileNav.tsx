'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  HomeIcon, 
  CheckSquareIcon, 
//   ExclamationTriangleIcon,
  UserIcon 
} from 'lucide-react';

export default function EmployeeMobileNav() {
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState(pathname);

  const navigationItems = [
    {
      name: 'Dashboard',
      href: '/employee',
      icon: HomeIcon,
    },
    {
      name: 'Tasks',
      href: '/employee/tasks',
      icon: CheckSquareIcon,
    },
    // {
    //   name: 'Issues',
    //   href: '/employee/issues',
    //   icon: ExclamationTriangleIcon,
    // },
    {
      name: 'Profile',
      href: '/employee/profile',
      icon: UserIcon,
    },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
      <div className="grid grid-cols-4 gap-1">
        {navigationItems.map((item) => {
          const isActive = activeTab === item.href;
          const Icon = item.icon;
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex flex-col items-center justify-center py-2 px-3 transition-colors ${
                isActive
                  ? 'text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setActiveTab(item.href)}
            >
              <Icon className="h-6 w-6 mb-1" />
              <span className="text-xs">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}