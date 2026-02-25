// app/ops/stores/[storeId]/page.tsx
import { use } from 'react';
import StoreDetailClient from './StoreDetailClient';

export default function StoreDetailPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = use(params);
  return <StoreDetailClient storeId={storeId} />;
}