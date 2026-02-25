'use client';
// app/employee/tasks/page.tsx

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import TaskDetailView from '@/components/employee/TaskDetailView';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TaskTemplate {
  id: string;
  title: string;
  description: string | null;
  role: string;
  employeeType: string | null;
  shift: string | null;
  recurrence: string;
  requiresForm: boolean;
  requiresAttachment: boolean;
  maxAttachments: number;
  formSchema: { fields: FormField[] } | null;
}

export interface FormField {
  id: string;
  type: 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'time';
  label: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
  validation?: { min?: number; max?: number };
}

export interface EmployeeTask {
  id: string;
  taskId: string;
  userId: string;
  storeId: string;
  date: string;
  shift: string;
  status: 'pending' | 'in_progress' | 'completed';
  completedAt: string | null;
  attachmentUrls: string[];
  formData: Record<string, unknown> | null;
  notes: string | null;
}

export interface AssignedTask {
  task: TaskTemplate;
  employeeTask: EmployeeTask;
  attendance: unknown;
}

type Filter = 'all' | 'pending' | 'in_progress' | 'completed';

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function EmployeeTasksPage() {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<AssignedTask | null>(null);

  const storeId = (session?.user as any)?.storeId ?? '';

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/employee/tasks?storeId=${storeId}`);
      const data = await res.json();
      setTasks(data.assignedTasks ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (session?.user) load();
  }, [session, load]);

  // After task completes / starts, refresh list
  const handleTaskUpdate = () => {
    load();
    setSelected(null);
  };

  // Tap a card → open detail view (also marks in_progress)
  const openTask = async (item: AssignedTask) => {
    if (item.employeeTask.status === 'pending') {
      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.employeeTask.id === item.employeeTask.id
            ? { ...t, employeeTask: { ...t.employeeTask, status: 'in_progress' } }
            : t,
        ),
      );
      await fetch('/api/employee/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: item.employeeTask.id, status: 'in_progress' }),
      });
      setSelected({ ...item, employeeTask: { ...item.employeeTask, status: 'in_progress' } });
    } else {
      setSelected(item);
    }
  };

  const filtered = tasks.filter((t) => filter === 'all' || t.employeeTask.status === filter);
  const count = (s: Filter) =>
    s === 'all' ? tasks.length : tasks.filter((t) => t.employeeTask.status === s).length;

  if (selected) {
    return <TaskDetailView task={selected} onBack={handleTaskUpdate} />;
  }

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
          --amber: #e8a020;
        }

        .tasks-page { background: var(--sand); min-height: 100dvh; font-family: 'DM Sans', sans-serif; }

        .tasks-hero {
          background: var(--ink); color: #fff;
          padding: 48px 24px 24px;
        }

        .tasks-hero h1 {
          font-family: 'Syne', sans-serif;
          font-size: 28px; font-weight: 800;
          letter-spacing: -0.02em;
        }

        .tasks-hero p { font-size: 13px; color: rgba(255,255,255,0.4); margin-top: 4px; }

        /* Filter tabs */
        .filter-wrap {
          display: flex;
          gap: 6px;
          padding: 16px 16px 0;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .filter-wrap::-webkit-scrollbar { display: none; }

        .filter-tab {
          flex-shrink: 0;
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 14px;
          border-radius: 99px;
          font-family: 'Syne', sans-serif;
          font-size: 12px; font-weight: 700;
          border: 1.5px solid var(--light);
          background: #fff;
          color: var(--mid);
          cursor: pointer;
          transition: all 0.15s;
          -webkit-tap-highlight-color: transparent;
        }

        .filter-tab.active { border-color: var(--ink); background: var(--ink); color: #fff; }

        .filter-count {
          background: rgba(255,255,255,0.15);
          border-radius: 99px;
          padding: 0 6px;
          font-size: 10px;
        }

        .filter-tab:not(.active) .filter-count {
          background: rgba(0,0,0,0.07);
          color: var(--ink);
        }

        /* Task list */
        .task-list { padding: 16px; display: flex; flex-direction: column; gap: 10px; }

        .task-card {
          background: #fff;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: transform 0.1s, box-shadow 0.1s;
        }
        .task-card:active { transform: scale(0.99); box-shadow: none; }

        .task-card-inner { padding: 16px; }

        .task-card-top {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
        }

        .task-card-left { display: flex; align-items: flex-start; gap: 12px; flex: 1; min-width: 0; }

        .task-status-icon {
          width: 36px; height: 36px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; flex-shrink: 0;
        }
        .status-pending   .task-status-icon { background: rgba(232,160,32,0.1);  }
        .status-progress  .task-status-icon { background: rgba(255,107,53,0.1);  }
        .status-completed .task-status-icon { background: rgba(45,158,107,0.1);  }

        .task-title {
          font-family: 'Syne', sans-serif;
          font-size: 14px; font-weight: 700;
          color: var(--ink);
          margin-bottom: 3px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        .task-desc { font-size: 12px; color: var(--mid); }

        .task-status-badge {
          flex-shrink: 0;
          font-size: 10px; font-weight: 700;
          font-family: 'Syne', sans-serif;
          padding: 3px 10px;
          border-radius: 99px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .badge-pending   { background: rgba(232,160,32,0.1);  color: var(--amber); }
        .badge-progress  { background: rgba(255,107,53,0.1);  color: var(--accent); }
        .badge-completed { background: rgba(45,158,107,0.1);  color: var(--green); }

        .task-meta {
          display: flex; gap: 8px; align-items: center;
          margin-top: 10px; padding-top: 10px;
          border-top: 1px solid #f4f4f0;
          flex-wrap: wrap;
        }

        .meta-chip {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 10px; color: var(--mid); font-weight: 500;
        }

        .progress-bar {
          height: 3px;
          background: linear-gradient(to right, var(--accent), #ff9a6c);
          animation: progress-pulse 1.5s ease-in-out infinite;
        }

        @keyframes progress-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }

        .completed-bar { height: 3px; background: var(--green); }

        /* Empty */
        .empty { text-align: center; padding: 60px 20px; color: var(--mid); }
        .empty-icon { font-size: 48px; margin-bottom: 12px; }
        .empty h3 { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 700; color: var(--ink); margin-bottom: 4px; }

        /* Skeleton */
        @keyframes shimmer { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
        .skel { background: #eee; border-radius: 8px; animation: shimmer 1.4s ease-in-out infinite; }
      `}</style>

      <div className="tasks-page">
        <div className="tasks-hero">
          <h1>My Tasks</h1>
          <p>{new Date().toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>

        {/* Filter tabs */}
        <div className="filter-wrap">
          {(['all', 'pending', 'in_progress', 'completed'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`filter-tab${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'in_progress' ? 'Active' : f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="filter-count">{count(f)}</span>
            </button>
          ))}
        </div>

        {/* List */}
        <div className="task-list">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skel" style={{ height: 80 }} />
            ))
          ) : filtered.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📭</div>
              <h3>No tasks here</h3>
              <p>You're all caught up!</p>
            </div>
          ) : (
            filtered.map((item) => {
              const { status } = item.employeeTask;
              const cls =
                status === 'completed'
                  ? 'status-completed'
                  : status === 'in_progress'
                  ? 'status-progress'
                  : 'status-pending';
              const badgeCls =
                status === 'completed'
                  ? 'badge-completed'
                  : status === 'in_progress'
                  ? 'badge-progress'
                  : 'badge-pending';
              const icon =
                status === 'completed' ? '✓' : status === 'in_progress' ? '↻' : '○';

              return (
                <div
                  key={item.employeeTask.id}
                  className={`task-card ${cls}`}
                  onClick={() => status !== 'completed' && openTask(item)}
                >
                  {status === 'in_progress' && <div className="progress-bar" />}
                  {status === 'completed' && <div className="completed-bar" />}

                  <div className="task-card-inner">
                    <div className="task-card-top">
                      <div className="task-card-left">
                        <div className="task-status-icon">{icon}</div>
                        <div style={{ minWidth: 0 }}>
                          <div className="task-title">{item.task.title}</div>
                          {item.task.description && (
                            <div className="task-desc">{item.task.description}</div>
                          )}
                        </div>
                      </div>
                      <span className={`task-status-badge ${badgeCls}`}>
                        {status === 'in_progress' ? 'Active' : status}
                      </span>
                    </div>

                    <div className="task-meta">
                      {item.task.shift && (
                        <span className="meta-chip">
                          🕐 {item.task.shift}
                        </span>
                      )}
                      {item.task.requiresForm && (
                        <span className="meta-chip">📝 Form</span>
                      )}
                      {item.task.requiresAttachment && (
                        <span className="meta-chip">📷 Photo required</span>
                      )}
                      {item.task.recurrence !== 'daily' && (
                        <span className="meta-chip">🔁 {item.task.recurrence}</span>
                      )}
                      {status === 'completed' && item.employeeTask.completedAt && (
                        <span className="meta-chip" style={{ marginLeft: 'auto', color: 'var(--green)' }}>
                          ✓ {new Date(item.employeeTask.completedAt).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}