// lib/db/utils/petty-cash-used.ts
//
// SQL for "does this request count as used?" — one place, so the Finance transactions list, the report and
// the monitoring view can't disagree. A completed request counts unless Finance's decision on it is still
// standing: Perlu Perbaikan, Ditolak, or corrected and not yet re-accepted (lib/petty-cash-review.ts).

import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { LEFT_OUT_REVIEWS } from '@/lib/petty-cash-review';

const leftOut = sql.raw(LEFT_OUT_REVIEWS.map((r) => `'${r}'`).join(', '));

/** True when the request's `finance_review` doesn't take it out of "used". Use inside `SUM(..) FILTER (WHERE …)`. */
export const countsAsUsed = (review: AnyColumn): SQL => sql`(${review} IS NULL OR ${review} NOT IN (${leftOut}))`;
