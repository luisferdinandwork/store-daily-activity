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
//   delivery      Foto Serah Terima → Terima Fisik Barang di Toko
//   bcReceiving   Terima Fisik Barang di Toko → WR Diposting
// (a "Total Proses Item Return" = TO Dibuat → Foto Serah Terima used to sit here
// too; removed 2026-11-18 by request — it repeated the first two and confused OPS.)
//
// SELESAI OTOMATIS (BC posted the WR while a store never did its PRISM step):
// the times that exist are kept and a missing photo is replaced by another
// recorded time, so nothing turns into a blank — a missing START (a photo that
// would have started the clock) becomes WS Diposting, a missing END becomes the
// next thing that really happened:
//   wsToReturn    … → (Terima Fisik | WR Diposting) — the destination store
//                 photographing the goods proves the hand-off was over by then
//                 ("half done": only the receiving store used PRISM)
//   delivery      (Foto Serah Terima | WS Diposting) → (Terima Fisik | WR Diposting)
//   bcReceiving   (Terima Fisik | WS Diposting) → WR Diposting
// so with no photo at all Delivery and Item Receiving both read WS → WR.
//
// "Foto Serah Terima" is `returnSubmittedAt`: the moment the store submits the
// confirmation, which requires the courier-signed photo (an upload happens
// seconds earlier but its time is not stored).
// ─────────────────────────────────────────────────────────────────────────────

export type MetricKey = 'bcProcessing' | 'wsToReturn' | 'delivery' | 'bcReceiving';

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
  /**
   * Selesai Otomatis: one end is another recorded time standing in for a step
   * nobody processed in PRISM (`autoStart` = WS Diposting, `autoEnd` = Terima
   * Fisik or WR Diposting — `autoEndLabel` says which). The duration is real and
   * final; `autoNote` says which end was filled in.
   */
  auto: boolean;
  autoStart: boolean;
  autoEnd: boolean;
  /** 'Terima Fisik' / 'WR Diposting' — what the filled-in end is ('' when not filled). */
  autoEndLabel: string;
  autoNote: string;
  /**
   * No duration can honestly be shown — the page shows `skippedLabel` ("—"):
   *  - the order is finished but even the stand-in times can't close it (no WS
   *    Diposting was ever recorded — BC drops a finished order's shipment rows);
   *  - or its end was recorded BEFORE its start (e.g. the store sent the Foto
   *    Serah Terima days after BC had posted the WR) — a 0 would be a lie.
   */
  skipped: boolean;
  skippedLabel: string;
}

/** What each end of a metric is called when it is the recorded step (not a stand-in). */
const END_NAMES: Record<MetricKey, { start: string; end: string }> = {
  bcProcessing: { start: 'TO Dibuat', end: 'WS Diposting' },
  wsToReturn: { start: 'WS Diposting', end: 'Foto Serah Terima' },
  delivery: { start: 'Foto Serah Terima', end: 'Terima Fisik' },
  bcReceiving: { start: 'Terima Fisik', end: 'WR Diposting' },
};

/** Why a finished order has no WS Diposting — shown on every metric that needed it. */
export const WS_NOT_RECORDED =
  'WS Diposting tidak tercatat — BC sudah menghapus data pengiriman TO ini sebelum PRISM membacanya';

const NA_WAREHOUSE = 'Tidak berlaku — tujuan/asal gudang (DM), tidak ada konfirmasi karyawan.';
const NA_NO_RETURN = 'Tidak berlaku — asal TO adalah gudang (DM), tidak ada Item Return dari toko.';

/**
 * Which end of a metric may be filled in once the order is finished (see the
 * header): a missing start → WS Diposting; a missing end → the first of `end`
 * that exists. TO Dibuat → WS Diposting has no photo in it, so it is never filled.
 */
type EndFill = { at: (t: MetricInput) => string | null; label: string };
const TERIMA_FISIK: EndFill = { at: (t) => t.droppingSubmittedAt, label: 'Terima Fisik' };
const WR_DIPOSTING: EndFill = { at: (t) => t.receivedAt, label: 'WR Diposting' };
const AUTO_FILL: Record<MetricKey, { start: boolean; end: EndFill[] }> = {
  bcProcessing: { start: false, end: [] },
  // Half done: the destination photographed the goods, so the Item Return was over by then.
  wsToReturn: { start: false, end: [TERIMA_FISIK, WR_DIPOSTING] },
  delivery: { start: true, end: [WR_DIPOSTING] },
  bcReceiving: { start: true, end: [WR_DIPOSTING] },
};

export function buildTransferMetrics(t: MetricInput): TransferMetric[] {
  const finished = Boolean(t.receivedAt);
  return buildRawMetrics(t).map((m) => {
    let { start, end } = m;
    let autoStart = false;
    let autoEndLabel = '';
    if (finished && m.applicable) {
      const fill = AUTO_FILL[m.key];
      if (!start && fill.start && t.droppingDetectedAt) { start = t.droppingDetectedAt; autoStart = true; }
      if (!end) {
        const by = fill.end.find((f) => f.at(t));
        if (by) { end = by.at(t); autoEndLabel = by.label; }
      }
    }
    const autoEnd = autoEndLabel !== '';
    const auto = autoStart || autoEnd;
    const missing = finished && m.applicable && (!start || !end);
    // A non-signed range whose end was recorded before its start has no real duration.
    const backwards = m.applicable && !m.signed && Boolean(start && end) && new Date(end!).getTime() < new Date(start!).getTime();
    const startName = autoStart ? 'WS Diposting' : END_NAMES[m.key].start;
    const endName = autoEnd ? autoEndLabel : END_NAMES[m.key].end;
    const skippedLabel = backwards
      ? `tidak tercatat — ${endName} lebih awal dari ${startName}`
      : missing
        ? (t.droppingDetectedAt ? 'tidak tercatat — TO sudah selesai di BC' : WS_NOT_RECORDED)
        : '';
    const filled = [autoStart && 'dari WS Diposting', autoEnd && `sampai ${autoEndLabel}`].filter(Boolean).join(', ');
    return {
      ...m,
      start,
      end,
      auto,
      autoStart,
      autoEnd,
      autoEndLabel,
      autoNote: auto ? `Selesai otomatis — tidak diproses di PRISM, dihitung ${filled}` : '',
      skipped: missing || backwards,
      skippedLabel,
    };
  });
}

function buildRawMetrics(
  t: MetricInput,
): Omit<TransferMetric, 'auto' | 'autoStart' | 'autoEnd' | 'autoEndLabel' | 'autoNote' | 'skipped' | 'skippedLabel'>[] {
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
