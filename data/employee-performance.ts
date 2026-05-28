// data/employee-performance.ts

export interface PosSalesEntry {
  itemNo: string;
  itemCategoryCode: string;
  variantCode: string;
  date: number | string;
  quantity: number;
  price: number;
  netAmount: number;
  vatAmount: number;
  total: number;
  storeNo: string;
  receiptNo: string;
  salesStaff: string;
}

export interface DummyStoreTarget {
  storeId: number;
  storeNo: string;
  storeName: string;
  yearMonth: string;
  monthlySalesTarget: number;
  monthlyTransactionTarget: number;
}

export interface DummySalesStaffMapping {
  salesStaff: string;
  userId: string;
  nik: string;
  employeeName: string;
  storeId: number;
  storeNo: string;
  storeName: string;
}

const now = new Date();
const currentYearMonth = now.toISOString().slice(0, 7);

export const dummySalesStaffMappings: DummySalesStaffMapping[] = [
  // ── Store Thamrin — make this store rich for frontend testing
  {
    salesStaff: 'A202208112',
    userId: 'EMP-001',
    nik: '317300000001',
    employeeName: 'Budi Santoso',
    storeId: 1,
    storeNo: 'OD002',
    storeName: 'Store Thamrin',
  },
  {
    salesStaff: 'A202405082',
    userId: 'EMP-002',
    nik: '317300000002',
    employeeName: 'Ahmad Rahman',
    storeId: 1,
    storeNo: 'OD002',
    storeName: 'Store Thamrin',
  },
  {
    salesStaff: 'A202507084',
    userId: 'EMP-003',
    nik: '317300000003',
    employeeName: 'Siti Nurhaliza',
    storeId: 1,
    storeNo: 'OD002',
    storeName: 'Store Thamrin',
  },
  {
    salesStaff: 'A202511143',
    userId: 'EMP-004',
    nik: '317300000004',
    employeeName: 'Dewi Lestari',
    storeId: 1,
    storeNo: 'OD002',
    storeName: 'Store Thamrin',
  },

  // ── Store Gambir
  {
    salesStaff: 'A202301017',
    userId: 'EMP-005',
    nik: '317300000005',
    employeeName: 'Eko Prasetyo',
    storeId: 2,
    storeNo: 'FF001',
    storeName: 'Store Gambir',
  },
  {
    salesStaff: 'A202401013',
    userId: 'EMP-006',
    nik: '317300000006',
    employeeName: 'Rina Wijaya',
    storeId: 2,
    storeNo: 'FF001',
    storeName: 'Store Gambir',
  },

  // ── Store Sudirman
  {
    salesStaff: 'A202407136',
    userId: 'EMP-007',
    nik: '317300000007',
    employeeName: 'Farhan Hidayat',
    storeId: 3,
    storeNo: 'OD012',
    storeName: 'Store Sudirman',
  },
  {
    salesStaff: 'A202508100',
    userId: 'EMP-008',
    nik: '317300000008',
    employeeName: 'Lina Permata',
    storeId: 3,
    storeNo: 'OD012',
    storeName: 'Store Sudirman',
  },
  {
    salesStaff: 'A202603040',
    userId: 'EMP-009',
    nik: '317300000009',
    employeeName: 'Hendra Kusuma',
    storeId: 3,
    storeNo: 'OD012',
    storeName: 'Store Sudirman',
  },
];

export const dummyStoreTargets: DummyStoreTarget[] = [
  {
    storeId: 1,
    storeNo: 'OD002',
    storeName: 'Store Thamrin',
    yearMonth: currentYearMonth,
    monthlySalesTarget: 210_000_000,
    monthlyTransactionTarget: 1_450,
  },
  {
    storeId: 2,
    storeNo: 'FF001',
    storeName: 'Store Gambir',
    yearMonth: currentYearMonth,
    monthlySalesTarget: 155_000_000,
    monthlyTransactionTarget: 1_050,
  },
  {
    storeId: 3,
    storeNo: 'OD012',
    storeName: 'Store Sudirman',
    yearMonth: currentYearMonth,
    monthlySalesTarget: 185_000_000,
    monthlyTransactionTarget: 1_250,
  },
];

const productPool = [
  { itemNo: 'SHO-RUN-001', category: 'SHOES', variant: 'BLACK-41', min: 499_000, max: 1_499_000 },
  { itemNo: 'SHO-CAS-002', category: 'SHOES', variant: 'WHITE-42', min: 399_000, max: 1_199_000 },
  { itemNo: 'SHO-BSK-003', category: 'SHOES', variant: 'RED-43', min: 599_000, max: 1_799_000 },
  { itemNo: 'APP-TSH-001', category: 'APPAREL', variant: 'M', min: 149_000, max: 399_000 },
  { itemNo: 'APP-JKT-002', category: 'APPAREL', variant: 'L', min: 399_000, max: 899_000 },
  { itemNo: 'ACC-SOC-001', category: 'ACCESSORY', variant: 'NS', min: 39_000, max: 129_000 },
  { itemNo: 'ACC-BAG-002', category: 'ACCESSORY', variant: 'NS', min: 199_000, max: 599_000 },
  { itemNo: 'FISFISIKSHOBAG003', category: 'LS', variant: 'NS', min: 5_000, max: 5_000 },
];

function createSeededRandom(seed: number) {
  let value = seed;

  return function random() {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

const random = createSeededRandom(260525);

function randomInt(min: number, max: number) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function pick<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}

function roundToNearest(value: number, nearest: number) {
  return Math.round(value / nearest) * nearest;
}

function daysInCurrentMonth() {
  const year = now.getFullYear();
  const month = now.getMonth();

  return new Date(year, month + 1, 0).getDate();
}

function dateOfMonth(day: number) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const date = new Date(year, month, day);

  return date.toISOString().slice(0, 10);
}

function makeReceiptNo(storeNo: string, day: number, sequence: number) {
  const compactYm = currentYearMonth.replace('-', '');
  const storeCode = storeNo.replace(/\D/g, '').padStart(3, '0');

  return `${compactYm}${storeCode}${String(day).padStart(2, '0')}${String(sequence).padStart(5, '0')}`;
}

function buildGeneratedPosEntries(): PosSalesEntry[] {
  const entries: PosSalesEntry[] = [];
  const totalDays = daysInCurrentMonth();

  let receiptSeq = 1;

  for (let day = 1; day <= totalDays; day += 1) {
    const date = dateOfMonth(day);
    const dayOfWeek = new Date(date).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    for (const mapping of dummySalesStaffMappings) {
      const isThamrin = mapping.storeId === 1;

      /**
       * Make Thamrin heavier so your frontend has better visual data.
       * Also make weekends stronger.
       */
      const baseReceiptMin = isThamrin ? 5 : 2;
      const baseReceiptMax = isThamrin ? 14 : 8;
      const weekendBoost = isWeekend ? randomInt(3, 8) : 0;

      /**
       * Some employees intentionally perform better than others
       * so contribution chart has variation.
       */
      const employeeMultiplier =
        mapping.userId === 'EMP-001' ? 1.35 :
        mapping.userId === 'EMP-002' ? 1.1 :
        mapping.userId === 'EMP-003' ? 0.9 :
        mapping.userId === 'EMP-004' ? 0.75 :
        1;

      const receiptsToday = Math.max(
        0,
        Math.round((randomInt(baseReceiptMin, baseReceiptMax) + weekendBoost) * employeeMultiplier),
      );

      for (let r = 0; r < receiptsToday; r += 1) {
        const receiptNo = makeReceiptNo(mapping.storeNo, day, receiptSeq++);
        const itemCount = randomInt(1, 4);

        for (let i = 0; i < itemCount; i += 1) {
          const product = pick(productPool);

          const price = roundToNearest(
            randomInt(product.min, product.max),
            product.max <= 10_000 ? 1_000 : 10_000,
          );

          const qty = -1;
          const total = -price;
          const netAmount = Math.round(total / 1.11);
          const vatAmount = total - netAmount;

          entries.push({
            itemNo: product.itemNo,
            itemCategoryCode: product.category,
            variantCode: product.variant,
            date,
            quantity: qty,
            price,
            netAmount,
            vatAmount,
            total,
            storeNo: mapping.storeNo,
            receiptNo,
            salesStaff: mapping.salesStaff,
          });
        }
      }
    }
  }

  return entries;
}

export const dummyPosSalesEntries: PosSalesEntry[] = buildGeneratedPosEntries();