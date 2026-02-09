// components/ops/report-management.tsx
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FileText, Eye, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';


interface Report {
  id: string;
  type: 'BOD' | 'EOD';
  date: string;
  actualAmount: string;
  roundedAmount: string;
  status: 'draft' | 'submitted' | 'verified' | 'rejected';
  userId: string;
  userName: string;
  storeId: string;
  storeName: string;
  createdAt: string;
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  issueId?: string;
  issueTitle?: string;
}

interface Store {
  id: string;
  name: string;
}

interface ReportManagementProps {
  reports: Report[];
  stores: Store[];
  userId: string;
}

export function ReportManagement({ reports, stores, userId }: ReportManagementProps) {
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [verificationNotes, setVerificationNotes] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('submitted');
  const [selectedStore, setSelectedStore] = useState<string>('all');

  const filteredReports = reports.filter(report => {
    const statusMatch = filterStatus === 'all' || report.status === filterStatus;
    const storeMatch = selectedStore === 'all' || report.storeId === selectedStore;
    return statusMatch && storeMatch;
  });

  const handleViewReport = (report: Report) => {
    setSelectedReport(report);
    setIsDialogOpen(true);
  };

  const handleVerify = async () => {
    if (!selectedReport) return;
    
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/ops/reports/${selectedReport.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          verified: true,
          verifiedBy: userId,
          verificationNotes,
        }),
      });

      if (response.ok) {
        // Refresh the page to show updated reports
        window.location.reload();
      } else {
        console.error('Failed to verify report');
      }
    } catch (error) {
      console.error('Error verifying report:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReject = async () => {
    if (!selectedReport) return;
    
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/ops/reports/${selectedReport.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          verified: false,
          verifiedBy: userId,
          verificationNotes,
        }),
      });

      if (response.ok) {
        // Refresh the page to show updated reports
        window.location.reload();
      } else {
        console.error('Failed to reject report');
      }
    } catch (error) {
      console.error('Error rejecting report:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'verified':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'rejected':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'submitted':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <FileText className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified':
        return <Badge variant="default" className="bg-green-500">Verified</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      case 'submitted':
        return <Badge variant="secondary" className="bg-yellow-500">Submitted</Badge>;
      default:
        return <Badge variant="outline">Draft</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Report Management</h3>
        <div className="flex gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedStore} onValueChange={setSelectedStore}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by store" />
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
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actual Amount</TableHead>
                <TableHead>Rounded Amount</TableHead>
                <TableHead>Submitted By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-4">
                    No reports found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredReports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="font-medium">{report.type}</TableCell>
                    <TableCell>{report.storeName}</TableCell>
                    <TableCell>{format(new Date(report.date), 'MMM d, yyyy')}</TableCell>
                    <TableCell>Rp {parseFloat(report.actualAmount).toLocaleString()}</TableCell>
                    <TableCell>Rp {parseFloat(report.roundedAmount).toLocaleString()}</TableCell>
                    <TableCell>{report.userName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(report.status)}
                        {getStatusBadge(report.status)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewReport(report)}
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
              <FileText className="h-5 w-5" />
              {selectedReport?.type} Report Details
            </DialogTitle>
            <DialogDescription>
              Review and verify or reject this report.
            </DialogDescription>
          </DialogHeader>
          {selectedReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="font-medium">Report Type:</span> {selectedReport.type}
                </div>
                <div>
                  <span className="font-medium">Store:</span> {selectedReport.storeName}
                </div>
                <div>
                  <span className="font-medium">Date:</span> {format(new Date(selectedReport.date), 'MMM d, yyyy')}
                </div>
                <div>
                  <span className="font-medium">Submitted by:</span> {selectedReport.userName}
                </div>
                <div>
                  <span className="font-medium">Actual Amount:</span> Rp {parseFloat(selectedReport.actualAmount).toLocaleString()}
                </div>
                <div>
                  <span className="font-medium">Rounded Amount:</span> Rp {parseFloat(selectedReport.roundedAmount).toLocaleString()}
                </div>
                <div>
                  <span className="font-medium">Status:</span> {getStatusBadge(selectedReport.status)}
                </div>
                <div>
                  <span className="font-medium">Created:</span> {format(new Date(selectedReport.createdAt), 'MMM d, yyyy')}
                </div>
              </div>

              {selectedReport.issueId && (
                <div className="bg-muted p-3 rounded-md">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">Related Issue:</span>
                  </div>
                  <p className="text-sm">{selectedReport.issueTitle}</p>
                </div>
              )}

              {selectedReport.verifiedAt && (
                <div className="text-sm">
                  <span className="font-medium">Verified by:</span> {selectedReport.verifiedByName} on {format(new Date(selectedReport.verifiedAt), 'MMM d, yyyy')}
                </div>
              )}

              {selectedReport.status === 'submitted' && (
                <div className="space-y-2">
                  <label htmlFor="verification-notes" className="text-sm font-medium">
                    Verification Notes
                  </label>
                  <Textarea
                    id="verification-notes"
                    value={verificationNotes}
                    onChange={(e) => setVerificationNotes(e.target.value)}
                    placeholder="Add notes about this report..."
                    rows={3}
                  />
                </div>
              )}

              <div className="flex gap-2">
                {selectedReport.status === 'submitted' && (
                  <>
                    <Button
                      onClick={handleVerify}
                      disabled={isUpdating}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      {isUpdating ? 'Processing...' : 'Verify'}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleReject}
                      disabled={isUpdating}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      {isUpdating ? 'Processing...' : 'Reject'}
                    </Button>
                  </>
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