ALTER TYPE "public"."attendance_status" ADD VALUE IF NOT EXISTS 'dinas';--> statement-breakpoint
ALTER TYPE "public"."attendance_status" ADD VALUE IF NOT EXISTS 'cuti';--> statement-breakpoint
ALTER TYPE "public"."attendance_status" ADD VALUE IF NOT EXISTS 'sakit_tanpa_surat';--> statement-breakpoint
ALTER TYPE "public"."attendance_status" ADD VALUE IF NOT EXISTS 'sakit_dengan_surat';