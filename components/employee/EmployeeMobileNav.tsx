'use client';
// components/employee/EmployeeMobileNav.tsx

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/employee',         label: 'Home',    icon: '⌂' },
  { href: '/employee/tasks',   label: 'Tasks',   icon: '✓' },
  { href: '/employee/profile', label: 'Profile', icon: '◎' },
];

export default function EmployeeMobileNav() {
  const pathname = usePathname();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700&display=swap');

        .mobile-nav {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          height: 64px;
          background: #fff;
          border-top: 1px solid #ebebeb;
          display: flex;
          z-index: 100;
          padding: 0 8px;
          padding-bottom: env(safe-area-inset-bottom);
        }

        .mobile-nav-item {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          text-decoration: none;
          color: #aaa;
          font-family: 'Syne', sans-serif;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.04em;
          position: relative;
          transition: color 0.2s;
          -webkit-tap-highlight-color: transparent;
        }

        .mobile-nav-item.active { color: #1a1a1a; }

        .mobile-nav-icon {
          font-size: 22px;
          line-height: 1;
          transition: transform 0.2s;
        }

        .mobile-nav-item.active .mobile-nav-icon {
          transform: translateY(-1px);
        }

        .mobile-nav-dot {
          position: absolute;
          top: 8px;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #1a1a1a;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .mobile-nav-item.active .mobile-nav-dot { opacity: 1; }
      `}</style>

      <nav className="mobile-nav">
        {NAV.map(({ href, label, icon }) => {
          const active = href === '/employee'
            ? pathname === href
            : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`mobile-nav-item${active ? ' active' : ''}`}
            >
              <div className="mobile-nav-dot" />
              <span className="mobile-nav-icon">{icon}</span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}