// components/audit/cash-check/BeritaAcaraDocument.tsx
//
// The Berita Acara Pemeriksaan Kas, drawn as the audit team's Excel "CO" sheet (format stock opname audit.xlsx):
// the same 13 columns A–M at the sheet's pixel widths, Trebuchet MS 11 pt, the same labels, number formats
// (#,##0.00, accounting "-" for zero, d-mmm-yy dates), bold / underline, medium bottom rules and double rules under
// the selisih lines. Columns A, B and M are the sheet's margins. Pure markup — used for the on-screen preview and,
// zoomed to A4, for the print (BeritaAcaraPrint).

import type { CSSProperties, ReactNode } from 'react';

import {
  AUDIT_DENOMINATIONS,
  DENOMINATION_KIND_LABEL,
  DENOMINATION_UNIT,
  cashCheckTotals,
  excelShortDate,
  extraTotal,
  longDateId,
  xlAccounting,
  xlAccounting0,
  xlNumber,
  type CashCheckRecord,
  type DenominationCounts,
  type DenominationKind,
} from '@/lib/audit-cash-check';

// Column widths of the CO sheet in pixels (A … M).
const COLS = [14, 24, 132, 40, 139, 44, 222, 48, 123, 44, 51, 267, 24] as const;
export const DOC_WIDTH = COLS.reduce((a, b) => a + b, 0); // 1172
const LETTERS = 'ABCDEFGHIJKLM';
type Col = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M';

const ROW_H = 19; // 14.4 pt — the sheet's default row height

interface CellSpec {
  c: Col;
  /** Columns covered, like an Excel merge (or text spilling into empty neighbours). */
  span?: number;
  children?: ReactNode;
  b?: boolean;
  u?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Bottom rule: medium (2 px), double, or a thin box (table header). */
  rule?: 'medium' | 'double' | 'box' | 'top';
  font?: 'calibri' | 'arial';
  size?: number;
}

const ruleStyle = (rule: CellSpec['rule']): CSSProperties => {
  switch (rule) {
    case 'medium':
      return { borderBottom: '2px solid #000' };
    case 'double':
      return { borderBottom: '3px double #000' };
    case 'box':
      return { border: '1px solid #000' };
    case 'top':
      return { borderTop: '1px solid #000' };
    default:
      return {};
  }
};

const FONTS = {
  calibri: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
} as const;

function Row({ cells = [], h = ROW_H }: { cells?: CellSpec[]; h?: number }) {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < LETTERS.length) {
    const spec = cells.find((c) => LETTERS.indexOf(c.c) === i);
    if (spec) {
      const span = spec.span ?? 1;
      out.push(
        <td
          key={i}
          colSpan={span}
          style={{
            textAlign: spec.align ?? 'left',
            fontWeight: spec.b ? 700 : 400,
            textDecoration: spec.u ? 'underline' : undefined,
            fontFamily: spec.font ? FONTS[spec.font] : undefined,
            fontSize: spec.size ? `${spec.size}pt` : undefined,
            padding: spec.align === 'right' ? '0 6px 0 2px' : '0 2px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'clip',
            verticalAlign: 'bottom',
            ...ruleStyle(spec.rule),
          }}
        >
          {spec.children}
        </td>,
      );
      i += span;
    } else {
      out.push(<td key={i} />);
      i += 1;
    }
  }
  return <tr style={{ height: h }}>{out}</tr>;
}

/** Rp label + amount pair in columns K and L. */
const money = (value: string, opts: { b?: boolean; rule?: CellSpec['rule'] } = {}): CellSpec[] => [
  { c: 'K', children: 'Rp', align: 'center', b: opts.b, rule: opts.rule },
  { c: 'L', children: value, align: 'right', b: opts.b, rule: opts.rule },
];

function DenominationRows({ counts, lastRule }: { counts: DenominationCounts; lastRule: boolean }) {
  const kinds: DenominationKind[] = ['kertas', 'koin'];
  return (
    <>
      {kinds.map((kind, k) => {
        const rows = AUDIT_DENOMINATIONS.filter((d) => d.kind === kind);
        return [
          <Row
            key={`${kind}-h`}
            cells={[
              { c: 'D', children: `${k + 1}.`, align: 'center' },
              { c: 'E', span: 6, children: DENOMINATION_KIND_LABEL[kind] },
            ]}
          />,
          ...rows.map((d, idx) => {
            const qty = counts[d.id] ?? 0;
            const isLast = lastRule && kind === 'koin' && idx === rows.length - 1;
            return (
              <Row
                key={d.id}
                cells={[
                  { c: 'F', children: qty, align: 'center' },
                  { c: 'G', children: DENOMINATION_UNIT[kind] },
                  { c: 'H', children: 'Rp', align: 'center' },
                  { c: 'I', children: xlNumber(d.value), align: 'right' },
                  { c: 'J', children: '=', align: 'center' },
                  ...money(xlNumber(qty * d.value), { rule: isLast ? 'medium' : undefined }),
                ]}
              />
            );
          }),
        ];
      })}
    </>
  );
}

export default function BeritaAcaraDocument({ record }: { record: CashCheckRecord }) {
  const t = cashCheckTotals(record);
  const lines = [
    ...record.pettyItems
      .filter((i) => i.checked)
      .map((i) => ({ key: `t${i.txId}`, date: i.date, description: i.description, qty: 1, price: i.amount, total: i.amount })),
    ...record.pettyExtras.map((e) => ({ key: e.key, date: e.date, description: e.description, qty: e.qty, price: e.price, total: extraTotal(e) })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <table
      className="ba-doc"
      style={{
        width: DOC_WIDTH,
        tableLayout: 'fixed',
        borderCollapse: 'collapse',
        fontFamily: '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", Tahoma, sans-serif',
        fontSize: '11pt',
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
        <Row />
        <Row
          h={40}
          cells={[
            {
              c: 'C',
              span: 10,
              b: true,
              size: 15,
              align: 'center',
              children: `BERITA ACARA PEMERIKSAAN KAS ${record.storeNo} ${record.storeName}`.toUpperCase(),
            },
          ]}
        />
        <Row />
        <Row cells={[{ c: 'C', span: 7, b: true, children: `No :${record.docNumber}` }]} />
        <Row
          h={20}
          cells={[
            { c: 'C', span: 7, rule: 'medium', children: `Dilakukan pada tanggal :  ${longDateId(record.checkDate)}` },
            { c: 'J', span: 3, rule: 'medium', children: `Pemegang Kas : ${record.holderName}` },
          ]}
        />
        <Row />

        {/* ── MODAL ── */}
        <Row cells={[{ c: 'C', span: 8, b: true, u: true, children: 'MODAL' }, ...money(xlAccounting(record.modalBook), { b: true })]} />
        <Row cells={[{ c: 'C', span: 8, children: 'PENJUALAN :' }]} />
        {(
          [
            ['1.', 'Cash Penjualan', record.salesCash],
            ['2.', 'Flash/Debit Card', record.salesDebit],
            ['3.', 'Credit Card', record.salesCredit],
            ['4.', 'Voucher', record.salesVoucher],
          ] as const
        ).map(([no, label, value], i) => (
          <Row
            key={label}
            cells={[
              { c: 'D', children: no, align: 'center' },
              { c: 'E', span: 6, children: label },
              ...money(xlNumber(value), { rule: i === 3 ? 'medium' : undefined }),
            ]}
          />
        ))}
        <Row cells={[{ c: 'G', span: 4, b: true, align: 'right', children: 'Jumlah Modal + Penjualan' }, ...money(xlNumber(t.modalPlusSales), { b: true })]} />
        <Row />
        <Row cells={[{ c: 'C', span: 8, children: 'RINCIAN MODAL' }]} />
        <DenominationRows counts={record.modalCounts} lastRule />
        <Row cells={[{ c: 'G', span: 4, b: true, align: 'right', children: 'Jumlah uang tunai KAS Modal' }, ...money(xlNumber(t.modalPhysical), { b: true })]} />
        <Row />
        <Row
          cells={[
            { c: 'F', span: 5, b: true, align: 'right', children: 'Selisih modal menurut buku dengan fisik kas' },
            { c: 'K', children: 'Rp', align: 'center', b: true },
            { c: 'L', children: xlNumber(t.modalDiff), align: 'right', b: true, rule: 'double' },
          ]}
        />
        <Row />

        {/* ── PETTY CASH ── */}
        <Row cells={[{ c: 'C', span: 8, b: true, u: true, children: 'PETTY CASH' }, ...money(xlNumber(record.pettyFund), { b: true })]} />
        <Row cells={[{ c: 'C', span: 8, children: 'PENGELUARAN :' }]} />
        <Row
          h={20}
          cells={[
            { c: 'D', children: 'No', b: true, align: 'center', rule: 'box' },
            { c: 'E', children: 'Tanggal', b: true, align: 'center', rule: 'box' },
            { c: 'F', span: 2, children: 'Keperluan', b: true, align: 'center', rule: 'box' },
            { c: 'H', children: 'Qty', b: true, align: 'center', rule: 'box' },
            { c: 'I', span: 3, children: 'Basic Price', b: true, align: 'center', rule: 'box' },
            { c: 'L', children: 'Total Price', b: true, align: 'center', rule: 'box' },
          ]}
        />
        {(lines.length ? lines : [null]).map((line, i) =>
          line ? (
            <Row
              key={line.key}
              cells={[
                { c: 'D', children: i + 1, align: 'center' },
                { c: 'E', children: excelShortDate(line.date), align: 'center' },
                { c: 'F', span: 2, children: line.description, font: 'calibri' },
                { c: 'H', children: line.qty, align: 'center', font: 'calibri' },
                { c: 'I', span: 2, children: xlAccounting0(line.price), align: 'right' },
                ...money(xlAccounting0(line.total)),
              ]}
            />
          ) : (
            <Row key="empty" cells={[{ c: 'D', children: '', align: 'center' }]} />
          ),
        )}
        <Row cells={[{ c: 'K', rule: 'medium' }, { c: 'L', rule: 'medium' }]} />
        <Row cells={[{ c: 'H', span: 3, b: true, align: 'right', children: 'TOTAL CASHOUT' }, ...money(xlNumber(t.cashout), { b: true })]} />
        <Row />
        <Row cells={[{ c: 'C', span: 8, children: 'LAIN-LAIN :' }]} />
        <Row
          cells={[
            { c: 'D', children: '1.', align: 'center' },
            { c: 'E', span: 6, children: 'Penggantian pettycash periode lalu yang belum diterima' },
            ...money(xlAccounting(record.pettyPendingRefill), { b: true, rule: 'medium' }),
          ]}
        />
        <Row cells={[{ c: 'G', span: 4, b: true, align: 'right', children: 'Sisa petty cash menurut buku' }, ...money(xlAccounting(t.pettyBook), { b: true })]} />
        <Row cells={[{ c: 'C', span: 8, children: 'RINCIAN KAS' }]} />
        <DenominationRows counts={record.pettyCounts} lastRule />
        <Row
          cells={[{ c: 'G', span: 4, b: true, align: 'right', children: 'Jumlah fisik uang tunai KAS Petty Cash' }, ...money(xlNumber(t.pettyPhysical), { b: true })]}
        />
        <Row />
        <Row
          cells={[
            { c: 'E', span: 6, b: true, align: 'right', children: 'Selisih Petty Cash menurut buku dengan fisik kas' },
            { c: 'K', children: 'Rp', align: 'center', b: true },
            { c: 'L', children: xlNumber(t.pettyDiff), align: 'right', b: true, rule: 'double' },
          ]}
        />
        <Row />
        <Row
          cells={[
            { c: 'I', span: 2, b: true, align: 'right', children: 'Selisih Akhir' },
            { c: 'K', children: 'Rp', align: 'center', b: true },
            { c: 'L', children: xlNumber(t.finalDiff), align: 'right', b: true, rule: 'double' },
          ]}
        />
        <Row />
        <Row />

        {/* ── Statement + signatures ── */}
        <Row cells={[{ c: 'C', span: 10, b: true, children: 'Jumlah uang kas telah dihitung  dan telah diserahkan kembali seluruhnya kepada pemegang kas sesuai ' }]} />
        <Row cells={[{ c: 'C', span: 10, b: true, children: 'dengan rincian tersebut di atas.' }]} />
        <Row />
        <Row cells={[{ c: 'C', span: 8, children: `${record.signCity}, ${longDateId(record.signDate)}` }]} />
        <Row />
        <Row cells={[{ c: 'C', span: 5, children: 'Dilakukan oleh,' }, { c: 'L', span: 2, children: 'Pemegang kas,' }]} />
        <Row />
        <Row />
        <Row />
        <Row />
        <Row cells={[{ c: 'C', span: 5, children: record.auditorName }, { c: 'L', span: 2, children: record.holderName }]} />
        <Row
          cells={[
            { c: 'C', span: 5, b: true, u: true, font: 'arial', children: record.auditorCaption },
            { c: 'L', span: 2, b: true, u: true, children: record.holderCaption },
          ]}
        />
        <Row />
        <Row />
        <Row cells={[{ c: 'C', span: 5, children: 'Diketahui,' }, { c: 'L', span: 2, children: 'Disetujui,' }]} />
        <Row />
        <Row />
        <Row />
        <Row />
        <Row cells={[{ c: 'C', span: 5, children: record.known.name }, { c: 'L', span: 2, children: record.approved.name }]} />
        <Row
          cells={[
            { c: 'C', span: 5, b: true, u: true, font: 'arial', children: record.known.title },
            { c: 'L', span: 2, b: true, u: true, font: 'arial', children: record.approved.title },
          ]}
        />
        <Row />
      </tbody>
    </table>
  );
}
