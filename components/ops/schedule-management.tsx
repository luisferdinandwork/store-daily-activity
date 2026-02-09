// components/ops/schedule-management.tsx
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CalendarDays, Users, Clock, Plus, Edit, Trash2 } from 'lucide-react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from 'date-fns';

interface Store {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  name: string;
  role: string;
  employeeType?: string;
  storeId: string;
}

interface Schedule {
  id: string;
  userId: string;
  userName: string;
  storeId: string;
  storeName: string;
  shift: 'morning' | 'evening';
  date: string;
  isHoliday: boolean;
}

interface ScheduleManagementProps {
  stores: Store[];
  employees: Employee[];
}

export function ScheduleManagement({ stores, employees }: ScheduleManagementProps) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>(stores[0]?.id || '');
  const [selectedWeek, setSelectedWeek] = useState<Date>(new Date());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [selectedShift, setSelectedShift] = useState<'morning' | 'evening'>('morning');
  const [isHoliday, setIsHoliday] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (selectedStore) {
      fetchSchedules();
    }
  }, [selectedStore, selectedWeek]);

  const fetchSchedules = async () => {
    try {
      const startDate = format(startOfWeek(selectedWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const endDate = format(endOfWeek(selectedWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      
      const response = await fetch(
        `/api/ops/schedules?storeId=${selectedStore}&startDate=${startDate}&endDate=${endDate}`
      );
      
      if (response.ok) {
        const data = await response.json();
        setSchedules(data.schedules);
      }
    } catch (error) {
      console.error('Failed to fetch schedules:', error);
    }
  };

  const handleCreateSchedule = async () => {
    if (!selectedDate || !selectedEmployee || !selectedStore) return;
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/ops/schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: selectedEmployee,
          storeId: selectedStore,
          shift: selectedShift,
          date: format(selectedDate, 'yyyy-MM-dd'),
          isHoliday,
        }),
      });

      if (response.ok) {
        setIsDialogOpen(false);
        resetForm();
        fetchSchedules();
      } else {
        console.error('Failed to create schedule');
      }
    } catch (error) {
      console.error('Error creating schedule:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateSchedule = async () => {
    if (!editingSchedule) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(`/api/ops/schedules/${editingSchedule.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: selectedEmployee,
          storeId: selectedStore,
          shift: selectedShift,
          date: format(selectedDate!, 'yyyy-MM-dd'),
          isHoliday,
        }),
      });

      if (response.ok) {
        setIsDialogOpen(false);
        resetForm();
        fetchSchedules();
      } else {
        console.error('Failed to update schedule');
      }
    } catch (error) {
      console.error('Error updating schedule:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!confirm('Are you sure you want to delete this schedule?')) return;
    
    try {
      const response = await fetch(`/api/ops/schedules/${scheduleId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchSchedules();
      } else {
        console.error('Failed to delete schedule');
      }
    } catch (error) {
      console.error('Error deleting schedule:', error);
    }
  };

  const handleEditSchedule = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setSelectedEmployee(schedule.userId);
    setSelectedShift(schedule.shift);
    setSelectedDate(new Date(schedule.date));
    setIsHoliday(schedule.isHoliday);
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setEditingSchedule(null);
    setSelectedEmployee('');
    setSelectedShift('morning');
    setSelectedDate(new Date());
    setIsHoliday(false);
  };

  const weekDays = eachDayOfInterval({
    start: startOfWeek(selectedWeek, { weekStartsOn: 1 }),
    end: endOfWeek(selectedWeek, { weekStartsOn: 1 }),
  });

  const getScheduleForDate = (date: Date) => {
    return schedules.filter(schedule => 
      isSameDay(new Date(schedule.date), date)
    );
  };

  const getShiftBadge = (shift: string) => {
    return shift === 'morning' 
      ? <Badge variant="default" className="bg-blue-500">Morning</Badge>
      : <Badge variant="secondary" className="bg-purple-500">Evening</Badge>;
  };

  const filteredEmployees = employees.filter(employee => employee.storeId === selectedStore);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Schedule Management</h3>
        <div className="flex gap-2">
          <Select value={selectedStore} onValueChange={setSelectedStore}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select store" />
            </SelectTrigger>
            <SelectContent>
              {stores.map((store) => (
                <SelectItem key={store.id} value={store.id}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={resetForm}>
                <Plus className="h-4 w-4 mr-2" />
                Add Schedule
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>
                  {editingSchedule ? 'Edit Schedule' : 'Add New Schedule'}
                </DialogTitle>
                <DialogDescription>
                  {editingSchedule ? 'Update the schedule details.' : 'Create a new schedule for an employee.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select Date</label>
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    className="rounded-md border"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Employee</label>
                  <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredEmployees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name} ({employee.employeeType})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Shift</label>
                  <Select value={selectedShift} onValueChange={(value: 'morning' | 'evening') => setSelectedShift(value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select shift" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="morning">Morning</SelectItem>
                      <SelectItem value="evening">Evening</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isHoliday"
                    checked={isHoliday}
                    onChange={(e) => setIsHoliday(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="isHoliday" className="text-sm font-medium">
                    Holiday
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button 
                    onClick={editingSchedule ? handleUpdateSchedule : handleCreateSchedule} 
                    disabled={isLoading}
                    className="flex-1"
                  >
                    {isLoading ? 'Saving...' : (editingSchedule ? 'Update' : 'Create')}
                  </Button>
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Week of {format(startOfWeek(selectedWeek, { weekStartsOn: 1 }), 'MMM d, yyyy')}
          </CardTitle>
          <CardDescription>
            View and manage schedules for the selected week.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
            {weekDays.map((day) => (
              <Card key={day.toISOString()} className={isSameDay(day, new Date()) ? 'ring-2 ring-primary' : ''}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-center">
                    {format(day, 'EEE')}
                  </CardTitle>
                  <CardDescription className="text-center text-lg">
                    {format(day, 'd')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {getScheduleForDate(day).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      No schedules
                    </p>
                  ) : (
                    getScheduleForDate(day).map((schedule) => (
                      <div key={schedule.id} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            <span className="text-xs truncate">{schedule.userName}</span>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => handleEditSchedule(schedule)}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => handleDeleteSchedule(schedule.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          {getShiftBadge(schedule.shift)}
                          {schedule.isHoliday && (
                            <Badge variant="outline" className="text-xs">Holiday</Badge>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Schedules</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-4">
                    No schedules found for this week.
                  </TableCell>
                </TableRow>
              ) : (
                schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium">{schedule.userName}</TableCell>
                    <TableCell>{schedule.storeName}</TableCell>
                    <TableCell>{format(new Date(schedule.date), 'MMM d, yyyy')}</TableCell>
                    <TableCell>{getShiftBadge(schedule.shift)}</TableCell>
                    <TableCell>
                      {schedule.isHoliday ? (
                        <Badge variant="outline">Holiday</Badge>
                      ) : (
                        <Badge variant="default">Working</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditSchedule(schedule)}
                        >
                          <Edit className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteSchedule(schedule.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}