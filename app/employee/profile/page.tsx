'use client';
// app/employee/profile/page.tsx

import { useSession, signOut } from 'next-auth/react';

export default function EmployeeProfilePage() {
  const { data: session } = useSession();
  const user = session?.user as any;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

        :root {
          --sand: #f8f7f5;
          --ink: #1a1a1a;
          --mid: #6b6b6b;
          --light: #e8e6e1;
          --accent: #ff6b35;
          --green: #2d9e6b;
        }

        .profile-page {
          background: var(--sand);
          min-height: 100dvh;
          font-family: 'DM Sans', sans-serif;
          padding-bottom: 80px;
        }

        .profile-hero {
          background: var(--ink); color: #fff;
          padding: 60px 24px 32px;
          display: flex; flex-direction: column; align-items: center;
          text-align: center;
        }

        .avatar {
          width: 72px; height: 72px;
          border-radius: 50%;
          background: rgba(255,107,53,0.2);
          display: flex; align-items: center; justify-content: center;
          font-size: 28px;
          margin-bottom: 14px;
          border: 2px solid rgba(255,255,255,0.1);
        }

        .profile-name {
          font-family: 'Syne', sans-serif;
          font-size: 22px; font-weight: 800;
          letter-spacing: -0.02em;
        }

        .profile-role {
          font-size: 12px; color: rgba(255,255,255,0.4);
          margin-top: 4px; text-transform: uppercase;
          letter-spacing: 0.1em; font-weight: 500;
        }

        .profile-badges { display: flex; gap: 8px; margin-top: 14px; }

        .profile-badge {
          font-size: 11px; font-weight: 700; font-family: 'Syne', sans-serif;
          padding: 4px 12px; border-radius: 99px;
          background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7);
          text-transform: uppercase; letter-spacing: 0.06em;
        }

        .profile-body { padding: 20px 16px; display: flex; flex-direction: column; gap: 12px; }

        .info-card {
          background: #fff; border-radius: 16px; padding: 18px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.05);
        }

        .card-title {
          font-family: 'Syne', sans-serif;
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.1em; color: var(--mid);
          margin-bottom: 14px;
        }

        .info-row {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 0; border-bottom: 1px solid #f4f4f0;
        }
        .info-row:last-child { border-bottom: none; padding-bottom: 0; }

        .info-label { font-size: 13px; color: var(--mid); }
        .info-val { font-size: 13px; font-weight: 500; color: var(--ink); }

        .signout-btn {
          width: 100%;
          background: none; border: 1.5px solid var(--light);
          border-radius: 14px; padding: 16px;
          font-family: 'Syne', sans-serif;
          font-size: 14px; font-weight: 700;
          color: var(--mid); cursor: pointer;
          transition: all 0.15s;
          -webkit-tap-highlight-color: transparent;
        }

        .signout-btn:active { background: #fff; color: var(--ink); border-color: var(--ink); }
      `}</style>

      <div className="profile-page">
        <div className="profile-hero">
          <div className="avatar">👤</div>
          <div className="profile-name">{user?.name ?? '—'}</div>
          <div className="profile-role">{user?.role ?? 'Employee'}</div>
          <div className="profile-badges">
            {user?.employeeType && (
              <span className="profile-badge">{user.employeeType.toUpperCase()}</span>
            )}
            {user?.shift && (
              <span className="profile-badge">{user.shift} shift</span>
            )}
          </div>
        </div>

        <div className="profile-body">
          <div className="info-card">
            <div className="card-title">Account Info</div>
            <div className="info-row">
              <span className="info-label">Email</span>
              <span className="info-val">{user?.email ?? '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Employee Type</span>
              <span className="info-val">{user?.employeeType?.toUpperCase() ?? '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Store</span>
              <span className="info-val">{user?.storeId ? '…' : '—'}</span>
            </div>
          </div>

          <button
            className="signout-btn"
            onClick={() => signOut({ callbackUrl: '/login' })}
          >
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}