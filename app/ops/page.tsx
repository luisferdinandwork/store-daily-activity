// app/ops/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────
type DashboardData = {
  date: string;
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    completionRate: number;
  };
  attendance: {
    scheduled: number;
    present: number;
    late: number;
    absent: number;
    excused: number;
  };
  taskTemplates: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  recentCompleted: Array<{
    employeeTask: { id: string; completedAt: string | null; shift: string };
    task: { id: string; title: string } | null;
    user: { id: string; name: string } | null;
  }>;
};

// ─── Constants ────────────────────────────────────────────────────────────────
// Replace with your actual store context / auth
const STORE_ID = "your-store-id";
const opsName = "Admin OPS";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(n: number, decimals = 0) {
  return n.toLocaleString("id-ID", { maximumFractionDigits: decimals });
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function today() {
  return new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="progress-track">
      <div
        className="progress-fill"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function OpsDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/ops/dashboard?storeId=${STORE_ID}&date=${new Date().toISOString()}`
      );
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // refresh every minute
    return () => clearInterval(id);
  }, [load]);

  async function handleGenerateTasks() {
    setGenerating(true);
    setGenMsg("");
    try {
      const res = await fetch("/api/ops/tasks/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: STORE_ID,
          createdBy: "ops-user-id", // replace with session user
        }),
      });
      const json = await res.json();
      setGenMsg(
        json.success
          ? `✓ ${json.tasksCreated} tasks generated`
          : `✗ ${json.errors?.[0] || "Error"}`
      );
      load();
    } finally {
      setGenerating(false);
    }
  }

  const total = data?.tasks.total || 0;
  const completed = data?.tasks.completed || 0;
  const rate = data?.tasks.completionRate || 0;
  const scheduled = data?.attendance.scheduled || 0;
  const present =
    (data?.attendance.present || 0) + (data?.attendance.late || 0);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #0f1117;
          --surface: #181c27;
          --border: #252b3b;
          --text: #e2e8f0;
          --muted: #64748b;
          --accent: #3b82f6;
          --green: #22c55e;
          --amber: #f59e0b;
          --red: #ef4444;
          --purple: #a855f7;
        }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 14px;
          min-height: 100vh;
        }

        .shell {
          display: grid;
          grid-template-columns: 220px 1fr;
          min-height: 100vh;
        }

        /* ── Sidebar ── */
        .sidebar {
          background: var(--surface);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          padding: 24px 0;
          position: sticky;
          top: 0;
          height: 100vh;
          overflow-y: auto;
        }

        .sidebar-logo {
          padding: 0 20px 24px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 16px;
        }

        .sidebar-logo .wordmark {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.12em;
          color: var(--accent);
          text-transform: uppercase;
        }

        .sidebar-logo .store-name {
          font-size: 11px;
          color: var(--muted);
          margin-top: 4px;
        }

        .nav-section {
          padding: 0 12px;
          margin-bottom: 8px;
        }

        .nav-label {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          color: var(--muted);
          text-transform: uppercase;
          padding: 0 8px;
          margin-bottom: 4px;
        }

        .nav-link {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 6px;
          color: var(--muted);
          text-decoration: none;
          font-size: 13px;
          transition: all 0.15s;
          cursor: pointer;
          border: none;
          background: none;
          width: 100%;
          text-align: left;
        }

        .nav-link:hover, .nav-link.active {
          background: rgba(59,130,246,0.1);
          color: var(--text);
        }

        .nav-link.active {
          color: var(--accent);
        }

        .nav-icon { font-size: 15px; }

        /* ── Main ── */
        .main {
          padding: 32px 40px;
          max-width: 1200px;
        }

        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 32px;
        }

        .page-title {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        .page-date {
          font-size: 12px;
          color: var(--muted);
          margin-top: 4px;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.15s;
          font-weight: 500;
        }

        .btn-primary {
          background: var(--accent);
          color: #fff;
        }

        .btn-primary:hover { background: #2563eb; }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-outline {
          background: transparent;
          border-color: var(--border);
          color: var(--text);
        }

        .btn-outline:hover {
          border-color: var(--accent);
          color: var(--accent);
        }

        .btn-row {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .gen-msg {
          font-size: 12px;
          font-family: 'IBM Plex Mono', monospace;
          color: var(--green);
          margin-top: 6px;
          text-align: right;
        }

        /* ── Stat grid ── */
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }

        .stat-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 20px;
        }

        .stat-label {
          font-size: 11px;
          font-family: 'IBM Plex Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted);
          margin-bottom: 8px;
        }

        .stat-value {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 28px;
          font-weight: 600;
          line-height: 1;
        }

        .stat-sub {
          font-size: 11px;
          color: var(--muted);
          margin-top: 6px;
        }

        /* ── Two-col layout ── */
        .two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: 20px;
        }

        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 20px;
        }

        .card-title {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted);
          margin-bottom: 16px;
        }

        /* ── Attendance rows ── */
        .att-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid var(--border);
        }

        .att-row:last-child { border-bottom: none; }

        .att-label { font-size: 13px; }

        .badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 99px;
          font-size: 11px;
          font-family: 'IBM Plex Mono', monospace;
          font-weight: 500;
        }

        .badge-green { background: rgba(34,197,94,0.15); color: var(--green); }
        .badge-amber { background: rgba(245,158,11,0.15); color: var(--amber); }
        .badge-red   { background: rgba(239,68,68,0.15);  color: var(--red);   }
        .badge-blue  { background: rgba(59,130,246,0.15); color: var(--accent); }
        .badge-muted { background: rgba(100,116,139,0.15); color: var(--muted); }

        /* ── Progress ── */
        .progress-track {
          height: 6px;
          background: var(--border);
          border-radius: 99px;
          overflow: hidden;
          margin-top: 6px;
        }

        .progress-fill {
          height: 100%;
          border-radius: 99px;
          transition: width 0.6s ease;
        }

        .progress-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
          font-size: 12px;
        }

        .progress-group { margin-bottom: 14px; }

        /* ── Template badges ── */
        .template-row {
          display: flex;
          gap: 12px;
          margin-top: 8px;
        }

        .template-chip {
          flex: 1;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 12px;
          text-align: center;
        }

        .template-chip .n {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 22px;
          font-weight: 600;
        }

        .template-chip .lbl {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted);
          margin-top: 2px;
        }

        /* ── Recent tasks ── */
        .recent-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid var(--border);
        }

        .recent-item:last-child { border-bottom: none; }

        .recent-task { font-size: 13px; font-weight: 500; }
        .recent-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }

        .recent-time {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--muted);
        }

        /* ── Loading ── */
        .skeleton {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          animation: pulse 1.4s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }

        @media (max-width: 900px) {
          .shell { grid-template-columns: 1fr; }
          .sidebar { display: none; }
          .stats-grid { grid-template-columns: 1fr 1fr; }
          .two-col { grid-template-columns: 1fr; }
          .main { padding: 20px; }
        }
      `}</style>

      <div className="shell">
        {/* ── Sidebar ── */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="wordmark">OPS Panel</div>
            <div className="store-name">Store Jakarta Pusat</div>
          </div>

          <div className="nav-section">
            <div className="nav-label">Overview</div>
            <Link href="/ops" className="nav-link active">
              <span className="nav-icon">▦</span> Dashboard
            </Link>
          </div>

          <div className="nav-section">
            <div className="nav-label">Tasks</div>
            <Link href="/ops/tasks" className="nav-link">
              <span className="nav-icon">☰</span> Task Library
            </Link>
            <Link href="/ops/tasks/new" className="nav-link">
              <span className="nav-icon">＋</span> Create Task
            </Link>
          </div>

          <div className="nav-section">
            <div className="nav-label">People</div>
            <Link href="/ops/schedules" className="nav-link">
              <span className="nav-icon">📅</span> Schedules
            </Link>
            <Link href="/ops/attendance" className="nav-link">
              <span className="nav-icon">✓</span> Attendance
            </Link>
          </div>

          <div className="nav-section" style={{ marginTop: "auto" }}>
            <div className="nav-label">Account</div>
            <div className="nav-link">
              <span className="nav-icon">◎</span> {opsName}
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="main">
          {/* Topbar */}
          <div className="topbar">
            <div>
              <h1 className="page-title">Dashboard</h1>
              <div className="page-date">{today()}</div>
            </div>
            <div>
              <div className="btn-row">
                <Link href="/ops/tasks/new" className="btn btn-outline">
                  + New Task
                </Link>
                <button
                  className="btn btn-primary"
                  onClick={handleGenerateTasks}
                  disabled={generating}
                >
                  {generating ? "Generating…" : "⟳ Generate Today's Tasks"}
                </button>
              </div>
              {genMsg && <div className="gen-msg">{genMsg}</div>}
            </div>
          </div>

          {loading ? (
            <>
              <div className="stats-grid">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton" style={{ height: 100 }} />
                ))}
              </div>
              <div className="two-col">
                <div className="skeleton" style={{ height: 200 }} />
                <div className="skeleton" style={{ height: 200 }} />
              </div>
            </>
          ) : (
            <>
              {/* Stat row */}
              <div className="stats-grid">
                <StatCard
                  label="Completion Rate"
                  value={`${Math.round(rate)}%`}
                  sub={`${completed} / ${total} tasks done`}
                  accent={rate >= 80 ? "var(--green)" : rate >= 50 ? "var(--amber)" : "var(--red)"}
                />
                <StatCard
                  label="Tasks Today"
                  value={fmt(total)}
                  sub={`${data?.tasks.pending} pending · ${data?.tasks.inProgress} in progress`}
                />
                <StatCard
                  label="Attendance"
                  value={`${present}/${scheduled}`}
                  sub={`${data?.attendance.absent} absent · ${data?.attendance.late} late`}
                  accent={present === scheduled ? "var(--green)" : "var(--amber)"}
                />
                <StatCard
                  label="Task Templates"
                  value={
                    (data?.taskTemplates.daily || 0) +
                    (data?.taskTemplates.weekly || 0) +
                    (data?.taskTemplates.monthly || 0)
                  }
                  sub={`${data?.taskTemplates.daily}d · ${data?.taskTemplates.weekly}w · ${data?.taskTemplates.monthly}m`}
                />
              </div>

              {/* Two-col */}
              <div className="two-col">
                {/* Task progress */}
                <div className="card">
                  <div className="card-title">Task Breakdown</div>

                  {[
                    { label: "Completed", val: completed, color: "var(--green)" },
                    {
                      label: "In Progress",
                      val: data?.tasks.inProgress || 0,
                      color: "var(--accent)",
                    },
                    {
                      label: "Pending",
                      val: data?.tasks.pending || 0,
                      color: "var(--amber)",
                    },
                  ].map(({ label, val, color }) => (
                    <div className="progress-group" key={label}>
                      <div className="progress-row">
                        <span style={{ color }}>{label}</span>
                        <span style={{ fontFamily: "IBM Plex Mono, monospace" }}>{val}</span>
                      </div>
                      <ProgressBar value={val} max={total} color={color} />
                    </div>
                  ))}
                </div>

                {/* Attendance card */}
                <div className="card">
                  <div className="card-title">Today's Attendance</div>
                  {[
                    {
                      label: "Present",
                      val: data?.attendance.present || 0,
                      cls: "badge-green",
                    },
                    { label: "Late", val: data?.attendance.late || 0, cls: "badge-amber" },
                    {
                      label: "Absent",
                      val: data?.attendance.absent || 0,
                      cls: "badge-red",
                    },
                    {
                      label: "Excused",
                      val: data?.attendance.excused || 0,
                      cls: "badge-muted",
                    },
                  ].map(({ label, val, cls }) => (
                    <div className="att-row" key={label}>
                      <span className="att-label">{label}</span>
                      <span className={`badge ${cls}`}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Second two-col */}
              <div className="two-col">
                {/* Template types */}
                <div className="card">
                  <div className="card-title">Active Task Templates</div>
                  <div className="template-row">
                    {[
                      { n: data?.taskTemplates.daily, lbl: "Daily", color: "var(--accent)" },
                      { n: data?.taskTemplates.weekly, lbl: "Weekly", color: "var(--purple)" },
                      { n: data?.taskTemplates.monthly, lbl: "Monthly", color: "var(--amber)" },
                    ].map(({ n, lbl, color }) => (
                      <div className="template-chip" key={lbl}>
                        <div className="n" style={{ color }}>
                          {n}
                        </div>
                        <div className="lbl">{lbl}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <Link href="/ops/tasks" className="btn btn-outline" style={{ width: "100%", justifyContent: "center" }}>
                      Manage Templates →
                    </Link>
                  </div>
                </div>

                {/* Recent completions */}
                <div className="card">
                  <div className="card-title">Recently Completed</div>
                  {data?.recentCompleted.length === 0 && (
                    <div style={{ color: "var(--muted)", fontSize: 13 }}>
                      No completions yet today
                    </div>
                  )}
                  {data?.recentCompleted.map((item, i) => (
                    <div className="recent-item" key={i}>
                      <div>
                        <div className="recent-task">
                          {item.task?.title || "Unknown Task"}
                        </div>
                        <div className="recent-meta">
                          {item.user?.name} ·{" "}
                          <span
                            className={`badge ${
                              item.employeeTask.shift === "morning"
                                ? "badge-blue"
                                : "badge-muted"
                            }`}
                          >
                            {item.employeeTask.shift}
                          </span>
                        </div>
                      </div>
                      <div className="recent-time">
                        {fmtTime(item.employeeTask.completedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}