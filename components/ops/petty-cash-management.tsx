// components/ops/petty-cash-management.tsx
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DollarSign, Eye, CheckCircle, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Select } from 'radix-ui';
import { SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface Transaction {
  id: string;
  amount: string;
  description: string;
  userId: string;
  userName: string;
  storeId: string;
  storeName: string;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
  approvedByName?: string;
}

interface Store {
  id: string;
  name: string;
  pettyCashBalance: string;
}

interface PettyCashManagementProps {
  transactions: Transaction[];
  stores: Store[];
  userId: string;
}

export function PettyCashManagement({ transactions, stores, userId }: PettyCashManagementProps) {
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('pending');
  const [selectedStore, setSelectedStore] = useState<string>('all');

  const filteredTransactions = transactions.filter(transaction => {
    const statusMatch = filterStatus === 'all' || 
      (filterStatus === 'pending' && !transaction.approvedAt) ||
      (filterStatus === 'approved' && transaction.approvedAt);
    
    const storeMatch = selectedStore === 'all' || transaction.storeId === selectedStore;
    
    return statusMatch && storeMatch;
  });

  const handleViewTransaction = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsDialogOpen(true);
  };

  const handleApprove = async () => {
    if (!selectedTransaction) return;
    
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/ops/petty-cash/${selectedTransaction.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          approved: true,
          approvedBy: userId,
          approvalNotes,
        }),
      });

      if (response.ok) {
        // Refresh the page to show updated transactions
        window.location.reload();
      } else {
        console.error('Failed to approve transaction');
      }
    } catch (error) {
      console.error('Error approving transaction:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReject = async () => {
    if (!selectedTransaction) return;
    
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/ops/petty-cash/${selectedTransaction.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          approved: false,
          approvedBy: userId,
          approvalNotes,
        }),
      });

      if (response.ok) {
        // Refresh the page to show updated transactions
        window.location.reload();
      } else {
        console.error('Failed to reject transaction');
      }
    } catch (error) {
      console.error('Error rejecting transaction:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const getStatusBadge = (approved: boolean | undefined) => {
    if (approved === undefined) {
      return <Badge variant="outline" className="text-yellow-500">Pending</Badge>;
    }
    return approved 
      ? <Badge variant="default" className="bg-green-500">Approved</Badge>
      : <Badge variant="destructive">Rejected</Badge>;
  };

  const getStoreBalance = (storeId: string) => {
    const store = stores.find(s => s.id === storeId);
    return store ? parseFloat(store.pettyCashBalance) : 0;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Petty Cash Management</h3>
        <div className="flex gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {stores.map((store) => (
          <Card key={store.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{store.name}</CardTitle>
              <CardDescription>Petty Cash Balance</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <DollarSign className="h-5 w-5 text-muted-foreground mr-2" />
                <span className="text-2xl font-bold">
                  Rp {parseFloat(store.pettyCashBalance).toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Requested By</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-4">
                    No transactions found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredTransactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell className="font-medium">{transaction.description}</TableCell>
                    <TableCell>{transaction.storeName}</TableCell>
                    <TableCell>{transaction.userName}</TableCell>
                    <TableCell>Rp {parseFloat(transaction.amount).toLocaleString()}</TableCell>
                    <TableCell>{format(new Date(transaction.createdAt), 'MMM d, yyyy')}</TableCell>
                    <TableCell>{getStatusBadge(transaction.approvedAt !== undefined)}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewTransaction(transaction)}
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
              <DollarSign className="h-5 w-5" />
              Petty Cash Transaction Details
            </DialogTitle>
            <DialogDescription>
              Review and approve or reject this petty cash transaction.
            </DialogDescription>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium">{selectedTransaction.description}</h4>
                <p className="text-2xl font-bold mt-2">
                  Rp {parseFloat(selectedTransaction.amount).toLocaleString()}
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Store:</span> {selectedTransaction.storeName}
                </div>
                <div>
                  <span className="font-medium">Current Balance:</span> Rp {getStoreBalance(selectedTransaction.storeId).toLocaleString()}
                </div>
                <div>
                  <span className="font-medium">Requested by:</span> {selectedTransaction.userName}
                </div>
                <div>
                  <span className="font-medium">Date:</span> {format(new Date(selectedTransaction.createdAt), 'MMM d, yyyy')}
                </div>
                <div>
                  <span className="font-medium">Status:</span> {getStatusBadge(selectedTransaction.approvedAt !== undefined)}
                </div>
                {selectedTransaction.approvedAt && (
                  <div>
                    <span className="font-medium">Approved by:</span> {selectedTransaction.approvedByName}
                  </div>
                )}
              </div>

              {!selectedTransaction.approvedAt && (
                <div className="space-y-2">
                  <label htmlFor="approval-notes" className="text-sm font-medium">
                    Approval Notes
                  </label>
                  <Textarea
                    id="approval-notes"
                    value={approvalNotes}
                    onChange={(e) => setApprovalNotes(e.target.value)}
                    placeholder="Add notes about this transaction..."
                    rows={3}
                  />
                </div>
              )}

              <div className="flex gap-2">
                {!selectedTransaction.approvedAt && (
                  <>
                    <Button
                      onClick={handleApprove}
                      disabled={isUpdating}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      {isUpdating ? 'Processing...' : 'Approve'}
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