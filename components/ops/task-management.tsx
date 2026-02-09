// components/ops/task-management.tsx
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

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

interface Task {
  id: string;
  title: string;
  description: string | null;
  role: string;
  employeeType: string | null;
  shift: string | null;
  isDaily: boolean;
}

interface TaskManagementProps {
  stores: Store[];
  employees: Employee[];
}

export function TaskManagement({ stores, employees }: TaskManagementProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState('');
  const [employeeType, setEmployeeType] = useState('');
  const [shift, setShift] = useState('');
  const [isDaily, setIsDaily] = useState(true);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      const response = await fetch('/api/ops/tasks');
      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks);
      }
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setRole('');
    setEmployeeType('');
    setShift('');
    setIsDaily(true);
    setEditingTask(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess(false);

    try {
      const url = editingTask ? `/api/ops/tasks/${editingTask.id}` : '/api/ops/tasks';
      const method = editingTask ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          description,
          role,
          employeeType: employeeType || null,
          shift: shift || null,
          isDaily,
        }),
      });

      if (response.ok) {
        setSuccess(true);
        setIsDialogOpen(false);
        resetForm();
        fetchTasks();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to save task');
      }
    } catch (error) {
      setError('An error occurred while saving the task');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setTitle(task.title);
    setDescription(task.description || '');
    setRole(task.role);
    setEmployeeType(task.employeeType || '');
    setShift(task.shift || '');
    setIsDaily(task.isDaily);
    setIsDialogOpen(true);
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    
    try {
      const response = await fetch(`/api/ops/tasks/${taskId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchTasks();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to delete task');
      }
    } catch (error) {
      setError('An error occurred while deleting the task');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Task Management</h3>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}>
              <Plus className="h-4 w-4 mr-2" />
              Add Task
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{editingTask ? 'Edit Task' : 'Add New Task'}</DialogTitle>
              <DialogDescription>
                {editingTask ? 'Update the task details.' : 'Create a new task for employees.'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Task title"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Task description"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select value={role} onValueChange={setRole} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="ops">Operations</SelectItem>
                    <SelectItem value="finance">Finance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {role === 'employee' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="employeeType">Employee Type</Label>
                    <Select value={employeeType} onValueChange={setEmployeeType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select employee type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pic">PIC</SelectItem>
                        <SelectItem value="so">SO</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="shift">Shift</Label>
                    <Select value={shift} onValueChange={setShift}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select shift" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="morning">Morning</SelectItem>
                        <SelectItem value="evening">Evening</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isDaily"
                  checked={isDaily}
                  onChange={(e) => setIsDaily(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="isDaily">Daily Task</Label>
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {success && (
                <Alert>
                  <AlertDescription>Task saved successfully!</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Saving...' : 'Save Task'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Daily</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-4">
                    No tasks found. Create your first task.
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">{task.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{task.role}</Badge>
                    </TableCell>
                    <TableCell>{task.employeeType || '-'}</TableCell>
                    <TableCell>{task.shift || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={task.isDaily ? 'default' : 'secondary'}>
                        {task.isDaily ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(task)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(task.id)}
                        >
                          <Trash2 className="h-4 w-4" />
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