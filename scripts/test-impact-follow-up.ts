// npx dotenv -e .env.local -- tsx scripts/test-impact-follow-up.ts
// Staging only. Every fixture and write is rolled back, including on failure.
import "./lib/not-production";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import {
  followUpPermissions,
  followUpSummary,
  followUpWeekStart,
  parseFollowUpInput,
  type FollowUpCheck,
} from "../lib/impact-visit/follow-up";
import type { ResultScope } from "../lib/db/utils/ops-impact-results";

async function main() {
  assert.equal(
    followUpWeekStart("2026-10-04T16:59:59Z").toISOString(),
    "2026-09-27T17:00:00.000Z",
  );
  assert.equal(
    followUpWeekStart("2026-10-04T17:00:00Z").toISOString(),
    "2026-10-04T17:00:00.000Z",
  );
  const check: FollowUpCheck = {
    id: 1,
    itemId: "main-1",
    status: "not_done",
    checkedAt: "2026-10-04T16:00:00.000Z",
    reviewerName: "Ops",
    note: null,
  };
  assert.equal(
    followUpSummary(["main-1"], [check], new Date("2026-10-05T01:00:00Z"))
      .dueThisWeek,
    1,
  );
  assert.equal(
    followUpSummary(
      ["main-1"],
      [{ ...check, status: "verified" }],
      new Date("2026-10-05T01:00:00Z"),
    ).dueThisWeek,
    0,
  );
  assert.equal(
    followUpSummary(
      ["main-1"],
      [{ ...check, checkedAt: "2026-10-05T01:00:00Z" }],
      new Date("2026-10-05T02:00:00Z"),
    ).dueThisWeek,
    0,
  );
  assert.equal(
    followUpSummary(
      ["main-1"],
      [check, { ...check, id: 2, status: "verified" }],
    ).verified,
    1,
  );
  for (const bad of [
    null,
    [],
    { itemId: "main-1", status: "bogus" },
    { itemId: "main-1", status: "verified", note: "x".repeat(2001) },
  ])
    assert.equal(parseFollowUpInput(bad), null);
  assert.equal(
    followUpPermissions(
      { status: "draft", visitedBy: "me", storeAreaId: 1 },
      { userId: "me", scope: "area", areaId: 1 },
    ).canReview,
    false,
  );
  console.log(
    "PASS: Jakarta weekly boundary, due/verified rules, validation, draft permissions.",
  );

  // A dedicated single-connection pool makes the imported service calls part of
  // this test transaction. No test data can be observed by the running app.
  const testPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  (globalThis as unknown as { __pgPool: Pool }).__pgPool = testPool;
  const { db } = await import("../lib/db");
  const { areas, stores, users, userRoles, impactVisits, impactVisitChecks } =
    await import("../lib/db/schema");
  const { listOpsImpactResults, getOpsImpactResult, recordImpactCheck } =
    await import("../lib/db/utils/ops-impact-results");
  const { getStoreImpactVisitResult, listStoreImpactVisitResults } =
    await import("../lib/db/utils/impact-visit-results");
  await testPool.query("BEGIN");
  try {
    const [role] = await db
      .select()
      .from(userRoles)
      .where(eq(userRoles.code, "ops"))
      .limit(1);
    assert.ok(role, "Staging must have the Ops role.");
    const [area] = await db
      .insert(areas)
      .values({ name: `Impact test ${randomUUID()}` })
      .returning();
    const [store] = await db
      .insert(stores)
      .values({
        name: "Temporary impact test",
        storeNo: randomUUID(),
        address: "Test",
        areaId: area.id,
      })
      .returning();
    const [owner, colleague] = await db
      .insert(users)
      .values(
        [0, 1].map(() => ({
          nik: randomUUID(),
          name: "Test reviewer",
          password: "disabled-test-login",
          roleId: role.id,
          areaId: area.id,
        })),
      )
      .returning();
    const ownerScope: ResultScope = {
      ok: true,
      scope: "area",
      userId: owner.id,
      areaId: area.id,
      isIt: false,
    };
    const colleagueScope: ResultScope = { ...ownerScope, userId: colleague.id };
    const hoScope: ResultScope = {
      ok: true,
      scope: "all_areas",
      userId: colleague.id,
      areaId: null,
      isIt: false,
    };
    const fixtures = await db
      .insert(impactVisits)
      .values(
        [0, 1, 2, 3].map((day) => ({
          storeId: store.id,
          visitedBy: owner.id,
          visitDate: new Date(`2026-10-0${day + 1}T03:00:00Z`),
          status: "submitted" as const,
          checklistResponses: JSON.stringify({
            "main-1": { answer: "tidak" },
            "main-2": { answer: "ya" },
          }),
          vmChecklistResponses: JSON.stringify({ "vm-1": { answer: "tidak" } }),
          checklistScore: 3,
          checklistGrade: "B",
        })),
      )
      .returning();
    const visit = fixtures[3];
    assert.equal((await listOpsImpactResults(colleagueScope)).length, 0);
    assert.equal(await getOpsImpactResult(colleagueScope, visit.id), null);
    assert.equal(
      await getOpsImpactResult({ ...ownerScope, areaId: -1 }, visit.id),
      null,
    );
    assert.equal(
      (await getOpsImpactResult(hoScope, visit.id))?.canReview,
      false,
    );
    assert.equal((await listOpsImpactResults(ownerScope)).length, 4);
    const rejectedHO = await recordImpactCheck(hoScope, visit.id, {
      itemId: "main-1",
      status: "verified",
    });
    assert.equal(rejectedHO.success, false);
    const rejectedPositive = await recordImpactCheck(ownerScope, visit.id, {
      itemId: "main-2",
      status: "verified",
    });
    assert.equal(rejectedPositive.success, false);
    assert.equal(
      (
        await recordImpactCheck(ownerScope, visit.id, {
          itemId: "vm-999",
          status: "verified",
        })
      ).success,
      false,
    );
    for (const status of ["needs_fix", "not_done", "verified"]) {
      const saved = await recordImpactCheck(ownerScope, visit.id, {
        itemId: "main-1",
        status,
        note: `Test ${status}`,
      });
      assert.ok(saved.success);
      assert.equal(saved.data?.mainNegatives[0].followUp?.status, status);
    }
    const result = await getOpsImpactResult(ownerScope, visit.id);
    assert.equal(result?.checks.length, 3);
    assert.equal(result?.followUp.verified, 1);
    assert.equal(result?.followUp.dueThisWeek, 1); // VM has not been checked.
    const employee = await getStoreImpactVisitResult(store.id, visit.id);
    assert.deepEqual(employee?.followUp, result?.followUp);
    assert.deepEqual(employee?.checks, result?.checks);
    assert.equal((await listStoreImpactVisitResults(store.id)).length, 3);
    assert.equal(
      await getStoreImpactVisitResult(store.id, fixtures[0].id),
      null,
    );
    assert.equal(await getStoreImpactVisitResult(-1, visit.id), null);
    const [unchanged] = await db
      .select()
      .from(impactVisits)
      .where(eq(impactVisits.id, visit.id));
    assert.equal(unchanged.checklistScore, visit.checklistScore);
    assert.equal(unchanged.checklistResponses, visit.checklistResponses);
    assert.equal(
      unchanged.updatedAt.toISOString(),
      visit.updatedAt.toISOString(),
    );
    await recordImpactCheck(ownerScope, visit.id, {
      itemId: "main-1",
      status: "needs_fix",
    });
    assert.equal(
      (await getOpsImpactResult(ownerScope, visit.id))?.followUp.verified,
      0,
    );
    await db.delete(impactVisits).where(eq(impactVisits.id, visit.id));
    assert.equal(
      (
        await db
          .select()
          .from(impactVisitChecks)
          .where(eq(impactVisitChecks.visitId, visit.id))
      ).length,
      0,
    );
    console.log(
      "PASS: creator/area/HO access, positive-point rejection, three statuses, timeline, reopen, employee latest-three visibility, immutable scores, cascade cleanup.",
    );
  } finally {
    await testPool.query("ROLLBACK");
    await testPool.end();
  }
  console.log("All integration fixtures rolled back.");
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Test failed");
  process.exitCode = 1;
});
