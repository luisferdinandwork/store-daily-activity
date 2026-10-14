# Visit Toko

- Ops mobile: **Visit Toko** → choose a store → answer the checklist → capture photos → validate location and submit. Ops Area is restricted to its assigned PRISM area. HO monitors all stores; IT can also exercise the flow.
- IT: **Configuration → Pengaturan Visit** (`/it/store-visits`). Add, rename, reorder, or remove checklist tasks; require a photo per task; edit each store's category, city, reference manager, interval, and minimum number of visits.
- Store photo and geotag are always mandatory. Each photo includes capture coordinates, accuracy, and time. Submission rechecks a fresh GPS fix against the store geofence. Missing store coordinates block submission. Photos expire after 30 minutes, submission GPS after 2 minutes, and GPS accuracy must be at most 100 m. The existing geofence noise allowance applies.
- Submitted visits preserve their checklist snapshot and evidence. Changes to IT settings do not rewrite history. A retry uses the same visit ID to avoid duplicate records. Visits are immutable; no delete/edit action is exposed.
- Obligations count distinct WIB calendar days in the trailing interval, including today. Example: a visit on October 12 satisfies a 7-day policy through October 18; another visit is due October 19. Repeated visits on one day count once. Missing history shows “Perlu visit”. Stores without a policy can still record visits but do not have an obligation until IT configures one.
- Initial source: `JADWAL VISIT.xlsx`, Sheet1 A2:G46; preserved in `lib/store-visit/schedule-source.json`. 30 stores in city: 1 visit / 7 days. Out of city: 8 stores at 1 / 60 days, 7 at 1 / 90 days. Manager names are reference data, not authorization rules. A code missing from PRISM remains visible to IT and matches automatically if that store code is later added. Store coordinates and area assignments are not inferred from the Excel.
- This simple visit workflow is independent of the scored Impact Visit reports and follow-ups; those remain at `/ops/impact-visits`.

Migration `0033_clean_jamie_braddock` adds three tables and inserts the initial checklist/policies. Run staging migration before testing. For production follow the repository staging → production migration flow before code deployment.

Checks: `npx tsc --noEmit`, `npx tsx scripts/test-store-visit-rules.ts`; staging API checks: `npx dotenv -e .env.local -- tsx scripts/test-store-visit-api.ts`. API checks use existing test accounts, avoid updating settings, and clean up only their own visit evidence.
