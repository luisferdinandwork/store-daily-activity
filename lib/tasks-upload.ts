// lib/tasks-upload.ts
// Client-side helper for posting a captured photo to the shared tasks upload
// endpoint. Used by every PhotoUploader across the task pages so the fetch /
// error-handling logic isn't duplicated per page.

export async function uploadTaskPhoto(file: File, photoType: string): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('photoType', photoType);

  const res = await fetch('/api/employee/tasks/upload', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload gagal');
  return data.url as string;
}
