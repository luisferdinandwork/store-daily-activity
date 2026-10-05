# CLAUDE.md

Guidance for AI assistants working in this repo. Keep this file short and current.

## What this is

**PRISM** — a store-operations platform for a sports-retail chain (Panatrade / "Fisik", "Factory Outlet"). Store staff run daily checklists, attendance, petty cash, handovers, and stock-transfer confirmations from a mobile web app; Ops/Finance/Audit/IT manage from desktop panels.

- Next.js 16 (App Router, React 19, React Compiler on), TypeScript strict.
- Postgres via **Drizzle ORM** + `pg` (node-postgres). Self-hosted DB — `DATABASE_URL` in `.env.local`.
- Auth: NextAuth (credentials). **Login is by NIK, not email.** Session user carries `id`, `role`, `employeeType`, `homeStoreId`, `areaId`.
- Deploy: VPS + PM2 + nginx (`ecosystem.config.js`, `deploy/`). Don't rely on the server's timezone — see the date convention below.
- Object storage: Biznet NOS (S3-compatible), `lib/storage.ts`. `lib/oss.ts` is legacy.
- Business Central (BC) OData integration for sales + stock transfers: `lib/bc/client.ts`, `lib/performance/business-central-*.ts`, `lib/db/utils/item-transfers.ts`.
- UI: Tailwind v4, Radix UI, `sonner` toasts, `lucide-react`. Indonesian-language user-facing copy.

## Roles & panels

| Role (`user_roles.code`) | Panel | Notes |
|---|---|---|
| `employee` | `/employee` (mobile) | `employee_types.code`: `pic_1`, `pic_2`, `sa`. PIC 1/2 also get `/pic` (view own store's schedule + Excel import only when the month has none — create/edit/delete is Ops-only since 2026-09-15 — plus team task progress). |
| `ops` | `/ops` | `employee_types.code`: `ops_ho` (all stores) or `ops_area` (own `areaId` only). |
| `finance` | `/finance` | |
| `audit` | `/audit` | |
| `it` | `/it` | Super-admin. IT-only pages live under `/it`; their APIs stay under `/api/ops/*`. Can "switch role" to preview others. |

## Layout

- `app/api/<role>/...` — route handlers, grouped by who calls them.
- `lib/db/schema/*` — Drizzle tables. `lib/db/schema/index.ts` re-exports everything + a `schema` object.
- `lib/db/utils/*` — per-task business logic (`briefing.ts`, `serah-terima.ts`, `store-opening.ts`, …). Task rows are created lazily via `getOrCreate*ForSchedule` when an employee opens the task — they don't all have to be pre-seeded.
- `lib/*` — cross-cutting helpers (`schedule-utils.ts`, `shift-tasks.ts`, `schedule-import.ts`, `performance/target-utils.ts`).
- `lib/performance/target-view.ts` — pure view logic for Ops **Performance Targets** (`/ops/performance-targets`): API types, store health bands (`on_track` / `watch` / `behind`, judged against elapsed days with today as half a day — that pace is **not shown** in the UI, Ops found it confusing), search + sort. UI lives in `components/ops/performance/*`; the list's filter/sort state in `useStoreListView`.
- `lib/user-import.ts` — IT Users bulk Excel import (`/it/users` → Import Excel). Reads the PRISM template **or** an HR roster (Employee No./Zona/Store Code/Organization Unit/Level/Status); unknown areas + stores are created (new stores default to the Daan Mogot placeholder location).
- `lib/attendance-health.ts` — the Ops **Attendance** (`/ops/attendance`) rule: rate = (present + late) ÷ (present + late + absent), **pending and leave are left out**; ≥ 90% good, 75–89% at risk, < 75% critical, plus a "many late" tier with its own colour (fuchsia). Calendar, day panel and store detail all use it. Its month API (`/api/ops/attendance/overview?month=YYYY-MM[&storeId=N]`) is **read-only**: past no-record shifts inside the auto-absent window count as absent (what the cron will record). `GET /api/ops/attendance` (store day) is *not* read-only — it runs the auto-absent / auto-checkout fixers.
- **Attendance status names are defined once.** Words live in `lib/attendance-status.ts` (`ATTENDANCE_STATUS_LABELS`, `PENDING_LABEL` = "Pending", `ON_LEAVE_LABEL` = "On leave"); look + pieces in `components/ops/AttendanceStatus.tsx` (`STATUS`, `AttendanceStatusBadge/Dot`, `AttendanceCountsLine`, `ATTENDANCE_COUNT_ITEMS`). Dashboard, Attendance, Stores and Areas all draw from them — never hand-write "hadir / belum hadir / not checked in / leave" or per-page colour maps. Counts go through `tallyStatus()` (`lib/attendance-health.ts`) so a status can't land in a different bucket per page; `/api/ops/stores` `attendanceSummary` is a full `AttendanceCounts` (`present` = on time only — use `showedUp()` for present + late).
- `components/<role>/...`, `components/ui/...`.
- `scripts/seed/*` — the dev/staging seed (see below). `scripts/{generate,migrate,reset}.ts` wrap drizzle-kit.

## Data model landmarks

- `areas` → `stores` (`storeNo` = the BC/POS code, e.g. `FF001`; keep separate from `name`).
- `users` (`nik` unique, `homeStoreId`, `areaId`) → `user_store_assignments` (assignment history; the schedule template roster reads this).
- IT "Delete user" (`lib/db/utils/user-deletion.ts`) always succeeds: personal records go (attendance, grooming, schedule, assignments, notifications, target shares); cash + shared history stays. If anything still references the user, the row becomes a hidden stub — `users.deleted_at` set, inactive, NIK renamed `<nik>~deleted~<id8>`. User lists that don't already filter `isActive`/store must add `isNull(users.deletedAt)`.
- One PIC 1 per store (the petty-cash holder) — flagged in red, not enforced (`lib/store-pic1.ts`): IT Users, Store Management, import review.
- Schedule: `monthly_schedules` (per store/`yearMonth`) → `monthly_schedule_entries` (per employee/day, OFF & leave included) → `schedules` (materialised working days only — `shiftId` NOT NULL).
- `shifts` (`code` in `morning` / `evening` / `full_day` — stable; hours/breaks/accent live here).
- **Dinas shift** (`dinas`, roster code `D`, no hours/tasks): working outside any store. Scheduling it (Ops editor or Excel `D`) auto-records `attendance.status = 'dinas'` (`recordDinasAttendance` in `lib/schedule-utils.ts`). That auto row never locks the day — `lockedByAttendance()` ignores it and schedule deletes drop it; any other attendance row still locks. Counts as On leave (excused), not in the rate.
- `shift_tasks` maps `shifts` → `task_definitions` (which task types a shift expects). Per-task tables in `lib/db/schema/tasks.ts`.
- Targets: `store_monthly_targets` (Ops sets one number) + `employee_monthly_targets` (fixed monthly %, `isPercentageOverridden` locks it) + `target_allocation_templates` (default % by headcount). Logic in `lib/performance/target-utils.ts`.
- `stores.status` (`active` / `close` / `ready_to_open`, `lib/store-status.ts` + `lib/db/utils/store-status.ts`) — only `active` stores record attendance, tasks, petty cash and appear in Ops/Finance progress rollups; `ready_to_open` is prep-only (schedules/targets, Rp 0 petty cash in Finance); change it only via `changeStoreStatus()` (IT-only; writes `store_status_history`, activation provisions petty cash; `checkStoreCloseReadiness()` is the future Audit hook). `stores.dept_code` = BC dimension code (`lib/store-dept-codes.ts`), IT + Finance views only — never return it from Ops/employee APIs.
- `item_transfer_orders` — 3-phase (Item Return → Shipping → Item Receiving) BC-driven pipeline.

## Conventions

- **Dates for day-buckets** (schedules, attendance, task `date`) are Asia/Jakarta calendar days, and the DB holds two encodings of day D: `D-1 17:00:00` (Jakarta midnight — what the app writes, ~95% of rows) and `D 00:00:00` (UTC midnight — seed scripts). Read a bucket with `jakartaDateKey()`, query a day with `jakartaDayRange()` (`lib/day-bucket.ts`); never `getUTCDate()`, `toISOString().slice(0,10)` or an exact timestamp match. "Today" = `todayInStoreTimezone()` (`lib/schedule-utils.ts`). Real timestamps (`checkInTime`, …) use plain `new Date()`; show them with `jakartaTime()`.
- Neon-HTTP-safe DB style (a holdover): avoid `db.transaction()`; prefer `onConflictDo*` + batched inserts over SELECT-then-INSERT; keep `IN (...)` lists well under the Postgres 65535-param limit.
- Money is stored as integer Rupiah in `decimal`/`text` columns; format with `toLocaleString('id-ID')`.
- User-facing strings are Indonesian. Server/log strings and code are English.
- Store pickers/filters on IT pages use the searchable `components/shared/store-combobox.tsx` (pass `modal` inside a Sheet/Dialog).
- Ops pages that browse stores/orders/visits/issues use **list rows** (`components/ops/layout/OpsList.tsx`: `OpsList` + `OpsListRow`), not multi-column card grids. KPI tiles, calendars and form fields stay grids. Their search / filter / sort bar uses `components/ops/layout/OpsToolbar.tsx` (`OpsSearchInput`, `OpsFilterSelect`, `OpsSortControl`, `OpsChipTabs`); lay rows out by container width (`@container` + `@4xl:`), not viewport — the Ops sidebar takes a quarter of the screen.
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

## Environments (staging → production)

`.env.local` holds **two** databases: `DATABASE_URL` = **staging** (the app, `db:migrate`, `db:seed`, `db:reset` all use it) and `PRODUCTION_DATABASE_URL` = production (only `scripts/migrate-prod.ts` reads it; the server has its own `.env.local` with just `DATABASE_URL`). Flow: change schema → `db:generate` → review SQL → `npm run db:migrate` (staging) → test → commit → `npm run db:migrate:prod -- --dry` → `npm run db:migrate:prod` (ships exactly the files staging already ran, in one transaction, refuses DROP/DELETE/TRUNCATE/type changes without `--allow-destructive`, rolls back if any table loses rows, you type the DB name to confirm) → deploy the code. Migrate prod *before* deploying. Destructive scripts (`db:reset`, `db:seed`, the `seed-*` one-offs) import `scripts/lib/not-production.ts` and refuse to run if `DATABASE_URL` is production. New staging DB: `npm run db:migrate && npm run db:seed:prod` (or `db:seed` for demo data).

## Seed world

`scripts/seed/dataset.ts` is the single source of truth. Default `npm run db:seed` builds: areas `DKI - BALI` + `DUMMY AREA`; stores `FF001` (Fisik Football - Daan Mogot, 10 staff), `FO001` (Factory Outlet-Daan Mogot, 3 staff), `DUMMY-001` (test store, own area/Ops); back-office accounts `OPS-HO-001`, `A11040401` (Indriawan, DKI-Bali Ops), `OPS-DUMMY-001`, `FIN-001`, `IT-001`, `AUDIT-001`. All passwords `password123`. Sep 2026 targets + schedules from the "Break down target sep 2026" sheets.

Stores/users added later (e.g. via the IT Users import) get demo activity with `npm run db:seed -- --only=roster-demo` (`scripts/seed/roster-demo.ts`): this month's schedule for everyone, attendance + task progress for past days only. It only touches stores with **no** schedule/attendance data and never FF001/FO001; `ROSTER_DEMO_DRY=1` previews, `ROSTER_DEMO_ONLY=FF002,…` limits stores. `--only=roster-demo-performance` adds dummy monthly targets (sized from each store's real Business Central run-rate; actual sales are never stored locally — they're read live from BC by store code + NIK).

## Working notes

- Don't commit or push unless asked. Branch off `main` first if you do.
- After editing `lib/db/utils/shift-lookup.ts`-cached data (shifts) via a reseed, restart the dev server.
- The hosted DB in `.env.local` is shared — `db:reset` wipes real data. Confirm before destructive DB ops.
- **Migration history got reset once** (old files deleted, `0000_lyrical_red_ghost` regenerated as a full baseline). `db:migrate` decides what to run purely by the journal `when` timestamp, so a fresh baseline looks "newer" than the DB and would re-`CREATE TABLE` everything. Fix / normal flow: edit schema → `db:generate` → review the SQL → `db:migrate`. If migration files ever get blown away again: `db:generate` (fresh baseline) → `db:baseline` (stamps every already-satisfied migration as applied without running it) → carry on. `db:baseline` is idempotent and finishes with a **column-drift report** (schema vs live DB).
- **Column drift** (a table exists but is missing a column the schema declares — e.g. `users.password_changed_at` was in the schema but never migrated, breaking every `SELECT`-whole-row on `users`): `db:generate`/`db:baseline` can't detect it (they diff snapshots, not the live DB). Fix: `npx drizzle-kit generate --custom --name sync_<thing>`, put `ALTER TABLE "x" ADD COLUMN IF NOT EXISTS "y" …` in the generated `.sql`, then `db:migrate`. `db:baseline`'s drift report lists these.
