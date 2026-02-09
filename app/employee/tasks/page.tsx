// app/employee/tasks/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { Session } from 'next-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle, Clock, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import PageHeader from '@/components/employee/ui/page-header';
import TaskDetail from '@/components/employee/task-detail';

// Define the correct interfaces based on the API response
interface Task {
  id: string;
  title: string;
  description: string | null;
  role: string;
  employeeType: string | null;
  shift: string | null;
  isDaily: boolean;
  requiresForm: boolean;
  requiresAttachment: boolean;
  maxAttachments: number;
  createdAt: string;
  updatedAt: string;
}

interface EmployeeTask {
  id: string;
  taskId: string;
  userId: string;
  storeId: string;
  date: string;
  status: 'pending' | 'in_progress' | 'completed';
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Attendance {
  id: string;
  scheduleId: string;
  userId: string;
  storeId: string;
  date: string;
  shift: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  checkInTime: string | null;
  checkOutTime: string | null;
  notes: string | null;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AssignedTask {
  task: Task;
  employeeTask: EmployeeTask;
  attendance: Attendance | null;
}

interface DailyTask {
  id: string;
  title: string;
  description: string | null;
  role: string;
  employeeType: string | null;
  shift: string | null;
  isDaily: boolean;
  createdAt: string;
  updatedAt: string;
}

type FilterStatus = 'all' | 'in_progress' | 'completed';

export default function EmployeeTasksPage() {
  const { data: session } = useSession();
  const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selectedTask, setSelectedTask] = useState<AssignedTask | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (session?.user) {
      fetchTasks();
    }
  }, [session]);

  const fetchTasks = async () => {
    try {
      setIsLoading(true);
      // Get storeId from session or user data
      const storeId = session?.user?.storeId || 'default-store-id';
      
      const response = await fetch(`/api/employee/tasks?storeId=${storeId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch tasks');
      }
      
      const data = await response.json();
      setAssignedTasks(data.assignedTasks || []);
      setDailyTasks(data.dailyTasks || []);
    } catch (error) {
      console.error('Error fetching tasks:', error);
      toast.error('Failed to load tasks');
    } finally {
      setIsLoading(false);
    }
  };

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    try {
      const response = await fetch('/api/employee/tasks', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskId, status: newStatus }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update task');
      }
      
      // Update local state
      setAssignedTasks(prevTasks =>
        prevTasks.map(item => {
          if (item.employeeTask.id === taskId) {
            return {
              ...item,
              employeeTask: {
                ...item.employeeTask,
                status: newStatus as any,
                completedAt: newStatus === 'completed' ? new Date().toISOString() : null
              }
            };
          }
          return item;
        })
      );
      
      toast.success('Task updated successfully');
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task');
    }
  };

  const handleStartTask = (task: AssignedTask) => {
    updateTaskStatus(task.employeeTask.id, 'in_progress');
    setSelectedTask(task);
  };

  const handleSubmitTask = async (employeeTaskId: string, attachmentUrls: string[], notes: string) => {
    try {
      const response = await fetch('/api/employee/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          employeeTaskId,
          attachmentUrls,
          notes,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to complete task');
      }
      
      // Update local state
      setAssignedTasks(prevTasks =>
        prevTasks.map(item => {
          if (item.employeeTask.id === employeeTaskId) {
            return {
              ...item,
              employeeTask: {
                ...item.employeeTask,
                status: 'completed' as any,
                completedAt: new Date().toISOString()
              }
            };
          }
          return item;
        })
      );
      
      setSelectedTask(null);
    } catch (error) {
      console.error('Error completing task:', error);
      throw error; // Re-throw to let the TaskDetail component handle the error display
    }
  };

  const getFilteredTasks = () => {
    let filtered = assignedTasks;
    
    // Apply status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(item => item.employeeTask.status === filterStatus);
    }
    
    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(item => 
        item.task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.task.description && item.task.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }
    
    return filtered;
  };

  const getTaskCount = (status: FilterStatus) => {
    if (status === 'all') return assignedTasks.length;
    return assignedTasks.filter(item => item.employeeTask.status === status).length;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary via-purple-500 to-purple-600 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
      </div>
    );
  }

  // Task Detail View
  if (selectedTask) {
    return (
      <TaskDetail 
        task={selectedTask} 
        onBack={() => setSelectedTask(null)}
        onSubmit={handleSubmitTask}
      />
    );
  }

  // Main Task List View
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with gradient background */}
      <PageHeader
        title="TASK"
        icon="📋"
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showTime={false}
      />

      {/* Filter tabs - positioned to overlap header */}
      <div className="px-6 mt-4 relative z-10">
        <div className="flex gap-3 bg-white/90 backdrop-blur-sm p-2 rounded-full shadow-lg">
          <button
            onClick={() => setFilterStatus('all')}
            className={`flex-1 p-1 rounded-full text-sm font-semibold transition-all ${
              filterStatus === 'all'
                ? 'bg-primary text-white shadow-md'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            All
            <Badge className="ml-2 bg-white text-primary rounded-full px-2 py-0 text-xs">
              {getTaskCount('all')}
            </Badge>
          </button>
          <button
            onClick={() => setFilterStatus('in_progress')}
            className={`flex-1 p-1 rounded-full text-sm font-semibold transition-all ${
              filterStatus === 'in_progress'
                ? 'bg-primary text-white shadow-md'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Progress
            <Badge className="ml-2 bg-white text-primary rounded-full px-2 py-0 text-xs">
              {getTaskCount('in_progress')}
            </Badge>
          </button>
          <button
            onClick={() => setFilterStatus('completed')}
            className={`flex-1 p-1 rounded-full text-sm font-semibold transition-all ${
              filterStatus === 'completed'
                ? 'bg-primary text-white shadow-md'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Done
            <Badge className="ml-2 bg-white text-primary rounded-full px-2 py-0 text-xs">
              {getTaskCount('completed')}
            </Badge>
          </button>
        </div>
      </div>

      {/* Task List */}
      <div className="px-6 py-6 space-y-4">
        {getFilteredTasks().length === 0 ? (
          <Card className="border-0 shadow-sm py-0">
            <CardContent className="p-8 text-center">
              <div className="text-gray-400 text-5xl mb-3">📭</div>
              <p className="text-gray-500 font-medium">No tasks found</p>
              <p className="text-gray-400 text-sm mt-1">You're all caught up!</p>
            </CardContent>
          </Card>
        ) : (
          getFilteredTasks().map((item) => (
            <Card 
              key={item.employeeTask.id} 
              className="border-0 shadow-md hover:shadow-lg transition-all overflow-hidden py-0"
            >
              <CardContent className="p-0">
                {/* Progress bar for in-progress tasks */}
                {item.employeeTask.status === 'in_progress' && (
                  <div className="h-1 bg-gray-100">
                    <div 
                      className="h-full bg-gradient-to-r from-primary to-purple-500 animate-pulse"
                      style={{ width: '60%' }}
                    />
                  </div>
                )}

                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        {item.employeeTask.status === 'completed' ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        ) : item.employeeTask.status === 'in_progress' ? (
                          <Clock className="h-5 w-5 text-primary" />
                        ) : (
                          <Circle className="h-5 w-5 text-gray-400" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{item.task.title}</h3>
                        {item.employeeTask.status === 'in_progress' && (
                          <p className="text-sm text-primary font-medium mt-0.5">In Progress</p>
                        )}
                      </div>
                    </div>
                    
                    {item.employeeTask.status === 'completed' ? (
                      <Badge className="bg-green-100 text-green-700 border-0 rounded-full px-3">
                        ✓ {item.employeeTask.completedAt ? 
                          new Date(item.employeeTask.completedAt).toLocaleTimeString('en-US', { 
                            hour: '2-digit', 
                            minute: '2-digit',
                            hour12: false 
                          }) : '00:00'
                        }
                      </Badge>
                    ) : (
                      <Badge className="bg-gray-100 text-gray-600 border-0 rounded-full px-3">
                        ⏱ 00:00
                      </Badge>
                    )}
                  </div>

                  {item.task.description && (
                    <p className="text-sm text-gray-600 mb-4 ml-13">{item.task.description}</p>
                  )}

                  {item.task.requiresAttachment && (
                    <div className="flex items-center gap-1 mb-4 ml-13">
                      <Upload className="h-3 w-3 text-orange-500" />
                      <span className="text-xs text-orange-500">Attachment required</span>
                    </div>
                  )}

                  {item.employeeTask.status !== 'completed' && (
                    <div className="flex gap-2 ml-13">
                      <Button
                        size="sm"
                        onClick={() => handleStartTask(item)}
                        className="bg-primary hover:bg-primary/90 text-white rounded-full px-6"
                      >
                        {item.employeeTask.status === 'in_progress' ? 'Continue' : 'Start Task'}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}