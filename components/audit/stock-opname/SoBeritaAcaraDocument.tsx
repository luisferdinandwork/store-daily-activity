// components/audit/stock-opname/SoBeritaAcaraDocument.tsx
//
// The Berita Acara Stock Opname, drawn as the audit team's Excel "BA" sheet (format stock opname audit.xlsx, print
// area A1:H47): the same 8 columns at the widths the sheet prints with, the same row heights, Arial 10 pt (title 16 pt,
// number 11 pt, bold + underline), Excel's accounting formats as an Indonesian PC shows them ("6.227", zero "-",
// negative "(5)", "Rp" left + amount right), medium bottom rules, double rules under the totals and the boxed
// "Total Harga Selisih" line. Pure markup — the on-screen preview and, zoomed 85 % like the sheet's page setup, the
// print (SoPrint).

import type { CSSProperties, ReactNode } from 'react';

import {
  idNumber,
  longDateId,
  soTotals,
  titleCase,
  totalHargaText,
  type StockOpnameRecord,
} from '@/lib/audit-stock-opname';

// Column widths in px (A … H), measured from the sheet's own PDF export.
const COLS = [20, 136, 231, 18, 182, 19, 95, 95] as const;
export const SO_BA_WIDTH = COLS.reduce((a, b) => a + b, 0); // 796
const LETTERS = 'ABCDEFGH';
type Col = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

// Row heights in px (pt × 4/3): default 13.2 pt, row 1 13.8 pt, rows 2–3 17.25 pt, row 4 15 pt.
const H_ROW = 17.6;

/** Excel's padding of an accounting number: `_)` = width of ")", the zero "-"?? adds two digit widths. */
const PAD_PAREN = 4.4;
const PAD_DASH = 4.4 + 14.8;

interface CellSpec {
  c: Col;
  span?: number;
  children?: ReactNode;
  b?: boolean;
  u?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Bottom rule: medium (2 px) or double. */
  rule?: 'medium' | 'double';
  size?: number;
  /** Right padding in px (accounting numbers). */
  padR?: number;
  style?: CSSProperties;
}

function Row({ cells = [], h = H_ROW }: { cells?: CellSpec[]; h?: number }) {
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
            fontSize: spec.size ? `${spec.size}pt` : undefined,
            padding: `0 ${spec.padR ?? 2}px 0 2px`,
            whiteSpace: 'nowrap',
            overflow: 'visible',
            verticalAlign: 'bottom',
            borderBottom: spec.rule === 'medium' ? '2px solid #000' : spec.rule === 'double' ? '3px double #000' : undefined,
            ...spec.style,
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

/** `_(* #,##0_);_(* \(#,##0\);_(* "-"??_)` → the text + the right padding Excel leaves. */
function acct(n: number): { text: string; padR: number } {
  if (n === 0) return { text: '-', padR: PAD_DASH };
  if (n < 0) return { text: `(${idNumber(-n)})`, padR: 2 };
  return { text: idNumber(n), padR: PAD_PAREN };
}

/** An accounting cell spec for column `c` (span 2 for the merged G:H cells). */
const num = (c: Col, n: number, opts: Partial<CellSpec> = {}): CellSpec => {
  const a = acct(n);
  return { c, align: 'right', children: a.text, padR: a.padR, ...opts };
};

/** `_-[$Rp-3809]* #,##0_-` — "Rp" on the left of the cell, the amount on the right ("-" for zero). */
function rpCell(n: number | null): ReactNode {
  const v = n ?? 0;
  const amount = v === 0 ? '-' : idNumber(Math.abs(v));
  return (
    <span style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 4.4 }}>
      <span>{v < 0 ? '-Rp' : 'Rp'}</span>
      <span style={{ paddingRight: v === 0 ? PAD_DASH - 2 : PAD_PAREN - 2 }}>{amount}</span>
    </span>
  );
}

export default function SoBeritaAcaraDocument({ record }: { record: StockOpnameRecord }) {
  const t = soTotals(record);
  const day = longDateId(record.soDate);
  const boxBorder = '2px solid #000';

  return (
    <table
      className="so-ba-doc"
      style={{
        width: SO_BA_WIDTH,
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
        <Row h={18.4} />
        <Row h={23} cells={[{ c: 'B', span: 7, b: true, u: true, size: 16, align: 'center', children: 'BERITA ACARA STOCK OPNAME' }]} />
        <Row h={23} cells={[{ c: 'B', span: 7, b: true, u: true, size: 16, align: 'center', children: record.storeTitle }]} />
        <Row h={20} cells={[{ c: 'B', span: 7, b: true, u: true, size: 11, align: 'center', children: record.docNumber }]} />
        <Row />
        <Row
          cells={[
            {
              c: 'B',
              span: 7,
              children: (
                <>
                  Berikut hasil stock opname {titleCase(record.storeTitle)} yang dilakukan pada tgl <b>{day}</b> :
                </>
              ),
            },
          ]}
        />
        <Row />
        <Row
          cells={[
            { c: 'E', b: true, align: 'center', rule: 'medium', children: 'Qty BC' },
            { c: 'G', span: 2, b: true, align: 'center', rule: 'medium', children: 'Hasil Scan' },
          ]}
        />
        <Row cells={[{ c: 'C', children: `SOH BC ${day}` }, { c: 'D', b: true, align: 'center', children: ':' }, num('E', record.sohBc), num('G', 0, { span: 2 })]} />
        <Row cells={[{ c: 'C', children: 'Scan All Fisik Barang' }, { c: 'D', b: true, align: 'center', children: ':' }, num('E', 0), num('G', record.scanQty, { span: 2 })]} />
        <Row cells={[{ c: 'C', children: 'ShoppingBag' }, { c: 'D', b: true, align: 'center', children: ':' }, num('E', 0), num('G', record.shoppingBagQty, { span: 2 })]} />
        <Row
          cells={[
            { c: 'C', children: `Trans Sales, ${day}` },
            { c: 'D', b: true, align: 'center', children: ':' },
            num('E', 0, { rule: 'medium' }),
            num('G', record.transSalesQty, { span: 2, rule: 'medium' }),
          ]}
        />
        <Row />
        <Row
          cells={[
            { c: 'C', b: true, align: 'right', children: 'TOTAL' },
            { c: 'D', b: true, align: 'center', children: ':' },
            { c: 'E', b: true, align: 'right', rule: 'double', children: idNumber(t.bcTotal) },
            { c: 'G', span: 2, b: true, align: 'right', rule: 'double', children: idNumber(t.scanTotal) },
          ]}
        />
        <Row />
        <Row
          cells={[
            { c: 'B', span: 4, b: true, align: 'right', children: 'SELISIH PLUS / ( MINUS )' },
            { c: 'F', b: true, align: 'center', children: ':' },
            num('H', t.qtyDiff, { b: true, rule: 'double' }),
          ]}
        />
        <Row />
        <Row
          cells={[
            {
              c: 'B',
              span: 7,
              children: (
                <>
                  Adapun perinciannya adalah sebagai berikut <b>:</b>
                </>
              ),
            },
          ]}
        />
        <Row cells={[{ c: 'C', span: 2, children: 'Selisih all artikel lebih (+) All Brand' }, { c: 'F', b: true, align: 'center', children: ':' }, num('H', record.valuePlus ?? 0)]} />
        <Row
          cells={[
            { c: 'C', span: 2, children: 'Selisih all artikel kurang (-) All Brand' },
            { c: 'F', b: true, align: 'center', children: ':' },
            num('H', -(record.valueMinus ?? 0), { rule: 'medium' }),
          ]}
        />
        <Row />
        <Row
          cells={[
            { c: 'B', span: 4, b: true, align: 'right', children: 'SELISIH PLUS / ( MINUS )' },
            { c: 'F', b: true, align: 'center', children: ':' },
            { c: 'H', b: true, rule: 'double', children: rpCell(t.valueTotal), padR: 2 },
          ]}
        />
        <Row />
        <Row />
        {/* B25:H26 — one merged, boxed cell */}
        <tr style={{ height: H_ROW }}>
          <td />
          <td
            colSpan={7}
            rowSpan={2}
            style={{
              border: boxBorder,
              textAlign: 'center',
              verticalAlign: 'middle',
              fontWeight: 700,
              padding: '0 2px',
              whiteSpace: 'nowrap',
            }}
          >
            {totalHargaText(t.valueTotal)}
          </td>
        </tr>
        <tr style={{ height: H_ROW }}>
          <td />
        </tr>
        <Row />
        <Row />
        <Row cells={[{ c: 'B', span: 4, b: true, children: `${record.signCity}, ${longDateId(record.signDate)}` }]} />
        <Row />
        <Row cells={[{ c: 'B', children: 'Dibuat' }, { c: 'G', span: 2, align: 'center', children: record.holderCaption }]} />
        <Row />
        <Row />
        <Row />
        <Row />
        <Row cells={[{ c: 'B', span: 3, children: record.auditorName }, { c: 'G', span: 2, align: 'center', children: record.holderName }]} />
        <Row cells={[{ c: 'B', span: 3, b: true, u: true, children: record.auditorCaption }, { c: 'G', span: 2, b: true, u: true, align: 'center', children: record.holderTitle }]} />
        <Row />
        <Row />
        <Row cells={[{ c: 'B', children: 'Diketahui' }, { c: 'G', span: 2, align: 'center', children: 'Disetujui' }]} />
        <Row />
        <Row />
        <Row />
        <Row />
        <Row />
        <Row cells={[{ c: 'B', span: 3, children: record.known.name }, { c: 'G', span: 2, align: 'center', children: record.approved.name }]} />
        <Row cells={[{ c: 'B', span: 3, b: true, u: true, children: record.known.title }, { c: 'G', span: 2, b: true, u: true, align: 'center', children: record.approved.title }]} />
      </tbody>
    </table>
  );
}
