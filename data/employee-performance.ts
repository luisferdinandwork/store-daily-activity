// data/employee-performance.ts
//
// Dummy data simulating what would be returned by an external sales API.
// Replace the fetch in the API route with a real endpoint when ready.

export interface DailyPerformanceData {
  date:             string;   // "YYYY-MM-DD"
  salesAmount:      number;   // Rp actual
  salesTarget:      number;   // Rp target
  transactionCount: number;   // actual transactions
  transactionTarget: number;  // target transactions
}

export interface EmployeePerformanceData {
  employeeId:   string;
  employeeName: string;
  storeId:      number;
  storeName:    string;
  today:        DailyPerformanceData;
}

export const dummyPerformance: EmployeePerformanceData = {
  employeeId:   'EMP-001',
  employeeName: 'Budi Santoso',
  storeId:      1,
  storeName:    'Store Sudirman',
  today: {
    date:             new Date().toISOString().slice(0, 10),
    salesAmount:      3_870_000,
    salesTarget:      5_000_000,
    transactionCount: 17,
    transactionTarget: 25,
  },
};