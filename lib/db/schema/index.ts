// lib/db/schema/index.ts
export * from './enums';
export * from './lookups';
export * from './core';
export * from './petty-cash';
export * from './tasks';
export * from './shift-tasks';
export * from './performance';
export * from './target-allocation';
export * from './notifications';
export * from './impact-visits';       // ← NEW: OPS store-visit audit
export * from './manuals';             // ← NEW: Knowledge Manual library
export * from './item-transfers';      // ← NEW: BC transfer order pipeline

import * as enums            from './enums';
import * as lookups          from './lookups';
import * as core             from './core';
import * as pettyCash        from './petty-cash';
import * as tasks            from './tasks';
import * as shiftTasks       from './shift-tasks';
import * as performance      from './performance';
import * as targetAllocation from './target-allocation';
import * as notifications    from './notifications';
import * as impactVisits     from './impact-visits';        // ← NEW
import * as manuals          from './manuals';               // ← NEW
import * as itemTransfers    from './item-transfers';        // ← NEW

export const schema = {
  ...enums,
  ...lookups,
  ...core,
  ...pettyCash,
  ...tasks,
  ...shiftTasks,
  ...performance,
  ...targetAllocation,
  ...notifications,
  ...impactVisits,   // ← NEW
  ...manuals,         // ← NEW
  ...itemTransfers,   // ← NEW
};