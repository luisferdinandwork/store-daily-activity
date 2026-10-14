CREATE TABLE "store_visit_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"tasks" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_visit_config_singleton" CHECK ("store_visit_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "store_visit_policies" (
	"store_no" text PRIMARY KEY NOT NULL,
	"store_name" text NOT NULL,
	"manager" text NOT NULL,
	"city" text NOT NULL,
	"category" text NOT NULL,
	"interval_days" integer NOT NULL,
	"minimum_visits" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_visit_policy_category" CHECK ("store_visit_policies"."category" IN ('in_city', 'out_city')),
	CONSTRAINT "store_visit_policy_interval" CHECK ("store_visit_policies"."interval_days" BETWEEN 1 AND 365 AND "store_visit_policies"."minimum_visits" BETWEEN 1 AND "store_visit_policies"."interval_days")
);
--> statement-breakpoint
CREATE TABLE "store_visits" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"visited_by" text NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"photo_url" text NOT NULL,
	"photo_geo" jsonb NOT NULL,
	"lat" numeric(10, 7) NOT NULL,
	"lng" numeric(10, 7) NOT NULL,
	"accuracy" numeric(8, 2) NOT NULL,
	"distance_m" integer NOT NULL,
	"tasks" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_visits" ADD CONSTRAINT "store_visits_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_visits" ADD CONSTRAINT "store_visits_visited_by_users_id_fk" FOREIGN KEY ("visited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_visits_store_date_idx" ON "store_visits" USING btree ("store_id","visited_at");
--> statement-breakpoint
-- Initial checklist and schedule transcribed from JADWAL VISIT.xlsx, Sheet1 A2:G46.
INSERT INTO store_visit_config (id,tasks) VALUES (1,'[{"id": "cleanliness", "label": "Kebersihan area toko, kasir, dan fitting room", "requirePhoto": true}, {"id": "display", "label": "Kerapian display, visual merchandising, dan promo", "requirePhoto": true}, {"id": "staff", "label": "Absensi, seragam, grooming, dan pelayanan staf", "requirePhoto": false}, {"id": "briefing", "label": "Briefing, target, dan pemahaman sales performance tim", "requirePhoto": false}, {"id": "stock", "label": "Kesesuaian stok, BIN, penerimaan, dan retur barang", "requirePhoto": false}, {"id": "cash", "label": "Uang modal, petty cash, dan bukti setoran", "requirePhoto": false}, {"id": "warehouse", "label": "Kerapian gudang dan penyimpanan barang", "requirePhoto": true}, {"id": "followup", "label": "Tindak lanjut temuan dan kondisi fasilitas toko", "requirePhoto": false}]'::jsonb) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO store_visit_policies (store_no,store_name,manager,city,category,interval_days,minimum_visits) VALUES
('FS033','Fisik - Living World Denpasar','AWAN','BALI','out_city',90,1),
('OD011','ODD - Beachwalk Bali','AWAN','BALI','out_city',90,1),
('FF001','Fisik Football - Daan Mogot','AWAN','JAKARTA','in_city',7,1),
('FF002','Fisik Football - Senayan City','AWAN','JAKARTA','in_city',7,1),
('FF003','Fisik Football - Gandaria City','AWAN','JAKARTA','in_city',7,1),
('FF009','Fisik Football - Grand Indonesia','AWAN','JAKARTA','in_city',7,1),
('FF010','Fisik Football - Pondok Indah Mall 3','AWAN','JAKARTA','in_city',7,1),
('FO001','Factory Outlet - Daan Mogot','AWAN','JAKARTA','in_city',7,1),
('OD002','ODD - Senayan City','AWAN','JAKARTA','in_city',7,1),
('OD004','ODD - Kota Kasablanka','AWAN','JAKARTA','in_city',7,1),
('OD005','ODD - Pik Avenue','AWAN','JAKARTA','in_city',7,1),
('OD008','ODD - Pondok Indah Mall 2','AWAN','JAKARTA','in_city',7,1),
('OD012','ODD - Grand Indonesia','AWAN','JAKARTA','in_city',7,1),
('OD022','ODD - Gandaria City','AWAN','JAKARTA','in_city',7,1),
('FS001','Fisik - Margo City','ELI','DEPOK','in_city',7,1),
('OD018','ODD - Margo City Mall Depok','ELI','DEPOK','in_city',7,1),
('FF013','Fisik Football - Bintaro Xchange','ELI','TANGGERANG','in_city',7,1),
('FO002','Factory Outlet - Cokroaminoto','ELI','TANGGERANG','in_city',7,1),
('FS003','Fisik - Tangerang City','ELI','TANGGERANG','in_city',7,1),
('FS012','Fisik - Summarecon Mal Serpong','ELI','TANGGERANG','in_city',7,1),
('FS025','Fisik - Bintaro Xchange Mall 2','ELI','TANGGERANG','in_city',7,1),
('OD009','ODD - Summarecon Mal Serpong','ELI','TANGGERANG','in_city',7,1),
('OD016','ODD - Bintaro Jaya Xchange Mall','ELI','TANGGERANG','in_city',7,1),
('FS014','Fisik - Bandung Indah Plaza','JAYANTI','BANDUNG','out_city',60,1),
('FF016','Fisik Football-Summarecon Mal Bandung','JAYANTI','BANDUNG','out_city',60,1),
('FS036','Fisik - 23 Paskal Shopping Center','JAYANTI','BANDUNG','out_city',60,1),
('FF012','Fisik Football-Summarecon Mall Bekasi','JAYANTI','BEKASI','in_city',7,1),
('FF014','Fisik Football - Pakuwon Mall Bekasi','JAYANTI','BEKASI','in_city',7,1),
('OD017','ODD - Summarecon Mal Bekasi','JAYANTI','BEKASI','in_city',7,1),
('FS008','Fisik - Ruko Padjajaran Bogor','JAYANTI','BOGOR','in_city',7,1),
('FS006','Fisik - Cirebon Superblock','JAYANTI','CIREBON','out_city',60,1),
('SS002','Specs Store - Ruko Kartini Cirebon','JAYANTI','CIREBON','out_city',60,1),
('FS020','Fisik - Plaza Medan Fair','JAYANTI','MEDAN','out_city',90,1),
('SS003','Specs Store - Plaza Medan Fair','JAYANTI','MEDAN','out_city',90,1),
('FS028','Fisik - Ewalk Mall Balikpapan','RIDO','BALIKPAPAN','out_city',90,1),
('FS027','Fisik - Duta Mall Banjarmasin','RIDO','BANJARMASIN','out_city',90,1),
('FS007','Fisik - Ruko Seturan Square','RIDO','JOGJAKARTA','out_city',60,1),
('FS029','Fisik - Mall Olympic Garden','RIDO','MALANG','out_city',60,1),
('FS005','Fisik - Ayani MegaMall','RIDO','PONTIANAK','out_city',90,1),
('FS031','Fisik - Pakuwon Mall Solo','RIDO','SOLO','out_city',60,1),
('FF004','Fisik Football - Tunjungan Plaza 5','RIDO','SURABAYA','in_city',7,1),
('FF015','Fisik Football -Pakuwon Mall Surabaya','RIDO','SURABAYA','in_city',7,1),
('FS002','Fisik - Tunjungan Plaza 1','RIDO','SURABAYA','in_city',7,1),
('OD010','ODD - Tunjungan Plaza 4 SBY','RIDO','SURABAYA','in_city',7,1),
('SS001','Specs Store - Tunjungan Plaza 3','RIDO','SURABAYA','in_city',7,1)
ON CONFLICT DO NOTHING;
