// lib/transfer-order-metrics.ts
// ─────────────────────────────────────────────────────────────────────────────
// The timing metrics OPS reads on every Transfer Order (/ops/transfer-order),
// as pure data so the rules can be tested without React. The page maps each
// `key` to an icon. Timestamp semantics: lib/db/schema/item-transfers.ts.
//
//   TO Dibuat ──► WS Diposting ──► Foto Serah Terima ──► (courier) ──► Terima Fisik
//   (first seen)  (BC's own        (employee confirms        Barang di Toko
//                  timestamp)       hand-off WITH photo)            │
//                                                      WR Diposting ◄─┘
//
//   bcProcessing  TO Dibuat → WS Diposting
//   wsToReturn    WS Diposting → Foto Serah Terima
//   returnTotal   TO Dibuat → Foto Serah Terima     ("Total Proses Item
//                 Return", i.e. bcProcessing + wsToReturn when the photo follows
//                 the WS)
//   delivery      Foto Serah Terima → Terima Fisik Barang di Toko
//   bcReceiving   Terima Fisik Barang di Toko → WR Diposting
//
// "Foto Serah Terima" is `returnSubmittedAt`: the moment the store submits the
// confirmation, which requires the courier-signed photo (an upload happens
// seconds earlier but its time is not stored).
// ─────────────────────────────────────────────────────────────────────────────

export type MetricKey = 'bcProcessing' | 'wsToReturn' | 'returnTotal' | 'delivery' | 'bcReceiving';

/** The ISO timestamps + warehouse flags `/api/ops/item-transfers` returns. */
export interface MetricInput {
  /** TO Dibuat (first seen by the sync). */
  returnDetectedAt: string | null;
  /** Foto Serah Terima. */
  returnSubmittedAt: string | null;
  /** WS Diposting (BC's own shipment creation time). */
  droppingDetectedAt: string | null;
  /** Terima Fisik Barang di Toko. */
  droppingSubmittedAt: string | null;
  /** WR Diposting (first seen posted in BC). */
  receivedAt: string | null;
  fromIsWarehouse: boolean;
  toIsWarehouse: boolean;
}

export interface TransferMetric {
  key: MetricKey;
  label: string;
  shortLabel: string;
  ongoingLabel: string;
  notStartedLabel: string;
  start: string | null;
  end: string | null;
  /** false = no employee exists on one end (a DM warehouse code), so the
   *  metric will never start/finish — render "N/A", not "pending". */
  applicable: boolean;
  /** Why it is N/A, for the drawer. */
  naReason: string;
  /** The end may legitimately come BEFORE the start (the store photographed the
   *  hand-off before BC created the WS) — show it as a negative duration
   *  instead of flattening it to 0. */
  signed: boolean;
  /** Extra note when `signed` and the end really is before the start. */
  earlyNote?: string;
}

const NA_WAREHOUSE = 'Tidak berlaku — tujuan/asal gudang (DM), tidak ada konfirmasi karyawan.';
const NA_NO_RETURN = 'Tidak berlaku — asal TO adalah gudang (DM), tidak ada Item Return dari toko.';

export function buildTransferMetrics(t: MetricInput): TransferMetric[] {
  // Item Return is the ORIGIN store handing goods to the courier. A DM
  // warehouse origin has no employee in this app, so there is no photo ever.
  const returnApplicable = !t.fromIsWarehouse;
  // Delivery needs BOTH a real Item Return and a real Item Receiving.
  const deliveryApplicable = !t.fromIsWarehouse && !t.toIsWarehouse;
  // BC receiving needs a real store to submit Item Receiving at all.
  const bcReceivingApplicable = !t.toIsWarehouse;

  return [
    {
      key: 'bcProcessing',
      label: 'TO Dibuat → WS Diposting',
      shortLabel: 'Proses BC',
      ongoingLabel: 'menunggu WS diposting',
      notStartedLabel: 'TO belum terdeteksi',
      start: t.returnDetectedAt,
      end: t.droppingDetectedAt,
      applicable: true,
      naReason: NA_WAREHOUSE,
      signed: false,
    },
    {
      key: 'wsToReturn',
      label: 'WS Diposting → Foto Serah Terima',
      shortLabel: 'WS → Foto',
      ongoingLabel: 'menunggu foto serah terima',
      notStartedLabel: 'WS belum diposting',
      start: t.droppingDetectedAt,
      end: t.returnSubmittedAt,
      applicable: returnApplicable,
      naReason: NA_NO_RETURN,
      signed: true,
      earlyNote: 'foto diambil sebelum WS diposting di BC',
    },
    {
      key: 'returnTotal',
      label: 'Total Proses Item Return',
      shortLabel: 'Total Return',
      ongoingLabel: 'menunggu foto serah terima',
      notStartedLabel: 'TO belum terdeteksi',
      start: t.returnDetectedAt,
      end: t.returnSubmittedAt,
      applicable: returnApplicable,
      naReason: NA_NO_RETURN,
      signed: false,
    },
    {
      key: 'delivery',
      label: 'Waktu Pengiriman (Delivery Time)',
      shortLabel: 'Delivery',
      ongoingLabel: 'dalam perjalanan',
      notStartedLabel: 'belum diserahkan ke kurir',
      start: t.returnSubmittedAt,
      end: t.droppingSubmittedAt,
      applicable: deliveryApplicable,
      naReason: NA_WAREHOUSE,
      signed: false,
    },
    {
      key: 'bcReceiving',
      label: 'Terima Fisik Barang di Toko → WR Diposting (BC)',
      shortLabel: 'Terima BC',
      ongoingLabel: 'menunggu WR diposting',
      notStartedLabel: 'belum diterima fisik di toko',
      start: t.droppingSubmittedAt,
      end: t.receivedAt,
      applicable: bcReceivingApplicable,
      naReason: NA_WAREHOUSE,
      signed: false,
    },
  ];
}

/**
 * Whole minutes from `start` to `end` (or to `now` while `end` is null).
 * Null when there is no start. Clamped to 0 unless `signed`, in which case a
 * negative result is kept.
 */
export function minutesBetween(
  start: string | null,
  end: string | null,
  opts: { signed?: boolean; now?: number } = {},
): number | null {
  if (!start) return null;
  const to = end ? new Date(end).getTime() : (opts.now ?? Date.now());
  const diff = Math.round((to - new Date(start).getTime()) / 60_000);
  return opts.signed ? diff : Math.max(0, diff);
}

/** "1h 18j" (hari/jam), "5j 20m", "14m"; a leading "−" for negative minutes. */
export function formatMinutes(total: number): string {
  const sign = total < 0 ? '−' : '';
  const m = Math.abs(total);
  const hours = Math.floor(m / 60);
  const minutes = m % 60;
  if (hours >= 24) return `${sign}${Math.floor(hours / 24)}h ${hours % 24}j`;
  if (hours > 0) return `${sign}${hours}j ${minutes}m`;
  return `${sign}${minutes}m`;
}

export function durationBetween(
  start: string | null,
  end: string | null,
  opts: { signed?: boolean; now?: number } = {},
): string {
  const minutes = minutesBetween(start, end, opts);
  return minutes == null ? '—' : formatMinutes(minutes);
}

/** True when a `signed` metric really did finish before it started. */
export function finishedEarly(metric: Pick<TransferMetric, 'start' | 'end' | 'signed'>): boolean {
  if (!metric.signed || !metric.start || !metric.end) return false;
  return new Date(metric.end).getTime() < new Date(metric.start).getTime();
}

/**
 * "TO Dibuat" can't be later than anything the order itself produced: not the
 * Warehouse Shipment, not the Item Return photo. The sync keeps the first two
 * in order, but rows written by an older deployment (or detected late) can
 * violate it — and completed transfers drop out of BC's feeds, so no later
 * sweep would ever repair them. Enforce it when presenting.
 */
export function effectiveToCreatedAt(
  returnDetectedAt: Date | null,
  droppingDetectedAt: Date | null,
  returnSubmittedAt: Date | null,
): Date | null {
  // Never seen in the TO feed (a shipment-first stub): don't invent a time
  // from the shipment's — "TO belum terdeteksi" is the honest answer.
  if (!returnDetectedAt) return null;
  let best = returnDetectedAt;
  for (const other of [droppingDetectedAt, returnSubmittedAt]) {
    if (other && other.getTime() < best.getTime()) best = other;
  }
  return best;
}

/**
 * "13 Okt, 21.54" in Jakarta time — ALWAYS with the date, on both ends of a
 * range (a bare "09.02" after "21 Okt, 13.57" read as going backwards when the
 * range actually spans days). The year only appears when it isn't this year.
 */
export function formatStamp(iso: string): string {
  const d = new Date(iso);
  const yearOf = (x: Date) => x.toLocaleString('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric' });
  const showYear = yearOf(d) !== yearOf(new Date());
  return d.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    ...(showYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
