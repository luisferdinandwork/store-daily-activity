// scripts/seed/petty-cash.ts
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  PETTY_CASH_MAX_BALANCE,
  pettyCashPeriods,
  pettyCashRefills,
  pettyCashTransactions,
  stores,
  userRoles,
  users,
} from '@/lib/db/schema';

function getJakartaMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;

  return `${year}-${month}`;
}

function addMonths(ym: string, amount: number) {
  const [year, month] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + amount, 1));

  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Clamps to "today" when seeding the current month, so transactions never
// land on a future date within it — cosmetic only, doesn't affect balances.
function dateInMonth(yearMonth: string, day: number, hour = 10, minute = 0) {
  const [year, month] = yearMonth.split('-').map(Number);

  const clampedDay =
    yearMonth === getJakartaMonth() ? Math.min(day, todayJakartaDate()) : day;

  return new Date(year, month - 1, clampedDay, hour, minute, 0);
}

function todayJakartaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
  }).formatToParts(new Date());

  return Number(parts.find((p) => p.type === 'day')?.value ?? 1);
}

function money(value: number) {
  return value.toLocaleString('id-ID');
}

function envBoolean(name: string, defaultValue = false) {
  const value = process.env[name];

  if (!value) return defaultValue;

  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
}

// Defaults to the CURRENT month — this is the month the app's employee/
// finance pages actually query by default, so a fresh seed is immediately
// visible without having to set SEED_PETTY_CASH_MONTH. Override with
// SEED_PETTY_CASH_MONTH=YYYY-MM to seed a different month (e.g. previous
// month, to test the refill/carry-forward flow into "this" month).
const SEED_MONTH = process.env.SEED_PETTY_CASH_MONTH?.trim() || getJakartaMonth();

const NEXT_MONTH = addMonths(SEED_MONTH, 1);

const RESET_EXISTING = envBoolean('SEED_PETTY_CASH_RESET', true);

/**
 * Default false:
 * every store starts with a clean period at full balance and NO
 * transactions — nothing pending, nothing to approve. This is the safe
 * default: OPS/Finance approval routes deduct balance at approval time, so
 * any store you want to test the request → approve → refill flow on should
 * start with no pre-existing requests, not synthetic ones that fight the
 * real flow over the same balance.
 *
 * Set true:
 * each store also gets a handful of sample transactions (for exercising the
 * history list / Finance dashboard without manually creating requests).
 */
const SEED_TRANSACTIONS = envBoolean('SEED_PETTY_CASH_TX', false);

/**
 * Only relevant when SEED_PETTY_CASH_TX=true.
 *
 * Default false:
 * all sample transactions are seeded as already OPS-approved, so Finance
 * page shows "Ready to refill".
 *
 * Set true:
 * the first store's last transaction is seeded as still pending_ops, so you
 * can test OPS's "Needs review" / approve-reject flow on it specifically.
 */
const INCLUDE_PENDING = envBoolean('SEED_PETTY_CASH_PENDING', false);

/**
 * Default false:
 * SEED_MONTH is seeded as open and ready to refill.
 *
 * Set true:
 * SEED_MONTH is already closed/refilled and the next month's period is created.
 */
const SEED_AS_CLOSED = envBoolean('SEED_PETTY_CASH_CLOSED', false);

const TX_TEMPLATES = [
  {
    amount: 125_000,
    description: 'Cleaning supplies and tissue refill',
  },
  {
    amount: 185_000,
    description: 'Local delivery and parking operational cost',
  },
  {
    amount: 225_000,
    description: 'Small store maintenance supplies',
  },
  {
    amount: 275_000,
    description: 'Emergency fixture and display repair',
  },
  {
    amount: 95_000,
    description: 'Stationery and admin supplies',
  },
];

async function getFinanceUser() {
  const [financeUser] = await db
    .select({
      id: users.id,
      name: users.name,
    })
    .from(users)
    .innerJoin(userRoles, eq(users.roleId, userRoles.id))
    .where(and(eq(userRoles.code, 'finance'), eq(users.isActive, true)))
    .limit(1);

  if (financeUser) return financeUser;

  const [fallbackUser] = await db
    .select({
      id: users.id,
      name: users.name,
    })
    .from(users)
    .where(eq(users.isActive, true))
    .limit(1);

  return fallbackUser ?? null;
}

async function getOpsUser() {
  const [opsUser] = await db
    .select({
      id: users.id,
      name: users.name,
    })
    .from(users)
    .innerJoin(userRoles, eq(users.roleId, userRoles.id))
    .where(and(eq(userRoles.code, 'ops'), eq(users.isActive, true)))
    .limit(1);

  return opsUser ?? null;
}

export async function seedPettyCash() {
  console.log(`🌱 seed-petty-cash: ${SEED_MONTH}`);
  console.log(`   reset existing: ${RESET_EXISTING ? 'yes' : 'no'}`);
  console.log(`   seed sample transactions: ${SEED_TRANSACTIONS ? 'yes' : 'no'}`);
  if (SEED_TRANSACTIONS) console.log(`   include pending: ${INCLUDE_PENDING ? 'yes' : 'no'}`);
  console.log(`   seed as closed/refilled: ${SEED_AS_CLOSED ? 'yes' : 'no'}`);

  const financeUser = await getFinanceUser();

  if (!financeUser) {
    throw new Error('No active user found. Run "npm run db:seed" (setup step) first.');
  }

  // Falls back to the finance user if no OPS account exists yet — only used
  // as the approved_by stamp on sample transactions, so a sane fallback is
  // fine and keeps this seeder usable even on a bare-bones setup.
  const opsUser = (await getOpsUser()) ?? financeUser;

  const storeRows = await db
    .select({
      id: stores.id,
      storeNo: stores.storeNo,
      name: stores.name,
    })
    .from(stores)
    .orderBy(stores.storeNo);

  if (storeRows.length === 0) {
    throw new Error('No stores found. Run "npm run db:seed" (setup step) first.');
  }

  const employeeRows = await db
    .select({
      id: users.id,
      name: users.name,
      homeStoreId: users.homeStoreId,
    })
    .from(users)
    .where(eq(users.isActive, true));

  const employeesByStore = new Map<number, typeof employeeRows>();

  for (const employee of employeeRows) {
    if (!employee.homeStoreId) continue;

    const list = employeesByStore.get(employee.homeStoreId) ?? [];
    list.push(employee);
    employeesByStore.set(employee.homeStoreId, list);
  }

  if (RESET_EXISTING) {
    console.log(`🧹 clearing existing petty cash data for ${SEED_MONTH}...`);

    await db
      .delete(pettyCashRefills)
      .where(eq(pettyCashRefills.yearMonth, SEED_MONTH));

    await db
      .delete(pettyCashTransactions)
      .where(eq(pettyCashTransactions.yearMonth, SEED_MONTH));

    await db
      .delete(pettyCashPeriods)
      .where(eq(pettyCashPeriods.yearMonth, SEED_MONTH));
  }

  let totalTransactions = 0;
  let totalSpend = 0;

  for (let storeIndex = 0; storeIndex < storeRows.length; storeIndex++) {
    const store = storeRows[storeIndex];

    const storeEmployees = employeesByStore.get(store.id) ?? [];
    const submitter = storeEmployees[0] ?? financeUser;

    // Each entry already knows its own final status — 'ops_approved' unless
    // this is the one sample transaction (first store's last one) deliberately
    // left pending for testing OPS's review flow. Only the approved ones have
    // actually been deducted from the store's balance, mirroring exactly what
    // the real approve endpoint does — so re-approving one of these through
    // the UI hits fresh, untouched balance instead of double-deducting.
    const txCount = SEED_TRANSACTIONS ? 2 + (store.id % 3) : 0;
    const txTemplates = Array.from({ length: txCount }).map((_, i) => {
      const templateIndex = (storeIndex + i) % TX_TEMPLATES.length;
      const isLast = i === txCount - 1;
      const pending = INCLUDE_PENDING && storeIndex === 0 && isLast;
      return { ...TX_TEMPLATES[templateIndex], status: pending ? ('pending_ops' as const) : ('ops_approved' as const) };
    });

    const monthlySpend = txTemplates
      .filter((tx) => tx.status === 'ops_approved')
      .reduce((sum, tx) => sum + tx.amount, 0);
    const currentBalance = Math.max(0, PETTY_CASH_MAX_BALANCE - monthlySpend);

    const [period] = await db
      .insert(pettyCashPeriods)
      .values({
        storeId: store.id,
        yearMonth: SEED_MONTH,
        openingBalance: String(PETTY_CASH_MAX_BALANCE),
        currentBalance: String(currentBalance),
        closingBalance: SEED_AS_CLOSED ? String(currentBalance) : null,
        status: SEED_AS_CLOSED ? 'closed' : 'open',
        closedBy: SEED_AS_CLOSED ? financeUser.id : null,
        closedAt: SEED_AS_CLOSED ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [pettyCashPeriods.storeId, pettyCashPeriods.yearMonth],
        set: {
          openingBalance: String(PETTY_CASH_MAX_BALANCE),
          currentBalance: String(currentBalance),
          closingBalance: SEED_AS_CLOSED ? String(currentBalance) : null,
          status: SEED_AS_CLOSED ? 'closed' : 'open',
          closedBy: SEED_AS_CLOSED ? financeUser.id : null,
          closedAt: SEED_AS_CLOSED ? new Date() : null,
        },
      })
      .returning({
        id: pettyCashPeriods.id,
      });

    for (let txIndex = 0; txIndex < txTemplates.length; txIndex++) {
      const txTemplate = txTemplates[txIndex];
      const isPending = txTemplate.status === 'pending_ops';

      const createdAt = dateInMonth(
        SEED_MONTH,
        3 + txIndex * 6 + (storeIndex % 3),
        9 + txIndex,
        15,
      );

      await db.insert(pettyCashTransactions).values({
        periodId: period.id,
        storeId: store.id,
        userId: submitter.id,
        amount: String(txTemplate.amount),
        description: txTemplate.description,
        status: txTemplate.status,
        imageUrl: isPending
          ? null
          : `https://placehold.co/600x800/e2e8f0/475569?text=Receipt+${encodeURIComponent(
              store.storeNo,
            )}+${txIndex + 1}`,
        imageKey: isPending ? null : `seed/petty-cash/${SEED_MONTH}/${store.storeNo}-${txIndex + 1}.jpg`,
        yearMonth: SEED_MONTH,
        approvedBy: isPending ? null : opsUser.id,
        approvedAt: isPending ? null : createdAt,
        createdAt,
      });

      totalTransactions++;
      if (!isPending) totalSpend += txTemplate.amount;
    }

    if (SEED_AS_CLOSED) {
      await db
        .insert(pettyCashRefills)
        .values({
          storeId: store.id,
          yearMonth: SEED_MONTH,
          nextYearMonth: NEXT_MONTH,
          refillAmount: String(PETTY_CASH_MAX_BALANCE - currentBalance),
          balanceBefore: String(currentBalance),
          balanceAfter: String(PETTY_CASH_MAX_BALANCE),
          refillBy: financeUser.id,
          notes: 'Seeded previous-month petty cash refill.',
        })
        .onConflictDoNothing({
          target: [pettyCashRefills.storeId, pettyCashRefills.yearMonth],
        });

      await db
        .insert(pettyCashPeriods)
        .values({
          storeId: store.id,
          yearMonth: NEXT_MONTH,
          openingBalance: String(PETTY_CASH_MAX_BALANCE),
          currentBalance: String(PETTY_CASH_MAX_BALANCE),
          status: 'open',
        })
        .onConflictDoNothing({
          target: [pettyCashPeriods.storeId, pettyCashPeriods.yearMonth],
        });

      await db
        .update(stores)
        .set({
          pettyCashBalance: String(PETTY_CASH_MAX_BALANCE),
        })
        .where(eq(stores.id, store.id));
    }

    console.log(
      `✓ ${store.storeNo} ${store.name} — ${txCount} tx, spend Rp${money(
        monthlySpend,
      )}, balance Rp${money(currentBalance)}`,
    );
  }

  console.log('');
  console.log('✅ Petty cash seed complete.');
  console.log(`   Month: ${SEED_MONTH}`);
  console.log(`   Stores: ${storeRows.length}`);
  console.log(`   Transactions: ${totalTransactions}`);
  console.log(`   Total spend: Rp${money(totalSpend)}`);
  console.log(`   Finance verifier: ${financeUser.name}`);
}

