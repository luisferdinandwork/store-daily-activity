// scripts/seed-daily-tasks.ts
// Database seeder for daily task management system
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
import { hash } from 'bcrypt';
import { eq, lte, and } from 'drizzle-orm';

const SALT_ROUNDS = 10;

async function seedDatabase() {
  console.log('🌱 Starting database seeding for daily task management...\n');

  try {
    // Clear existing data (in reverse order of dependencies)
    console.log('🗑️  Clearing existing data...');
    await db.delete(employeeTasks);
    await db.delete(attendance);
    await db.delete(schedules);
    await db.delete(tasks);
    await db.delete(users);
    await db.delete(stores);
    console.log('✓ Existing data cleared\n');

    // ==========================================
    // 1. CREATE STORES
    // ==========================================
    console.log('🏪 Creating stores...');
    const storeData: NewStore[] = [
      {
        name: 'Store Jakarta Pusat',
        address: 'Jl. Thamrin No. 1, Jakarta Pusat',
        pettyCashBalance: '1000000',
      },
      {
        name: 'Store Jakarta Selatan',
        address: 'Jl. Sudirman No. 52, Jakarta Selatan',
        pettyCashBalance: '1500000',
      },
    ];

    const createdStores = await db.insert(stores).values(storeData).returning();
    const store1 = createdStores[0];
    const store2 = createdStores[1];
    console.log(`✓ Created ${createdStores.length} stores\n`);

    // ==========================================
    // 2. CREATE USERS
    // ==========================================
    console.log('👥 Creating users...');
    
    const hashedPassword = await hash('password123', SALT_ROUNDS);
    
    const userData: NewUser[] = [
      // OPS Users
      {
        name: 'Admin OPS',
        email: 'ops@store.com',
        password: hashedPassword,
        role: 'ops',
        employeeType: null,
        storeId: store1.id,
      },
      {
        name: 'OPS Manager Store 2',
        email: 'ops2@store.com',
        password: hashedPassword,
        role: 'ops',
        employeeType: null,
        storeId: store2.id,
      },
      
      // Store 1 Employees
      {
        name: 'Budi Santoso (PIC)',
        email: 'budi@store.com',
        password: hashedPassword,
        role: 'employee',
        employeeType: 'pic',
        storeId: store1.id,
      },
      {
        name: 'Siti Nurhaliza (SO)',
        email: 'siti@store.com',
        password: hashedPassword,
        role: 'employee',
        employeeType: 'so',
        storeId: store1.id,
      },
      {
        name: 'Ahmad Rahman (PIC)',
        email: 'ahmad@store.com',
        password: hashedPassword,
        role: 'employee',
        employeeType: 'pic',
        storeId: store1.id,
      },
      {
        name: 'Dewi Lestari (SO)',
        email: 'dewi@store.com',
        password: hashedPassword,
        role: 'employee',
        employeeType: 'so',
        storeId: store1.id,
      },
      
      // Store 2 Employees
      {
        name: 'Eko Prasetyo (PIC)',
        email: 'eko@store.com',
        password: hashedPassword,
        role: 'employee',
        employeeType: 'pic',
        storeId: store2.id,
      },
      {
        name: 'Rina Wijaya (SO)',
        email: 'rina@store.com',
        password: hashedPassword,
        role: 'employee',
        employeeType: 'so',
        storeId: store2.id,
      },
    ];

    const createdUsers = await db.insert(users).values(userData).returning();
    
    // Organize users by role for easy reference
    const opsUser = createdUsers[0];
    const opsUser2 = createdUsers[1];
    const store1PIC1 = createdUsers[2];
    const store1SO1 = createdUsers[3];
    const store1PIC2 = createdUsers[4];
    const store1SO2 = createdUsers[5];
    const store2PIC = createdUsers[6];
    const store2SO = createdUsers[7];
    
    console.log(`✓ Created ${createdUsers.length} users`);
    console.log(`  - OPS users: 2`);
    console.log(`  - Store 1 employees: 4 (2 PIC, 2 SO)`);
    console.log(`  - Store 2 employees: 2 (1 PIC, 1 SO)\n`);

    // ==========================================
    // 3. CREATE TASK TEMPLATES
    // ==========================================
    console.log('📋 Creating task templates...');
    
    const taskData: NewTask[] = [
      // Morning Tasks - PIC
      {
        title: 'Store Opening Procedure',
        description: 'Unlock doors, turn on lights, check security system',
        role: 'employee',
        employeeType: 'pic',
        shift: 'morning',
        isDaily: true,
        requiresForm: false,
        requiresAttachment: false,
        createdBy: opsUser.id,
      },
      {
        title: 'Cash Register Setup',
        description: 'Count starting cash, verify petty cash balance',
        role: 'employee',
        employeeType: 'pic',
        shift: 'morning',
        isDaily: true,
        requiresForm: true,
        formSchema: JSON.stringify({
          fields: [
            {
              id: 'starting_cash',
              type: 'number',
              label: 'Starting Cash Amount (IDR)',
              required: true,
              validation: { min: 0 },
            },
            {
              id: 'petty_cash',
              type: 'number',
              label: 'Petty Cash Balance (IDR)',
              required: true,
              validation: { min: 0 },
            },
            {
              id: 'discrepancy',
              type: 'textarea',
              label: 'Any Discrepancies',
              required: false,
            },
          ],
        }),
        requiresAttachment: false,
        createdBy: opsUser.id,
      },
      {
        title: 'Morning Inventory Check',
        description: 'Check stock levels and expiry dates',
        role: 'employee',
        employeeType: 'pic',
        shift: 'morning',
        isDaily: true,
        requiresForm: true,
        formSchema: JSON.stringify({
          fields: [
            {
              id: 'items_checked',
              type: 'number',
              label: 'Number of Items Checked',
              required: true,
              validation: { min: 0 },
            },
            {
              id: 'expired_items',
              type: 'number',
              label: 'Expired Items Found',
              required: true,
              validation: { min: 0 },
            },
            {
              id: 'low_stock_items',
              type: 'textarea',
              label: 'Low Stock Items',
              required: false,
              placeholder: 'List items running low...',
            },
          ],
        }),
        requiresAttachment: true,
        maxAttachments: 5,
        createdBy: opsUser.id,
      },
      
      // Morning Tasks - SO
      {
        title: 'Store Cleaning - Morning',
        description: 'Clean floors, windows, and customer areas',
        role: 'employee',
        employeeType: 'so',
        shift: 'morning',
        isDaily: true,
        requiresForm: true,
        formSchema: JSON.stringify({
          fields: [
            {
              id: 'areas_cleaned',
              type: 'select',
              label: 'All Areas Cleaned',
              required: true,
              options: ['Yes', 'Partial', 'No'],
            },
            {
              id: 'cleaning_rating',
              type: 'select',
              label: 'Overall Cleanliness',
              required: true,
              options: ['Excellent', 'Good', 'Fair', 'Poor'],
            },
            {
              id: 'issues',
              type: 'textarea',
              label: 'Issues Found',
              required: false,
            },
          ],
        }),
        requiresAttachment: false,
        createdBy: opsUser.id,
      },
      {
        title: 'Product Display Setup',
        description: 'Arrange products, check price tags, update promotions',
        role: 'employee',
        employeeType: 'so',
        shift: 'morning',
        isDaily: true,
        requiresForm: false,
        requiresAttachment: true,
        maxAttachments: 3,
        createdBy: opsUser.id,
      },
      
      // Evening Tasks - PIC
      {
        title: 'End of Day Cash Count',
        description: 'Count cash register and prepare deposit',
        role: 'employee',
        employeeType: 'pic',
        shift: 'evening',
        isDaily: true,
        requiresForm: true,
        formSchema: JSON.stringify({
          fields: [
            {
              id: 'ending_cash',
              type: 'number',
              label: 'Ending Cash Amount (IDR)',
              required: true,
              validation: { min: 0 },
            },
            {
              id: 'total_sales',
              type: 'number',
              label: 'Total Sales (IDR)',
              required: true,
              validation: { min: 0 },
            },
            {
              id: 'variance',
              type: 'number',
              label: 'Variance (+/-)',
              required: true,
            },
            {
              id: 'explanation',
              type: 'textarea',
              label: 'Variance Explanation',
              required: false,
            },
          ],
        }),
        requiresAttachment: false,
        createdBy: opsUser.id,
      },
      {
        title: 'Store Closing Checklist',
        description: 'Lock up, turn off equipment, arm security',
        role: 'employee',
        employeeType: 'pic',
        shift: 'evening',
        isDaily: true,
        requiresForm: false,
        requiresAttachment: false,
        createdBy: opsUser.id,
      },
      
      // Evening Tasks - SO
      {
        title: 'Deep Cleaning - Evening',
        description: 'Mop floors, clean restrooms, take out trash',
        role: 'employee',
        employeeType: 'so',
        shift: 'evening',
        isDaily: true,
        requiresForm: true,
        formSchema: JSON.stringify({
          fields: [
            {
              id: 'floor_mopped',
              type: 'checkbox',
              label: 'Floors Mopped',
              required: true,
            },
            {
              id: 'restroom_cleaned',
              type: 'checkbox',
              label: 'Restrooms Cleaned',
              required: true,
            },
            {
              id: 'trash_removed',
              type: 'checkbox',
              label: 'Trash Removed',
              required: true,
            },
            {
              id: 'time_completed',
              type: 'time',
              label: 'Time Completed',
              required: true,
            },
          ],
        }),
        requiresAttachment: true,
        maxAttachments: 2,
        createdBy: opsUser.id,
      },
      {
        title: 'Stock Replenishment',
        description: 'Restock shelves from storage',
        role: 'employee',
        employeeType: 'so',
        shift: 'evening',
        isDaily: true,
        requiresForm: true,
        formSchema: JSON.stringify({
          fields: [
            {
              id: 'items_restocked',
              type: 'number',
              label: 'Number of Items Restocked',
              required: true,
              validation: { min: 0 },
            },
            {
              id: 'notes',
              type: 'textarea',
              label: 'Notes',
              required: false,
            },
          ],
        }),
        requiresAttachment: false,
        createdBy: opsUser.id,
      },
      
      // All Day Tasks
      {
        title: 'Customer Service Report',
        description: 'Log any customer complaints or feedback',
        role: 'employee',
        employeeType: 'pic',
        shift: null, // Both shifts
        isDaily: true,
        requiresForm: true,
        formSchema: JSON.stringify({
          fields: [
            {
              id: 'total_customers',
              type: 'number',
              label: 'Approximate Customer Count',
              required: false,
              validation: { min: 0 },
            },
            {
              id: 'complaints',
              type: 'number',
              label: 'Number of Complaints',
              required: true,
              validation: { min: 0 },
            },
            {
              id: 'complaint_details',
              type: 'textarea',
              label: 'Complaint Details',
              required: false,
            },
            {
              id: 'positive_feedback',
              type: 'textarea',
              label: 'Positive Feedback',
              required: false,
            },
          ],
        }),
        requiresAttachment: false,
        createdBy: opsUser.id,
      },
    ];

    const createdTasks = await db.insert(tasks).values(taskData).returning();
    console.log(`✓ Created ${createdTasks.length} task templates`);
    console.log(`  - Morning tasks: ${taskData.filter(t => t.shift === 'morning').length}`);
    console.log(`  - Evening tasks: ${taskData.filter(t => t.shift === 'evening').length}`);
    console.log(`  - All-day tasks: ${taskData.filter(t => !t.shift).length}\n`);

    // ==========================================
    // 4. CREATE SCHEDULES (Next 7 Days)
    // ==========================================
    console.log('📅 Creating schedules for next 7 days...');
    
    const scheduleData: NewSchedule[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const scheduleDate = new Date(today);
      scheduleDate.setDate(today.getDate() + i);
      
      const isWeekend = scheduleDate.getDay() === 0 || scheduleDate.getDay() === 6;
      
      // Store 1 - Morning Shift
      scheduleData.push({
        userId: i % 2 === 0 ? store1PIC1.id : store1PIC2.id, // Alternate PICs
        storeId: store1.id,
        shift: 'morning',
        date: new Date(scheduleDate.setHours(8, 0, 0, 0)),
        isHoliday: false,
      });
      
      scheduleData.push({
        userId: i % 2 === 0 ? store1SO1.id : store1SO2.id, // Alternate SOs
        storeId: store1.id,
        shift: 'morning',
        date: new Date(scheduleDate.setHours(8, 0, 0, 0)),
        isHoliday: false,
      });
      
      // Store 1 - Evening Shift
      scheduleData.push({
        userId: i % 2 === 0 ? store1PIC2.id : store1PIC1.id, // Opposite of morning
        storeId: store1.id,
        shift: 'evening',
        date: new Date(scheduleDate.setHours(14, 0, 0, 0)),
        isHoliday: false,
      });
      
      scheduleData.push({
        userId: i % 2 === 0 ? store1SO2.id : store1SO1.id, // Opposite of morning
        storeId: store1.id,
        shift: 'evening',
        date: new Date(scheduleDate.setHours(14, 0, 0, 0)),
        isHoliday: false,
      });
      
      // Store 2 - Both shifts (smaller team)
      if (!isWeekend) {
        scheduleData.push({
          userId: store2PIC.id,
          storeId: store2.id,
          shift: 'morning',
          date: new Date(scheduleDate.setHours(8, 0, 0, 0)),
          isHoliday: false,
        });
        
        scheduleData.push({
          userId: store2SO.id,
          storeId: store2.id,
          shift: 'morning',
          date: new Date(scheduleDate.setHours(8, 0, 0, 0)),
          isHoliday: false,
        });
      }
    }

    const createdSchedules = await db.insert(schedules).values(scheduleData).returning();
    console.log(`✓ Created ${createdSchedules.length} schedules\n`);

    // ==========================================
    // 5. AUTO-ASSIGN TASKS TO SCHEDULES
    // ==========================================
    console.log('🎯 Auto-assigning tasks to scheduled employees...');
    
    let tasksAssigned = 0;
    
    for (const schedule of createdSchedules) {
      // Get the user for this schedule
      const user = createdUsers.find(u => u.id === schedule.userId);
      if (!user) continue;
      
      // Find matching tasks
      const matchingTasks = createdTasks.filter(task => {
        const roleMatch = task.role === user.role;
        const typeMatch = !task.employeeType || task.employeeType === user.employeeType;
        const shiftMatch = !task.shift || task.shift === schedule.shift;
        return roleMatch && typeMatch && shiftMatch;
      });
      
      // Create employee tasks
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
    
    console.log(`✓ Assigned ${tasksAssigned} tasks to employees\n`);

    // ==========================================
    // 6. CREATE SAMPLE ATTENDANCE (Past 3 Days)
    // ==========================================
    console.log('✅ Creating sample attendance records...');
    
    let attendanceRecords = 0;
    const pastSchedules = createdSchedules.filter(s => {
      const scheduleDate = new Date(s.date);
      const threeDaysAgo = new Date(today);
      threeDaysAgo.setDate(today.getDate() - 3);
      return scheduleDate >= threeDaysAgo && scheduleDate < today;
    });
    
    for (const schedule of pastSchedules) {
      const scheduleDate = new Date(schedule.date);
      const checkInTime = new Date(scheduleDate);
      
      // Randomly assign attendance status (mostly present)
      const random = Math.random();
      let status: 'present' | 'late' | 'absent';
      
      if (random < 0.8) {
        status = 'present';
        checkInTime.setMinutes(checkInTime.getMinutes() + Math.floor(Math.random() * 10));
      } else if (random < 0.95) {
        status = 'late';
        checkInTime.setMinutes(checkInTime.getMinutes() + 30 + Math.floor(Math.random() * 30));
      } else {
        status = 'absent';
      }
      
      const checkOutTime = status !== 'absent' ? new Date(checkInTime) : null;
      if (checkOutTime) {
        checkOutTime.setHours(checkOutTime.getHours() + 8);
      }
      
      const [attendanceRecord] = await db.insert(attendance).values({
        scheduleId: schedule.id,
        userId: schedule.userId,
        storeId: schedule.storeId,
        date: schedule.date,
        shift: schedule.shift,
        status,
        checkInTime: status !== 'absent' ? checkInTime : null,
        checkOutTime: status !== 'absent' ? checkOutTime : null,
        notes: status === 'late' ? 'Traffic jam' : status === 'absent' ? 'Sick leave' : null,
        recordedBy: schedule.storeId === store1.id ? opsUser.id : opsUser2.id,
      }).returning();
      
      // Link attendance to employee tasks
      await db.update(employeeTasks)
        .set({ attendanceId: attendanceRecord.id })
        .where(eq(employeeTasks.scheduleId, schedule.id));
      
      attendanceRecords++;
    }
    
    console.log(`✓ Created ${attendanceRecords} attendance records\n`);

    // ==========================================
    // 7. COMPLETE SOME TASKS (Past Days)
    // ==========================================
    console.log('✨ Completing sample tasks...');
    
    const pastTasks = await db.select()
      .from(employeeTasks)
      .where(
        and(
          lte(employeeTasks.date, today),
          eq(employeeTasks.status, 'pending')
        )
      );
    
    let tasksCompleted = 0;
    
    for (const empTask of pastTasks) {
      // 70% completion rate
      if (Math.random() < 0.7) {
        const task = createdTasks.find(t => t.id === empTask.taskId);
        if (!task) continue;
        
        let formData = null;
        let attachmentUrls = null;
        
        // Generate sample form data if required
        if (task.requiresForm && task.formSchema) {
          const schema = JSON.parse(task.formSchema);
          const data: Record<string, any> = {};
          
          for (const field of schema.fields) {
            switch (field.type) {
              case 'number':
                data[field.id] = Math.floor(Math.random() * 1000000) + 10000;
                break;
              case 'select':
                data[field.id] = field.options[Math.floor(Math.random() * field.options.length)];
                break;
              case 'checkbox':
                data[field.id] = true;
                break;
              case 'time':
                data[field.id] = '17:30';
                break;
              case 'textarea':
                data[field.id] = field.required ? 'Sample notes' : '';
                break;
              default:
                data[field.id] = 'Sample value';
            }
          }
          formData = JSON.stringify(data);
        }
        
        // Generate sample attachment URLs if required
        if (task.requiresAttachment) {
          const numAttachments = Math.min(
            Math.floor(Math.random() * (task.maxAttachments || 1)) + 1,
            task.maxAttachments || 1
          );
          const urls = Array.from({ length: numAttachments }, (_, i) => 
            `https://storage.example.com/uploads/${empTask.id}_${i + 1}.jpg`
          );
          attachmentUrls = JSON.stringify(urls);
        }
        
        await db.update(employeeTasks)
          .set({
            status: 'completed',
            completedAt: new Date(empTask.date.getTime() + Math.random() * 8 * 60 * 60 * 1000),
            formData,
            attachmentUrls,
            notes: 'Task completed successfully',
          })
          .where(eq(employeeTasks.id, empTask.id));
        
        tasksCompleted++;
      }
    }
    
    console.log(`✓ Completed ${tasksCompleted} tasks\n`);

    // ==========================================
    // SUMMARY
    // ==========================================
    console.log('✅ Database seeding completed!\n');
    console.log('📊 Summary:');
    console.log(`   Stores: ${createdStores.length}`);
    console.log(`   Users: ${createdUsers.length} (2 OPS, ${createdUsers.length - 2} Employees)`);
    console.log(`   Task Templates: ${createdTasks.length}`);
    console.log(`   Schedules: ${createdSchedules.length}`);
    console.log(`   Assigned Tasks: ${tasksAssigned}`);
    console.log(`   Attendance Records: ${attendanceRecords}`);
    console.log(`   Completed Tasks: ${tasksCompleted}`);
    console.log('\n🔐 Login Credentials:');
    console.log('   Email: ops@store.com | Password: password123 (OPS)');
    console.log('   Email: budi@store.com | Password: password123 (PIC Employee)');
    console.log('   Email: siti@store.com | Password: password123 (SO Employee)');

  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
}

// Run seeder
seedDatabase()
  .then(() => {
    console.log('\n🎉 Seeding finished successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Seeding failed:', error);
    process.exit(1);
  });