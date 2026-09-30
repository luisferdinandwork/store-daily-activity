import { db } from '@/lib/db';
import { schedules, stores, shifts } from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function endOfDay(d: Date) { const r = new Date(d); r.setHours(23,59,59,999); return r; }

async function main() {
  const [store] = await db.select().from(stores).where(eq(stores.storeNo, 'DUMMY-001')).limit(1);
  const today = new Date();
  const rows = await db.select().from(schedules).where(and(
    eq(schedules.storeId, store.id),
    eq(schedules.userId, 'EMP-014'),
    gte(schedules.date, startOfDay(today)),
    lte(schedules.date, endOfDay(today)),
  ));
  console.log(JSON.stringify(rows, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
