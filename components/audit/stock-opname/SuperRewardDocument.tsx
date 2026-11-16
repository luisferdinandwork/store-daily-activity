// components/audit/stock-opname/SuperRewardDocument.tsx
//
// The Super Reward (Lampiran Regular Reward Stock Opname), drawn as the audit team's Excel "Super Reward" sheet
// (format stock opname audit.xlsx, B2:T35): columns A–T at the widths Excel prints them with (measured from the
// sheet's own PDF export), the same row heights, Arial 10 pt (title 18 pt bold, section 14 pt bold), the grey header
// block with its merged cells, medium rules round every cell, one double-height row per employee, dates as
// `d-mmm-yy` ("16-Sep-26"), the "√" in Calibri Light 20 pt bold under the reward the employee gets, and the four
// signatures (Dibuat · Disetujui · Dept IR · Diketahui). Pure markup at the sheet's 100 % — the print (SoPrint)
// zooms it to 50 % on A4 landscape, like the sheet's page setup.

import type { CSSProperties, ReactNode } from 'react';

import type { StockOpnameRecord } from '@/lib/audit-stock-opname';
import {
  DURATION_LABEL,
  INCENTIVE_LABEL,
  REWARD_TIERS,
  resolveReward,
  rewardRoleLabels,
  rewardTitle,
  sheetDate,
  sortRewardRows,
} from '@/lib/audit-super-reward';

// Column widths in px at the sheet's 100 % (A … T), from the sheet's PDF export (Excel prints it at 50 %).
const COLS = [25.5, 25.5, 36, 112.5, 172.3, 119.2, 119.2, 81.6, 43.5, 135.2, 135.5, 70.9, 70.9, 70.9, 43.6, 104.1, 172, 89.1, 89.1, 88.8] as const;
export const SUPER_REWARD_WIDTH = COLS.reduce((a, b) => a + b, 0); // ≈ 1805
const N_COLS = COLS.length;

// Row heights in px (pt × 4/3). The header + employee rows as Excel prints them (a little under the sheet's 13.8 / 18 pt).
const H = {
  r1: 17.6,
  r2: 20,
  title: 30.4,
  r5: 18.4,
  plain: 17.6,
  r18pt: 24,
  h10: 18.1,
  h11: 17.9,
  h12: 18.1,
  h13: 17.5,
  employee: 47.2,
  // The 13.2 pt spacer rows around the signatures, as Excel prints them.
  signGap: 17.1,
} as const;

const RULE = '2px solid #000';
const HEAD_FILL = '#d9d9d9';

const headCell: CSSProperties = {
  border: RULE,
  background: HEAD_FILL,
  fontWeight: 700,
  textAlign: 'center',
  verticalAlign: 'middle',
  padding: '0 3px',
  lineHeight: 1.1,
  whiteSpace: 'normal',
};

const bodyCell = (align: 'left' | 'center', extra?: CSSProperties): CSSProperties => ({
  border: RULE,
  textAlign: align,
  verticalAlign: 'middle',
  padding: '0 3px',
  lineHeight: 1.15,
  whiteSpace: align === 'left' ? 'normal' : 'nowrap',
  overflowWrap: 'anywhere',
  ...extra,
});

const checkCell: CSSProperties = {
  ...bodyCell('center'),
  fontFamily: '"Calibri Light", Calibri, Carlito, "Segoe UI", sans-serif',
  fontSize: '20pt',
  fontWeight: 700,
  lineHeight: 1,
};

/** Columns A + B, empty on every row. */
const Gutter = () => <td colSpan={2} />;

function Blank({ h }: { h: number }) {
  return (
    <tr style={{ height: h }}>
      <td colSpan={N_COLS} />
    </tr>
  );
}

/** One row of the signature block: four texts centred over C:E · H:J · M:O · R:T. */
function SignRow({ h, cells, style }: { h: number; cells: [ReactNode, ReactNode, ReactNode, ReactNode]; style?: CSSProperties }) {
  const td: CSSProperties = { textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap', padding: 0, ...style };
  return (
    <tr style={{ height: h }}>
      <Gutter />
      <td colSpan={3} style={td}>
        {cells[0]}
      </td>
      <td colSpan={2} />
      <td colSpan={3} style={td}>
        {cells[1]}
      </td>
      <td colSpan={2} />
      <td colSpan={3} style={td}>
        {cells[2]}
      </td>
      <td colSpan={2} />
      <td colSpan={3} style={td}>
        {cells[3]}
      </td>
    </tr>
  );
}

export default function SuperRewardDocument({ record }: { record: StockOpnameRecord }) {
  const rows = sortRewardRows(record.reward ?? []);
  const roles = rewardRoleLabels(rows);
  const soDay = sheetDate(record.soDate);

  return (
    <table
      className="so-reward-doc"
      style={{
        width: SUPER_REWARD_WIDTH,
        tableLayout: 'fixed',
        borderCollapse: 'collapse',
        fontFamily: 'Arial, "Liberation Sans", Helvetica, sans-serif',
        fontSize: '10pt',
        lineHeight: 1.15,
        color: '#000',
        background: '#fff',
      }}
    >
      <colgroup>
        {COLS.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <tbody>
        <Blank h={H.r1} />
        <Blank h={H.r2} />
        {/* C3:T3 · C4:T4 */}
        <tr style={{ height: H.title }}>
          <Gutter />
          <td colSpan={N_COLS - 2} style={{ textAlign: 'center', verticalAlign: 'bottom', fontSize: '18pt', fontWeight: 700, whiteSpace: 'nowrap', padding: 0 }}>
            {rewardTitle(record.storeNo, record.storeTitle)}
          </td>
        </tr>
        <tr style={{ height: H.title }}>
          <Gutter />
          <td colSpan={N_COLS - 2} style={{ textAlign: 'center', verticalAlign: 'bottom', fontSize: '18pt', fontWeight: 700, whiteSpace: 'nowrap', padding: 0 }}>
            {record.docNumber}
          </td>
        </tr>
        <Blank h={H.r5} />
        <Blank h={H.plain} />
        <Blank h={H.plain} />
        {/* C8 */}
        <tr style={{ height: H.r18pt }}>
          <Gutter />
          <td colSpan={N_COLS - 2} style={{ verticalAlign: 'bottom', fontSize: '14pt', fontWeight: 700, whiteSpace: 'nowrap', padding: '0 3px' }}>
            1. Stock Opname Regular Reward
          </td>
        </tr>
        <Blank h={H.r18pt} />

        {/* ── Header block, rows 10–14 ── */}
        <tr style={{ height: H.h10 }}>
          <Gutter />
          <th rowSpan={5} style={headCell}>
            No
          </th>
          <th rowSpan={5} style={headCell}>
            Employee No.
          </th>
          <th rowSpan={5} style={headCell}>
            Employee Name
          </th>
          <th rowSpan={5} style={headCell}>
            Tgl Masuk Toko Awal
          </th>
          <th rowSpan={5} style={headCell}>
            Tgl SO Audit
          </th>
          <th rowSpan={5} style={headCell}>
            Ket Durasi
          </th>
          <th rowSpan={5} style={headCell}>
            PIC
          </th>
          <th colSpan={4} rowSpan={2} style={headCell}>
            Rincian Tgl SO
          </th>
          <th rowSpan={5} style={headCell}>
            Jumlah SO
          </th>
          <th colSpan={3} rowSpan={5} style={headCell}>
            Keterangan Incentive
          </th>
          <th colSpan={3} style={headCell}>
            REGULAR REWARD
          </th>
        </tr>
        <tr style={{ height: H.h11 }}>
          <Gutter />
          <th colSpan={2} rowSpan={2} style={headCell}>
            VOUCHER CASH
          </th>
          <th rowSpan={2} style={headCell}>
            CASH
          </th>
        </tr>
        <tr style={{ height: H.h12 }}>
          <Gutter />
          <th rowSpan={3} style={headCell}>
            SO PERIODE 1
          </th>
          <th rowSpan={3} style={headCell}>
            SO PERIODE 2
          </th>
          <th colSpan={2} rowSpan={3} style={headCell}>
            SO PERIODE 3
          </th>
        </tr>
        <tr style={{ height: H.h13 }}>
          <Gutter />
          {REWARD_TIERS.map((t) => (
            <th key={t.key} rowSpan={2} style={{ ...headCell, whiteSpace: 'nowrap', padding: 0 }}>
              {t.header}
            </th>
          ))}
        </tr>
        <tr style={{ height: H.h13 }}>
          <Gutter />
        </tr>

        {/* ── One double-height row per employee ── */}
        {rows.map((row, i) => {
          const r = resolveReward(row, record.soDate);
          return (
            <tr key={`${row.userId ?? 'manual'}-${i}`} style={{ height: H.employee, breakInside: 'avoid' }}>
              <Gutter />
              <td style={bodyCell('center')}>{i + 1}</td>
              <td style={bodyCell('left', { fontWeight: 700, whiteSpace: 'nowrap' })}>{row.nik}</td>
              <td style={bodyCell('left', { fontWeight: 700 })}>{row.name}</td>
              <td style={bodyCell('center')}>{sheetDate(row.joinDate)}</td>
              <td style={bodyCell('center')}>{soDay}</td>
              <td style={bodyCell('center')}>{r.duration ? DURATION_LABEL[r.duration] : ''}</td>
              <td style={bodyCell('center', { padding: 0 })}>{roles[i]}</td>
              <td style={bodyCell('center')}>{sheetDate(row.soDates[0])}</td>
              <td style={bodyCell('center')}>{sheetDate(row.soDates[1])}</td>
              <td colSpan={2} style={bodyCell('center')}>
                {sheetDate(row.soDates[2])}
              </td>
              <td style={bodyCell('center')}>{r.soCount > 0 ? r.soCount : ''}</td>
              <td colSpan={3} style={bodyCell('center')}>
                {r.incentive ? INCENTIVE_LABEL[r.incentive] : ''}
              </td>
              {REWARD_TIERS.map((t) => (
                <td key={t.key} style={checkCell}>
                  {r.reward === t.key ? '√' : ''}
                </td>
              ))}
            </tr>
          );
        })}

        <Blank h={H.r18pt} />
        <Blank h={H.signGap} />
        <Blank h={H.signGap} />
        <SignRow h={H.r18pt} cells={['Dibuat', 'Disetujui', 'Dept IR', 'Diketahui']} />
        <Blank h={H.signGap} />
        <Blank h={H.signGap} />
        <Blank h={H.signGap} />
        <Blank h={H.signGap} />
        <Blank h={H.signGap} />
        <SignRow h={H.r18pt} cells={[record.auditorName, record.approved.name, record.ir.name, record.known.name]} />
        <SignRow
          h={H.r18pt}
          style={{ fontWeight: 700, textDecoration: 'underline' }}
          cells={[record.auditorCaption, record.approved.title, record.ir.title, record.known.title]}
        />
      </tbody>
    </table>
  );
}
