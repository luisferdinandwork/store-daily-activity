// scripts/seed-daily-tasks.ts
// Updated seeder with daily / weekly / monthly task recurrence support
// Run with: tsx scripts/seed-daily-tasks.ts

import { db } from '@/lib/db';
import {
  users,
  stores,
  tasks,
  schedules,
  employeeTasks,
  attendance,
  type NewUser,
  type NewStore,
  type NewTask,
  type NewSchedule,
} from '@/lib/db/schema';
import { shouldTaskRunOnDate } from '@/lib/daily-task-utils';
import { hash } from 'bcrypt';
import { eq, and, lte } from 'drizzle-orm';

const SALT_ROUNDS = 10;

async function seedDatabase() {
  console.log('🌱 Starting database seeding (daily / weekly / monthly tasks)…\n');

  try {
    // ── Clear existing data ─────────────────────────────────────────────────
    console.log('🗑️  Clearing existing data…');
    await db.delete(employeeTasks);
    await db.delete(attendance);
    await db.delete(schedules);
    await db.delete(tasks);
    await db.delete(users);
    await db.delete(stores);
    console.log('✓ Cleared\n');

    // ── 1. STORES ───────────────────────────────────────────────────────────
    console.log('🏪 Creating stores…');
    const storeData: NewStore[] = [
      { name: 'Store Jakarta Pusat',  address: 'Jl. Thamrin No. 1, Jakarta Pusat',  pettyCashBalance: '1000000' },
      { name: 'Store Jakarta Selatan', address: 'Jl. Sudirman No. 52, Jakarta Selatan', pettyCashBalance: '1500000' },
    ];
    const createdStores = await db.insert(stores).values(storeData).returning();
    const [store1, store2] = createdStores;
    console.log(`✓ ${createdStores.length} stores\n`);

    // ── 2. USERS ────────────────────────────────────────────────────────────
    console.log('👥 Creating users…');
    const pwd = await hash('password123', SALT_ROUNDS);

    const userData: NewUser[] = [
      { name: 'Admin OPS',            email: 'ops@store.com',   password: pwd, role: 'ops',      employeeType: null, storeId: store1.id },
      { name: 'OPS Manager Store 2',  email: 'ops2@store.com',  password: pwd, role: 'ops',      employeeType: null, storeId: store2.id },
      { name: 'Budi Santoso (PIC)',   email: 'budi@store.com',  password: pwd, role: 'employee', employeeType: 'pic', storeId: store1.id },
      { name: 'Siti Nurhaliza (SO)',  email: 'siti@store.com',  password: pwd, role: 'employee', employeeType: 'so',  storeId: store1.id },
      { name: 'Ahmad Rahman (PIC)',   email: 'ahmad@store.com', password: pwd, role: 'employee', employeeType: 'pic', storeId: store1.id },
      { name: 'Dewi Lestari (SO)',    email: 'dewi@store.com',  password: pwd, role: 'employee', employeeType: 'so',  storeId: store1.id },
      { name: 'Eko Prasetyo (PIC)',   email: 'eko@store.com',   password: pwd, role: 'employee', employeeType: 'pic', storeId: store2.id },
      { name: 'Rina Wijaya (SO)',     email: 'rina@store.com',  password: pwd, role: 'employee', employeeType: 'so',  storeId: store2.id },
    ];

    const createdUsers = await db.insert(users).values(userData).returning();
    const [opsUser, opsUser2, store1PIC1, store1SO1, store1PIC2, store1SO2, store2PIC, store2SO] = createdUsers;
    console.log(`✓ ${createdUsers.length} users\n`);

    // ── 3. TASK TEMPLATES ───────────────────────────────────────────────────
    console.log('📋 Creating task templates…');

    /**
     * recurrenceDays encoding:
     *  weekly  → weekday numbers (0=Sun … 6=Sat)
     *  monthly → calendar day numbers (1-31)
     *  daily   → null
     */
    const taskData: NewTask[] = [

      // ─────────────────── DAILY tasks ────────────────────────────────────
      {
        title: 'Store Opening Procedure',
        description: 'Unlock doors, turn on lights, check security system',
        role: 'employee', employeeType: 'pic', shift: 'morning',
        recurrence: 'daily', recurrenceDays: null,
        isActive: true, requiresForm: false, requiresAttachment: false,
        createdBy: opsUser.id,
      },
      {
        title: 'Cash Register Setup',
        description: 'Count starting cash, verify petty cash balance',
        role: 'employee', employeeType: 'pic', shift: 'morning',
        recurrence: 'daily', recurrenceDays: null,
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'starting_cash', type: 'number', label: 'Starting Cash Amount (IDR)', required: true, validation: { min: 0 } },
          { id: 'petty_cash',    type: 'number', label: 'Petty Cash Balance (IDR)',   required: true, validation: { min: 0 } },
          { id: 'discrepancy',   type: 'textarea', label: 'Any Discrepancies',        required: false },
        ]}),
        requiresAttachment: false, createdBy: opsUser.id,
      },
      {
        title: 'Morning Inventory Check',
        description: 'Check stock levels and expiry dates',
        role: 'employee', employeeType: 'pic', shift: 'morning',
        recurrence: 'daily', recurrenceDays: null,
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'items_checked',   type: 'number',   label: 'Items Checked',       required: true, validation: { min: 0 } },
          { id: 'expired_items',   type: 'number',   label: 'Expired Items Found', required: true, validation: { min: 0 } },
          { id: 'low_stock_items', type: 'textarea', label: 'Low Stock Items',      required: false, placeholder: 'List items running low…' },
        ]}),
        requiresAttachment: true, maxAttachments: 5, createdBy: opsUser.id,
      },
      {
        title: 'Store Cleaning – Morning',
        description: 'Clean floors, windows, and customer areas',
        role: 'employee', employeeType: 'so', shift: 'morning',
        recurrence: 'daily', recurrenceDays: null,
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'areas_cleaned',    type: 'select', label: 'All Areas Cleaned',   required: true, options: ['Yes', 'Partial', 'No'] },
          { id: 'cleaning_rating',  type: 'select', label: 'Overall Cleanliness', required: true, options: ['Excellent', 'Good', 'Fair', 'Poor'] },
          { id: 'issues',           type: 'textarea', label: 'Issues Found',      required: false },
        ]}),
        requiresAttachment: false, createdBy: opsUser.id,
      },
      {
        title: 'Product Display Setup',
        description: 'Arrange products, check price tags, update promotions',
        role: 'employee', employeeType: 'so', shift: 'morning',
        recurrence: 'daily', recurrenceDays: null,
        isActive: true, requiresForm: false, requiresAttachment: true, maxAttachments: 3,
        createdBy: opsUser.id,
      },
      {
        title: 'End of Day Cash Count',
        description: 'Count cash register and prepare deposit',
        role: 'employee', employeeType: 'pic', shift: 'evening',
        recurrence: 'daily', recurrenceDays: null,
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'ending_cash',  type: 'number',   label: 'Ending Cash (IDR)',  required: true, validation: { min: 0 } },
          { id: 'total_sales',  type: 'number',   label: 'Total Sales (IDR)',  required: true, validation: { min: 0 } },
          { id: 'variance',     type: 'number',   label: 'Variance (+/-)',     required: true },
          { id: 'explanation',  type: 'textarea', label: 'Variance Explanation', required: false },
        ]}),
        requiresAttachment: false, createdBy: opsUser.id,
      },
      {
        title: 'Store Closing Checklist',
        description: 'Lock up, turn off equipment, arm security',
        role: 'employee', employeeType: 'pic', shift: 'evening',
        recurrence: 'daily', recurrenceDays: null,
        isActive: true, requiresForm: false, requiresAttachment: false,
        createdBy: opsUser.id,
      },
      {
        title: 'Deep Cleaning – Evening',
        description: 'Mop floors, clean restrooms, take out trash',
        role: 'employee', employeeType: 'so', shift: 'evening',
        recurrence: 'daily', recurrenceDays: null,
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'floor_mopped',      type: 'checkbox', label: 'Floors Mopped',      required: true },
          { id: 'restroom_cleaned',  type: 'checkbox', label: 'Restrooms Cleaned',  required: true },
          { id: 'trash_removed',     type: 'checkbox', label: 'Trash Removed',      required: true },
          { id: 'time_completed',    type: 'time',     label: 'Time Completed',     required: true },
        ]}),
        requiresAttachment: true, maxAttachments: 2, createdBy: opsUser.id,
      },
      {
        title: 'Stock Replenishment',
        description: 'Restock shelves from storage',
        role: 'employee', employeeType: 'so', shift: 'evening',
        recurrence: 'daily', recurrenceDays: null,
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'items_restocked', type: 'number',   label: 'Items Restocked', required: true, validation: { min: 0 } },
          { id: 'notes',           type: 'textarea', label: 'Notes',           required: false },
        ]}),
        requiresAttachment: false, createdBy: opsUser.id,
      },
      {
        title: 'Customer Service Report',
        description: 'Log customer complaints or feedback for the shift',
        role: 'employee', employeeType: 'pic', shift: null, // both shifts
        recurrence: 'daily', recurrenceDays: null,
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'total_customers',   type: 'number',   label: 'Approx Customer Count', required: false, validation: { min: 0 } },
          { id: 'complaints',        type: 'number',   label: 'Number of Complaints',  required: true,  validation: { min: 0 } },
          { id: 'complaint_details', type: 'textarea', label: 'Complaint Details',      required: false },
          { id: 'positive_feedback', type: 'textarea', label: 'Positive Feedback',      required: false },
        ]}),
        requiresAttachment: false, createdBy: opsUser.id,
      },

      // ─────────────────── WEEKLY tasks ───────────────────────────────────
      /**
       * Monday (1) and Thursday (4): Deep inventory audit
       * Appears twice per week.
       */
      {
        title: 'Full Inventory Audit',
        description: 'Complete count of all SKUs including back stock. Submit signed count sheet.',
        role: 'employee', employeeType: 'pic', shift: 'morning',
        recurrence: 'weekly', recurrenceDays: JSON.stringify([1, 4]), // Mon, Thu
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'total_skus',    type: 'number',   label: 'Total SKUs Counted',   required: true, validation: { min: 0 } },
          { id: 'discrepancies', type: 'number',   label: 'Discrepancy Count',    required: true, validation: { min: 0 } },
          { id: 'details',       type: 'textarea', label: 'Discrepancy Details',  required: false },
        ]}),
        requiresAttachment: true, maxAttachments: 2, createdBy: opsUser.id,
      },
      /**
       * Friday (5): Weekly equipment maintenance check
       */
      {
        title: 'Equipment Maintenance Check',
        description: 'Inspect refrigerators, POS terminals, scales, and CCTV systems.',
        role: 'employee', employeeType: 'pic', shift: null,
        recurrence: 'weekly', recurrenceDays: JSON.stringify([5]), // Friday
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'refrigerator_ok', type: 'select',   label: 'Refrigerators OK',  required: true,  options: ['Yes', 'Needs Attention', 'Out of Service'] },
          { id: 'pos_ok',          type: 'select',   label: 'POS Terminals OK',  required: true,  options: ['Yes', 'Needs Attention', 'Out of Service'] },
          { id: 'cctv_ok',         type: 'select',   label: 'CCTV OK',           required: true,  options: ['Yes', 'Needs Attention', 'Out of Service'] },
          { id: 'notes',           type: 'textarea', label: 'Notes / Issues',    required: false },
        ]}),
        requiresAttachment: false, createdBy: opsUser.id,
      },
      /**
       * Wednesday (3) and Saturday (6): Window & exterior cleaning — SO
       */
      {
        title: 'Exterior & Window Cleaning',
        description: 'Clean store exterior, windows, and entrance area.',
        role: 'employee', employeeType: 'so', shift: 'morning',
        recurrence: 'weekly', recurrenceDays: JSON.stringify([3, 6]), // Wed, Sat
        isActive: true, requiresForm: false,
        requiresAttachment: true, maxAttachments: 4, createdBy: opsUser.id,
      },

      // ─────────────────── MONTHLY tasks ──────────────────────────────────
      /**
       * 1st and 15th of each month: Petty cash reconciliation
       */
      {
        title: 'Petty Cash Reconciliation',
        description: 'Reconcile petty cash fund, document all transactions, prepare replenishment request.',
        role: 'employee', employeeType: 'pic', shift: 'morning',
        recurrence: 'monthly', recurrenceDays: JSON.stringify([1, 15]),
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'opening_balance',   type: 'number',   label: 'Opening Balance (IDR)',       required: true, validation: { min: 0 } },
          { id: 'total_spent',       type: 'number',   label: 'Total Spent (IDR)',           required: true, validation: { min: 0 } },
          { id: 'closing_balance',   type: 'number',   label: 'Closing Balance (IDR)',       required: true, validation: { min: 0 } },
          { id: 'replenishment_req', type: 'number',   label: 'Replenishment Requested (IDR)', required: false, validation: { min: 0 } },
          { id: 'notes',             type: 'textarea', label: 'Notes',                        required: false },
        ]}),
        requiresAttachment: true, maxAttachments: 3, createdBy: opsUser.id,
      },
      /**
       * Last day of month (28 — conservative — OPS can adjust): Monthly store performance self-report
       */
      {
        title: 'Monthly Store Performance Report',
        description: 'Compile monthly KPIs: sales, task completion rate, attendance, issues.',
        role: 'employee', employeeType: 'pic', shift: null,
        recurrence: 'monthly', recurrenceDays: JSON.stringify([28]),
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'total_sales_month',    type: 'number',   label: 'Total Sales This Month (IDR)', required: true, validation: { min: 0 } },
          { id: 'task_completion_pct',  type: 'number',   label: 'Task Completion % (est.)',     required: true, validation: { min: 0, max: 100 } },
          { id: 'issues_count',         type: 'number',   label: 'Issues Reported',              required: true, validation: { min: 0 } },
          { id: 'summary',              type: 'textarea', label: 'Monthly Summary & Notes',      required: true },
        ]}),
        requiresAttachment: false, createdBy: opsUser.id,
      },
      /**
       * 5th of each month: Staff training log
       */
      {
        title: 'Monthly Training & Development Log',
        description: 'Record any training sessions, briefings, or upskilling activities completed during the month.',
        role: 'employee', employeeType: null, shift: null,
        recurrence: 'monthly', recurrenceDays: JSON.stringify([5]),
        isActive: true, requiresForm: true,
        formSchema: JSON.stringify({ fields: [
          { id: 'sessions_held',   type: 'number',   label: 'Training Sessions Held', required: true, validation: { min: 0 } },
          { id: 'topics',          type: 'textarea', label: 'Topics Covered',         required: true },
          { id: 'attendees_count', type: 'number',   label: 'Total Attendees',        required: false, validation: { min: 0 } },
          { id: 'notes',           type: 'textarea', label: 'Additional Notes',       required: false },
        ]}),
        requiresAttachment: false, createdBy: opsUser.id,
      },
    ];

    const createdTasks = await db.insert(tasks).values(taskData).returning();

    const dailyCount   = taskData.filter(t => t.recurrence === 'daily').length;
    const weeklyCount  = taskData.filter(t => t.recurrence === 'weekly').length;
    const monthlyCount = taskData.filter(t => t.recurrence === 'monthly').length;

    console.log(`✓ ${createdTasks.length} task templates`);
    console.log(`  - Daily:   ${dailyCount}`);
    console.log(`  - Weekly:  ${weeklyCount}`);
    console.log(`  - Monthly: ${monthlyCount}\n`);

    // ── 4. SCHEDULES (next 7 days) ──────────────────────────────────────────
    console.log('📅 Creating schedules for next 7 days…');

    const scheduleData: NewSchedule[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);

      const isWeekend = d.getDay() === 0 || d.getDay() === 6;

      // Store 1 – morning
      scheduleData.push({ userId: i % 2 === 0 ? store1PIC1.id : store1PIC2.id, storeId: store1.id, shift: 'morning', date: new Date(new Date(d).setHours(8,0,0,0)),  isHoliday: false });
      scheduleData.push({ userId: i % 2 === 0 ? store1SO1.id  : store1SO2.id,  storeId: store1.id, shift: 'morning', date: new Date(new Date(d).setHours(8,0,0,0)),  isHoliday: false });
      // Store 1 – evening
      scheduleData.push({ userId: i % 2 === 0 ? store1PIC2.id : store1PIC1.id, storeId: store1.id, shift: 'evening', date: new Date(new Date(d).setHours(14,0,0,0)), isHoliday: false });
      scheduleData.push({ userId: i % 2 === 0 ? store1SO2.id  : store1SO1.id,  storeId: store1.id, shift: 'evening', date: new Date(new Date(d).setHours(14,0,0,0)), isHoliday: false });

      // Store 2 – weekdays only
      if (!isWeekend) {
        scheduleData.push({ userId: store2PIC.id, storeId: store2.id, shift: 'morning', date: new Date(new Date(d).setHours(8,0,0,0)),  isHoliday: false });
        scheduleData.push({ userId: store2SO.id,  storeId: store2.id, shift: 'morning', date: new Date(new Date(d).setHours(8,0,0,0)),  isHoliday: false });
      }
    }

    const createdSchedules = await db.insert(schedules).values(scheduleData).returning();
    console.log(`✓ ${createdSchedules.length} schedules\n`);

    // ── 5. AUTO-ASSIGN TASKS ────────────────────────────────────────────────
    console.log('🎯 Assigning tasks to schedules (respects recurrence)…');

    let tasksAssigned = 0;

    for (const schedule of createdSchedules) {
      const user = createdUsers.find(u => u.id === schedule.userId);
      if (!user) continue;

      const scheduleDate = new Date(schedule.date);

      const matchingTasks = createdTasks.filter(task => {
        // Check recurrence
        if (!shouldTaskRunOnDate(task.recurrence, task.recurrenceDays, scheduleDate)) return false;
        // Check role / type / shift
        const roleMatch  = task.role === user.role;
        const typeMatch  = !task.employeeType || task.employeeType === user.employeeType;
        const shiftMatch = !task.shift || task.shift === schedule.shift;
        return roleMatch && typeMatch && shiftMatch;
      });

      for (const task of matchingTasks) {
        await db.insert(employeeTasks).values({
          taskId: task.id,
          userId: user.id,
          storeId: schedule.storeId,
          scheduleId: schedule.id,
          date: schedule.date,
          shift: schedule.shift,
          status: 'pending',
        });
        tasksAssigned++;
      }
    }

    console.log(`✓ ${tasksAssigned} employee tasks created\n`);

    // ── 6. SAMPLE ATTENDANCE (past 3 days) ──────────────────────────────────
    console.log('✅ Creating sample attendance records…');

    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(today.getDate() - 3);

    const pastSchedules = createdSchedules.filter(s =>
      new Date(s.date) >= threeDaysAgo && new Date(s.date) < today
    );

    let attendanceCount = 0;

    for (const schedule of pastSchedules) {
      const rand = Math.random();
      let status: 'present' | 'late' | 'absent';
      const checkIn = new Date(schedule.date);

      if (rand < 0.8)       { status = 'present'; checkIn.setMinutes(checkIn.getMinutes() + Math.floor(Math.random() * 10)); }
      else if (rand < 0.95) { status = 'late';    checkIn.setMinutes(checkIn.getMinutes() + 30 + Math.floor(Math.random() * 30)); }
      else                  { status = 'absent'; }

      const checkOut = status !== 'absent' ? new Date(new Date(checkIn).setHours(checkIn.getHours() + 8)) : null;

      const [att] = await db.insert(attendance).values({
        scheduleId: schedule.id,
        userId: schedule.userId,
        storeId: schedule.storeId,
        date: schedule.date,
        shift: schedule.shift,
        status,
        checkInTime:  status !== 'absent' ? checkIn  : null,
        checkOutTime: status !== 'absent' ? checkOut : null,
        notes: status === 'late' ? 'Traffic jam' : status === 'absent' ? 'Sick leave' : null,
        recordedBy: schedule.storeId === store1.id ? opsUser.id : opsUser2.id,
      }).returning();

      await db.update(employeeTasks)
        .set({ attendanceId: att.id })
        .where(eq(employeeTasks.scheduleId, schedule.id));

      attendanceCount++;
    }

    console.log(`✓ ${attendanceCount} attendance records\n`);

    // ── 7. COMPLETE SOME PAST TASKS ─────────────────────────────────────────
    console.log('✨ Completing sample past tasks…');

    const pastTasks = await db.select()
      .from(employeeTasks)
      .where(and(lte(employeeTasks.date, today), eq(employeeTasks.status, 'pending')));

    let completedCount = 0;

    for (const et of pastTasks) {
      if (Math.random() >= 0.7) continue;

      const task = createdTasks.find(t => t.id === et.taskId);
      if (!task) continue;

      let formData: string | null = null;
      let attachmentUrls: string | null = null;

      if (task.requiresForm && task.formSchema) {
        const schema = JSON.parse(task.formSchema);
        const data: Record<string, unknown> = {};
        for (const field of schema.fields) {
          switch (field.type) {
            case 'number':   data[field.id] = Math.floor(Math.random() * 1_000_000) + 10_000; break;
            case 'select':   data[field.id] = field.options[Math.floor(Math.random() * field.options.length)]; break;
            case 'checkbox': data[field.id] = true; break;
            case 'time':     data[field.id] = '17:30'; break;
            case 'date':     data[field.id] = new Date().toISOString().slice(0, 10); break;
            default:         data[field.id] = field.required ? 'Sample notes' : ''; break;
          }
        }
        formData = JSON.stringify(data);
      }

      if (task.requiresAttachment) {
        const n = Math.min(Math.ceil(Math.random() * (task.maxAttachments || 1)), task.maxAttachments || 1);
        attachmentUrls = JSON.stringify(
          Array.from({ length: n }, (_, i) => `https://storage.example.com/uploads/${et.id}_${i + 1}.jpg`)
        );
      }

      await db.update(employeeTasks).set({
        status: 'completed',
        completedAt: new Date(et.date.getTime() + Math.random() * 8 * 3600_000),
        formData,
        attachmentUrls,
        notes: 'Completed successfully',
      }).where(eq(employeeTasks.id, et.id));

      completedCount++;
    }

    console.log(`✓ ${completedCount} tasks marked completed\n`);

    // ── SUMMARY ─────────────────────────────────────────────────────────────
    console.log('✅ Seeding complete!\n');
    console.log('📊 Summary:');
    console.log(`   Stores:           ${createdStores.length}`);
    console.log(`   Users:            ${createdUsers.length}`);
    console.log(`   Task Templates:   ${createdTasks.length} (${dailyCount} daily / ${weeklyCount} weekly / ${monthlyCount} monthly)`);
    console.log(`   Schedules:        ${createdSchedules.length}`);
    console.log(`   Assigned Tasks:   ${tasksAssigned}`);
    console.log(`   Attendance:       ${attendanceCount}`);
    console.log(`   Completed Tasks:  ${completedCount}`);
    console.log('\n🔐 Login Credentials:');
    console.log('   ops@store.com  / password123  (OPS)');
    console.log('   budi@store.com / password123  (PIC Employee)');
    console.log('   siti@store.com / password123  (SO Employee)');

  } catch (err) {
    console.error('❌ Seeding failed:', err);
    throw err;
  }
}

seedDatabase()
  .then(() => { console.log('\n🎉 Done!'); process.exit(0); })
  .catch(() => process.exit(1));