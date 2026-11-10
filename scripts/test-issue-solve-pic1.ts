// scripts/test-issue-solve-pic1.ts
//
// Any PIC 1 of a store can "Mark as Solved" that store's issues — not only the
// employee who reported it (so an issue never gets stuck when its reporter is
// removed or moved). Runs on STAGING with disposable test data:
//   - the DUMMY-001 store + test users/issues named "[ISSUE-TEST]" (removed again),
//   - one disposable fixture store for the "PIC 1 of another store" case.
// The test issues have NO role assignments, so Ops/Finance/IT are never notified
// or e-mailed. It refuses to run against production.
//
//   npm run test:issue-solve-pic1                       # rules + DB checks
//   ISSUE_TEST_URL=http://localhost:3000 npm run test:issue-solve-pic1
//                                                       # + the real API over HTTP
//                                                       #   (the server must use the SAME database)

import './lib/not-production';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq, inArray, like } from 'drizzle-orm';

import { db, pool } from '@/lib/db';
import { areas, employeeTypes, issues, notifications, stores, userRoles, users } from '@/lib/db/schema';
import {
  computeIssuePermissionFlags,
  getOperationIssueRoleIds,
  isStorePic1,
} from '@/lib/db/utils/issues';

const MARK = '[ISSUE-TEST]';
const baseUrl = process.env.ISSUE_TEST_URL?.replace(/\/$/, '');
const PASSWORD = 'IssueTest-123';

let checks = 0;
const check = (label: string, value: unknown, expected: unknown) => {
  assert.deepEqual(value, expected, label);
  checks++;
  console.log(`PASS ${label}`);
};

type Account = { id: string; nik: string };
const createdUserIds: string[] = [];
const createdIssueIds: number[] = [];
let fixtureStoreId: number | undefined;

async function cleanup() {
  if (createdIssueIds.length) await db.delete(issues).where(inArray(issues.id, createdIssueIds));
  await db.delete(notifications).where(like(notifications.title, `%${MARK}%`));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  if (fixtureStoreId) await db.delete(stores).where(eq(stores.id, fixtureStoreId));
}

async function run() {
  const [dummy] = await db.select().from(stores).where(eq(stores.storeNo, 'DUMMY-001')).limit(1);
  assert.ok(dummy, 'DUMMY-001 store not found — run `npm run db:seed` on staging first');

  const [area] = await db.select().from(areas).where(eq(areas.id, dummy.areaId)).limit(1);
  const [employeeRole] = await db.select().from(userRoles).where(eq(userRoles.code, 'employee'));
  const types = new Map((await db.select().from(employeeTypes)).map((t) => [t.code, t.id]));
  const opsRoleId = (await getOperationIssueRoleIds())[0];
  const hash = await bcrypt.hash(PASSWORD, 10);

  // A second, disposable store for "a PIC 1 of ANOTHER store".
  const [other] = await db
    .insert(stores)
    .values({ storeNo: `ISSUETEST-${randomUUID().slice(0, 8)}`, name: `${MARK} other store`, address: 'Test only', areaId: area.id })
    .returning();
  fixtureStoreId = other.id;

  const makeUser = async (label: string, type: string, storeId: number): Promise<Account> => {
    const id = randomUUID();
    const nik = `ISSUETEST-${label}-${id.slice(0, 6)}`;
    await db.insert(users).values({
      id, nik, name: `${MARK} ${label}`, password: hash,
      roleId: employeeRole.id, employeeTypeId: types.get(type)!, homeStoreId: storeId, areaId: dummy.areaId,
    });
    createdUserIds.push(id);
    return { id, nik };
  };

  const reporter = await makeUser('reporter', 'sa', dummy.id);
  const pic1 = await makeUser('pic1', 'pic_1', dummy.id);
  const pic2 = await makeUser('pic2', 'pic_2', dummy.id);
  const sa = await makeUser('sa', 'sa', dummy.id);
  const pic1Other = await makeUser('pic1-other-store', 'pic_1', other.id);
  const leaver = await makeUser('leaver', 'sa', dummy.id); // will be removed (hidden stub)
  const mover = await makeUser('mover', 'sa', dummy.id); // will be moved to another store

  const newIssue = async (userId: string, status: 'draft' | 'reported' | 'in_review', label: string) => {
    const [row] = await db
      .insert(issues)
      .values({
        title: `${MARK} ${label}`, description: 'Test issue, removed after the run.',
        userId, storeId: dummy.id, assignedToRoleId: opsRoleId, status,
        createdAt: new Date(), updatedAt: new Date(),
      })
      .returning();
    createdIssueIds.push(row.id);
    return row;
  };

  const inReview = await newIssue(reporter.id, 'in_review', 'in review');
  const reported = await newIssue(reporter.id, 'reported', 'reported (locked)');
  const draft = await newIssue(reporter.id, 'draft', 'private draft');
  const ownByPic1 = await newIssue(pic1.id, 'in_review', 'own by pic1');
  const orphan = await newIssue(leaver.id, 'in_review', 'reporter removed');
  const moved = await newIssue(mover.id, 'in_review', 'reporter moved');

  // ── 1. Rules (pure) ───────────────────────────────────────────────────────────
  const viewerPic1 = { employeeType: 'pic_1', homeStoreId: dummy.id };
  check('isStorePic1: pic_1 of that store', isStorePic1(viewerPic1, dummy.id), true);
  check('isStorePic1: string homeStoreId is accepted', isStorePic1({ employeeType: 'pic_1', homeStoreId: String(dummy.id) }, dummy.id), true);
  check('isStorePic1: pic_1 of another store', isStorePic1(viewerPic1, other.id), false);
  check('isStorePic1: pic_2', isStorePic1({ employeeType: 'pic_2', homeStoreId: dummy.id }, dummy.id), false);
  check('isStorePic1: sa', isStorePic1({ employeeType: 'sa', homeStoreId: dummy.id }, dummy.id), false);
  check('isStorePic1: no store', isStorePic1({ employeeType: 'pic_1', homeStoreId: null }, dummy.id), false);
  check('isStorePic1: no type', isStorePic1({ homeStoreId: dummy.id }, dummy.id), false);

  const flags = (issue: typeof inReview, userId: string, isPic1: boolean) =>
    computeIssuePermissionFlags(issue, userId, { sameStore: true, isStorePic1: isPic1 });
  const solveFlags = (f: ReturnType<typeof flags>) => ({ can: f.canMarkSolved, show: f.showMarkSolved });

  check('Reporter, In Review: can solve', solveFlags(flags(inReview, reporter.id, false)), { can: true, show: true });
  check('PIC 1 (not reporter), In Review: can solve', solveFlags(flags(inReview, pic1.id, true)), { can: true, show: true });
  check('PIC 1, Reported: shown but locked', solveFlags(flags(reported, pic1.id, true)), { can: false, show: true });
  check('PIC 1 never sees solve on someone\'s draft', solveFlags(flags(draft, pic1.id, true)), { can: false, show: false });
  check('Other employee (not PIC 1): no solve', solveFlags(flags(inReview, sa.id, false)), { can: false, show: false });
  const pic1Flags = flags(inReview, pic1.id, true);
  check('PIC 1 gains no edit / send / delete / BA on a colleague\'s issue',
    [pic1Flags.canEdit, pic1Flags.canSendToOps, pic1Flags.canDelete, pic1Flags.canUploadBa], [false, false, false, false]);
  const draftFlags = flags(draft, pic1.id, true);
  check('PIC 1 gains no edit / send / delete on a colleague\'s draft',
    [draftFlags.canEdit, draftFlags.canSendToOps, draftFlags.canDelete], [false, false, false]);

  // The reporter is removed (hidden stub) / moved to another store — the issue stays in the issue's store.
  await db.update(users).set({ isActive: false, deletedAt: new Date(), nik: `${leaver.nik}~deleted~${leaver.id.slice(0, 8)}` }).where(eq(users.id, leaver.id));
  await db.update(users).set({ homeStoreId: other.id }).where(eq(users.id, mover.id));

  if (!baseUrl) {
    console.log('\n(ISSUE_TEST_URL not set — skipping the HTTP checks.)');
    console.log(`\n${checks} checks passed.`);
    return;
  }

  // ── 2. The real API over HTTP ─────────────────────────────────────────────────
  type Client = (path: string, init?: { method?: string; body?: unknown }) => Promise<{ status: number; body: any }>;
  const login = async (account: Account): Promise<Client> => {
    const cookies = new Map<string, string>();
    const request: Client = async (path, init = {}) => {
      const headers = new Headers({ Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') });
      if (init.body !== undefined) headers.set('Content-Type', 'application/json');
      const res = await fetch(`${baseUrl}${path}`, {
        method: init.method ?? 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(60_000),
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      for (const cookie of res.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const at = pair.indexOf('=');
        cookies.set(pair.slice(0, at), pair.slice(at + 1));
      }
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const csrf = await request('/api/auth/csrf');
    const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded', Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') });
    const res = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
      method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(60_000),
      body: new URLSearchParams({ csrfToken: csrf.body.csrfToken, nik: account.nik, password: PASSWORD, json: 'true', callbackUrl: `${baseUrl}/employee` }),
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const at = pair.indexOf('=');
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const session = await request('/api/auth/session');
    assert.equal(session.body.user?.id, account.id, `Could not sign in as ${account.nik} — is ISSUE_TEST_URL using the same database?`);
    return request;
  };

  const asReporter = await login(reporter);
  const asPic1 = await login(pic1);
  const asPic2 = await login(pic2);
  const asSa = await login(sa);
  const asPic1Other = await login(pic1Other);
  const asMover = await login(mover);

  const patch = (c: Client, id: number, body: unknown) => c(`/api/employee/issues/${id}`, { method: 'PATCH', body });
  const byId = (list: any[], id: number) => list.find((i) => i.id === String(id));

  // GET — a PIC 1 sees colleagues' + removed/moved reporters' issues with the button.
  const pic1List = (await asPic1('/api/employee/issues')).body.issues as any[];
  check('PIC 1 list: sees the colleague\'s In Review issue', Boolean(byId(pic1List, inReview.id)), true);
  check('PIC 1 list: In Review → Mark as Solved enabled',
    [byId(pic1List, inReview.id).showMarkSolved, byId(pic1List, inReview.id).canMarkSolved, byId(pic1List, inReview.id).isOwner], [true, true, false]);
  check('PIC 1 list: Reported → button shown but locked',
    [byId(pic1List, reported.id).showMarkSolved, byId(pic1List, reported.id).canMarkSolved], [true, false]);
  check('PIC 1 list: removed reporter\'s issue is there and solvable', byId(pic1List, orphan.id)?.canMarkSolved, true);
  check('PIC 1 list: moved reporter\'s issue is there and solvable', byId(pic1List, moved.id)?.canMarkSolved, true);
  check('PIC 1 list: a colleague\'s draft stays hidden', Boolean(byId(pic1List, draft.id)), false);
  check('PIC 1 list: gets no edit/send/delete on others\' issues',
    [byId(pic1List, inReview.id).canEdit, byId(pic1List, inReview.id).canSendToOps, byId(pic1List, inReview.id).canDelete], [false, false, false]);

  const pic2List = (await asPic2('/api/employee/issues')).body.issues as any[];
  check('PIC 2 list: sees the issue, no solve button', [Boolean(byId(pic2List, inReview.id)), byId(pic2List, inReview.id)?.showMarkSolved], [true, false]);
  const saList = (await asSa('/api/employee/issues')).body.issues as any[];
  check('SA list: sees the issue, no solve button', [Boolean(byId(saList, inReview.id)), byId(saList, inReview.id)?.showMarkSolved], [true, false]);
  const otherList = (await asPic1Other('/api/employee/issues')).body.issues as any[];
  check('PIC 1 of another store does not see this store\'s issues', Boolean(byId(otherList, inReview.id)), false);

  // PATCH — server-side enforcement.
  check('PIC 2 cannot solve (403)', (await patch(asPic2, inReview.id, { status: 'solved' })).status, 403);
  check('SA cannot solve (403)', (await patch(asSa, inReview.id, { status: 'solved' })).status, 403);
  check('PIC 1 of another store cannot solve (403)', (await patch(asPic1Other, inReview.id, { status: 'solved' })).status, 403);
  check('PIC 1: still locked until In Review (409)', (await patch(asPic1, reported.id, { status: 'solved' })).status, 409);
  check('PIC 1 cannot touch a colleague\'s draft (404)', (await patch(asPic1, draft.id, { status: 'solved' })).status, 404);
  check('PIC 1 cannot send a colleague\'s draft (404)', (await patch(asPic1, draft.id, { status: 'reported' })).status, 404);
  check('PIC 1 cannot edit a colleague\'s issue (403)', (await patch(asPic1, inReview.id, { title: 'hijacked title' })).status, 403);
  check('PIC 1 cannot edit while solving (403)', (await patch(asPic1, inReview.id, { status: 'solved', title: 'hijacked title' })).status, 403);
  check('PIC 1 cannot upload the reporter\'s Berita Acara (403)', (await patch(asPic1, inReview.id, { baAttachmentUrls: ['x.jpg'] })).status, 403);
  check('PIC 1 cannot move a status other than solved (403)', (await patch(asPic1, inReview.id, { status: 'reported' })).status, 403);
  check('PIC 1 cannot delete a colleague\'s issue (403)',
    (await asPic1(`/api/employee/issues/${inReview.id}`, { method: 'DELETE' })).status, 403);
  check('Nothing changed by the refused calls',
    (await db.select().from(issues).where(eq(issues.id, inReview.id)))[0].status, 'in_review');

  const solvedByPic1 = await patch(asPic1, inReview.id, { status: 'solved' });
  check('PIC 1 solves a colleague\'s In Review issue (200)', [solvedByPic1.status, solvedByPic1.body.issue?.status], [200, 'solved']);
  const [afterPic1] = await db.select().from(issues).where(eq(issues.id, inReview.id));
  check('…recorded as solved by the PIC 1', [afterPic1.status, afterPic1.solvedBy, afterPic1.solvedAt != null], ['solved', pic1.id, true]);
  check('…and the button is gone afterwards', solvedByPic1.body.issue?.canMarkSolved, false);
  check('PIC 1 cannot solve it twice (409)', (await patch(asPic1, inReview.id, { status: 'solved' })).status, 409);

  check('PIC 1 solves an issue whose reporter was removed', (await patch(asPic1, orphan.id, { status: 'solved' })).body.issue?.status, 'solved');
  check('PIC 1 solves an issue whose reporter moved away', (await patch(asPic1, moved.id, { status: 'solved' })).body.issue?.status, 'solved');

  // The reporter keeps the right (including after moving store), a PIC 1 solving their own issue works too.
  await db.update(issues).set({ status: 'in_review' }).where(eq(issues.id, reported.id));
  check('The reporter still solves their own issue', (await patch(asReporter, reported.id, { status: 'solved' })).body.issue?.status, 'solved');
  await db.update(issues).set({ status: 'in_review', solvedBy: null, solvedAt: null }).where(eq(issues.id, moved.id));
  check('A reporter who moved still solves their own old issue', (await patch(asMover, moved.id, { status: 'solved' })).body.issue?.status, 'solved');
  check('PIC 1 solves their own issue', (await patch(asPic1, ownByPic1.id, { status: 'solved' })).body.issue?.status, 'solved');

  console.log(`\n${checks} checks passed.`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      console.error('Cleanup failed — remove rows named "[ISSUE-TEST]" by hand:', error);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  });
