// app/api/employee/tasks/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// Only import @vercel/blob if it's available and we're in production
let put: any;
if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV) {
  try {
    const blob = require('@vercel/blob');
    put = blob.put;
  } catch (error) {
    console.error('Failed to load @vercel/blob:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }
    
    // Get file bytes
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    let url: string;
    
    // Use Vercel Blob in production if available, otherwise use local storage
    if (put && process.env.VERCEL_ENV) {
      // Upload to Vercel Blob
      const blob = await put(`tasks/${session.user.id}/${Date.now()}-${file.name}`, file, {
        access: 'public',
      });
      url = blob.url;
    } else {
      // Use local storage
      const timestamp = Date.now();
      const filename = `${session.user.id}-${timestamp}-${file.name}`;
      
      // Define the upload directory path
      const uploadDir = join(process.cwd(), 'public', 'uploads', 'tasks');
      
      // Create the directory if it doesn't exist
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }
      
      // Write the file to the local filesystem
      const filePath = join(uploadDir, filename);
      await writeFile(filePath, buffer);
      
      // Return the URL that can be accessed from the frontend
      url = `/uploads/tasks/${filename}`;
    }
    
    return NextResponse.json({ url });
  } catch (error) {
    console.error('Error uploading file:', error);
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    );
  }
}