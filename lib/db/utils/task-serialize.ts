// lib/db/utils/task-serialize.ts
//
// Shared serialization for FlatTask rows going to the frontend TaskDetailView
// (app/ops/tasks/progress/task-detail.tsx). Extracted so both the OPS task
// progress route and the PIC task progress route produce the exact same
// shape — TaskDetailView expects nested IDs (serah terima items, item return
// entries, cek uang modal denominations) as strings, not numbers.

import type { getFlatTasksForStoreDate } from './tasks';

export type RawFlatTask = Awaited<ReturnType<typeof getFlatTasksForStoreDate>>[number];

type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue };

function serializeUnknown(value: unknown): SerializableValue {
  if (value === null || value === undefined) return null;

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeUnknown);
  }

  if (typeof value === 'object') {
    const out: Record<string, SerializableValue> = {};

    for (const [key, item] of Object.entries(value)) {
      out[key] = serializeUnknown(item);
    }

    return out;
  }

  return String(value);
}

function normalizeNestedIds(
  value: SerializableValue,
  keys: readonly string[],
): SerializableValue {
  if (!Array.isArray(value)) return value;

  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;

    const out: Record<string, SerializableValue> = { ...item };

    for (const key of keys) {
      if (key in out) out[key] = String(out[key] ?? '');
    }

    return out;
  });
}

function serializeExtra(extra: Record<string, unknown> | null | undefined) {
  const safeExtra = (extra ?? {}) as Record<string, unknown>;
  const serialized = serializeUnknown(safeExtra) as Record<string, SerializableValue>;

  // Serah Terima uses nested handover items.
  if (Array.isArray(serialized.items)) {
    serialized.items = normalizeNestedIds(serialized.items, [
      'id',
      'taskId',
      'senderTaskId',
      'receiverTaskId',
    ]) as SerializableValue[];
  }

  // Item Return / Cek Uang Modal use nested rows too.
  if (Array.isArray(serialized.entries)) {
    serialized.entries = normalizeNestedIds(serialized.entries, [
      'id',
      'taskId',
      'storeId',
    ]) as SerializableValue[];
  }

  if (Array.isArray(serialized.denominations)) {
    serialized.denominations = normalizeNestedIds(serialized.denominations, [
      'id',
      'taskId',
      'storeId',
    ]) as SerializableValue[];
  }

  return serialized;
}

export function serializeTask(task: RawFlatTask) {
  return {
    ...task,
    id: String(task.id),
    scheduleId: String(task.scheduleId),
    storeId: String(task.storeId),
    parentTaskId:
      task.parentTaskId === null || task.parentTaskId === undefined
        ? null
        : Number(task.parentTaskId),
    extra: serializeExtra(task.extra),
  };
}
