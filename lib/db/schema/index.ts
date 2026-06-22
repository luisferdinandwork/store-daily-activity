// lib/db/schema/index.ts
export * from './enums';
export * from './lookups';
export * from './core';
export * from './petty-cash';   // ← NEW: pettyCashTransactions + pettyCashRefills
export * from './tasks';
export * from './shift-tasks';
export * from './performance';

import * as enums       from './enums';
import * as lookups     from './lookups';
import * as core        from './core';
import * as pettyCash   from './petty-cash';  // ← NEW
import * as tasks       from './tasks';
import * as shiftTasks  from './shift-tasks';
import * as performance from './performance';

export const schema = {
  ...enums,
  ...lookups,
  ...core,
  ...pettyCash,   // ← NEW
  ...tasks,
  ...shiftTasks,
  ...performance,
};