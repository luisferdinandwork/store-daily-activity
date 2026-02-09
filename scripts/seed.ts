// scripts/seed.ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { config } from 'dotenv';
import { eq, and } from 'drizzle-orm';
import * as schema from '../lib/db/schema'; // Adjust path if needed
import bcrypt from 'bcryptjs';

config({ path: '.env.local' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql, { schema });

async function main() {
  console.log('🌱 Seeding database...');

  // Check if an admin user already exists to avoid duplicate seeding
  const existingAdmin = await db.select().from(schema.users).where(eq(schema.users.email, 'admin@example.com')).limit(1);
  
  if (existingAdmin.length > 0) {
    console.log('Database already seeded. Skipping seeding.');
    return;
  }

  // Create stores
  const [store1] = await db.insert(schema.stores).values({
    name: 'Main Branch',
    address: '123 Commerce St, Downtown',
    pettyCashBalance: '1000000.00',
  }).returning();

  const [store2] = await db.insert(schema.stores).values({
    name: 'Westside Branch',
    address: '456 Park Ave, West District',
    pettyCashBalance: '750000.00',
  }).returning();

  const [store3] = await db.insert(schema.stores).values({
    name: 'Eastside Branch',
    address: '789 Market St, East District',
    pettyCashBalance: '850000.00',
  }).returning();

  // Hash passwords for all users
  const adminPassword = await bcrypt.hash('admin123', 10);
  const opsPassword = await bcrypt.hash('ops123', 10);
  const financePassword = await bcrypt.hash('finance123', 10);
  const employeePassword = await bcrypt.hash('employee123', 10);

  // Create admin/ops users
  const [adminUser] = await db.insert(schema.users).values({
    name: 'Super Admin',
    email: 'admin@example.com',
    password: adminPassword,
    role: 'ops',
  }).returning();

  const [opsUser1] = await db.insert(schema.users).values({
    name: 'Operations Manager',
    email: 'ops@example.com',
    password: opsPassword,
    role: 'ops',
    storeId: store1.id,
  }).returning();

  const [financeUser] = await db.insert(schema.users).values({
    name: 'Finance Manager',
    email: 'finance@example.com',
    password: financePassword,
    role: 'finance',
  }).returning();

  // Create employees
  const [employee1] = await db.insert(schema.users).values({
    name: 'John Smith',
    email: 'john@example.com',
    password: employeePassword,
    role: 'employee',
    employeeType: 'pic',
    storeId: store1.id,
  }).returning();

  const [employee2] = await db.insert(schema.users).values({
    name: 'Sarah Johnson',
    email: 'sarah@example.com',
    password: employeePassword,
    role: 'employee',
    employeeType: 'so',
    storeId: store1.id,
  }).returning();

  const [employee3] = await db.insert(schema.users).values({
    name: 'Michael Brown',
    email: 'michael@example.com',
    password: employeePassword,
    role: 'employee',
    employeeType: 'pic',
    storeId: store2.id,
  }).returning();

  const [employee4] = await db.insert(schema.users).values({
    name: 'Emily Davis',
    email: 'emily@example.com',
    password: employeePassword,
    role: 'employee',
    employeeType: 'so',
    storeId: store2.id,
  }).returning();

  const [employee5] = await db.insert(schema.users).values({
    name: 'Robert Wilson',
    email: 'robert@example.com',
    password: employeePassword,
    role: 'employee',
    employeeType: 'pic',
    storeId: store3.id,
  }).returning();

  const [employee6] = await db.insert(schema.users).values({
    name: 'Lisa Anderson',
    email: 'lisa@example.com',
    password: employeePassword,
    role: 'employee',
    employeeType: 'so',
    storeId: store3.id,
  }).returning();

  // Create schedules for employees (for current week)
  const today = new Date();
  const currentDay = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - currentDay);
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    
    // Store 1 schedules
    await db.insert(schema.schedules).values({
      userId: employee1.id,
      storeId: store1.id,
      shift: i % 2 === 0 ? 'morning' : 'evening',
      date: date,
      isHoliday: i === 0, // Sunday is a holiday
    });
    
    await db.insert(schema.schedules).values({
      userId: employee2.id,
      storeId: store1.id,
      shift: i % 2 === 1 ? 'morning' : 'evening',
      date: date,
      isHoliday: i === 0, // Sunday is a holiday
    });
    
    // Store 2 schedules
    await db.insert(schema.schedules).values({
      userId: employee3.id,
      storeId: store2.id,
      shift: i % 2 === 0 ? 'morning' : 'evening',
      date: date,
      isHoliday: i === 0, // Sunday is a holiday
    });
    
    await db.insert(schema.schedules).values({
      userId: employee4.id,
      storeId: store2.id,
      shift: i % 2 === 1 ? 'morning' : 'evening',
      date: date,
      isHoliday: i === 0, // Sunday is a holiday
    });
    
    // Store 3 schedules
    await db.insert(schema.schedules).values({
      userId: employee5.id,
      storeId: store3.id,
      shift: i % 2 === 0 ? 'morning' : 'evening',
      date: date,
      isHoliday: i === 0, // Sunday is a holiday
    });
    
    await db.insert(schema.schedules).values({
      userId: employee6.id,
      storeId: store3.id,
      shift: i % 2 === 1 ? 'morning' : 'evening',
      date: date,
      isHoliday: i === 0, // Sunday is a holiday
    });
  }

  // Create tasks
  const [task1] = await db.insert(schema.tasks).values({
    title: 'Open Store',
    description: 'Open the store for business, turn on lights, unlock doors',
    role: 'employee',
    employeeType: 'pic',
    shift: 'morning',
    isDaily: true,
  }).returning();

  const [task2] = await db.insert(schema.tasks).values({
    title: 'Count Cash Register',
    description: 'Count the cash in the register and verify against records',
    role: 'employee',
    employeeType: 'pic',
    shift: 'morning',
    isDaily: true,
  }).returning();

  const [task3] = await db.insert(schema.tasks).values({
    title: 'Stock Shelves',
    description: 'Check inventory levels and stock shelves as needed',
    role: 'employee',
    shift: 'morning',
    isDaily: true,
  }).returning();

  const [task4] = await db.insert(schema.tasks).values({
    title: 'Clean Store',
    description: 'Clean and organize the store area',
    role: 'employee',
    shift: 'evening',
    isDaily: true,
  }).returning();

  const [task5] = await db.insert(schema.tasks).values({
    title: 'Close Store',
    description: 'Close the store, secure cash, lock doors',
    role: 'employee',
    employeeType: 'pic',
    shift: 'evening',
    isDaily: true,
  }).returning();

  const [task6] = await db.insert(schema.tasks).values({
    title: 'Submit Daily Report',
    description: 'Submit the daily sales and operations report',
    role: 'employee',
    employeeType: 'so',
    shift: 'evening',
    isDaily: true,
  }).returning();

  // Assign tasks to employees for today
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  // Morning tasks for PIC employees
  await db.insert(schema.employeeTasks).values({
    taskId: task1.id,
    userId: employee1.id,
    storeId: store1.id,
    date: todayDate,
    status: 'completed',
    completedAt: new Date(),
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task2.id,
    userId: employee1.id,
    storeId: store1.id,
    date: todayDate,
    status: 'completed',
    completedAt: new Date(),
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task1.id,
    userId: employee3.id,
    storeId: store2.id,
    date: todayDate,
    status: 'completed',
    completedAt: new Date(),
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task2.id,
    userId: employee3.id,
    storeId: store2.id,
    date: todayDate,
    status: 'completed',
    completedAt: new Date(),
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task1.id,
    userId: employee5.id,
    storeId: store3.id,
    date: todayDate,
    status: 'completed',
    completedAt: new Date(),
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task2.id,
    userId: employee5.id,
    storeId: store3.id,
    date: todayDate,
    status: 'completed',
    completedAt: new Date(),
  });

  // General tasks for all employees
  await db.insert(schema.employeeTasks).values({
    taskId: task3.id,
    userId: employee1.id,
    storeId: store1.id,
    date: todayDate,
    status: 'in_progress',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task3.id,
    userId: employee2.id,
    storeId: store1.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task3.id,
    userId: employee3.id,
    storeId: store2.id,
    date: todayDate,
    status: 'completed',
    completedAt: new Date(),
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task3.id,
    userId: employee4.id,
    storeId: store2.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task3.id,
    userId: employee5.id,
    storeId: store3.id,
    date: todayDate,
    status: 'in_progress',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task3.id,
    userId: employee6.id,
    storeId: store3.id,
    date: todayDate,
    status: 'pending',
  });

  // Evening tasks (pending for now)
  await db.insert(schema.employeeTasks).values({
    taskId: task4.id,
    userId: employee1.id,
    storeId: store1.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task4.id,
    userId: employee2.id,
    storeId: store1.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task4.id,
    userId: employee3.id,
    storeId: store2.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task4.id,
    userId: employee4.id,
    storeId: store2.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task4.id,
    userId: employee5.id,
    storeId: store3.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task4.id,
    userId: employee6.id,
    storeId: store3.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task5.id,
    userId: employee1.id,
    storeId: store1.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task5.id,
    userId: employee3.id,
    storeId: store2.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task5.id,
    userId: employee5.id,
    storeId: store3.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task6.id,
    userId: employee2.id,
    storeId: store1.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task6.id,
    userId: employee4.id,
    storeId: store2.id,
    date: todayDate,
    status: 'pending',
  });

  await db.insert(schema.employeeTasks).values({
    taskId: task6.id,
    userId: employee6.id,
    storeId: store3.id,
    date: todayDate,
    status: 'pending',
  });

  // Create issues
  const [issue1] = await db.insert(schema.issues).values({
    title: 'Cash Register Shortage',
    description: 'Cash register is short by $500 at the end of yesterday',
    userId: employee1.id,
    storeId: store1.id,
    status: 'reported',
  }).returning();

  const [issue2] = await db.insert(schema.issues).values({
    title: 'Inventory System Error',
    description: 'Inventory system is not updating correctly for certain items',
    userId: employee3.id,
    storeId: store2.id,
    status: 'in_review',
    reviewedBy: opsUser1.id,
    reviewedAt: new Date(),
  }).returning();

  const [issue3] = await db.insert(schema.issues).values({
    title: 'AC Not Working',
    description: 'Air conditioning unit in the main store area is not working',
    userId: employee5.id,
    storeId: store3.id,
    status: 'resolved',
    reviewedBy: opsUser1.id,
    reviewedAt: new Date(),
  }).returning();

  // Create petty cash transactions
  await db.insert(schema.pettyCashTransactions).values({
    amount: '15000.00',
    description: 'Office supplies purchase',
    userId: employee1.id,
    storeId: store1.id,
    approvedBy: opsUser1.id,
    approvedAt: new Date(),
  });

  await db.insert(schema.pettyCashTransactions).values({
    amount: '25000.00',
    description: 'Cleaning services',
    userId: employee3.id,
    storeId: store2.id,
    approvedBy: opsUser1.id,
    approvedAt: new Date(),
  });

  await db.insert(schema.pettyCashTransactions).values({
    amount: '10000.00',
    description: 'Small equipment repair',
    userId: employee5.id,
    storeId: store3.id,
    approvedBy: opsUser1.id,
    approvedAt: new Date(),
  });

  await db.insert(schema.pettyCashTransactions).values({
    amount: '5000.00',
    description: 'Customer refund',
    userId: employee2.id,
    storeId: store1.id,
    approvedBy: opsUser1.id,
    approvedAt: new Date(),
  });

  await db.insert(schema.pettyCashTransactions).values({
    amount: '30000.00',
    description: 'Marketing materials',
    userId: employee4.id,
    storeId: store2.id,
    approvedBy: opsUser1.id,
    approvedAt: new Date(),
  });

  // Create daily reports (BOD/EOD)
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Yesterday's BOD reports
  await db.insert(schema.dailyReports).values({
    type: 'BOD',
    date: yesterday,
    actualAmount: '500000.00',
    roundedAmount: '500000.00',
    userId: employee1.id,
    storeId: store1.id,
    status: 'verified',
    verifiedBy: opsUser1.id,
    verifiedAt: new Date(),
  });

  await db.insert(schema.dailyReports).values({
    type: 'BOD',
    date: yesterday,
    actualAmount: '400000.00',
    roundedAmount: '400000.00',
    userId: employee3.id,
    storeId: store2.id,
    status: 'verified',
    verifiedBy: opsUser1.id,
    verifiedAt: new Date(),
  });

  await db.insert(schema.dailyReports).values({
    type: 'BOD',
    date: yesterday,
    actualAmount: '450000.00',
    roundedAmount: '450000.00',
    userId: employee5.id,
    storeId: store3.id,
    status: 'verified',
    verifiedBy: opsUser1.id,
    verifiedAt: new Date(),
  });

  // Yesterday's EOD reports
  await db.insert(schema.dailyReports).values({
    type: 'EOD',
    date: yesterday,
    actualAmount: '550000.00',
    roundedAmount: '550000.00',
    userId: employee2.id,
    storeId: store1.id,
    status: 'verified',
    verifiedBy: opsUser1.id,
    verifiedAt: new Date(),
  });

  await db.insert(schema.dailyReports).values({
    type: 'EOD',
    date: yesterday,
    actualAmount: '420000.00',
    roundedAmount: '420000.00',
    userId: employee4.id,
    storeId: store2.id,
    status: 'verified',
    verifiedBy: opsUser1.id,
    verifiedAt: new Date(),
  });

  await db.insert(schema.dailyReports).values({
    type: 'EOD',
    date: yesterday,
    actualAmount: '465000.00',
    roundedAmount: '465000.00',
    userId: employee6.id,
    storeId: store3.id,
    status: 'verified',
    verifiedBy: opsUser1.id,
    verifiedAt: new Date(),
  });

  // Today's BOD reports
  await db.insert(schema.dailyReports).values({
    type: 'BOD',
    date: todayDate,
    actualAmount: '550000.00',
    roundedAmount: '550000.00',
    userId: employee1.id,
    storeId: store1.id,
    status: 'submitted',
  });

  await db.insert(schema.dailyReports).values({
    type: 'BOD',
    date: todayDate,
    actualAmount: '420000.00',
    roundedAmount: '420000.00',
    userId: employee3.id,
    storeId: store2.id,
    status: 'submitted',
  });

  await db.insert(schema.dailyReports).values({
    type: 'BOD',
    date: todayDate,
    actualAmount: '465000.00',
    roundedAmount: '465000.00',
    userId: employee5.id,
    storeId: store3.id,
    status: 'submitted',
  });

  // Today's EOD reports (drafts)
  await db.insert(schema.dailyReports).values({
    type: 'EOD',
    date: todayDate,
    actualAmount: '600000.00',
    roundedAmount: '600000.00',
    userId: employee2.id,
    storeId: store1.id,
    status: 'draft',
    issueId: issue1.id,
  });

  await db.insert(schema.dailyReports).values({
    type: 'EOD',
    date: todayDate,
    actualAmount: '450000.00',
    roundedAmount: '450000.00',
    userId: employee4.id,
    storeId: store2.id,
    status: 'draft',
    issueId: issue2.id,
  });

  await db.insert(schema.dailyReports).values({
    type: 'EOD',
    date: todayDate,
    actualAmount: '480000.00',
    roundedAmount: '480000.00',
    userId: employee6.id,
    storeId: store3.id,
    status: 'draft',
  });

  console.log('✅ Seeding completed!');
  console.log('Created stores:', store1.name, store2.name, store3.name);
  console.log('Created admin user:', adminUser.email);
  console.log('Created employees:', employee1.name, employee2.name, employee3.name, employee4.name, employee5.name, employee6.name);
  console.log('Created tasks and schedules for the week');
  console.log('Created issues, petty cash transactions, and daily reports');
  console.log('Login credentials:');
  console.log('Admin: admin@example.com / admin123');
  console.log('Ops: ops@example.com / ops123');
  console.log('Finance: finance@example.com / finance123');
  console.log('Employees: employee@example.com / employee123');
}

main().catch((err) => {
  console.error('❌ Error during seeding:', err);
  process.exit(1);
});