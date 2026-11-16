// components/audit/stock-opname/SuratPernyataanDocument.tsx
//
// "Surat Pernyataan Hasil SO Store", drawn as the audit team's Word file (Surat Pernyataan SO.doc): an A4 page
// (595.3 × 841.9 pt, 1-inch margins) in Times New Roman 12 pt, the PRI logo in the header, every line at the position
// Word puts it (measured from the .doc's own PDF), the five brand lines with the store's line in bold, the "Hasil
// perhitungan SO" list with the numbers on the underlines, the two small tables (Temuan · Data stock opname bin, as
// the .doc's embedded sheet: Aptos Narrow, thin borders) and the two signature lines.
//
// Positions are in pt. A line's box is placed so its baseline lands where Word's does: with line-height 1.15 em the
// baseline sits 0.9125 em below the top of the box (Times New Roman: ascent 0.891, descent 0.216).
// If there are more than five findings the Temuan table grows and the closing lines move down with it.

import type { CSSProperties, ReactNode } from 'react';

import {
  SO_BRANDS,
  SO_FINDING_ROWS,
  diffSide,
  idNumber,
  longDateId,
  personilCaption,
  shortDateId,
  soTotals,
  type StockOpnameRecord,
} from '@/lib/audit-stock-opname';

export const SURAT_W_PT = 595.3;
export const SURAT_H_PT = 841.9;
const MARGIN = 72;
const CONTENT_W = SURAT_W_PT - MARGIN * 2; // 451.3

const SERIF = '"Times New Roman", Tinos, "Liberation Serif", Times, serif';
const NARROW = '"Aptos Narrow", "Arial Narrow", "Liberation Sans Narrow", Arial, sans-serif';

/** Top of a 1.15-line box whose baseline is at `baseline` (pt), for a font of `size` pt. */
const topFor = (baseline: number, size = 12) => baseline - 0.9125 * size;

function Line({
  baseline,
  x = MARGIN,
  size = 12,
  width,
  style,
  children,
}: {
  baseline: number;
  x?: number;
  size?: number;
  width?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}pt`,
        top: `${topFor(baseline, size)}pt`,
        width: width != null ? `${width}pt` : undefined,
        fontSize: `${size}pt`,
        lineHeight: 1.15,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A horizontal rule at `y` from x0 to x1 (pt). */
function Rule({ y, x0, x1, weight = 0.75 }: { y: number; x0: number; x1: number; weight?: number }) {
  return <div style={{ position: 'absolute', left: `${x0}pt`, top: `${y}pt`, width: `${x1 - x0}pt`, borderTop: `${weight}pt solid #000` }} />;
}

/** A value sitting on an underline (x0..x1), centred; long values shrink a little so they stay on it. */
function OnLine({ baseline, x0, x1, value }: { baseline: number; x0: number; x1: number; value: string }) {
  const room = x1 - x0;
  const size = value.length * 6 > room ? Math.max(9, (room / (value.length * 6)) * 12) : 12;
  return (
    <>
      <Rule y={baseline + 1.4} x0={x0} x1={x1} weight={0.7} />
      {value && (
        <Line baseline={baseline} x={x0} width={room} size={size} style={{ textAlign: 'center' }}>
          {value}
        </Line>
      )}
    </>
  );
}

const BIU: CSSProperties = { fontWeight: 700, fontStyle: 'italic', textDecoration: 'underline' };

/** "Plus / Minus" with the word that does not apply struck through (none while the selisih is 0). */
function PlusMinus({ n }: { n: number | null }) {
  const side = diffSide(n);
  const strike = (w: 'plus' | 'minus'): CSSProperties | undefined => (side && side !== w ? { textDecoration: 'line-through' } : undefined);
  return (
    <>
      : <span style={strike('plus')}>Plus</span> / <span style={strike('minus')}>Minus</span>
    </>
  );
}

const BULLETS = [331.1, 351.6, 372.6, 393.1, 414.1, 434.7];
const BULLET_X = 114.6;
const BULLET_TEXT_X = 132.4;
const COLON_X = 324.4;

// The embedded sheet of the two tables: columns B … H in pt (scaled like the .doc's object), rows 14.2 pt.
const T_TOP = 464.1;
const T_ROW = 14.2;
const T_SIZE = 10.4;
const TX = { B: 72.5, C: 91.4, D: 318.0, E: 333.5, F: 354.3, G: 454.8, H: 461.9, END: 516.4 };

export default function SuratPernyataanDocument({ record }: { record: StockOpnameRecord }) {
  const t = soTotals(record);
  const shortDay = shortDateId(record.soDate);
  const findingRows = Math.max(SO_FINDING_ROWS, record.findings.length);
  const tableBottom = T_TOP + T_ROW * (findingRows + 1);
  // Everything under the tables keeps Word's distances from the table's bottom (549.3 pt with 5 findings).
  const shift = tableBottom - (T_TOP + T_ROW * (SO_FINDING_ROWS + 1));
  const valueText = t.valueTotal == null || t.valueTotal === 0 ? '' : idNumber(Math.abs(t.valueTotal));

  const cell = (style: CSSProperties): CSSProperties => ({
    position: 'absolute',
    boxSizing: 'border-box',
    border: '0.75pt solid #000',
    fontFamily: NARROW,
    fontSize: `${T_SIZE}pt`,
    lineHeight: `${T_ROW - 1.5}pt`,
    padding: '0 2pt',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    ...style,
  });

  const binRows: [string, number][] = [
    ['Total bin store', record.binsTotal],
    ['Qty sesuai bin', record.binsMatch],
    ['Qty tidak sesuai bin', record.binsMismatch],
  ];

  return (
    <div
      className="so-surat-doc"
      style={{
        position: 'relative',
        width: `${SURAT_W_PT}pt`,
        // 2 pt short of A4, so print rounding never spills a blank second page (nothing is printed that low).
        height: `${SURAT_H_PT - 2 + Math.max(0, shift)}pt`,
        fontFamily: SERIF,
        fontSize: '12pt',
        color: '#000',
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* Header logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/audit/logo-pri-surat.png"
        alt="PRI — Prestasi Retail Innovation"
        style={{ position: 'absolute', left: `${MARGIN}pt`, top: '36.2pt', width: '139.4pt', height: '44.3pt' }}
      />

      <Line
        baseline={101.8}
        size={23}
        width={CONTENT_W}
        style={{ textAlign: 'center', fontWeight: 700, textDecoration: 'underline', textDecorationThickness: '2.2pt', textUnderlineOffset: '2.4pt' }}
      >
        SURAT PERNYATAAN HASIL SO STORE
      </Line>

      <Line baseline={137.7}>
        {record.suratCity || '…………'}, {longDateId(record.soDate)}
      </Line>
      <Line baseline={157.2}>
        Pada hari ini telah dilaksanakan <span style={{ fontWeight: 700, textDecoration: 'underline' }}>Stock Opname</span> di :
      </Line>

      {SO_BRANDS.map((brand, i) => {
        const mine = record.suratBrand === brand.key;
        const baseline = [180.3, 194.1, 207.9, 221.8, 235.6][i];
        return (
          <div key={brand.key} style={{ fontWeight: mine ? 700 : 400 }}>
            <Line baseline={baseline}>{brand.label}</Line>
            <Line baseline={baseline} x={216.1}>
              : {mine ? record.suratLocation || '-' : '-'}
            </Line>
          </div>
        );
      })}

      {/* Justified paragraph — Word's three lines, kept as three lines. */}
      <Line baseline={259.7} width={CONTENT_W} style={{ textAlign: 'justify', textAlignLast: 'justify' }}>
        Antara audit dan pihak toko sudah disepakati, dimana jumlah data scan dan fisik barang
      </Line>
      <Line baseline={273.6} width={CONTENT_W} style={{ textAlign: 'justify', textAlignLast: 'justify' }}>
        <span style={BIU}>Sudah Sesuai</span> dan <span style={BIU}>Tidak Ada Penambahan</span> barang apapun lagi setelah data{' '}
        <span style={BIU}>Diserahkan</span>, dan
      </Line>
      <Line baseline={287.4}>
        <span style={BIU}>Dibawa</span> ke office.
      </Line>

      <Line baseline={308.0} x={90.1}>
        1.
      </Line>
      <Line baseline={308.0} x={108.3}>
        Hasil perhitungan SO :
      </Line>

      {/* ➢ list */}
      {BULLETS.map((b) => (
        <Line key={b} baseline={b} x={BULLET_X} style={{ fontFamily: '"Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", sans-serif', fontSize: '10.5pt' }}>
          ➢
        </Line>
      ))}

      <Line baseline={BULLETS[0]} x={BULLET_TEXT_X}>SOH BC Store,</Line>
      <Line baseline={BULLETS[0]} x={252.3} style={{ fontWeight: 700 }}>{shortDay}</Line>
      <Line baseline={BULLETS[0]} x={COLON_X}>:</Line>
      <OnLine baseline={BULLETS[0]} x0={360.2} x1={468.4} value={idNumber(record.sohBc)} />
      <Line baseline={BULLETS[0]} x={474.9}>Prs/Pcs</Line>

      <Line baseline={BULLETS[1]} x={BULLET_TEXT_X}>Qty Scan All Fisik Barang</Line>
      <Line baseline={BULLETS[1]} x={COLON_X}>:</Line>
      <OnLine baseline={BULLETS[1]} x0={360.2} x1={468.4} value={idNumber(record.scanQty)} />
      <Line baseline={BULLETS[1]} x={474.9}>Prs/Pcs</Line>

      <Line baseline={BULLETS[2]} x={BULLET_TEXT_X}>ShoppingBag</Line>
      <Line baseline={BULLETS[2]} x={COLON_X}>:</Line>
      <OnLine baseline={BULLETS[2]} x0={360.2} x1={468.4} value={idNumber(record.shoppingBagQty)} />
      <Line baseline={BULLETS[2]} x={474.9}>Prs/Pcs</Line>

      <Line baseline={BULLETS[3]} x={BULLET_TEXT_X}>Trans Sales,</Line>
      <Line baseline={BULLETS[3]} x={252.3} style={{ fontWeight: 700 }}>{shortDay}</Line>
      <Line baseline={BULLETS[3]} x={COLON_X}>:</Line>
      <OnLine baseline={BULLETS[3]} x0={360.2} x1={468.4} value={idNumber(record.transSalesQty)} />
      <Line baseline={BULLETS[3]} x={474.9}>Prs/Pcs</Line>

      <Line baseline={BULLETS[4]} x={BULLET_TEXT_X}>Qty Selisih Fisik Barang</Line>
      <Line baseline={BULLETS[4]} x={COLON_X}>
        <PlusMinus n={t.qtyDiff} />
      </Line>
      <OnLine baseline={BULLETS[4]} x0={432.3} x1={468.4} value={t.qtyDiff === 0 ? '0' : idNumber(Math.abs(t.qtyDiff))} />
      <Line baseline={BULLETS[4]} x={474.9}>Prs/Pcs</Line>

      <Line baseline={BULLETS[5]} x={BULLET_TEXT_X}>Nominal Selisih Value</Line>
      <Line baseline={BULLETS[5]} x={COLON_X}>
        <PlusMinus n={t.valueTotal} />
      </Line>
      <Line baseline={BULLETS[5]} x={398.0}>Rp</Line>
      <OnLine baseline={BULLETS[5]} x0={432.3} x1={486.5} value={valueText} />
      <Line baseline={BULLETS[5]} x={495.8}>,-</Line>

      {/* ── Temuan stock opname ── */}
      <div style={cell({ left: `${TX.B}pt`, top: `${T_TOP}pt`, width: `${TX.C - TX.B}pt`, height: `${T_ROW}pt`, fontWeight: 700, textAlign: 'center' })}>No</div>
      <div style={cell({ left: `${TX.C}pt`, top: `${T_TOP}pt`, width: `${TX.D - TX.C}pt`, height: `${T_ROW}pt`, fontWeight: 700, textAlign: 'center', borderLeft: 0 })}>
        Temuan stock opname
      </div>
      {Array.from({ length: findingRows }, (_, i) => {
        const top = T_TOP + T_ROW * (i + 1);
        const text = record.findings[i] ?? '';
        return (
          <div key={i}>
            <div style={cell({ left: `${TX.B}pt`, top: `${top}pt`, width: `${TX.C - TX.B}pt`, height: `${T_ROW}pt`, borderTop: 0, textAlign: 'center' })}>
              {text ? i + 1 : ''}
            </div>
            <div
              style={cell({ left: `${TX.C}pt`, top: `${top}pt`, width: `${TX.D - TX.C}pt`, height: `${T_ROW}pt`, borderTop: 0, borderLeft: 0, textOverflow: 'ellipsis' })}
              title={text}
            >
              {text}
            </div>
          </div>
        );
      })}

      {/* ── Data stock opname bin ── */}
      <div style={cell({ left: `${TX.E}pt`, top: `${T_TOP}pt`, width: `${TX.F - TX.E}pt`, height: `${T_ROW}pt`, fontWeight: 700, textAlign: 'center' })}>No</div>
      <div style={cell({ left: `${TX.F}pt`, top: `${T_TOP}pt`, width: `${TX.END - TX.F}pt`, height: `${T_ROW}pt`, fontWeight: 700, textAlign: 'center', borderLeft: 0 })}>
        Data stock opname bin
      </div>
      {binRows.map(([label, value], i) => {
        const top = T_TOP + T_ROW * (i + 1);
        return (
          <div key={label}>
            <div style={cell({ left: `${TX.E}pt`, top: `${top}pt`, width: `${TX.F - TX.E}pt`, height: `${T_ROW}pt`, borderTop: 0, textAlign: 'center' })}>{i + 1}</div>
            <div
              style={cell({
                left: `${TX.F}pt`,
                top: `${top}pt`,
                width: `${TX.END - TX.F}pt`,
                height: `${T_ROW}pt`,
                borderTop: 0,
                borderLeft: 0,
                padding: 0,
                display: 'grid',
                gridTemplateColumns: `${TX.G - TX.F}pt ${TX.H - TX.G}pt 1fr`,
              })}
            >
              <span style={{ paddingLeft: '0.8pt' }}>{label}</span>
              <span>:</span>
              <span style={{ paddingLeft: '2pt' }}>{idNumber(value)}</span>
            </div>
          </div>
        );
      })}

      {/* ── Closing ── */}
      <Line baseline={586.5 + shift} width={CONTENT_W} style={{ textAlign: 'justify', textAlignLast: 'justify' }}>
        Demikian surat ini kami buat dengan sebenar-benarnya dan tanpa paksaan. Atas
      </Line>
      <Line baseline={607.5 + shift}>kerjasamanya kami ucapkan terima kasih.</Line>

      <Line baseline={648.6 + shift}>Tim Audit</Line>
      <Line baseline={648.6 + shift} x={396.4}>
        {personilCaption(record.storeNo)}
      </Line>
      <Rule y={719.4 + shift} x0={74.4} x1={143.4} />
      <Rule y={720.6 + shift} x0={391.2} x1={508.8} />
    </div>
  );
}
