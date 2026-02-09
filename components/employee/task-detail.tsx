// app/components/employee/task-detail.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

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

interface TaskDetailProps {
  task: AssignedTask;
  onBack: () => void;
  onSubmit: (employeeTaskId: string, attachmentUrls: string[], notes: string) => Promise<void>;
}

export default function TaskDetail({ task, onBack, onSubmit }: TaskDetailProps) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const formatTime = () => {
    return new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      
      // Limit to max attachments allowed
      const maxAttachments = task?.task?.maxAttachments || 3;
      const updatedPhotos = [...photos, ...newFiles].slice(0, maxAttachments);
      setPhotos(updatedPhotos);
      
      // Only upload the new files
      const startIndex = photos.length;
      const newFilesToUpload = updatedPhotos.slice(startIndex);
      
      if (newFilesToUpload.length > 0) {
        // Upload each photo and get URL
        try {
          setIsUploading(true);
          const uploadPromises = newFilesToUpload.map(async (file) => {
            const formData = new FormData();
            formData.append('file', file);
            
            const response = await fetch('/api/employee/tasks/upload', {
              method: 'POST',
              body: formData,
            });
            
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || 'Failed to upload photo');
            }
            
            const data = await response.json();
            return data.url;
          });
          
          const newUrls = await Promise.all(uploadPromises);
          setPhotoUrls(prevUrls => [...prevUrls, ...newUrls]);
        } catch (error) {
          console.error('Error uploading photos:', error);
          toast.error(error instanceof Error ? error.message : 'Failed to upload photos');
          // Remove the files that failed to upload
          setPhotos(prevPhotos => prevPhotos.slice(0, startIndex));
        } finally {
          setIsUploading(false);
        }
      }
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(prevPhotos => prevPhotos.filter((_, i) => i !== index));
    setPhotoUrls(prevUrls => prevUrls.filter((_, i) => i !== index));
  };

  const handleSubmitTask = async () => {
    try {
      setIsSubmitting(true);
      
      // Validate required attachments
      if (task.task.requiresAttachment && photoUrls.length === 0) {
        toast.error('This task requires at least one photo attachment');
        return;
      }
      
      // Wait for any ongoing uploads to complete
      if (isUploading) {
        toast.error('Please wait for all photos to finish uploading');
        return;
      }
      
      console.log('Submitting task with:', {
        employeeTaskId: task.employeeTask.id,
        attachmentUrls: photoUrls,
        notes
      });
      
      await onSubmit(task.employeeTask.id, photoUrls, notes);
      
      toast.success('Task completed successfully!');
      setPhotos([]);
      setPhotoUrls([]);
      setNotes('');
    } catch (error) {
      console.error('Error completing task:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to complete task');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-primary rounded-b-2xl text-white px-6 pt-6 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-medium">{formatTime()}</div>
          <div className="flex gap-1">
            <div className="w-1 h-4 bg-white rounded"></div>
            <div className="w-1 h-4 bg-white rounded"></div>
            <div className="w-1 h-4 bg-white rounded"></div>
            <div className="w-1 h-4 bg-white rounded"></div>
          </div>
        </div>
        
        <button 
          onClick={onBack}
          className="mb-4 p-2 hover:bg-white/10 rounded-full transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        
        <h1 className="text-2xl font-bold">{task.task.title}</h1>
      </div>

      {/* Content */}
      <div className="px-6 py-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Title
          </label>
          <Input 
            value={task.task.title}
            disabled
            className="bg-gray-100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description
          </label>
          <Textarea 
            value={task.task.description || ''}
            disabled
            className="bg-gray-100 min-h-[80px]"
          />
        </div>

        {/* Notes Section */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Notes
          </label>
          <Textarea 
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any notes about this task..."
            className="min-h-[100px]"
          />
        </div>

        {/* Photo Upload Section */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Upload Photos {task.task.requiresAttachment && <span className="text-red-500">*</span>}
          </label>
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((index) => (
              <div key={index}>
                {photoUrls[index] ? (
                  <div className="relative h-28">
                    <img
                      src={photoUrls[index]}
                      alt={`Upload ${index + 1}`}
                      className="w-full h-full object-cover rounded-lg"
                    />
                    <button
                      onClick={() => removePhoto(index)}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                      id={`photo-${index}`}
                      disabled={index >= (task.task.maxAttachments || 3) || isUploading}
                    />
                    <label
                      htmlFor={`photo-${index}`}
                      className={`flex flex-col items-center justify-center h-28 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                        index >= (task.task.maxAttachments || 3) || isUploading
                          ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                          : 'border-purple-300 bg-purple-50 hover:bg-purple-100'
                      }`}
                    >
                      {photos[index] && !photoUrls[index] ? (
                        <div className="flex flex-col items-center justify-center">
                          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-primary mb-1"></div>
                          <span className="text-xs text-primary font-medium">Uploading...</span>
                        </div>
                      ) : (
                        <>
                          <Upload className="h-6 w-6 text-primary mb-1" />
                          <span className="text-xs text-primary font-medium">Upload Photo</span>
                        </>
                      )}
                    </label>
                  </>
                )}
              </div>
            ))}
          </div>
          {task.task.requiresAttachment && (
            <p className="text-xs text-red-500 mt-1">At least one photo is required for this task</p>
          )}
          {isUploading && (
            <p className="text-xs text-blue-500 mt-1">Please wait for photos to finish uploading...</p>
          )}
        </div>

        {/* Submit Button */}
        <Button
          onClick={handleSubmitTask}
          disabled={isSubmitting || isUploading || (task.task.requiresAttachment && photoUrls.length === 0)}
          className="w-full h-14 bg-primary hover:bg-primary/90 text-white rounded-full text-lg font-semibold shadow-lg"
        >
          {isSubmitting ? 'Submitting...' : 'Submit'}
        </Button>
      </div>
    </div>
  );
}