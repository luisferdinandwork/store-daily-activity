// examples/daily-task-usage.ts
// This file demonstrates how to use the daily task utilities

import {
  generateDailyTasksForDate,
  assignTasksToSchedule,
  recordAttendance,
  checkoutAttendance,
  completeTask,
  verifyTask,
  getEmployeeTasksForDate,
  getTaskStatistics,
  createTaskTemplate,
  getAttendanceSummary,
  type TaskFormSchema,
} from '@/lib/daily-task-utils';

// ====================
// 1. OPS CREATES TASK TEMPLATES
// ====================

async function setupTaskTemplates(opsUserId: string) {
  // Example 1: Simple task without form
  await createTaskTemplate({
    title: 'Store Opening Checklist',
    description: 'Complete all opening procedures',
    role: 'employee',
    employeeType: 'pic',
    shift: 'morning',
    isDaily: true,
    requiresForm: false,
    requiresAttachment: false,
    createdBy: opsUserId,
  });

  // Example 2: Task with form submission
  const cleaningFormSchema: TaskFormSchema = {
    fields: [
      {
        id: 'cleanliness_rating',
        type: 'select',
        label: 'Overall Cleanliness',
        required: true,
        options: ['Excellent', 'Good', 'Fair', 'Poor'],
      },
      {
        id: 'areas_cleaned',
        type: 'checkbox',
        label: 'Areas Cleaned',
        required: true,
      },
      {
        id: 'issues_found',
        type: 'textarea',
        label: 'Any Issues Found',
        required: false,
        placeholder: 'Describe any issues...',
      },
      {
        id: 'cleaning_time',
        type: 'time',
        label: 'Time Completed',
        required: true,
      },
    ],
  };

  await createTaskTemplate({
    title: 'Daily Cleaning Check',
    description: 'Inspect and clean all store areas',
    role: 'employee',
    employeeType: 'so',
    shift: 'evening',
    isDaily: true,
    requiresForm: true,
    formSchema: cleaningFormSchema,
    requiresAttachment: false,
    createdBy: opsUserId,
  });

  // Example 3: Task with photo attachment
  const inventoryFormSchema: TaskFormSchema = {
    fields: [
      {
        id: 'item_count',
        type: 'number',
        label: 'Item Count',
        required: true,
        validation: { min: 0 },
      },
      {
        id: 'discrepancies',
        type: 'textarea',
        label: 'Any Discrepancies',
        required: false,
      },
    ],
  };

  await createTaskTemplate({
    title: 'Inventory Spot Check',
    description: 'Take photos of inventory and submit counts',
    role: 'employee',
    employeeType: 'pic',
    isDaily: true,
    requiresForm: true,
    formSchema: inventoryFormSchema,
    requiresAttachment: true,
    maxAttachments: 3,
    createdBy: opsUserId,
  });
}

// ====================
// 2. OPS CREATES SCHEDULES
// ====================

async function createScheduleExample(db: any, opsUserId: string) {
  // OPS creates a schedule for tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);

  // Create schedule for Employee B (PIC - Morning shift)
  const [scheduleB] = await db.insert('schedules').values({
    userId: 'employee-b-id',
    storeId: 'store-1-id',
    shift: 'morning',
    date: tomorrow,
    isHoliday: false,
  }).returning();

  // Automatically assign tasks to this schedule
  await assignTasksToSchedule(
    scheduleB.id,
    'employee-b-id',
    'store-1-id',
    'morning',
    tomorrow
  );

  // Create schedule for Employee C (SO - Evening shift)
  const [scheduleC] = await db.insert('schedules').values({
    userId: 'employee-c-id',
    storeId: 'store-1-id',
    shift: 'evening',
    date: tomorrow,
    isHoliday: false,
  }).returning();

  // Automatically assign tasks
  await assignTasksToSchedule(
    scheduleC.id,
    'employee-c-id',
    'store-1-id',
    'evening',
    tomorrow
  );

  console.log('Schedules created and tasks assigned!');
}

// ====================
// 3. BULK GENERATE TASKS FOR THE DAY
// ====================

async function generateTasksForTomorrow(storeId: string, opsUserId: string) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const result = await generateDailyTasksForDate(
    storeId,
    tomorrow,
    opsUserId
  );

  console.log(`Tasks created: ${result.tasksCreated}`);
  if (result.errors) {
    console.error('Errors:', result.errors);
  }
}

// ====================
// 4. RECORD ATTENDANCE
// ====================

async function recordEmployeeAttendance(scheduleId: string, opsUserId: string) {
  // Employee checks in on time
  const result = await recordAttendance(
    scheduleId,
    'present',
    new Date(), // check-in time
    opsUserId,
    'On time'
  );

  console.log('Attendance recorded:', result);
  return result.attendanceId;
}

async function recordLateAttendance(scheduleId: string, opsUserId: string) {
  // Employee is late
  const lateTime = new Date();
  lateTime.setHours(lateTime.getHours() + 1);

  const result = await recordAttendance(
    scheduleId,
    'late',
    lateTime,
    opsUserId,
    'Arrived 1 hour late due to traffic'
  );

  console.log('Late attendance recorded:', result);
}

async function checkoutEmployee(attendanceId: string) {
  const checkoutTime = new Date();
  checkoutTime.setHours(17, 0, 0, 0);

  await checkoutAttendance(attendanceId, checkoutTime);
  console.log('Employee checked out');
}

// ====================
// 5. EMPLOYEE COMPLETES TASKS
// ====================

async function employeeCompletesSimpleTask(employeeTaskId: string, employeeId: string) {
  // Task without form or attachment
  const result = await completeTask({
    employeeTaskId,
    notes: 'All opening procedures completed successfully',
    completedBy: employeeId,
  });

  console.log('Task completed:', result);
}

async function employeeCompletesTaskWithForm(employeeTaskId: string, employeeId: string) {
  // Task with form submission
  const result = await completeTask({
    employeeTaskId,
    formData: {
      cleanliness_rating: 'Excellent',
      areas_cleaned: true,
      issues_found: 'Minor dust in storage area',
      cleaning_time: '16:30',
    },
    notes: 'Everything looks good',
    completedBy: employeeId,
  });

  console.log('Task with form completed:', result);
}

async function employeeCompletesTaskWithPhoto(
  employeeTaskId: string, 
  employeeId: string,
  photoUrls: string[]
) {
  // Task with form and photo attachments
  const result = await completeTask({
    employeeTaskId,
    formData: {
      item_count: 245,
      discrepancies: 'All counts match inventory system',
    },
    attachmentUrls: photoUrls, // URLs from uploaded files
    notes: 'Photos attached showing shelf organization',
    completedBy: employeeId,
  });

  console.log('Task with photos completed:', result);
}

// ====================
// 6. OPS VERIFIES COMPLETED TASKS
// ====================

async function opsVerifiesTask(employeeTaskId: string, opsUserId: string) {
  // Approve the task
  const result = await verifyTask(
    employeeTaskId,
    opsUserId,
    true, // approved
    'Good job! Everything looks correct.'
  );

  console.log('Task verified:', result);
}

async function opsRejectsTask(employeeTaskId: string, opsUserId: string) {
  // Reject the task - needs to be redone
  const result = await verifyTask(
    employeeTaskId,
    opsUserId,
    false, // not approved
    'Please retake photos with better lighting'
  );

  console.log('Task rejected:', result);
}

// ====================
// 7. VIEW EMPLOYEE TASKS
// ====================

async function viewEmployeeTasksToday(employeeId: string, storeId: string) {
  const today = new Date();
  const tasks = await getEmployeeTasksForDate(employeeId, storeId, today);

  console.log('Tasks for today:', tasks.length);
  
  tasks.forEach((t) => {
    console.log(`
      Task: ${t.task?.title}
      Status: ${t.employeeTask.status}
      Shift: ${t.employeeTask.shift}
      Attendance: ${t.attendance?.status || 'Not recorded'}
    `);
  });
}

// ====================
// 8. VIEW STATISTICS (OPS Dashboard)
// ====================

async function viewStoreStatistics(storeId: string) {
  const today = new Date();
  const stats = await getTaskStatistics(storeId, today);

  console.log(`
    Task Statistics for Today:
    Total Tasks: ${stats.total}
    Pending: ${stats.pending}
    In Progress: ${stats.inProgress}
    Completed: ${stats.completed}
    Completion Rate: ${stats.completionRate.toFixed(2)}%
  `);
}

// ====================
// 9. VIEW ATTENDANCE REPORT
// ====================

async function viewWeeklyAttendance(storeId: string) {
  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const summary = await getAttendanceSummary(storeId, weekAgo, today);

  console.log('Weekly Attendance Summary:');
  summary.forEach((record) => {
    console.log(`
      Employee: ${record.user?.name}
      Date: ${record.attendance.date}
      Shift: ${record.attendance.shift}
      Status: ${record.attendance.status}
      Check-in: ${record.attendance.checkInTime}
      Check-out: ${record.attendance.checkOutTime}
    `);
  });
}

// ====================
// COMPLETE WORKFLOW EXAMPLE
// ====================

async function completeWorkflowExample() {
  const opsUserId = 'ops-user-id';
  const storeId = 'store-1-id';
  const employeeBId = 'employee-b-id';
  
  console.log('=== DAY 1: OPS SETUP ===');
  
  // 1. OPS creates task templates (one-time setup)
  await setupTaskTemplates(opsUserId);
  console.log('✓ Task templates created');
  
  // 2. OPS creates schedule for tomorrow
  // (This would be done through UI, shown here for example)
  console.log('✓ Schedules created for employees');
  
  // 3. System auto-generates tasks based on schedules
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  await generateDailyTasksForDate(storeId, tomorrow, opsUserId);
  console.log('✓ Daily tasks auto-assigned to scheduled employees');
  
  console.log('\n=== DAY 2: MORNING ===');
  
  // 4. Employee B arrives and checks in
  const attendanceResult = await recordAttendance(
    'schedule-b-id',
    'present',
    new Date(),
    opsUserId
  );
  console.log('✓ Employee B checked in');
  
  // 5. Employee B views their tasks
  const employeeTasks = await getEmployeeTasksForDate(employeeBId, storeId, new Date());
  console.log(`✓ Employee B has ${employeeTasks.length} tasks today`);
  
  // 6. Employee B completes tasks
  for (const task of employeeTasks) {
    if (task.task?.requiresForm) {
      await employeeCompletesTaskWithForm(task.employeeTask.id, employeeBId);
    } else {
      await employeeCompletesSimpleTask(task.employeeTask.id, employeeBId);
    }
  }
  console.log('✓ All tasks completed by Employee B');
  
  console.log('\n=== DAY 2: AFTERNOON ===');
  
  // 7. OPS reviews and verifies completed tasks
  for (const task of employeeTasks) {
    await opsVerifiesTask(task.employeeTask.id, opsUserId);
  }
  console.log('✓ OPS verified all tasks');
  
  // 8. View statistics
  const stats = await getTaskStatistics(storeId, new Date());
  console.log(`✓ Completion rate: ${stats.completionRate.toFixed(2)}%`);
  
  console.log('\n=== DAY 2: EVENING ===');
  
  // 9. Employee B checks out
  if (attendanceResult.attendanceId) {
    await checkoutAttendance(attendanceResult.attendanceId, new Date());
    console.log('✓ Employee B checked out');
  }
}

// Export for use in actual application
export {
  setupTaskTemplates,
  createScheduleExample,
  generateTasksForTomorrow,
  recordEmployeeAttendance,
  employeeCompletesTaskWithForm,
  employeeCompletesTaskWithPhoto,
  opsVerifiesTask,
  viewEmployeeTasksToday,
  viewStoreStatistics,
  viewWeeklyAttendance,
  completeWorkflowExample,
};