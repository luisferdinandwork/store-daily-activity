// components/ops/ops-dashboard.tsx
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { CalendarDays, CheckCircle, Clock, DollarSign, FileText, AlertCircle, Store, Users } from 'lucide-react';
import { StoreHeatmap } from './store-heatmap';
import { TaskManagement } from './task-management';
import { IssueManagement } from './issue-management';
import { PettyCashManagement } from './petty-cash-management';
import { ReportManagement } from './report-management';
import { ScheduleManagement } from './schedule-management';

interface OpsDashboardProps {
  userId: string;
}

export function OpsDashboard({ userId }: OpsDashboardProps) {
  const [date, setDate] = useState(new Date());
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [stores, setStores] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [storeProgress, setStoreProgress] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [pendingReports, setPendingReports] = useState<any[]>([]);
  const [pendingPettyCash, setPendingPettyCash] = useState<any[]>([]);

  // Fetch stores
  useEffect(() => {
    const fetchStores = async () => {
      try {
        const response = await fetch('/api/ops/stores');
        if (response.ok) {
          const data = await response.json();
          setStores(data.stores);
        }
      } catch (error) {
        console.error('Failed to fetch stores:', error);
      }
    };

    fetchStores();
  }, []);

  // Fetch employees
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const response = await fetch('/api/ops/employees');
        if (response.ok) {
          const data = await response.json();
          setEmployees(data.employees);
        }
      } catch (error) {
        console.error('Failed to fetch employees:', error);
      }
    };

    fetchEmployees();
  }, []);

  // Fetch store progress
  useEffect(() => {
    const fetchStoreProgress = async () => {
      try {
        const response = await fetch(`/api/ops/store-progress?date=${format(date, 'yyyy-MM-dd')}`);
        if (response.ok) {
          const data = await response.json();
          setStoreProgress(data.progress);
        }
      } catch (error) {
        console.error('Failed to fetch store progress:', error);
      }
    };

    fetchStoreProgress();
  }, [date]);

  // Fetch issues
  useEffect(() => {
    const fetchIssues = async () => {
      try {
        const response = await fetch('/api/ops/issues');
        if (response.ok) {
          const data = await response.json();
          setIssues(data.issues);
        }
      } catch (error) {
        console.error('Failed to fetch issues:', error);
      }
    };

    fetchIssues();
  }, []);

  // Fetch pending reports
  useEffect(() => {
    const fetchPendingReports = async () => {
      try {
        const response = await fetch('/api/ops/reports?status=submitted');
        if (response.ok) {
          const data = await response.json();
          setPendingReports(data.reports);
        }
      } catch (error) {
        console.error('Failed to fetch pending reports:', error);
      }
    };

    fetchPendingReports();
  }, []);

  // Fetch pending petty cash transactions
  useEffect(() => {
    const fetchPendingPettyCash = async () => {
      try {
        const response = await fetch('/api/ops/petty-cash?status=pending');
        if (response.ok) {
          const data = await response.json();
          setPendingPettyCash(data.transactions);
        }
      } catch (error) {
        console.error('Failed to fetch pending petty cash transactions:', error);
      }
    };

    fetchPendingPettyCash();
  }, []);

  const filteredStoreProgress = selectedStore === 'all'
    ? storeProgress
    : storeProgress.filter(store => store.storeId === selectedStore);

  const totalTasks = filteredStoreProgress.reduce((sum, store) => sum + store.totalTasks, 0);
  const completedTasks = filteredStoreProgress.reduce((sum, store) => sum + store.completedTasks, 0);
  const overallProgress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  return (
    <div className="container mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Operations Dashboard</h1>
        <p className="text-muted-foreground">Monitor and manage all store operations.</p>
      </div>

      <div className="grid gap-4 md:gap-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Stores</CardTitle>
              <Store className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stores.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Employees</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{employees.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Issues</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{issues.filter(i => i.status === 'reported').length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Reports</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pendingReports.length}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Overall Progress
              <div className="flex items-center gap-2">
                <Select value={selectedStore} onValueChange={setSelectedStore}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select store" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stores</SelectItem>
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(date) => date && setDate(date)}
                  className="rounded-md border"
                />
              </div>
            </CardTitle>
            <CardDescription>
              {format(date, 'EEEE, MMMM d, yyyy')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Overall Completion</span>
                  <span>{Math.round(overallProgress)}%</span>
                </div>
                <Progress value={overallProgress} className="h-2" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredStoreProgress.map((store) => (
                  <Card key={store.storeId}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium">{store.storeName}</h3>
                        <Badge variant={store.progressPercentage === 100 ? 'default' : 'secondary'}>
                          {store.completedTasks}/{store.totalTasks}
                        </Badge>
                      </div>
                      <Progress value={store.progressPercentage} className="h-2 mb-2" />
                      <p className="text-xs text-muted-foreground">
                        {Math.round(store.progressPercentage)}% complete
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="heatmap" className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="petty-cash">Petty Cash</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
        </TabsList>

        <TabsContent value="heatmap" className="mt-4">
          <StoreHeatmap stores={stores} date={date} />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <TaskManagement stores={stores} employees={employees} />
        </TabsContent>

        <TabsContent value="issues" className="mt-4">
          <IssueManagement issues={issues} userId={userId} />
        </TabsContent>

        <TabsContent value="petty-cash" className="mt-4">
          <PettyCashManagement transactions={pendingPettyCash} stores={stores} userId={userId} />
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <ReportManagement reports={pendingReports} stores={stores} userId={userId} />
        </TabsContent>

        <TabsContent value="schedule" className="mt-4">
          <ScheduleManagement stores={stores} employees={employees} />
        </TabsContent>
      </Tabs>
    </div>
  );
}