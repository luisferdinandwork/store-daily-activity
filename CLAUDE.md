# CLAUDE.md

Guidance for AI assistants working in this repo. Keep this file short and current.

## What this is

**PRISM** — a store-operations platform for a sports-retail chain (Panatrade / "Fisik", "Factory Outlet"). Store staff run daily checklists, attendance, petty cash, handovers, and stock-transfer confirmations from a mobile web app; Ops/Finance/Audit/IT manage from desktop panels.

- Next.js 16 (App Router, React 19, React Compiler on), TypeScript strict.
- Postgres via **Drizzle ORM** + `pg` (node-postgres). Self-hosted DB — `DATABASE_URL` in `.env.local`.
- Auth: NextAuth (credentials). **Login is by NIK, not email.** Session user carries `id`, `role`, `employeeType`, `homeStoreId`, `areaId`.
- Deploy: VPS + PM2 + nginx (`ecosystem.config.js`, `deploy/`). **Production runs in UTC** — see date convention below.
- Object storage: Biznet NOS (S3-compatible), `lib/storage.ts`. `lib/oss.ts` is legacy.
- Business Central (BC) OData integration for sales + stock transfers: `lib/bc/client.ts`, `lib/performance/business-central-*.ts`, `lib/db/utils/item-transfers.ts`.
- UI: Tailwind v4, Radix UI, `sonner` toasts, `lucide-react`. Indonesian-language user-facing copy.

## Roles & panels

| Role (`user_roles.code`) | Panel | Notes |
|---|---|---|
| `employee` | `/employee` (mobile) | `employee_types.code`: `pic_1`, `pic_2`, `sa`. PIC 1/2 also get `/pic` (team task progress + **read-only** schedule: they upload the Excel for a month with no schedule yet; editing/creating/deleting is Ops-only, so to fix a mistake Ops removes the month from `/ops/schedules` and the PIC re-uploads). |
| `ops` | `/ops` | `employee_types.code`: `ops_ho` (all stores) or `ops_area` (own `areaId` only). |
| `finance` | `/finance` | |
| `audit` | `/audit` | |
| `it` | `/it` | Super-admin. IT-only pages live under `/it`; their APIs stay under `/api/ops/*`. Can "switch role" to preview others. |

## Layout

- `app/api/<role>/...` — route handlers, grouped by who calls them.
- `lib/db/schema/*` — Drizzle tables. `lib/db/schema/index.ts` re-exports everything + a `schema` object.
- `lib/db/utils/*` — per-task business logic (`briefing.ts`, `serah-terima.ts`, `store-opening.ts`, …). Task rows are created lazily via `getOrCreate*ForSchedule` when an employee opens the task — they don't all have to be pre-seeded.
- `lib/*` — cross-cutting helpers (`schedule-utils.ts`, `shift-tasks.ts`, `schedule-import.ts`, `performance/target-utils.ts`).
- `components/<role>/...`, `components/ui/...`.
- `scripts/seed/*` — the dev/staging seed (see below). `scripts/{generate,migrate,reset}.ts` wrap drizzle-kit.

## Data model landmarks

- `areas` → `stores` (`storeNo` = the BC/POS code, e.g. `FF001`; keep separate from `name`).
- `users` (`nik` unique, `homeStoreId`, `areaId`) → `user_store_assignments` (assignment history; the schedule template roster reads this).
- Schedule: `monthly_schedules` (per store/`yearMonth`) → `monthly_schedule_entries` (per employee/day, OFF & leave included) → `schedules` (materialised working days only — `shiftId` NOT NULL).
- `shifts` (`code` in `morning` / `evening` / `full_day` — stable; hours/breaks/accent live here).
- `shift_tasks` maps `shifts` → `task_definitions` (which task types a shift expects). Per-task tables in `lib/db/schema/tasks.ts`.
- Targets: `store_monthly_targets` (Ops sets one number) + `employee_monthly_targets` (fixed monthly %, `isPercentageOverridden` locks it) + `target_allocation_templates` (default % by headcount). Logic in `lib/performance/target-utils.ts`.
- `item_transfer_orders` — 3-phase (Item Return → Shipping → Item Receiving) BC-driven pipeline.

## Conventions

- **Dates for day-buckets** (schedules, attendance, task `date`): store **UTC midnight of the calendar day**. Drizzle's `timestamp` column serialises via `.toISOString()`, so build these as `new Date(Date.UTC(y, m, d))`, and read "today" via `todayInStoreTimezone()` in `lib/schedule-utils.ts` (Asia/Jakarta calendar date → `new Date(y,m-1,d)`, = UTC midnight on the prod server). Real timestamps (`checkInTime`, …) use plain `new Date()`.
- Neon-HTTP-safe DB style (a holdover): avoid `db.transaction()`; prefer `onConflictDo*` + batched inserts over SELECT-then-INSERT; keep `IN (...)` lists well under the Postgres 65535-param limit.
- Money is stored as integer Rupiah in `decimal`/`text` columns; format with `toLocaleString('id-ID')`.
- User-facing strings are Indonesian. Server/log strings and code are English.
- Route handlers return `{ success: boolean, ... }` JSON; utils return `{ success: true, data } | { success: false, error }`.

## Commands

```bash
npm run dev                      # dev server on :3000
npm run db:generate              # new migration from lib/db/schema changes
npm run db:migrate               # apply migrations
npm run db:baseline              # mark already-satisfied migrations as applied (no SQL run); -- --dry to preview
npm run db:reset                 # DROP everything in public schema
npm run db:seed                  # seed (see scripts/seed/dataset.ts); -- --list for steps
npm run db:seed -- --only=tasks,attendance   # opt-in demo activity
npm run db:seed:prod             # production skeleton + one IT account
npx tsc --noEmit                 # type-check (must pass)
npm run lint                     # eslint (scripts/ has pre-existing `any` noise; app/ + lib/ should stay clean)
```

Run seed/migrate/probe scripts as `npx dotenv -e .env.local -- tsx <file>` (`@/lib/db` reads `DATABASE_URL` at import).

## Seed world

`scripts/seed/dataset.ts` is the single source of truth. Default `npm run db:seed` builds: areas `DKI - BALI` + `DUMMY AREA`; stores `FF001` (Fisik Football - Daan Mogot, 10 staff), `FO001` (Factory Outlet-Daan Mogot, 3 staff), `DUMMY-001` (test store, own area/Ops); back-office accounts `OPS-HO-001`, `A11040401` (Indriawan, DKI-Bali Ops), `OPS-DUMMY-001`, `FIN-001`, `IT-001`, `AUDIT-001`. All passwords `password123`. Sep 2026 targets + schedules from the "Break down target sep 2026" sheets.

## Working notes

- Don't commit or push unless asked. Branch off `main` first if you do.
- After editing `lib/db/utils/shift-lookup.ts`-cached data (shifts) via a reseed, restart the dev server.
- The hosted DB in `.env.local` is shared — `db:reset` wipes real data. Confirm before destructive DB ops.
- **Migration history got reset once** (old files deleted, `0000_lyrical_red_ghost` regenerated as a full baseline). `db:migrate` decides what to run purely by the journal `when` timestamp, so a fresh baseline looks "newer" than the DB and would re-`CREATE TABLE` everything. Fix / normal flow: edit schema → `db:generate` → review the SQL → `db:migrate`. If migration files ever get blown away again: `db:generate` (fresh baseline) → `db:baseline` (stamps every already-satisfied migration as applied without running it) → carry on. `db:baseline` is idempotent and finishes with a **column-drift report** (schema vs live DB).
- **Column drift** (a table exists but is missing a column the schema declares — e.g. `users.password_changed_at` was in the schema but never migrated, breaking every `SELECT`-whole-row on `users`): `db:generate`/`db:baseline` can't detect it (they diff snapshots, not the live DB). Fix: `npx drizzle-kit generate --custom --name sync_<thing>`, put `ALTER TABLE "x" ADD COLUMN IF NOT EXISTS "y" …` in the generated `.sql`, then `db:migrate`. `db:baseline`'s drift report lists these.
