'use client';
// app/employee/page.tsx

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface Stats {
  pending: number;
  inProgress: number;
  completed: number;
  total: number;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel() {
  return new Date().toLocaleDateString('en-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export default function EmployeeDashboard() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<Stats>({ pending: 0, inProgress: 0, completed: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user) return;
    const storeId = (session.user as any).storeId ?? '';

    fetch(`/api/employee/tasks?storeId=${storeId}`)
      .then((r) => r.json())
      .then((data) => {
        const tasks: any[] = data.assignedTasks ?? [];
        setStats({
          pending: tasks.filter((t) => t.employeeTask.status === 'pending').length,
          inProgress: tasks.filter((t) => t.employeeTask.status === 'in_progress').length,
          completed: tasks.filter((t) => t.employeeTask.status === 'completed').length,
          total: tasks.length,
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session]);

  const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  const firstName = session?.user?.name?.split(' ')[0] ?? 'there';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

        :root {
          --sand: #f8f7f5;
          --ink: #1a1a1a;
          --mid: #6b6b6b;
          --light: #e8e6e1;
          --accent: #ff6b35;
          --green: #2d9e6b;
          --amber: #e8a020;
        }

        .dash-page {
          background: var(--sand);
          min-height: 100dvh;
          font-family: 'DM Sans', sans-serif;
        }

        /* Hero */
        .dash-hero {
          background: var(--ink);
          color: #fff;
          padding: 48px 24px 40px;
          position: relative;
          overflow: hidden;
        }

        .dash-hero::before {
          content: '';
          position: absolute;
          top: -60px; right: -60px;
          width: 220px; height: 220px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,107,53,0.25) 0%, transparent 70%);
          pointer-events: none;
        }

        .dash-greeting {
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.5);
          margin-bottom: 4px;
        }

        .dash-name {
          font-family: 'Syne', sans-serif;
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 4px;
        }

        .dash-date {
          font-size: 13px;
          color: rgba(255,255,255,0.4);
        }

        /* Ring progress */
        .ring-wrap {
          margin-top: 28px;
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .ring-svg { flex-shrink: 0; }

        .ring-bg  { fill: none; stroke: rgba(255,255,255,0.08); stroke-width: 6; }
        .ring-val { fill: none; stroke: var(--accent); stroke-width: 6; stroke-linecap: round;
                    transition: stroke-dashoffset 1s ease; transform: rotate(-90deg); transform-origin: 50% 50%; }

        .ring-label {
          font-family: 'Syne', sans-serif;
          font-size: 11px;
          font-weight: 700;
          fill: rgba(255,255,255,0.4);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .ring-pct {
          font-family: 'Syne', sans-serif;
          font-size: 18px;
          font-weight: 800;
          fill: #fff;
        }

        .ring-info { color: rgba(255,255,255,0.7); font-size: 13px; }
        .ring-info strong { color: #fff; font-size: 22px; font-family: 'Syne', sans-serif; font-weight: 800; display: block; }

        /* Stat chips */
        .stat-chips {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 10px;
          padding: 20px 16px 0;
          margin-top: -1px;
        }

        .stat-chip {
          background: #fff;
          border-radius: 14px;
          padding: 14px 12px;
          text-align: center;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        }

        .stat-chip .n {
          font-family: 'Syne', sans-serif;
          font-size: 24px;
          font-weight: 800;
          color: var(--ink);
          line-height: 1;
        }

        .stat-chip .lbl {
          font-size: 10px;
          color: var(--mid);
          margin-top: 4px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .stat-chip.amber .n { color: var(--amber); }
        .stat-chip.green .n { color: var(--green); }
        .stat-chip.accent .n { color: var(--accent); }

        /* Quick actions */
        .section {
          padding: 24px 16px 0;
        }

        .section-label {
          font-family: 'Syne', sans-serif;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--mid);
          margin-bottom: 12px;
        }

        .action-card {
          display: flex;
          align-items: center;
          gap: 14px;
          background: #fff;
          border-radius: 14px;
          padding: 16px;
          text-decoration: none;
          color: var(--ink);
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
          margin-bottom: 10px;
          transition: transform 0.15s, box-shadow 0.15s;
          -webkit-tap-highlight-color: transparent;
        }

        .action-card:active { transform: scale(0.98); box-shadow: none; }

        .action-icon {
          width: 44px; height: 44px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          font-size: 20px; flex-shrink: 0;
        }

        .action-icon.orange { background: rgba(255,107,53,0.1); }
        .action-icon.green  { background: rgba(45,158,107,0.1); }

        .action-title {
          font-family: 'Syne', sans-serif;
          font-size: 14px;
          font-weight: 700;
        }

        .action-sub {
          font-size: 12px;
          color: var(--mid);
          margin-top: 2px;
        }

        .action-arrow {
          margin-left: auto;
          color: var(--light);
          font-size: 18px;
        }

        /* Shift badge */
        .shift-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 99px;
          padding: 4px 12px;
          font-size: 11px;
          color: rgba(255,255,255,0.6);
          margin-top: 16px;
        }

        .shift-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }

        /* Skeleton */
        @keyframes shimmer { 0%,100% { opacity: 0.4; } 50% { opacity: 0.8; } }
        .skel { background: rgba(255,255,255,0.08); border-radius: 6px; animation: shimmer 1.4s ease-in-out infinite; }
      `}</style>

      <div className="dash-page">
        {/* Hero */}
        <div className="dash-hero">
          <div className="dash-greeting">{greeting()}</div>
          <div className="dash-name">{firstName} 👋</div>
          <div className="dash-date">{todayLabel()}</div>

          <div className="shift-badge">
            <span className="shift-dot" />
            {(session?.user as any)?.shift === 'evening' ? 'Evening shift' : 'Morning shift'}
          </div>

          {/* Ring */}
          <div className="ring-wrap">
            <svg className="ring-svg" width="80" height="80" viewBox="0 0 80 80">
              <circle className="ring-bg" cx="40" cy="40" r="32" />
              <circle
                className="ring-val"
                cx="40" cy="40" r="32"
                strokeDasharray={`${2 * Math.PI * 32}`}
                strokeDashoffset={`${2 * Math.PI * 32 * (1 - pct / 100)}`}
              />
              <text x="50%" y="45%" textAnchor="middle" className="ring-pct" dy=".1em">
                {loading ? '—' : `${pct}%`}
              </text>
              <text x="50%" y="62%" textAnchor="middle" className="ring-label">done</text>
            </svg>

            <div className="ring-info">
              <strong>{loading ? '—' : stats.total}</strong>
              tasks assigned today
            </div>
          </div>
        </div>

        {/* Stat chips */}
        <div className="stat-chips">
          <div className="stat-chip amber">
            <div className="n">{loading ? '—' : stats.pending}</div>
            <div className="lbl">Pending</div>
          </div>
          <div className="stat-chip accent">
            <div className="n">{loading ? '—' : stats.inProgress}</div>
            <div className="lbl">Active</div>
          </div>
          <div className="stat-chip green">
            <div className="n">{loading ? '—' : stats.completed}</div>
            <div className="lbl">Done</div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="section">
          <div className="section-label">Quick Actions</div>

          <Link href="/employee/tasks" className="action-card">
            <div className="action-icon orange">✓</div>
            <div>
              <div className="action-title">My Tasks</div>
              <div className="action-sub">
                {loading ? 'Loading…' : `${stats.pending} pending · ${stats.inProgress} in progress`}
              </div>
            </div>
            <span className="action-arrow">›</span>
          </Link>

          <Link href="/employee/profile" className="action-card">
            <div className="action-icon green">◎</div>
            <div>
              <div className="action-title">My Profile</div>
              <div className="action-sub">View schedule & attendance</div>
            </div>
            <span className="action-arrow">›</span>
          </Link>
        </div>
      </div>
    </>
  );
}