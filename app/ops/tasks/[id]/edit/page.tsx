// app/ops/tasks/[id]/edit/page.tsx
import { use } from 'react';
import TaskForm from '@/components/ops/TaskForm';

// In Next.js 15, `params` is a Promise — must be unwrapped with React.use()
export default function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <TaskForm taskId={id} />;
}