// scripts/seed-setup.ts
// Seeds: areas → stores → users → task templates → weekly schedule templates
// Run ONCE (or when you want to reset the base data).
// Run with: tsx scripts/seed-setup.ts

import { db } from '@/lib/db';
import {
  areas, users, stores, tasks,
  weeklyScheduleTemplates, weeklyScheduleEntries,
  schedules, attendance, employeeTasks, breakSessions,
} from '@/lib/db/schema';
import { hash } from 'bcrypt';

const SALT_ROUNDS = 10;

async function seedSetup() {
  console.log('🌱  seed-setup: areas / stores / users / tasks / templates\n');

  // ── 0. CLEAR ALL (ordered to respect FK constraints) ─────────────────────
  console.log('🗑️   Clearing existing data…');
  await db.delete(breakSessions);
  await db.delete(employeeTasks);
  await db.delete(attendance);
  await db.delete(schedules);
  await db.delete(weeklyScheduleEntries);
  await db.delete(weeklyScheduleTemplates);
  await db.delete(tasks);
  await db.delete(users);
  await db.delete(stores);
  await db.delete(areas);
  console.log('✓   Cleared\n');

  // ── 1. AREAS ──────────────────────────────────────────────────────────────
  // Each area is managed by one OPS user and contains multiple stores.
  console.log('🗺️   Creating areas…');
  const [areaJakartaPusat, areaJakartaSelatan] = await db.insert(areas).values([
    { name: 'Area Jakarta Pusat' },
    { name: 'Area Jakarta Selatan' },
  ]).returning();
  console.log('✓   2 areas\n');

  // ── 2. STORES ─────────────────────────────────────────────────────────────
  // Each store belongs to one area. Stores in the same area are managed by
  // the same OPS user.
  console.log('🏪  Creating stores…');
  const [store1, store2, store3] = await db.insert(stores).values([
    {
      name: 'Store Thamrin',
      address: 'Jl. Thamrin No. 1, Jakarta Pusat',
      areaId: areaJakartaPusat.id,
      pettyCashBalance: '1000000',
    },
    {
      name: 'Store Gambir',
      address: 'Jl. Gambir No. 10, Jakarta Pusat',
      areaId: areaJakartaPusat.id,    // same area as store1 → same OPS manages both
      pettyCashBalance: '1200000',
    },
    {
      name: 'Store Sudirman',
      address: 'Jl. Sudirman No. 52, Jakarta Selatan',
      areaId: areaJakartaSelatan.id,
      pettyCashBalance: '1500000',
    },
  ]).returning();
  console.log('✓   3 stores (2 in Jakarta Pusat area, 1 in Jakarta Selatan area)\n');

  // ── 3. USERS ──────────────────────────────────────────────────────────────
  //
  // Role / employeeType matrix:
  //   ops      → role:'ops',      employeeType: null,    areaId: <area>,  storeId: null
  //   pic_1    → role:'employee', employeeType:'pic_1',  areaId: null,    storeId: <store>
  //   pic_2    → role:'employee', employeeType:'pic_2',  areaId: null,    storeId: <store>
  //   so       → role:'employee', employeeType:'so',     areaId: null,    storeId: <store>
  //
  // PIC 1 is the schedule owner for their store.
  // PIC 2 is a senior employee with no schedule management permissions.
  // OPS oversees all stores in their area — can review & override, but
  //   normal flow is PIC 1 creates → OPS checks.
  //
  console.log('👥  Creating users…');
  const pwd = await hash('password123', SALT_ROUNDS);

  const [
    // OPS managers (one per area, no storeId)
    opsJP,          // manages Store Thamrin + Store Gambir
    opsJS,          // manages Store Sudirman

    // Store Thamrin (store1) — Jakarta Pusat area
    s1Pic1,         // PIC 1 → creates & owns schedules for store1
    s1Pic2,         // PIC 2 → senior employee, read-only on schedules
    s1So1,          // SO    → standard operator, morning
    s1So2,          // SO    → standard operator, evening

    // Store Gambir (store2) — Jakarta Pusat area (same OPS as store1)
    s2Pic1,
    s2So1,

    // Store Sudirman (store3) — Jakarta Selatan area
    s3Pic1,
    s3Pic2,
    s3So1,
  ] = await db.insert(users).values([

    // ── OPS ─────────────────────────────────────────────────────────────────
    {
      name: 'Andi Wijaya',
      email: 'ops.jp@store.com',
      password: pwd,
      role: 'ops',
      employeeType: null,
      storeId: null,
      areaId: areaJakartaPusat.id,
    },
    {
      name: 'Maya Sari',
      email: 'ops.js@store.com',
      password: pwd,
      role: 'ops',
      employeeType: null,
      storeId: null,
      areaId: areaJakartaSelatan.id,
    },

    // ── Store Thamrin (store1) ───────────────────────────────────────────────
    {
      name: 'Budi Santoso',
      email: 'budi@store.com',
      password: pwd,
      role: 'employee',
      employeeType: 'pic_1',
      storeId: store1.id,
      areaId: null,
    },
    {
      name: 'Ahmad Rahman',
      email: 'ahmad@store.com',
      password: pwd,
      role: 'employee',
      employeeType: 'pic_2',
      storeId: store1.id,
      areaId: null,
    },
    {
      name: 'Siti Nurhaliza',
      email: 'siti@store.com',
      password: pwd,
      role: 'employee',
      employeeType: 'so',
      storeId: store1.id,
      areaId: null,
    },
    {
      name: 'Dewi Lestari',
      email: 'dewi@store.com',
      password: pwd,
      role: 'employee',
      employeeType: 'so',
      storeId: store1.id,
      areaId: null,
    },

    // ── Store Gambir (store2) ────────────────────────────────────────────────
    {
      name: 'Eko Prasetyo',
      email: 'eko@store.com',
      password: pwd,
      role: 'employee',
      employeeType: 'pic_1',
      storeId: store2.id,
      areaId: null,
    },
    {
      name: 'Rina Wijaya',
      email: 'rina@store.com',
      password: pwd,
      role: 'employee',
      employeeType: 'so',
      storeId: store2.id,
      areaId: null,
    },

    // ── Store Sudirman (store3) ──────────────────────────────────────────────
    {
      name: 'Farhan Hidayat',
      email: 'farhan@store.com',
      password: pwd,
      role: 'employee',
      employeeType: 'pic_1',
      storeId: store3.id,
      areaId: null,
    },
    {
      name: 'Lina Permata',
      email: 'lina@store.com',
      password: pwd,
      role: 'employee',
      employeeType: 'pic_2',
      storeId: store3.id,
      areaId: null,
    },
    {
      name: 'Hendra Kusuma',
      email: 'hendra@store.com',
      password: pwd,
      role: 'employee',
      employeeType: 'so',
      storeId: store3.id,
      areaId: null,
    },

  ] as any[]).returning();

  console.log('✓   11 users\n');

  // ── 4. TASK TEMPLATES ─────────────────────────────────────────────────────
  // Tasks reference employeeType: 'pic_1' | 'pic_2' | 'so' | null.
  // Using opsJP as createdBy for all global task templates (admin-created).
  console.log('📋  Creating task templates…');

  const createdTasks = await db.insert(tasks).values([

    // ── Daily – morning PIC 1 ────────────────────────────────────────────────
    {
      title: 'Store Opening Procedure',
      description: 'Unlock doors, turn on lights, check security system',
      role: 'employee', employeeType: 'pic_1', shift: 'morning',
      recurrence: 'daily', isActive: true,
      requiresForm: false, requiresAttachment: false,
      createdBy: opsJP.id,
    },
    {
      title: 'Cash Register Setup',
      description: 'Count starting cash, verify petty cash balance',
      role: 'employee', employeeType: 'pic_1', shift: 'morning',
      recurrence: 'daily', isActive: true,
      requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'starting_cash', type: 'number',   label: 'Starting Cash (IDR)', required: true,  validation: { min: 0 } },
        { id: 'petty_cash',    type: 'number',   label: 'Petty Cash (IDR)',    required: true,  validation: { min: 0 } },
        { id: 'discrepancy',   type: 'textarea', label: 'Discrepancies',       required: false  },
      ]}),
      requiresAttachment: false,
      createdBy: opsJP.id,
    },
    {
      title: 'Morning Inventory Check',
      description: 'Check stock levels and expiry dates',
      role: 'employee', employeeType: 'pic_1', shift: 'morning',
      recurrence: 'daily', isActive: true,
      requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'items_checked',   type: 'number',   label: 'Items Checked',   required: true,  validation: { min: 0 } },
        { id: 'expired_items',   type: 'number',   label: 'Expired Items',   required: true,  validation: { min: 0 } },
        { id: 'low_stock_items', type: 'textarea', label: 'Low Stock Items', required: false  },
      ]}),
      requiresAttachment: true, maxAttachments: 5,
      createdBy: opsJP.id,
    },

    // ── Daily – morning PIC 2 ────────────────────────────────────────────────
    {
      title: 'Morning Floor Supervision',
      description: 'Supervise floor staff during morning setup and opening',
      role: 'employee', employeeType: 'pic_2', shift: 'morning',
      recurrence: 'daily', isActive: true,
      requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'staff_present',  type: 'number',   label: 'Staff Present',  required: true, validation: { min: 0 } },
        { id: 'issues_noted',   type: 'textarea', label: 'Issues Noted',   required: false },
      ]}),
      requiresAttachment: false,
      createdBy: opsJP.id,
    },

    // ── Daily – morning SO ───────────────────────────────────────────────────
    {
      title: 'Store Cleaning – Morning',
      description: 'Clean floors, windows, and customer areas',
      role: 'employee', employeeType: 'so', shift: 'morning',
      recurrence: 'daily', isActive: true,
      requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'areas_cleaned', type: 'select',   label: 'All Areas Cleaned',  required: true, options: ['Yes', 'Partial', 'No'] },
        { id: 'cleanliness',   type: 'select',   label: 'Cleanliness Rating', required: true, options: ['Excellent', 'Good', 'Fair', 'Poor'] },
        { id: 'issues',        type: 'textarea', label: 'Issues Found',       required: false },
      ]}),
      requiresAttachment: false,
      createdBy: opsJP.id,
    },
    {
      title: 'Product Display Setup',
      description: 'Arrange products, check price tags, update promotions',
      role: 'employee', employeeType: 'so', shift: 'morning',
      recurrence: 'daily', isActive: true,
      requiresForm: false, requiresAttachment: true, maxAttachments: 3,
      createdBy: opsJP.id,
    },

    // ── Daily – evening PIC 1 ────────────────────────────────────────────────
    {
      title: 'End of Day Cash Count',
      description: 'Count cash register and prepare deposit',
      role: 'employee', employeeType: 'pic_1', shift: 'evening',
      recurrence: 'daily', isActive: true,
      requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'ending_cash',  type: 'number',   label: 'Ending Cash (IDR)',  required: true,  validation: { min: 0 } },
        { id: 'total_sales',  type: 'number',   label: 'Total Sales (IDR)',  required: true,  validation: { min: 0 } },
        { id: 'variance',     type: 'number',   label: 'Variance (+/-)',     required: true  },
        { id: 'explanation',  type: 'textarea', label: 'Explanation',        required: false },
      ]}),
      requiresAttachment: false,
      createdBy: opsJP.id,
    },
    {
      title: 'Store Closing Checklist',
      description: 'Lock up, turn off equipment, arm security',
      role: 'employee', employeeType: 'pic_1', shift: 'evening',
      recurrence: 'daily', isActive: true,
      requiresForm: false, requiresAttachment: false,
      createdBy: opsJP.id,
    },

    // ── Daily – evening PIC 2 ────────────────────────────────────────────────
    {
      title: 'Evening Staff Handover',
      description: 'Brief evening staff on any morning issues or pending tasks',
      role: 'employee', employeeType: 'pic_2', shift: 'evening',
      recurrence: 'daily', isActive: true,
      requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'handover_notes', type: 'textarea', label: 'Handover Notes', required: true },
        { id: 'pending_issues', type: 'textarea', label: 'Pending Issues', required: false },
      ]}),
      requiresAttachment: false,
      createdBy: opsJP.id,
    },

    // ── Daily – evening SO ───────────────────────────────────────────────────
    {
      title: 'Deep Cleaning – Evening',
      description: 'Mop floors, clean restrooms, take out trash',
      role: 'employee', employeeType: 'so', shift: 'evening',
      recurrence: 'daily', isActive: true,
      requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'floor_mopped',     type: 'checkbox', label: 'Floors Mopped',     required: true },
        { id: 'restroom_cleaned', type: 'checkbox', label: 'Restrooms Cleaned', required: true },
        { id: 'trash_removed',    type: 'checkbox', label: 'Trash Removed',     required: true },
        { id: 'time_completed',   type: 'time',     label: 'Time Completed',    required: true },
      ]}),
      requiresAttachment: true, maxAttachments: 2,
      createdBy: opsJP.id,
    },
    {
      title: 'Stock Replenishment',
      description: 'Restock shelves from storage',
      role: 'employee', employeeType: 'so', shift: 'evening',
      recurrence: 'daily', isActive: true,
      requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'items_restocked', type: 'number',   label: 'Items Restocked', required: true, validation: { min: 0 } },
        { id: 'notes',           type: 'textarea', label: 'Notes',           required: false },
      ]}),
      requiresAttachment: false,
      createdBy: opsJP.id,
    },

    // ── Daily – both shifts, PIC 1 ───────────────────────────────────────────
    {
      title: 'Customer Service Report',
      description: 'Log customer feedback for the shift',
      role: 'employee', employeeType: 'pic_1', shift: null,
      recurrence: 'daily', isActive: true,
      requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'total_customers',   type: 'number',   label: 'Approx Customers',  required: false, validation: { min: 0 } },
        { id: 'complaints',        type: 'number',   label: 'Complaints',        required: true,  validation: { min: 0 } },
        { id: 'complaint_details', type: 'textarea', label: 'Complaint Details', required: false },
      ]}),
      requiresAttachment: false,
      createdBy: opsJP.id,
    },

    // ── Weekly – Mon+Thu morning PIC 1 ───────────────────────────────────────
    {
      title: 'Full Inventory Audit',
      description: 'Complete count of all SKUs including back stock',
      role: 'employee', employeeType: 'pic_1', shift: 'morning',
      recurrence: 'weekly', recurrenceDays: JSON.stringify([1, 4]),
      isActive: true, requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'total_skus',    type: 'number',   label: 'SKUs Counted',  required: true, validation: { min: 0 } },
        { id: 'discrepancies', type: 'number',   label: 'Discrepancies', required: true, validation: { min: 0 } },
        { id: 'details',       type: 'textarea', label: 'Details',       required: false },
      ]}),
      requiresAttachment: true, maxAttachments: 2,
      createdBy: opsJP.id,
    },

    // ── Weekly – Friday both shifts PIC 1 ────────────────────────────────────
    {
      title: 'Equipment Maintenance Check',
      description: 'Inspect refrigerators, POS terminals, scales, CCTV',
      role: 'employee', employeeType: 'pic_1', shift: null,
      recurrence: 'weekly', recurrenceDays: JSON.stringify([5]),
      isActive: true, requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'refrigerator_ok', type: 'select',   label: 'Refrigerators', required: true, options: ['Yes', 'Needs Attention', 'Out of Service'] },
        { id: 'pos_ok',          type: 'select',   label: 'POS Terminals', required: true, options: ['Yes', 'Needs Attention', 'Out of Service'] },
        { id: 'cctv_ok',         type: 'select',   label: 'CCTV',          required: true, options: ['Yes', 'Needs Attention', 'Out of Service'] },
        { id: 'notes',           type: 'textarea', label: 'Notes',         required: false },
      ]}),
      requiresAttachment: false,
      createdBy: opsJP.id,
    },

    // ── Weekly – Wed+Sat morning SO ──────────────────────────────────────────
    {
      title: 'Exterior & Window Cleaning',
      description: 'Clean store exterior, windows, and entrance',
      role: 'employee', employeeType: 'so', shift: 'morning',
      recurrence: 'weekly', recurrenceDays: JSON.stringify([3, 6]),
      isActive: true, requiresForm: false,
      requiresAttachment: true, maxAttachments: 4,
      createdBy: opsJP.id,
    },

    // ── Monthly – 1st and 15th morning PIC 1 ─────────────────────────────────
    {
      title: 'Petty Cash Reconciliation',
      description: 'Reconcile petty cash, document all transactions',
      role: 'employee', employeeType: 'pic_1', shift: 'morning',
      recurrence: 'monthly', recurrenceDays: JSON.stringify([1, 15]),
      isActive: true, requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'opening_balance', type: 'number',   label: 'Opening Balance (IDR)',   required: true, validation: { min: 0 } },
        { id: 'total_spent',     type: 'number',   label: 'Total Spent (IDR)',       required: true, validation: { min: 0 } },
        { id: 'closing_balance', type: 'number',   label: 'Closing Balance (IDR)',   required: true, validation: { min: 0 } },
        { id: 'replenishment',   type: 'number',   label: 'Replenishment Requested', required: false, validation: { min: 0 } },
        { id: 'notes',           type: 'textarea', label: 'Notes',                  required: false },
      ]}),
      requiresAttachment: true, maxAttachments: 3,
      createdBy: opsJP.id,
    },

    // ── Monthly – 28th both shifts PIC 1 ─────────────────────────────────────
    {
      title: 'Monthly Store Performance Report',
      description: 'Compile monthly KPIs: sales, task completion, attendance',
      role: 'employee', employeeType: 'pic_1', shift: null,
      recurrence: 'monthly', recurrenceDays: JSON.stringify([28]),
      isActive: true, requiresForm: true,
      formSchema: JSON.stringify({ fields: [
        { id: 'total_sales_month',   type: 'number',   label: 'Total Sales (IDR)',  required: true, validation: { min: 0 } },
        { id: 'task_completion_pct', type: 'number',   label: 'Task Completion %',  required: true, validation: { min: 0, max: 100 } },
        { id: 'issues_count',        type: 'number',   label: 'Issues Reported',    required: true, validation: { min: 0 } },
        { id: 'summary',             type: 'textarea', label: 'Monthly Summary',    required: true },
      ]}),
      requiresAttachment: false,
      createdBy: opsJP.id,
    },

  ] as any[]).returning();

  const daily   = createdTasks.filter(t => t.recurrence === 'daily').length;
  const weekly  = createdTasks.filter(t => t.recurrence === 'weekly').length;
  const monthly = createdTasks.filter(t => t.recurrence === 'monthly').length;
  console.log(`✓   ${createdTasks.length} tasks (${daily} daily / ${weekly} weekly / ${monthly} monthly)\n`);

  // ── 5. WEEKLY SCHEDULE TEMPLATES ──────────────────────────────────────────
  // All templates are created by PIC 1 of each store (createdBy = pic_1 user).
  // OPS is NOT the creator — PIC 1 owns the schedule. OPS can later override.
  console.log('📅  Creating weekly schedule templates (created by PIC 1 of each store)…');

  // ── Store 1: Thamrin ──────────────────────────────────────────────────────

  // Budi (PIC 1) – Mon–Fri morning. PIC 1 creates their own template too.
  const [tmplBudi] = await db.insert(weeklyScheduleTemplates).values({
    userId: s1Pic1.id, storeId: store1.id, isActive: true,
    note: 'Mon–Fri morning shift',
    createdBy: s1Pic1.id,   // PIC 1 creates
  }).returning();
  await db.insert(weeklyScheduleEntries).values(
    [1,2,3,4,5].map(d => ({ templateId: tmplBudi.id, weekday: String(d) as any, shift: 'morning' as const }))
  );

  // Ahmad (PIC 2) – Mon–Fri morning, created by Budi (PIC 1)
  const [tmplAhmad] = await db.insert(weeklyScheduleTemplates).values({
    userId: s1Pic2.id, storeId: store1.id, isActive: true,
    note: 'Mon–Fri morning shift',
    createdBy: s1Pic1.id,   // PIC 1 creates schedules for all store staff
  }).returning();
  await db.insert(weeklyScheduleEntries).values(
    [1,2,3,4,5].map(d => ({ templateId: tmplAhmad.id, weekday: String(d) as any, shift: 'morning' as const }))
  );

  // Siti (SO) – Mon–Fri morning, created by Budi (PIC 1)
  const [tmplSiti] = await db.insert(weeklyScheduleTemplates).values({
    userId: s1So1.id, storeId: store1.id, isActive: true,
    note: 'Mon–Fri morning shift',
    createdBy: s1Pic1.id,
  }).returning();
  await db.insert(weeklyScheduleEntries).values(
    [1,2,3,4,5].map(d => ({ templateId: tmplSiti.id, weekday: String(d) as any, shift: 'morning' as const }))
  );

  // Dewi (SO) – Mon–Fri evening + Sat morning, created by Budi (PIC 1)
  const [tmplDewi] = await db.insert(weeklyScheduleTemplates).values({
    userId: s1So2.id, storeId: store1.id, isActive: true,
    note: 'Mon–Fri evening + Sat morning',
    createdBy: s1Pic1.id,
  }).returning();
  await db.insert(weeklyScheduleEntries).values([
    ...[1,2,3,4,5].map(d => ({ templateId: tmplDewi.id, weekday: String(d) as any, shift: 'evening' as const })),
    { templateId: tmplDewi.id, weekday: '6' as any, shift: 'morning' as const },
  ]);

  // ── Store 2: Gambir ───────────────────────────────────────────────────────

  // Eko (PIC 1) – Mon–Fri morning
  const [tmplEko] = await db.insert(weeklyScheduleTemplates).values({
    userId: s2Pic1.id, storeId: store2.id, isActive: true,
    note: 'Mon–Fri morning shift',
    createdBy: s2Pic1.id,
  }).returning();
  await db.insert(weeklyScheduleEntries).values(
    [1,2,3,4,5].map(d => ({ templateId: tmplEko.id, weekday: String(d) as any, shift: 'morning' as const }))
  );

  // Rina (SO) – Tue–Sat morning, created by Eko (PIC 1)
  const [tmplRina] = await db.insert(weeklyScheduleTemplates).values({
    userId: s2So1.id, storeId: store2.id, isActive: true,
    note: 'Tue–Sat morning',
    createdBy: s2Pic1.id,
  }).returning();
  await db.insert(weeklyScheduleEntries).values(
    [2,3,4,5,6].map(d => ({ templateId: tmplRina.id, weekday: String(d) as any, shift: 'morning' as const }))
  );

  // ── Store 3: Sudirman ─────────────────────────────────────────────────────

  // Farhan (PIC 1) – Mon–Fri morning
  const [tmplFarhan] = await db.insert(weeklyScheduleTemplates).values({
    userId: s3Pic1.id, storeId: store3.id, isActive: true,
    note: 'Mon–Fri morning shift',
    createdBy: s3Pic1.id,
  }).returning();
  await db.insert(weeklyScheduleEntries).values(
    [1,2,3,4,5].map(d => ({ templateId: tmplFarhan.id, weekday: String(d) as any, shift: 'morning' as const }))
  );

  // Lina (PIC 2) – Mon–Fri evening, created by Farhan (PIC 1)
  const [tmplLina] = await db.insert(weeklyScheduleTemplates).values({
    userId: s3Pic2.id, storeId: store3.id, isActive: true,
    note: 'Mon–Fri evening shift',
    createdBy: s3Pic1.id,
  }).returning();
  await db.insert(weeklyScheduleEntries).values(
    [1,2,3,4,5].map(d => ({ templateId: tmplLina.id, weekday: String(d) as any, shift: 'evening' as const }))
  );

  // Hendra (SO) – Mon–Sat morning, created by Farhan (PIC 1)
  const [tmplHendra] = await db.insert(weeklyScheduleTemplates).values({
    userId: s3So1.id, storeId: store3.id, isActive: true,
    note: 'Mon–Sat morning',
    createdBy: s3Pic1.id,
  }).returning();
  await db.insert(weeklyScheduleEntries).values(
    [1,2,3,4,5,6].map(d => ({ templateId: tmplHendra.id, weekday: String(d) as any, shift: 'morning' as const }))
  );

  console.log('✓   9 weekly templates\n');

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅  seed-setup complete!');
  console.log('    Run seed-schedules.ts next to generate schedules & attendance.\n');

  console.log('🗺️   Areas:');
  console.log('    Jakarta Pusat  → Store Thamrin + Store Gambir  (OPS: Andi)');
  console.log('    Jakarta Selatan → Store Sudirman               (OPS: Maya)\n');

  console.log('🔐  Login credentials:');
  console.log('');
  console.log('    ── OPS (manages area, reviews schedules) ──────────────');
  console.log('    ops.jp@store.com  / password123  (OPS – Jakarta Pusat area)');
  console.log('    ops.js@store.com  / password123  (OPS – Jakarta Selatan area)');
  console.log('');
  console.log('    ── Store Thamrin ───────────────────────────────────────');
  console.log('    budi@store.com    / password123  (PIC 1 – creates schedules)');
  console.log('    ahmad@store.com   / password123  (PIC 2 – read-only)');
  console.log('    siti@store.com    / password123  (SO – morning)');
  console.log('    dewi@store.com    / password123  (SO – evening)');
  console.log('');
  console.log('    ── Store Gambir ─────────────────────────────────────────');
  console.log('    eko@store.com     / password123  (PIC 1 – creates schedules)');
  console.log('    rina@store.com    / password123  (SO – morning)');
  console.log('');
  console.log('    ── Store Sudirman ───────────────────────────────────────');
  console.log('    farhan@store.com  / password123  (PIC 1 – creates schedules)');
  console.log('    lina@store.com    / password123  (PIC 2 – read-only)');
  console.log('    hendra@store.com  / password123  (SO – morning)');
  console.log('═══════════════════════════════════════════════════════════');
}

seedSetup()
  .then(() => process.exit(0))
  .catch((err) => { console.error('❌  seed-setup failed:', err); process.exit(1); });