// scripts/seed-petty-cash.ts
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

function dateInMonth(yearMonth: string, day: number, hour = 10, minute = 0) {
  const [year, month] = yearMonth.split('-').map(Number);

  return new Date(year, month - 1, day, hour, minute, 0);
}

function money(value: number) {
  return value.toLocaleString('id-ID');
}

function envBoolean(name: string, defaultValue = false) {
  const value = process.env[name];

  if (!value) return defaultValue;

  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
}

const SEED_MONTH =
  process.env.SEED_PETTY_CASH_MONTH?.trim() || addMonths(getJakartaMonth(), -1);

const NEXT_MONTH = addMonths(SEED_MONTH, 1);

const RESET_EXISTING = envBoolean('SEED_PETTY_CASH_RESET', true);

/**
 * Default false:
 * all transactions are verified, so Finance page shows "Ready to refill".
 *
 * Set true:
 * first store will have 1 pending transaction, so you can test "Needs review".
 */
const INCLUDE_PENDING = envBoolean('SEED_PETTY_CASH_PENDING', false);

/**
 * Default false:
 * previous month is seeded as open and ready to refill.
 *
 * Set true:
 * previous month is already closed/refilled and next month period is created.
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

async function seedPettyCash() {
  console.log(`🌱 seed-petty-cash: ${SEED_MONTH}`);
  console.log(`   reset existing: ${RESET_EXISTING ? 'yes' : 'no'}`);
  console.log(`   include pending: ${INCLUDE_PENDING ? 'yes' : 'no'}`);
  console.log(`   seed as closed/refilled: ${SEED_AS_CLOSED ? 'yes' : 'no'}`);

  const financeUser = await getFinanceUser();

  if (!financeUser) {
    throw new Error('No active user found. Run seed:setup first.');
  }

  const storeRows = await db
    .select({
      id: stores.id,
      storeNo: stores.storeNo,
      name: stores.name,
    })
    .from(stores)
    .orderBy(stores.storeNo);

  if (storeRows.length === 0) {
    throw new Error('No stores found. Run seed:setup first.');
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

    const txCount = 2 + (store.id % 3);
    const txTemplates = Array.from({ length: txCount }).map((_, i) => {
      const templateIndex = (storeIndex + i) % TX_TEMPLATES.length;
      return TX_TEMPLATES[templateIndex];
    });

    const monthlySpend = txTemplates.reduce((sum, tx) => sum + tx.amount, 0);
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

      const isPending =
        INCLUDE_PENDING && storeIndex === 0 && txIndex === txTemplates.length - 1;

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
        imageUrl: `https://placehold.co/600x800/e2e8f0/475569?text=Receipt+${encodeURIComponent(
          store.storeNo,
        )}+${txIndex + 1}`,
        imageKey: `seed/petty-cash/${SEED_MONTH}/${store.storeNo}-${txIndex + 1}.jpg`,
        yearMonth: SEED_MONTH,
        verifiedBy: isPending ? null : financeUser.id,
        verifiedAt: isPending ? null : createdAt,
        createdAt,
      });

      totalTransactions++;
      totalSpend += txTemplate.amount;
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

seedPettyCash()
  .catch((error) => {
    console.error('❌ seed-petty-cash failed:', error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });