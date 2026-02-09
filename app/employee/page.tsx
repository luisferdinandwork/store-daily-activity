// app/employee/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckSquare, AlertTriangle, DollarSign, Calendar } from 'lucide-react';

interface DashboardStats {
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  reportedIssues: number;
}

export default function EmployeeDashboard() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<DashboardStats>({
    pendingTasks: 0,
    inProgressTasks: 0,
    completedTasks: 0,
    reportedIssues: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (session?.user) {
      fetchDashboardData();
    }
  }, [session]);

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      // In a real app, you would have a dedicated API endpoint for dashboard stats
      // For now, we'll use the tasks endpoint
      const response = await fetch('/api/employee/tasks');
      
      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }
      
      const data = await response.json();
      
      // Calculate stats from tasks
      const assignedTasks = data.assignedTasks || [];
      const pendingTasks = assignedTasks.filter((t: any) => t.employeeTask.status === 'pending').length;
      const inProgressTasks = assignedTasks.filter((t: any) => t.employeeTask.status === 'in_progress').length;
      const completedTasks = assignedTasks.filter((t: any) => t.employeeTask.status === 'completed').length;
      
      setStats({
        pendingTasks,
        inProgressTasks,
        completedTasks,
        reportedIssues: 0, // This would come from a separate API call in a real app
      });
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Welcome, {session?.user?.name}</h1>
        <p className="text-gray-600 mt-1">Here's an overview of your tasks and activities</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingTasks}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.inProgressTasks}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completedTasks}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reported Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.reportedIssues}</div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckSquare className="h-5 w-5" />
                View Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">View and manage your assigned tasks</p>
              <Link href="/employee/tasks">
                <Button>View Tasks</Button>
              </Link>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Report Issue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">Report an issue at your store</p>
              <Link href="/employee/issues">
                <Button variant="outline">Report Issue</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}