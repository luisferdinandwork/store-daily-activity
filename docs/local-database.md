# Local PostgreSQL for PRISM

PostgreSQL 17.11 is installed for this Windows user under
`%LOCALAPPDATA%\PRISM\postgresql` using the [EDB Windows binaries](https://www.enterprisedb.com/download-postgresql-binaries).
The data directory is `data`, and the server log is `postgresql.log` in that directory's parent.
It listens only on `127.0.0.1:5432` and uses password authentication.

`.env.local` contains `LOCAL_DATABASE_URL` for `prism_local` and an identical,
active `DATABASE_URL`. The previous staging URL is commented out; the production
URL is preserved. The app and migration/seed commands use `DATABASE_URL`.
Keep `.env.local` private. A localhost URL is machine-specific and must not be deployed to the VPS.

After restarting Windows, start the database before the app:

```powershell
npm run db:local:start
npm run dev
```

Check connectivity with `npm run db:check`, inspect the process with
`npm run db:local:status`, or stop it with `npm run db:local:stop`.
This installation runs as your user, rather than a Windows system service.

The local database contains the repository's September 2026 seed: FF001, FO001,
DUMMY-001, their staff, Ops/Finance/IT/Audit accounts, schedules, targets and petty cash.
October schedules and targets are adapted from September; sample attendance and
task activity cover past days only. This is demo data, not a snapshot of the
unreachable server. Sales and stock-transfer integrations still require Business Central connectivity.

Use NIK to sign in. All seeded passwords are `password123`:

| Panel | NIK |
| --- | --- |
| IT | IT-001 |
| Ops HO | OPS-HO-001 |
| Finance | FIN-001 |
| Audit | AUDIT-001 |
| FF001 PIC 1 | A18041273 |
| FO001 PIC 1 | A201908250 |
| Dummy PIC 1 | DUMMY-PIC1 |

Seed store coordinates point at the demo locations. For a live GPS/check-in test
from your current location, use IT's store settings to update the local Dummy
Store coordinates. Database/API regression checks use disposable store fixtures.

`npm run db:seed:local` adds the current month's demo data after the standard seed.
It refuses any target other than `prism_local` on localhost. Today's check-in is
left empty for live testing, and task rows are created when the employee opens their task list.

## Setoran validation regression checks

```powershell
npm run test:setoran
# Also exercise real login, task-list, access, autosave and submit APIs:
$env:SETORAN_TEST_URL = 'http://localhost:3000'
npm run test:setoran
Remove-Item Env:SETORAN_TEST_URL
```

Checks create disposable local users and a store, then remove their records.
They cover shared tasks, checked-in duplicate schedules, late attendance,
Jakarta/UTC date encodings, carry-forward and location enforcement. They refuse
remote databases. An interrupted test's fixtures can be removed by setting
`SETORAN_TEST_CLEANUP=1` for a test run; remove that variable afterward.

Setoran defaults to location optional because bank deposits can happen outside
the store. IT's task setting still takes precedence; when enabled, both access
and submission validate the store geofence. Attendance remains required.
Network/server failures display a retryable validation message, and settings
failures are retried instead of permanently enabling GPS requirements.

No production database records were repaired or changed. Deploy the code to
apply these fixes to production; no schema migration is required for this change.
