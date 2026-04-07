// lib/db/schema/index.ts
export * from './enums';
export * from './lookups';
export * from './core';
export * from './tasks';

import * as enums   from './enums';
import * as lookups from './lookups';
import * as core    from './core';
import * as tasks   from './tasks';

export const schema = { ...enums, ...lookups, ...core, ...tasks };