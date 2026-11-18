// Bank-transfer CSV matching Finance's autocredit template. No title, totals or extra columns.

import { jakartaDateKey } from '@/lib/day-bucket';
import {
  groupByStoreCode,
  selectReportRows,
  type PettyCashReportFilters,
  type PettyCashReportRow,
} from '@/lib/petty-cash-report';

const HEADERS = [
  'Beneficiary Name', 'Transf. Date', 'Transf. Amount', 'Account No', 'Bank Name',
  'BI Code', 'Bank Branch Name', 'Remark 1', 'Remark 2', 'Jenis',
  'Receiver Cust Type', 'Receiver Cust Residence',
];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildReportCsv(input: {
  month: string;
  rows: PettyCashReportRow[];
  filters?: PettyCashReportFilters;
  /** Match the grouped view's row order when exporting by store code. */
  grouped?: boolean;
  now?: Date;
}): string {
  const [year, month] = input.month.split('-');
  const period = `${MONTHS[Number(month) - 1]} ${year}`;
  const [todayYear, todayMonth, todayDay] = jakartaDateKey(input.now ?? new Date()).split('-');
  const transferDate = `${todayDay}/${todayMonth}/${todayYear}`;
  const selected = selectReportRows(input.rows, input.filters);
  const rows = input.grouped
    ? groupByStoreCode(selected, input.filters?.sort).flatMap((group) => group.rows)
    : selected;

  const records = rows.map((row) => [
    row.accountHolderName ?? '',
    transferDate,
    row.refill?.transfer != null ? row.refill.transfer.toFixed(2) : '',
    // Keep identifiers verbatim: no numeric coercion, apostrophe or Excel formula wrapper.
    row.accountNumber ?? '',
    row.bankName ?? '',
    '1111111',
    'CAB JAKARTA',
    'PETTY CASH',
    period,
    'BCA',
    '1',
    'N',
  ]);

  return [HEADERS, ...records].map((record) => record.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
