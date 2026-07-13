// lib/db/schema/index.ts
export * from './enums';
export * from './lookups';
export * from './core';
export * from './petty-cash';
export * from './tasks';
export * from './shift-tasks';
export * from './performance';
export * from './target-allocation';   // ← NEW: allocation templates + daily overrides

import * as enums            from './enums';
import * as lookups          from './lookups';
import * as core             from './core';
import * as pettyCash        from './petty-cash';
import * as tasks            from './tasks';
import * as shiftTasks       from './shift-tasks';
import * as performance      from './performance';
import * as targetAllocation from './target-allocation';   // ← NEW

export const schema = {
  ...enums,
  ...lookups,
  ...core,
  ...pettyCash,
  ...tasks,
  ...shiftTasks,
  ...performance,
  ...targetAllocation,   // ← NEW
};