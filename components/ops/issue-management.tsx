// components/ops/issue-management.tsx
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertCircle, CheckCircle, Clock, Eye } from 'lucide-react';
import { format } from 'date-fns';

interface Issue {
  id: string;
  title: string;
  description: string;
  status: 'reported' | 'in_review' | 'resolved';
  createdAt: string;
  userId: string;
  userName: string;
  storeId: string;
  storeName: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

interface IssueManagementProps {
  issues: Issue[];
  userId: string;
}

export function IssueManagement({ issues, userId }: IssueManagementProps) {
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filteredIssues = filterStatus === 'all' 
    ? issues 
    : issues.filter(issue => issue.status === filterStatus);

  const handleViewIssue = (issue: Issue) => {
    setSelectedIssue(issue);
    setIsDialogOpen(true);
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedIssue) return;
    
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/ops/issues/${selectedIssue.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: newStatus,
          reviewedBy: userId,
          reviewNotes,
        }),
      });

      if (response.ok) {
        // Refresh the page to show updated issues
        window.location.reload();
      } else {
        console.error('Failed to update issue status');
      }
    } catch (error) {
      console.error('Error updating issue status:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'resolved':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'in_review':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'resolved':
        return <Badge variant="default" className="bg-green-500">Resolved</Badge>;
      case 'in_review':
        return <Badge variant="secondary" className="bg-yellow-500">In Review</Badge>;
      default:
        return <Badge variant="outline" className="text-red-500">Reported</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Issue Management</h3>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Issues</SelectItem>
            <SelectItem value="reported">Reported</SelectItem>
            <SelectItem value="in_review">In Review</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Reported By</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredIssues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-4">
                    No issues found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredIssues.map((issue) => (
                  <TableRow key={issue.id}>
                    <TableCell className="font-medium">{issue.title}</TableCell>
                    <TableCell>{issue.storeName}</TableCell>
                    <TableCell>{issue.userName}</TableCell>
                    <TableCell>{format(new Date(issue.createdAt), 'MMM d, yyyy')}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(issue.status)}
                        {getStatusBadge(issue.status)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewIssue(issue)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedIssue && getStatusIcon(selectedIssue.status)}
              Issue Details
            </DialogTitle>
            <DialogDescription>
              Review and manage the reported issue.
            </DialogDescription>
          </DialogHeader>
          {selectedIssue && (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium">{selectedIssue.title}</h4>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedIssue.description}
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Store:</span> {selectedIssue.storeName}
                </div>
                <div>
                  <span className="font-medium">Reported by:</span> {selectedIssue.userName}
                </div>
                <div>
                  <span className="font-medium">Date:</span> {format(new Date(selectedIssue.createdAt), 'MMM d, yyyy')}
                </div>
                <div>
                  <span className="font-medium">Status:</span> {getStatusBadge(selectedIssue.status)}
                </div>
              </div>

              {selectedIssue.reviewedAt && (
                <div className="text-sm">
                  <span className="font-medium">Reviewed on:</span> {format(new Date(selectedIssue.reviewedAt), 'MMM d, yyyy')}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="review-notes" className="text-sm font-medium">
                  Review Notes
                </label>
                <Textarea
                  id="review-notes"
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Add notes about this issue..."
                  rows={3}
                />
              </div>

              <div className="flex gap-2">
                {selectedIssue.status === 'reported' && (
                  <Button
                    onClick={() => handleUpdateStatus('in_review')}
                    disabled={isUpdating}
                  >
                    {isUpdating ? 'Updating...' : 'Mark as In Review'}
                  </Button>
                )}
                {selectedIssue.status === 'in_review' && (
                  <Button
                    onClick={() => handleUpdateStatus('resolved')}
                    disabled={isUpdating}
                  >
                    {isUpdating ? 'Updating...' : 'Mark as Resolved'}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}