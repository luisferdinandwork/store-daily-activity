// lib/impact-visit/checklist-config.ts
//
// Static checklist definitions transcribed from the paper "OPS IMPACT VISIT
// AND CHECKLIST" form (sections A-G, 100 pts + VM checklist sections A-E,
// 70 pts). Every section subtotal below was hand-verified against the
// source form's own printed subtotals while transcribing.
//
// Only item DEFINITIONS live here — per-visit ANSWERS are stored as JSON on
// impact_visits.checklistResponses / vmChecklistResponses, keyed by item id.

export interface ChecklistItem {
  id: string;
  section: string;
  criteria: string;
  points: number;
  hint: string;
}

export interface ChecklistSection {
  section: string;
  total: number;
}

// ─── Main Impact Visit Checklist — 100 pts ─────────────────────────────────

export const IMPACT_CHECKLIST: ChecklistItem[] = [
  // A. ADMINISTRASI — 20
  { id: 'main-1', section: 'A. ADMINISTRASI', criteria: 'Pembukuan', points: 2,
    hint: 'Marketing, Brankas, Shoes Display (Kanan), Reservation Book, Received & Retur, List Follow up, Store Checklist, Log book, Buku Uang Cash Karyawan, Buku Reedem Voucher, Buku Sales Return.' },
  { id: 'main-2', section: 'A. ADMINISTRASI', criteria: 'SPSTS Stock & Harian Stock', points: 3,
    hint: 'SPSTS Bulanan, SPSTS Mutasi, SPSTS Joint, SPSTS Resign, SPSTS Stock Scan Antar Toko. Melakukan dan mengisi Form cek bin harian sebanyak 30% dari total BIN (terutama yang terjual kemarin), Stock Best Seller, Stock Paling Mahal, Stock Display Random Cek.' },
  { id: 'main-3', section: 'A. ADMINISTRASI', criteria: 'Absensi', points: 2,
    hint: 'Memeriksa absensi serta in-out staff dengan benar, Mengatur jadwal istirahat dengan benar. Membuat schedule kerja dengan benar.' },
  { id: 'main-4', section: 'A. ADMINISTRASI', criteria: 'MAP Prestasi & TRAINING', points: 2,
    hint: 'Folder di PC Store - File Basic Training, CDP, 5 Foundation, Coaching & Counseling, Punishment, Form Mutasi, Hasil Impact Visit, Nomor BPJS (KS & KT).' },
  { id: 'main-5', section: 'A. ADMINISTRASI', criteria: 'Bantex tergruping dengan rapih', points: 2,
    hint: '2 Binder/Bantex di Store - Impact Visit, Receiving, Return, Tanda Terima, Slip Setoran, SPSTS.' },
  { id: 'main-6', section: 'A. ADMINISTRASI', criteria: 'Melakukan Daily Briefing Pukul 14.00 WIB/WITA.', points: 2,
    hint: 'Folder di PC Store - (Brand Contribution, Individual Sales & Schedule Checklist) By Phone PIC.' },
  { id: 'main-7', section: 'A. ADMINISTRASI', criteria: 'Menjelaskan target harian / bulanan kepada seluruh tim.', points: 2,
    hint: 'Bertanya kepada tim toko mengenai target operasional toko.' },
  { id: 'main-8', section: 'A. ADMINISTRASI', criteria: 'Sales Performance Tracker Terisi dengan benar dan Staff Bisa Menjelaskan Sales Matrik Perorangan dan Toko.', points: 3,
    hint: 'Mengecek Form Sales Performance Tracker di Papan Jalan dan Bertanya kepada tim toko mengenai Sales Matrix. (ATU, ATV, Invoice, Achivement, CR, Promo Yang Berjalan)' },
  { id: 'main-9', section: 'A. ADMINISTRASI', criteria: 'General Meeting', points: 2,
    hint: 'Jadwal & Report Pelaksanaan.' },

  // B. CUSTOMER SERVICE — 8
  { id: 'main-10', section: 'B. CUSTOMER SERVICE', criteria: 'Keberadaan staff di area toko dilakukan dengan baik.', points: 2,
    hint: 'Staff selalu hadir di area penjualan.' },
  { id: 'main-11', section: 'B. CUSTOMER SERVICE', criteria: 'Seragam', points: 2,
    hint: 'Pemakaian seragam, name-tag dan grooming dilakukan dengan baik.' },
  { id: 'main-12', section: 'B. CUSTOMER SERVICE', criteria: 'Seluruh staff melayani konsumen sesuai dengan panduan 5 FOUNDATIONS.', points: 2,
    hint: 'Monitoring staff pada saat melayani customer.' },
  { id: 'main-13', section: 'B. CUSTOMER SERVICE', criteria: 'Staff Memahami Sales Oriented', points: 2,
    hint: 'Monitoring staff pada saat melayani customer.' },

  // C. MERCHANDISING — 22
  { id: 'main-14', section: 'C. MERCHANDISING', criteria: 'SPSTS Stock & Harian Stock', points: 3,
    hint: 'SPSTS Bulanan, SPSTS Mutasi, SPSTS Joint, SPSTS Resign, SPSTS Stock Scan Antar Toko. Melakukan dan mengisi Form cek bin harian sebanyak 30% dari total BIN (terutama yang terjual kemarin), Stock Best Seller, Stock Paling Mahal, Stock Display Random Cek.' },
  { id: 'main-15', section: 'C. MERCHANDISING', criteria: 'Promo Toko Sudah Update dan Berjalan Dengan Baik.', points: 3,
    hint: 'Memeriksa Display di area Floor.' },
  { id: 'main-16', section: 'C. MERCHANDISING', criteria: 'Regulasi: Label Bahasa, Barcode, SNI, K3L', points: 3,
    hint: 'Memeriksa Display yang dimaksud di area Floor.' },
  { id: 'main-17', section: 'C. MERCHANDISING', criteria: 'Stok di PP BIN Content sesuai dengan Fisik Barang pada masing masing Rak', points: 2,
    hint: 'Melakukan Cek di mesin PDT.' },
  { id: 'main-18', section: 'C. MERCHANDISING', criteria: 'Tidak ada Item Minus, Case Retur, STO, Sales Return Item Discount dalam 1 minggu', points: 2,
    hint: 'Memeriksa History Case Item Minus, Retur, STO, dan Sales Return di LS dan followupnya.' },
  { id: 'main-19', section: 'C. MERCHANDISING', criteria: 'Nilai VM checklist diatas 50.', points: 4,
    hint: 'Check VM Checklist.' },
  { id: 'main-20', section: 'C. MERCHANDISING', criteria: 'VM Aktif kordinasi dengan team & PIC.', points: 3,
    hint: 'Bertanya kepada PIC dan team.' },
  { id: 'main-21', section: 'C. MERCHANDISING', criteria: 'Analisa dan Action Plan', points: 2,
    hint: 'Menganalisa produk (Rasio, Broken size, Report Inventory Level (IL) - Cek Capture di WA Setiap Hari Senin.' },

  // E. KEBERSIHAN — 16 (paper form has no section "D")
  { id: 'main-22', section: 'E. KEBERSIHAN', criteria: 'Area kasir bersih dan rapih.', points: 2,
    hint: 'Meja kasir tidak penuh barang, Laci kasir tidak penuh barang yang tidak tersusun rapi, tidak ada debu di belakang komputer.' },
  { id: 'main-23', section: 'E. KEBERSIHAN', criteria: 'Kebersihan front sign, show window & pencahayaan toko.', points: 2,
    hint: 'Memeriksa Selling Floor.' },
  { id: 'main-24', section: 'E. KEBERSIHAN', criteria: 'Kebersihan langit-langit, lantai toko, wall, fixture & merchandise.', points: 2,
    hint: 'Memeriksa Selling Floor. (Jadwalkan 2x seminggu sikat lantai)' },
  { id: 'main-25', section: 'E. KEBERSIHAN', criteria: 'Equipment Rusak Sudah Dilaporkan, di-Pooling serta telah dicatat pada List Follow Up.', points: 2,
    hint: 'Memeriksa Selling Floor dan Buku List Follow Up.' },
  { id: 'main-26', section: 'E. KEBERSIHAN', criteria: 'General Cleaning', points: 2,
    hint: 'Jadwal & Report Pelaksanaan.' },
  { id: 'main-27', section: 'E. KEBERSIHAN', criteria: 'Toilet, Fitting room, Tester socks, Shoe Horn.', points: 2,
    hint: 'Memeriksa kondisi Toilet, Fitting room, Tester socks, Shoe Cleaner, Shoe Horn.' },
  { id: 'main-28', section: 'E. KEBERSIHAN', criteria: 'Kelengkapan Kunci dan Gembok', points: 2,
    hint: 'Memeriksa Kelengkapan Kunci dan Gembok.' },
  { id: 'main-29', section: 'E. KEBERSIHAN', criteria: 'Penggunaan volume musik & standard pemilihan lagu.', points: 2,
    hint: 'Memeriksa pemilihan jenis lagu dan volume.' },

  // F. KASIR & KEUANGAN — 18
  { id: 'main-30', section: 'F. KASIR & KEUANGAN', criteria: 'Memiliki pencatatan Petty Cash yang baik dengan jumlah yang sesuai.', points: 3,
    hint: 'Memeriksa pencatatan secara manual, melalui sistem & penghitungan fisik.' },
  { id: 'main-31', section: 'F. KASIR & KEUANGAN', criteria: 'Memeriksa uang modal sebesar Rp 500,000.', points: 3,
    hint: 'Harus ada uang pecahan Rp100 - Rp500 - Rp1.000 - Rp2.000 - Rp5.000 - Rp10.000 - Rp20.000 - Rp50.000 - Rp100.000.' },
  { id: 'main-32', section: 'F. KASIR & KEUANGAN', criteria: 'Sisa setoran', points: 2,
    hint: 'Memeriksa pencatatan secara manual, melalui sistem & penghitungan fisik.' },
  { id: 'main-33', section: 'F. KASIR & KEUANGAN', criteria: 'Sales Cash saat itu', points: 2,
    hint: 'Memeriksa pencatatan secara manual, melalui sistem & penghitungan fisik.' },
  { id: 'main-34', section: 'F. KASIR & KEUANGAN', criteria: 'Buku Pemakaian Voucher', points: 2,
    hint: 'Employee Voucher, All Coupon.' },
  { id: 'main-35', section: 'F. KASIR & KEUANGAN', criteria: 'Memeriksa brankas.', points: 2,
    hint: 'Hanya berisikan dokumen yang berhubungan dengan perusahaan.' },
  { id: 'main-36', section: 'F. KASIR & KEUANGAN', criteria: 'Setoran ke Bank sebelum buka toko.', points: 2,
    hint: 'Mengecek Send Email Ke Finance. (Jika posisi Bank buka bersamaan dengan buka mall, maka setor ke Bank menunggu shift siang datang).' },
  { id: 'main-37', section: 'F. KASIR & KEUANGAN', criteria: 'Mendokumentasikan Slip Setoran Bank dengan benar.', points: 2,
    hint: 'Memeriksa EOD, Settlement, Daily Report dan Slip Setoran (pencatatan manual, sistem & penghitungan fisik).' },

  // G. GUDANG — 16
  { id: 'main-38', section: 'G. GUDANG', criteria: 'Pengaturan barang berdasarkan merk produk.', points: 2,
    hint: 'Memeriksa gudang.' },
  { id: 'main-39', section: 'G. GUDANG', criteria: 'Pengaturan barang berdasarkan kategori - artikel - ukuran & tumpukan innerbox', points: 3,
    hint: 'Memeriksa urutan sizing dari paling bawah Size besar - Size kecil, serta tumpukan innerbox tidak lebih dari 7 innerbox.' },
  { id: 'main-40', section: 'G. GUDANG', criteria: 'Pembagian Area Toko Sesuai Fungsi (Receiving, Penomoran Rak/BIN, Display, Defect, Target Area)', points: 3,
    hint: 'Memeriksa Area Toko apakah antara Barcode BIN sesuai dengan Fungsinya.' },
  { id: 'main-41', section: 'G. GUDANG', criteria: 'Mading Board diisi dengan benar.', points: 2,
    hint: 'Target, Best Sales, 5 Foundation, Pre Service, Core Value, Insentife, Structure Organisation, Responsibility of Section, Surat Izin Keluar Masuk Barang, 4 Pilar, Staff Day Information.' },
  { id: 'main-42', section: 'G. GUDANG', criteria: 'Memisahkan peralatan Non-Merchandiser (APAR, Fixture, Staffs Goods, Hanger dll).', points: 2,
    hint: 'Memeriksa gudang.' },
  { id: 'main-43', section: 'G. GUDANG', criteria: 'Memisahkan produk display, defective item & reservation.', points: 2,
    hint: 'Memeriksa penggunaan formnya serta penempatannya.' },
  { id: 'main-44', section: 'G. GUDANG', criteria: 'Pengecekan Iner Box Kosong, Dus Kosong & Sepatu Staff', points: 2,
    hint: 'Tidak ada Iner Box Kosong, Dus Kosong & Sepatu Staff.' },
];

export const IMPACT_CHECKLIST_SECTIONS: ChecklistSection[] = [
  { section: 'A. ADMINISTRASI', total: 20 },
  { section: 'B. CUSTOMER SERVICE', total: 8 },
  { section: 'C. MERCHANDISING', total: 22 },
  { section: 'E. KEBERSIHAN', total: 16 },
  { section: 'F. KASIR & KEUANGAN', total: 18 },
  { section: 'G. GUDANG', total: 16 },
];

export const IMPACT_CHECKLIST_MAX_SCORE = 100;

// ─── VM Checklist — 70 pts ──────────────────────────────────────────────────

export const VM_CHECKLIST: ChecklistItem[] = [
  // A. BASIC VM — 24
  { id: 'vm-1', section: 'A. BASIC VM', criteria: 'Staff mengetahui cara memasang tali sepatu display', points: 2, hint: 'Minta staff praktek.' },
  { id: 'vm-2', section: 'A. BASIC VM', criteria: 'Staff mengetahui cara memasang shoefiller', points: 2, hint: 'Minta staff praktek.' },
  { id: 'vm-3', section: 'A. BASIC VM', criteria: 'Staff mengetahui cara memasang price tag', points: 2, hint: 'Minta staff praktek.' },
  { id: 'vm-4', section: 'A. BASIC VM', criteria: 'Staff mengetahui cara memasang tag discount', points: 2, hint: 'Minta staff praktek.' },
  { id: 'vm-5', section: 'A. BASIC VM', criteria: 'Staff hafal size chart dengan benar', points: 2, hint: 'Tanyakan terkait size sepatu (minimal benar 4 dari 5).' },
  { id: 'vm-6', section: 'A. BASIC VM', criteria: 'Staff mengerti size display Women, Men & Kids', points: 2, hint: 'WOMEN (37-38), MEN (41-42), KIDS-BABY (19-23), KIDS-JUNIOR (33-34).' },
  { id: 'vm-7', section: 'A. BASIC VM', criteria: 'VM Memasang ALL POP dengan benar', points: 2, hint: 'Materi promo harus ter-update pada ALL POP (Acrylic, Tripod, PVC, Digital Signage).' },
  { id: 'vm-8', section: 'A. BASIC VM', criteria: 'Staff mengerti cara membaca garment care / material shoes', points: 2, hint: 'Tanyakan terkait arti logo garment.' },
  { id: 'vm-9', section: 'A. BASIC VM', criteria: 'Mengetahui SOP product Last Pairs & PIG SKIN', points: 2, hint: 'Cek product Last Pairs & PIG SKIN (display dan stiker).' },
  { id: 'vm-10', section: 'A. BASIC VM', criteria: 'Mengetahui SOP Hangtag display (FW, APP, EQP)', points: 2, hint: 'Cek Hangtag display (tag, chainball, loopin/toge).' },
  { id: 'vm-11', section: 'A. BASIC VM', criteria: 'Selling Area sesuai dengan layout toko', points: 2, hint: 'Logo, Fitting Room & Area Floor tidak ada Dus/Barang.' },
  { id: 'vm-12', section: 'A. BASIC VM', criteria: 'Staff mengetahui kategori sizing kids', points: 2, hint: 'Baby/Infant, Toddler, Junior.' },

  // B. Collection PER BRAND — 12
  { id: 'vm-13', section: 'B. COLLECTION PER BRAND', criteria: 'Staff mengetahui Collection ADIDAS (sesuai SBU)', points: 2, hint: 'ODD (Performance, Classic, Future) / FISIK (Futsal, Football, Tennis, Basket, Training, Classic, Future).' },
  { id: 'vm-14', section: 'B. COLLECTION PER BRAND', criteria: 'Staff mengetahui Collection NIKE (sesuai SBU)', points: 2, hint: 'ODD (Inspired Running, Air Max, Air Force) / FISIK (Futsal, Football, Running, Training, Basket, Classic).' },
  { id: 'vm-15', section: 'B. COLLECTION PER BRAND', criteria: 'Staff mengetahui Collection PUMA (sesuai SBU)', points: 2, hint: 'ODD (Running, Training, SportStyle) / FISIK (Futsal, Football, Running, Training, SportStyle).' },
  { id: 'vm-16', section: 'B. COLLECTION PER BRAND', criteria: 'Staff mengetahui Collection MIZUNO (sesuai SBU)', points: 2, hint: 'ODD (Sportstyle) / FISIK (Futsal, Football, Volley, Tennis, Running, Badminton).' },
  { id: 'vm-17', section: 'B. COLLECTION PER BRAND', criteria: 'Staff mengetahui Collection ASICS/PIERO (sesuai SBU)', points: 2, hint: 'ODD (Gel, Lifestyle) / FISIK (Lifestyle: active, classic, essential, exclusive).' },
  { id: 'vm-18', section: 'B. COLLECTION PER BRAND', criteria: 'Staff mengetahui Collection VANS/SPECS (sesuai SBU)', points: 2, hint: 'ODD (Lifestyle) / FISIK (Futsal, Football, Running, Classic).' },

  // C. ORIENTATION QUIZ — 16
  { id: 'vm-19', section: 'C. ORIENTATION QUIZ', criteria: 'VM Membuat OQ', points: 4, hint: 'VM membuat Quiziz — tanggal berapa?' },
  { id: 'vm-20', section: 'C. ORIENTATION QUIZ', criteria: 'Staff dapat menjawab 10 Pertanyaan OQ', points: 2, hint: 'Minta OQ ke VM, dan tanyakan ke staff.' },
  { id: 'vm-21', section: 'C. ORIENTATION QUIZ', criteria: 'VM membuat PDF produk knowledge', points: 4, hint: 'Wajib diupload ke link (ada di deskripsi grup VM).' },
  { id: 'vm-22', section: 'C. ORIENTATION QUIZ', criteria: 'Share Video Konten & Product Knowledge (Sosmed)', points: 3, hint: 'Cek di grup VM Checklist.' },
  { id: 'vm-23', section: 'C. ORIENTATION QUIZ', criteria: 'Staff dapat menjelaskan Feature, Advantage dan Benefit product', points: 3, hint: 'Random pick produk yang dijual, minta staff menjelaskan F-A-B-nya.' },

  // D. PRODUCTIVITY BY BRAND — 10
  { id: 'vm-24', section: 'D. PRODUCTIVITY BY BRAND', criteria: 'VM mengecek updated clearance sale', points: 2, hint: 'Cek tag barang MC (saletag, price) sudah sesuai dengan MC update.' },
  { id: 'vm-25', section: 'D. PRODUCTIVITY BY BRAND', criteria: 'VM mempresentasikan setiap wall', points: 2, hint: 'Tanyakan konsep display setiap wall.' },
  { id: 'vm-26', section: 'D. PRODUCTIVITY BY BRAND', criteria: 'VM mengupdate portofolio', points: 2, hint: 'Dikirim setiap awal bulan (maks. tanggal 5).' },
  { id: 'vm-27', section: 'D. PRODUCTIVITY BY BRAND', criteria: 'Staff mengetahui TOP 10 product Best Seller', points: 2, hint: 'Cek data best seller store.' },
  { id: 'vm-28', section: 'D. PRODUCTIVITY BY BRAND', criteria: 'MIX Match Display / Essentials / Wall / Shelving', points: 2, hint: 'Cek display MixMatch/Essentials/Wall/Shelving sesuai SOP VM.' },

  // E. GUDANG — 8
  { id: 'vm-29', section: 'E. GUDANG', criteria: 'Mading Board VM diisi dengan benar', points: 2,
    hint: 'Nama Media materi promo, Anatomi sepatu, Brand Collection VM, Layout toko, Denah rack Gudang, SIZE chart, Garment care.' },
  { id: 'vm-30', section: 'E. GUDANG', criteria: 'Menyimpan stock hook dengan baik dan benar', points: 2,
    hint: 'SILO (khusus SBU FF FS FO SPECS). Cek penyimpanan HOOK yang tidak terpakai.' },
  { id: 'vm-31', section: 'E. GUDANG', criteria: 'Menyimpan Saletag dengan Rapi & Benar (Tidak diikat dengan Karet)', points: 2, hint: 'Cek penyimpanan Saletag.' },
  { id: 'vm-32', section: 'E. GUDANG', criteria: 'Menyimpan tools POP VM dengan baik (POP A1, PVC, ACRYLIC)', points: 2, hint: 'Cek penyimpanan Tools POP VM.' },
];

export const VM_CHECKLIST_SECTIONS: ChecklistSection[] = [
  { section: 'A. BASIC VM', total: 24 },
  { section: 'B. COLLECTION PER BRAND', total: 12 },
  { section: 'C. ORIENTATION QUIZ', total: 16 },
  { section: 'D. PRODUCTIVITY BY BRAND', total: 10 },
  { section: 'E. GUDANG', total: 8 },
];

export const VM_CHECKLIST_MAX_SCORE = 70;

// ─── Cash Money Check ───────────────────────────────────────────────────────

/** Denomination values (IDR), largest to smallest — same order as the paper form. */
export const CASH_DENOMINATIONS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100] as const;

export interface CashDenominationRow {
  value: number;
  qty: number;
}

export interface CashMoneyData {
  /** Target: Rp 500,000 */
  uangModal: CashDenominationRow[];
  uangSisaSetoran: CashDenominationRow[];
  /** Target: Rp 1,000,000 */
  uangPettyCash: CashDenominationRow[];
  uangSalesCash: CashDenominationRow[];
  cashOut: number | null;
}

export const UANG_MODAL_TARGET = 500_000;
export const UANG_PETTY_CASH_TARGET = 1_000_000;

export function emptyCashMoneyData(): CashMoneyData {
  const emptyRows = (): CashDenominationRow[] => CASH_DENOMINATIONS.map((value) => ({ value, qty: 0 }));
  return {
    uangModal: emptyRows(),
    uangSisaSetoran: emptyRows(),
    uangPettyCash: emptyRows(),
    uangSalesCash: emptyRows(),
    cashOut: null,
  };
}

export function cashRowTotal(rows: CashDenominationRow[]): number {
  return rows.reduce((sum, row) => sum + row.value * row.qty, 0);
}
