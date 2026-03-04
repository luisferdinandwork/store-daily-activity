// scripts/seed-daily-tasks.ts
// Full seeder: stores → users → tasks → weekly templates → generate schedules → attendance
// Run with: tsx scripts/seed-daily-tasks.ts

import { db } from '@/lib/db';
import {
  users, stores, tasks, schedules, employeeTasks, attendance,
  weeklyScheduleTemplates, weeklyScheduleEntries,
} from '@/lib/db/schema';
import { shouldTaskRunOnDate } from '@/lib/daily-task-utils';
import { hash } from 'bcrypt';
import { eq, and, lte } from 'drizzle-orm';

const SALT_ROUNDS = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23,59,59,999); return r; }
function* eachDay(start: Date, end: Date): Generator<Date> {
  const cur = startOfDay(start);
  const fin = startOfDay(end);
  while (cur <= fin) { yield new Date(cur); cur.setDate(cur.getDate() + 1); }
}

type Shift = 'morning' | 'evening';

function taskMatchesEmployee(
  task: { role: string; employeeType: string | null; shift: string | null },
  user: { role: string; employeeType: string | null },
  shift: Shift,
) {
  return (
    task.role === user.role &&
    (!task.employeeType || task.employeeType === user.employeeType) &&
    (!task.shift || task.shift === shift)
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function seedDatabase() {
  console.log('🌱 Starting full database seed…\n');

  try {
    // ── 0. CLEAR ────────────────────────────────────────────────────────────
    console.log('🗑️  Clearing existing data…');
    await db.delete(employeeTasks);
    await db.delete(attendance);
    await db.delete(schedules);
    await db.delete(weeklyScheduleEntries);
    await db.delete(weeklyScheduleTemplates);
    await db.delete(tasks);
    await db.delete(users);
    await db.delete(stores);
    console.log('✓ Cleared\n');

    // ── 1. STORES ────────────────────────────────────────────────────────────
    console.log('🏪 Creating stores…');
    const [store1, store2] = await db.insert(stores).values([
      { name: 'Store Jakarta Pusat',   address: 'Jl. Thamrin No. 1, Jakarta Pusat',      pettyCashBalance: '1000000' },
      { name: 'Store Jakarta Selatan', address: 'Jl. Sudirman No. 52, Jakarta Selatan',   pettyCashBalance: '1500000' },
    ]).returning();
    console.log(`✓ 2 stores\n`);

    // ── 2. USERS ─────────────────────────────────────────────────────────────
    console.log('👥 Creating users…');
    const pwd = await hash('password123', SALT_ROUNDS);

    const [ops1, ops2, s1pic1, s1so1, s1pic2, s1so2, s2pic, s2so] = await db.insert(users).values([
      { name: 'Admin OPS',            email: 'ops@store.com',   password: pwd, role: 'ops',      employeeType: null,  storeId: store1.id },
      { name: 'OPS Manager 2',        email: 'ops2@store.com',  password: pwd, role: 'ops',      employeeType: null,  storeId: store2.id },
      { name: 'Budi Santoso',         email: 'budi@store.com',  password: pwd, role: 'employee', employeeType: 'pic', storeId: store1.id },
      { name: 'Siti Nurhaliza',       email: 'siti@store.com',  password: pwd, role: 'employee', employeeType: 'so',  storeId: store1.id },
      { name: 'Ahmad Rahman',         email: 'ahmad@store.com', password: pwd, role: 'employee', employeeType: 'pic', storeId: store1.id },
      { name: 'Dewi Lestari',         email: 'dewi@store.com',  password: pwd, role: 'employee', employeeType: 'so',  storeId: store1.id },
      { name: 'Eko Prasetyo',         email: 'eko@store.com',   password: pwd, role: 'employee', employeeType: 'pic', storeId: store2.id },
      { name: 'Rina Wijaya',          email: 'rina@store.com',  password: pwd, role: 'employee', employeeType: 'so',  storeId: store2.id },
    ] as any[]).returning();
    console.log(`✓ 8 users\n`);

    // ── 3. TASK TEMPLATES ────────────────────────────────────────────────────
    console.log('📋 Creating task templates…');
    const createdTasks = await db.insert(tasks).values([

      // ── Daily – morning PIC
      {
        title: 'Store Opening Procedure',
        description: 'Unlock doors, turn on lights, check security system',
        role: 'employee', employeeType: 'pic', shift: 'morning',
        recurrence: 'daily', isActive: true,
        requiresForm: false, requiresAttachment: false, createdBy: ops1.id,
      },
      {
        title: 'Cash Register Setup',
        description: 'Count starting cash, verify petty cash balance',
        role: 'employee', employeeType: 'pic', shift: 'morning',
        recurrence: 'daily', isActive: true,
        requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'starting_cash', type: 'number',   label: 'Starting Cash (IDR)',  required: true,  validation: { min: 0 } },
          { id: 'petty_cash',    type: 'number',   label: 'Petty Cash (IDR)',     required: true,  validation: { min: 0 } },
          { id: 'discrepancy',   type: 'textarea', label: 'Discrepancies',        required: false },
        ]}),
        requiresAttachment: false, createdBy: ops1.id,
      },
      {
        title: 'Morning Inventory Check',
        description: 'Check stock levels and expiry dates',
        role: 'employee', employeeType: 'pic', shift: 'morning',
        recurrence: 'daily', isActive: true,
        requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'items_checked',   type: 'number',   label: 'Items Checked',      required: true,  validation: { min: 0 } },
          { id: 'expired_items',   type: 'number',   label: 'Expired Items',      required: true,  validation: { min: 0 } },
          { id: 'low_stock_items', type: 'textarea', label: 'Low Stock Items',    required: false  },
        ]}),
        requiresAttachment: true, maxAttachments: 5, createdBy: ops1.id,
      },

      // ── Daily – morning SO
      {
        title: 'Store Cleaning – Morning',
        description: 'Clean floors, windows, and customer areas',
        role: 'employee', employeeType: 'so', shift: 'morning',
        recurrence: 'daily', isActive: true,
        requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'areas_cleaned',   type: 'select',   label: 'All Areas Cleaned',   required: true, options: ['Yes', 'Partial', 'No'] },
          { id: 'cleanliness',     type: 'select',   label: 'Cleanliness Rating',  required: true, options: ['Excellent', 'Good', 'Fair', 'Poor'] },
          { id: 'issues',          type: 'textarea', label: 'Issues Found',        required: false },
        ]}),
        requiresAttachment: false, createdBy: ops1.id,
      },
      {
        title: 'Product Display Setup',
        description: 'Arrange products, check price tags, update promotions',
        role: 'employee', employeeType: 'so', shift: 'morning',
        recurrence: 'daily', isActive: true,
        requiresForm: false, requiresAttachment: true, maxAttachments: 3, createdBy: ops1.id,
      },

      // ── Daily – evening PIC
      {
        title: 'End of Day Cash Count',
        description: 'Count cash register and prepare deposit',
        role: 'employee', employeeType: 'pic', shift: 'evening',
        recurrence: 'daily', isActive: true,
        requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'ending_cash',  type: 'number',   label: 'Ending Cash (IDR)',  required: true,  validation: { min: 0 } },
          { id: 'total_sales',  type: 'number',   label: 'Total Sales (IDR)',  required: true,  validation: { min: 0 } },
          { id: 'variance',     type: 'number',   label: 'Variance (+/-)',     required: true  },
          { id: 'explanation',  type: 'textarea', label: 'Explanation',        required: false },
        ]}),
        requiresAttachment: false, createdBy: ops1.id,
      },
      {
        title: 'Store Closing Checklist',
        description: 'Lock up, turn off equipment, arm security',
        role: 'employee', employeeType: 'pic', shift: 'evening',
        recurrence: 'daily', isActive: true,
        requiresForm: false, requiresAttachment: false, createdBy: ops1.id,
      },

      // ── Daily – evening SO
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
        requiresAttachment: true, maxAttachments: 2, createdBy: ops1.id,
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
        requiresAttachment: false, createdBy: ops1.id,
      },

      // ── Daily – both shifts (PIC)
      {
        title: 'Customer Service Report',
        description: 'Log customer feedback for the shift',
        role: 'employee', employeeType: 'pic', shift: null,
        recurrence: 'daily', isActive: true,
        requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'total_customers',   type: 'number',   label: 'Approx Customers',  required: false, validation: { min: 0 } },
          { id: 'complaints',        type: 'number',   label: 'Complaints',        required: true,  validation: { min: 0 } },
          { id: 'complaint_details', type: 'textarea', label: 'Complaint Details', required: false },
        ]}),
        requiresAttachment: false, createdBy: ops1.id,
      },

      // ── Weekly – Mon+Thu morning PIC
      {
        title: 'Full Inventory Audit',
        description: 'Complete count of all SKUs including back stock',
        role: 'employee', employeeType: 'pic', shift: 'morning',
        recurrence: 'weekly', recurrenceDays: JSON.stringify([1, 4]),
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'total_skus',    type: 'number',   label: 'SKUs Counted',     required: true, validation: { min: 0 } },
          { id: 'discrepancies', type: 'number',   label: 'Discrepancies',    required: true, validation: { min: 0 } },
          { id: 'details',       type: 'textarea', label: 'Details',          required: false },
        ]}),
        requiresAttachment: true, maxAttachments: 2, createdBy: ops1.id,
      },

      // ── Weekly – Friday both shifts PIC
      {
        title: 'Equipment Maintenance Check',
        description: 'Inspect refrigerators, POS terminals, scales, CCTV',
        role: 'employee', employeeType: 'pic', shift: null,
        recurrence: 'weekly', recurrenceDays: JSON.stringify([5]),
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'refrigerator_ok', type: 'select',   label: 'Refrigerators',  required: true, options: ['Yes', 'Needs Attention', 'Out of Service'] },
          { id: 'pos_ok',          type: 'select',   label: 'POS Terminals',  required: true, options: ['Yes', 'Needs Attention', 'Out of Service'] },
          { id: 'cctv_ok',         type: 'select',   label: 'CCTV',           required: true, options: ['Yes', 'Needs Attention', 'Out of Service'] },
          { id: 'notes',           type: 'textarea', label: 'Notes',          required: false },
        ]}),
        requiresAttachment: false, createdBy: ops1.id,
      },

      // ── Weekly – Wed+Sat morning SO
      {
        title: 'Exterior & Window Cleaning',
        description: 'Clean store exterior, windows, and entrance',
        role: 'employee', employeeType: 'so', shift: 'morning',
        recurrence: 'weekly', recurrenceDays: JSON.stringify([3, 6]),
        isActive: true, requiresForm: false,
        requiresAttachment: true, maxAttachments: 4, createdBy: ops1.id,
      },

      // ── Monthly – 1st and 15th morning PIC
      {
        title: 'Petty Cash Reconciliation',
        description: 'Reconcile petty cash, document all transactions',
        role: 'employee', employeeType: 'pic', shift: 'morning',
        recurrence: 'monthly', recurrenceDays: JSON.stringify([1, 15]),
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'opening_balance', type: 'number',   label: 'Opening Balance (IDR)',      required: true, validation: { min: 0 } },
          { id: 'total_spent',     type: 'number',   label: 'Total Spent (IDR)',          required: true, validation: { min: 0 } },
          { id: 'closing_balance', type: 'number',   label: 'Closing Balance (IDR)',      required: true, validation: { min: 0 } },
          { id: 'replenishment',   type: 'number',   label: 'Replenishment Requested',   required: false, validation: { min: 0 } },
          { id: 'notes',           type: 'textarea', label: 'Notes',                     required: false },
        ]}),
        requiresAttachment: true, maxAttachments: 3, createdBy: ops1.id,
      },

      // ── Monthly – 28th both shifts PIC
      {
        title: 'Monthly Store Performance Report',
        description: 'Compile monthly KPIs: sales, task completion, attendance',
        role: 'employee', employeeType: 'pic', shift: null,
        recurrence: 'monthly', recurrenceDays: JSON.stringify([28]),
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'total_sales_month',   type: 'number',   label: 'Total Sales (IDR)',       required: true, validation: { min: 0 } },
          { id: 'task_completion_pct', type: 'number',   label: 'Task Completion %',       required: true, validation: { min: 0, max: 100 } },
          { id: 'issues_count',        type: 'number',   label: 'Issues Reported',         required: true, validation: { min: 0 } },
          { id: 'summary',             type: 'textarea', label: 'Monthly Summary',         required: true },
        ]}),
        requiresAttachment: false, createdBy: ops1.id,
      },

    ] as any[]).returning();

    const daily   = createdTasks.filter(t => t.recurrence === 'daily').length;
    const weekly  = createdTasks.filter(t => t.recurrence === 'weekly').length;
    const monthly = createdTasks.filter(t => t.recurrence === 'monthly').length;
    console.log(`✓ ${createdTasks.length} tasks (${daily} daily / ${weekly} weekly / ${monthly} monthly)\n`);

    // ── 4. WEEKLY SCHEDULE TEMPLATES ────────────────────────────────────────
    // Each template = one employee's recurring weekly pattern.
    // Entries = which weekday (0–6) and shift they work.
    console.log('📅 Creating weekly schedule templates…');

    // Store 1 – Budi (PIC): Mon–Fri morning
    const [tmplBudi] = await db.insert(weeklyScheduleTemplates).values({
      userId: s1pic1.id, storeId: store1.id, isActive: true,
      note: 'Mon–Fri morning shift', createdBy: ops1.id,
    }).returning();
    await db.insert(weeklyScheduleEntries).values(
      [1,2,3,4,5].map(d => ({ templateId: tmplBudi.id, weekday: String(d) as any, shift: 'morning' as const }))
    );

    // Store 1 – Siti (SO): Mon–Fri morning
    const [tmplSiti] = await db.insert(weeklyScheduleTemplates).values({
      userId: s1so1.id, storeId: store1.id, isActive: true,
      note: 'Mon–Fri morning shift', createdBy: ops1.id,
    }).returning();
    await db.insert(weeklyScheduleEntries).values(
      [1,2,3,4,5].map(d => ({ templateId: tmplSiti.id, weekday: String(d) as any, shift: 'morning' as const }))
    );

    // Store 1 – Ahmad (PIC): Mon–Fri evening
    const [tmplAhmad] = await db.insert(weeklyScheduleTemplates).values({
      userId: s1pic2.id, storeId: store1.id, isActive: true,
      note: 'Mon–Fri evening shift', createdBy: ops1.id,
    }).returning();
    await db.insert(weeklyScheduleEntries).values(
      [1,2,3,4,5].map(d => ({ templateId: tmplAhmad.id, weekday: String(d) as any, shift: 'evening' as const }))
    );

    // Store 1 – Dewi (SO): Mon–Fri evening + Sat morning
    const [tmplDewi] = await db.insert(weeklyScheduleTemplates).values({
      userId: s1so2.id, storeId: store1.id, isActive: true,
      note: 'Mon–Fri evening + Sat morning', createdBy: ops1.id,
    }).returning();
    await db.insert(weeklyScheduleEntries).values([
      ...[1,2,3,4,5].map(d => ({ templateId: tmplDewi.id, weekday: String(d) as any, shift: 'evening' as const })),
      { templateId: tmplDewi.id, weekday: '6' as any, shift: 'morning' as const },
    ]);

    // Store 2 – Eko (PIC): Mon–Fri morning
    const [tmplEko] = await db.insert(weeklyScheduleTemplates).values({
      userId: s2pic.id, storeId: store2.id, isActive: true,
      note: 'Mon–Fri morning shift', createdBy: ops2.id,
    }).returning();
    await db.insert(weeklyScheduleEntries).values(
      [1,2,3,4,5].map(d => ({ templateId: tmplEko.id, weekday: String(d) as any, shift: 'morning' as const }))
    );

    // Store 2 – Rina (SO): Tue–Sat morning
    const [tmplRina] = await db.insert(weeklyScheduleTemplates).values({
      userId: s2so.id, storeId: store2.id, isActive: true,
      note: 'Tue–Sat morning', createdBy: ops2.id,
    }).returning();
    await db.insert(weeklyScheduleEntries).values(
      [2,3,4,5,6].map(d => ({ templateId: tmplRina.id, weekday: String(d) as any, shift: 'morning' as const }))
    );

    console.log('✓ 6 weekly templates created\n');

    // ── 5. GENERATE SCHEDULES (past 7 days + next 7 days = 2 weeks) ─────────
    console.log('🗓️  Generating schedules from templates…');

    const today = startOfDay(new Date());
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - 7);
    const weekEnd   = new Date(today); weekEnd.setDate(today.getDate() + 7);

    const allTemplates = [
      { template: tmplBudi,  user: s1pic1, entries: [1,2,3,4,5].map(d => ({ weekday: String(d), shift: 'morning' })) },
      { template: tmplSiti,  user: s1so1,  entries: [1,2,3,4,5].map(d => ({ weekday: String(d), shift: 'morning' })) },
      { template: tmplAhmad, user: s1pic2, entries: [1,2,3,4,5].map(d => ({ weekday: String(d), shift: 'evening' })) },
      { template: tmplDewi,  user: s1so2,  entries: [
        ...[1,2,3,4,5].map(d => ({ weekday: String(d), shift: 'evening' })),
        { weekday: '6', shift: 'evening' },
      ]},
      { template: tmplEko,   user: s2pic,  entries: [1,2,3,4,5].map(d => ({ weekday: String(d), shift: 'morning' })) },
      { template: tmplRina,  user: s2so,   entries: [2,3,4,5,6].map(d => ({ weekday: String(d), shift: 'morning' })) },
    ];

    let schedulesCreated = 0;
    let tasksCreated     = 0;
    const createdSchedules: Array<{ id: string; userId: string; storeId: string; shift: string; date: Date }> = [];

    for (const date of eachDay(weekStart, weekEnd)) {
      const weekday = date.getDay();

      for (const { template, user, entries } of allTemplates) {
        const todayEntries = entries.filter(e => Number(e.weekday) === weekday);

        for (const entry of todayEntries) {
          const shift = entry.shift as Shift;

          // Create schedule row
          const [sched] = await db.insert(schedules).values({
            userId:    template.userId,
            storeId:   template.storeId,
            shift,
            date:      startOfDay(date),
            templateEntryId: null,
            isHoliday: false,
          }).returning();

          createdSchedules.push({ id: sched.id, userId: sched.userId, storeId: sched.storeId, shift, date: new Date(date) });
          schedulesCreated++;

          // Auto-assign tasks
          const matching = createdTasks.filter(t =>
            shouldTaskRunOnDate(t.recurrence as any, t.recurrenceDays, date) &&
            taskMatchesEmployee(t, user, shift)
          );

          for (const task of matching) {
            await db.insert(employeeTasks).values({
              taskId:     task.id,
              userId:     template.userId,
              storeId:    template.storeId,
              scheduleId: sched.id,
              date:       startOfDay(date),
              shift,
              status:     'pending',
            });
            tasksCreated++;
          }
        }
      }
    }

    console.log(`✓ ${schedulesCreated} schedules generated`);
    console.log(`✓ ${tasksCreated} tasks auto-assigned\n`);

    // ── 6. ATTENDANCE – past 7 days ──────────────────────────────────────────
    console.log('✅ Generating sample attendance for past 7 days…');

    const pastSchedules = createdSchedules.filter(s => s.date < today);
    let attCount = 0;

    for (const sched of pastSchedules) {
      const rand = Math.random();
      const isAbsent = rand > 0.92;
      const isLate   = !isAbsent && rand > 0.80;

      const checkIn = new Date(sched.date);
      checkIn.setHours(sched.shift === 'morning' ? 8 : 13, 0, 0, 0);
      if (isLate)   checkIn.setMinutes(checkIn.getMinutes() + 30 + Math.floor(Math.random() * 30));
      else          checkIn.setMinutes(Math.floor(Math.random() * 15));

      const checkOut = isAbsent ? null : new Date(checkIn.getTime() + (7.5 + Math.random()) * 3_600_000);
      const status: 'present' | 'late' | 'absent' = isAbsent ? 'absent' : isLate ? 'late' : 'present';

      const [att] = await db.insert(attendance).values({
        scheduleId:   sched.id,
        userId:       sched.userId,
        storeId:      sched.storeId,
        date:         startOfDay(sched.date),
        shift:        sched.shift as Shift,
        status,
        checkInTime:  isAbsent ? null : checkIn,
        checkOutTime: checkOut,
        notes:        isAbsent ? 'Sick leave' : isLate ? 'Traffic jam' : null,
        recordedBy:   sched.storeId === store1.id ? ops1.id : ops2.id,
      }).returning();

      // Link tasks to attendance
      await db.update(employeeTasks)
        .set({ attendanceId: att.id })
        .where(eq(employeeTasks.scheduleId, sched.id));

      attCount++;
    }

    console.log(`✓ ${attCount} attendance records\n`);

    // ── 7. MARK SOME PAST TASKS COMPLETED ───────────────────────────────────
    console.log('✨ Completing sample past tasks…');

    const pastTasks = await db.select()
      .from(employeeTasks)
      .where(and(lte(employeeTasks.date, today), eq(employeeTasks.status, 'pending')));

    let completedCount = 0;
    for (const et of pastTasks) {
      if (Math.random() > 0.65) continue;
      const task = createdTasks.find(t => t.id === et.taskId);
      if (!task) continue;

      let formData: string | null = null;
      if (task.requiresForm && task.formSchema) {
        const schema = JSON.parse(task.formSchema);
        const data: Record<string, unknown> = {};
        for (const field of schema.fields) {
          switch (field.type) {
            case 'number':   data[field.id] = Math.floor(Math.random() * 500_000) + 1_000; break;
            case 'select':   data[field.id] = field.options[0]; break;
            case 'checkbox': data[field.id] = true; break;
            case 'time':     data[field.id] = '17:30'; break;
            case 'date':     data[field.id] = new Date().toISOString().slice(0, 10); break;
            default:         data[field.id] = field.required ? 'Completed' : ''; break;
          }
        }
        formData = JSON.stringify(data);
      }

      const attachmentUrls = task.requiresAttachment
        ? JSON.stringify([`https://storage.example.com/${et.id}_1.jpg`])
        : null;

      await db.update(employeeTasks).set({
        status:         'completed',
        completedAt:    new Date(et.date.getTime() + (2 + Math.random() * 5) * 3_600_000),
        formData,
        attachmentUrls,
        notes:          'Completed by seed',
      }).where(eq(employeeTasks.id, et.id));

      completedCount++;
    }

    console.log(`✓ ${completedCount} tasks marked completed\n`);

    // ── SUMMARY ──────────────────────────────────────────────────────────────
    console.log('═══════════════════════════════════════');
    console.log('✅  Seed complete!\n');
    console.log('📊  Summary:');
    console.log(`    Stores:             2`);
    console.log(`    Users:              8`);
    console.log(`    Task templates:     ${createdTasks.length}  (${daily} daily / ${weekly} weekly / ${monthly} monthly)`);
    console.log(`    Weekly templates:   6`);
    console.log(`    Schedules:          ${schedulesCreated}  (14 days)`);
    console.log(`    Tasks assigned:     ${tasksCreated}`);
    console.log(`    Attendance records: ${attCount}  (past 7 days)`);
    console.log(`    Completed tasks:    ${completedCount}`);
    console.log('\n🔐  Login credentials:');
    console.log('    ops@store.com    / password123   (OPS - Store 1)');
    console.log('    ops2@store.com   / password123   (OPS - Store 2)');
    console.log('    budi@store.com   / password123   (PIC Employee - Store 1, Mon–Fri morning)');
    console.log('    siti@store.com   / password123   (SO  Employee - Store 1, Mon–Fri morning)');
    console.log('    ahmad@store.com  / password123   (PIC Employee - Store 1, Mon–Fri evening)');
    console.log('    dewi@store.com   / password123   (SO  Employee - Store 1, Mon–Fri evening)');
    console.log('    eko@store.com    / password123   (PIC Employee - Store 2, Mon–Fri morning)');
    console.log('    rina@store.com   / password123   (SO  Employee - Store 2, Tue–Sat morning)');
    console.log('═══════════════════════════════════════');

  } catch (err) {
    console.error('\n❌  Seeding failed:', err);
    throw err;
  }
}

seedDatabase()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));