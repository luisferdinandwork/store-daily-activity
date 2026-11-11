// scripts/test-store-closing-hold.ts
// Checks for the Store Closing "On Hold" setup (lib/store-closing-hold.ts + lib/db/utils/store-closing-hold.ts).
//   npm run test:store-closing-hold
//
// Part 1 is pure (no DB): reason / category rules, template validation, rendering.
// Part 2 uses the staging DB (refuses production): category + default-template CRUD, with
// throwaway "ZZ TEST …" categories that are removed again and the stored template restored.

import './lib/not-production';

import assert from 'node:assert/strict';

import {
  DEFAULT_HOLD_DESCRIPTION_TEMPLATE,
  DEFAULT_HOLD_TITLE_TEMPLATE,
  HOLD_NO_CATEGORY_LABEL,
  HOLD_PLACEHOLDERS,
  HOLD_SAMPLE_VARS,
  STARTER_HOLD_CATEGORIES,
  buildHoldIssueText,
  holdCategoryProblem,
  holdPlaceholdersUsed,
  holdReasonProblem,
  holdTemplateProblem,
  renderHoldTemplate,
  type HoldVars,
} from '../lib/store-closing-hold';

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
};
const okAsync = async (name: string, fn: () => Promise<void>) => {
  await fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
};

const VARS: HoldVars = {
  store: 'Dummy Store',
  storeCode: 'DUMMY-001',
  date: '09 Oktober 2026',
  category: 'Selisih nominal EDC',
  reason: 'Testing alasan onhold',
  employee: 'Budi',
};

// ─── Part 1 · pure ───────────────────────────────────────────────────────────

console.log('The reason');
ok('empty / blank → asked for', () => {
  assert.ok(holdReasonProblem(''));
  assert.ok(holdReasonProblem('   '));
  assert.ok(holdReasonProblem(undefined));
});
ok('too short and too long are refused, a real sentence passes', () => {
  assert.ok(holdReasonProblem('terlalu'));
  assert.ok(holdReasonProblem('x'.repeat(1001)));
  assert.equal(holdReasonProblem('Selisih nominal EDC BCA'), null);
});

console.log('\nThe category');
const active = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
ok('with active categories one must be picked', () => {
  assert.ok(holdCategoryProblem(null, active));
  assert.ok(holdCategoryProblem(undefined, active));
});
ok('a category that is not (or no longer) active is refused', () => {
  assert.ok(holdCategoryProblem(99, active));
  assert.equal(holdCategoryProblem(2, active), null);
});
ok('with no active category nothing is asked (IT has not set any up)', () => {
  assert.equal(holdCategoryProblem(null, []), null);
  assert.equal(holdCategoryProblem(5, []), null);
});

console.log('\nTemplate validation');
ok('the built-in templates are valid', () => {
  assert.equal(holdTemplateProblem('title', DEFAULT_HOLD_TITLE_TEMPLATE), null);
  assert.equal(holdTemplateProblem('description', DEFAULT_HOLD_DESCRIPTION_TEMPLATE), null);
});
ok('every starter category description is valid', () => {
  for (const c of STARTER_HOLD_CATEGORIES) {
    if (c.description) assert.equal(holdTemplateProblem('description', c.description), null, c.name);
  }
});
ok('a description without {{reason}} is refused (it would drop what the employee wrote)', () => {
  assert.match(holdTemplateProblem('description', 'Toko {{store}} On Hold.') ?? '', /\{\{reason\}\}/);
});
ok('{{ reason }} with spaces still counts', () => {
  assert.equal(holdTemplateProblem('description', 'Alasan: {{ reason }}'), null);
});
ok('an unknown placeholder is refused and named', () => {
  const p = holdTemplateProblem('description', '{{reason}} {{nope}} {{alsoNope}}') ?? '';
  assert.match(p, /\{\{nope\}\}/);
  assert.match(p, /\{\{alsoNope\}\}/);
});
ok('blank, too long and multi-line titles are refused', () => {
  assert.ok(holdTemplateProblem('title', '   '));
  assert.ok(holdTemplateProblem('title', 'x'.repeat(121)));
  assert.ok(holdTemplateProblem('title', 'baris 1\nbaris 2'));
  assert.equal(holdTemplateProblem('title', 'Open Statement - {{store}}'), null);
});
ok('a description over the limit is refused', () => {
  assert.ok(holdTemplateProblem('description', `{{reason}} ${'x'.repeat(1000)}`));
});

console.log('\nRendering');
ok('every placeholder in the list is filled', () => {
  const all = HOLD_PLACEHOLDERS.map((p) => `{{${p.name}}}`).join(' | ');
  const out = renderHoldTemplate(all, VARS);
  assert.ok(!out.includes('{{'));
  assert.equal(out.split(' | ').length, HOLD_PLACEHOLDERS.length);
});
ok('the default description renders with the reason and category, nothing left over', () => {
  const out = renderHoldTemplate(DEFAULT_HOLD_DESCRIPTION_TEMPLATE, VARS);
  assert.ok(out.includes('Dummy Store'));
  assert.ok(out.includes('09 Oktober 2026'));
  assert.ok(out.includes('Kategori: Selisih nominal EDC'));
  assert.ok(out.includes('Alasan dari employee: Testing alasan onhold'));
  assert.ok(!out.includes('{{'));
});
ok('a value that itself contains {{x}} is not expanded again', () => {
  const out = renderHoldTemplate('Alasan: {{reason}}', { ...VARS, reason: 'lihat {{store}}' });
  assert.equal(out, 'Alasan: lihat {{store}}');
});
ok('placeholders with spaces inside the braces are filled; unknown ones are left as typed', () => {
  assert.equal(renderHoldTemplate('{{ store }} / {{x}}', VARS), 'Dummy Store / {{x}}');
});
ok('holdPlaceholdersUsed lists each name once', () => {
  assert.deepEqual(holdPlaceholdersUsed('{{store}} {{reason}} {{store}}').sort(), ['reason', 'store']);
});

console.log('\nWhich description is used');
const base = { titleTemplate: DEFAULT_HOLD_TITLE_TEMPLATE, descriptionTemplate: DEFAULT_HOLD_DESCRIPTION_TEMPLATE, vars: VARS };
ok('no category description → the default one', () => {
  const r = buildHoldIssueText({ ...base, categoryDescription: null });
  assert.equal(r.title, 'Open Statement Tertunda - Dummy Store - 09 Oktober 2026');
  assert.ok(r.description.startsWith('Issue otomatis dari task Store Closing untuk toko Dummy Store'));
});
ok('a blank category description counts as none', () => {
  const r = buildHoldIssueText({ ...base, categoryDescription: '   ' });
  assert.ok(r.description.startsWith('Issue otomatis'));
});
ok("a category's own description wins over the default, the title still comes from the default", () => {
  const r = buildHoldIssueText({ ...base, categoryDescription: 'Khusus {{category}}: {{reason}}' });
  assert.equal(r.description, 'Khusus Selisih nominal EDC: Testing alasan onhold');
  assert.equal(r.title, 'Open Statement Tertunda - Dummy Store - 09 Oktober 2026');
});
ok('the title is one tidy line even if a value has line breaks', () => {
  const r = buildHoldIssueText({ ...base, vars: { ...VARS, store: 'Dummy\nStore' } });
  assert.ok(!/[\r\n]/.test(r.title));
});
ok('no category → the placeholder says so', () => {
  const r = buildHoldIssueText({ ...base, vars: { ...VARS, category: HOLD_NO_CATEGORY_LABEL } });
  assert.ok(r.description.includes(`Kategori: ${HOLD_NO_CATEGORY_LABEL}`));
});
ok('sample vars (the IT preview) cover every placeholder', () => {
  for (const p of HOLD_PLACEHOLDERS) assert.ok(HOLD_SAMPLE_VARS[p.name as keyof HoldVars]);
});

// ─── Part 2 · DB (staging) ───────────────────────────────────────────────────

async function dbPart() {
  const {
    createHoldCategory,
    deleteHoldCategory,
    getHoldTemplate,
    listActiveHoldCategories,
    listHoldCategoriesAdmin,
    reorderHoldCategories,
    resetHoldTemplate,
    saveHoldTemplate,
    updateHoldCategory,
  } = await import('../lib/db/utils/store-closing-hold');
  const { db } = await import('../lib/db');
  const { users } = await import('../lib/db/schema');

  console.log('\nCategories + template in the database (staging)');

  const [it] = await db.select({ id: users.id }).from(users).limit(1);
  assert.ok(it, 'needs at least one user for updated_by');

  const originalTemplate = await getHoldTemplate();
  const created: number[] = [];
  const mine = <T extends { name: string }>(rows: T[]) => rows.filter((r) => r.name.startsWith('ZZ TEST'));

  try {
    await okAsync('create: name is trimmed / collapsed, description blank → null (default text)', async () => {
      const r = await createHoldCategory({ name: '  ZZ TEST   Selisih ', description: '   ' });
      assert.ok(r.success);
      if (!r.success) return;
      created.push(r.data.id);
      assert.equal(r.data.name, 'ZZ TEST Selisih');
      assert.equal(r.data.description, null);
      assert.equal(r.data.isActive, true);
    });

    await okAsync('create: a second one with its own description goes to the end', async () => {
      const r = await createHoldCategory({ name: 'ZZ TEST Sistem', description: 'Sistem down: {{reason}}' });
      assert.ok(r.success);
      if (!r.success) return;
      created.push(r.data.id);
      const list = mine(await listHoldCategoriesAdmin());
      assert.deepEqual(list.map((c) => c.name), ['ZZ TEST Selisih', 'ZZ TEST Sistem']);
    });

    await okAsync('create: a duplicate name (any case) is refused', async () => {
      const r = await createHoldCategory({ name: 'zz test SELISIH' });
      assert.equal(r.success, false);
    });

    await okAsync('create: a description without {{reason}}, or with an unknown placeholder, is refused', async () => {
      assert.equal((await createHoldCategory({ name: 'ZZ TEST Bad1', description: 'tanpa alasan' })).success, false);
      assert.equal((await createHoldCategory({ name: 'ZZ TEST Bad2', description: '{{reason}} {{x}}' })).success, false);
    });

    await okAsync('update: edit the description, rename, clear it back to the default', async () => {
      const [a] = created;
      const edit = await updateHoldCategory(a, { description: 'Baru: {{reason}}' });
      assert.ok(edit.success && edit.data.description === 'Baru: {{reason}}');
      const rename = await updateHoldCategory(a, { name: 'ZZ TEST Selisih 2' });
      assert.ok(rename.success && rename.data.name === 'ZZ TEST Selisih 2');
      const clear = await updateHoldCategory(a, { description: '' });
      assert.ok(clear.success && clear.data.description === null);
    });

    await okAsync('update: renaming onto another name is refused', async () => {
      const r = await updateHoldCategory(created[0], { name: 'ZZ TEST Sistem' });
      assert.equal(r.success, false);
    });

    await okAsync('hiding a category takes it off the employee list but keeps it for IT', async () => {
      const hide = await updateHoldCategory(created[1], { isActive: false });
      assert.ok(hide.success);
      assert.ok(!mine(await listActiveHoldCategories()).some((c) => c.name === 'ZZ TEST Sistem'));
      assert.ok(mine(await listHoldCategoriesAdmin()).some((c) => c.name === 'ZZ TEST Sistem' && !c.isActive));
      await updateHoldCategory(created[1], { isActive: true });
      assert.ok(mine(await listActiveHoldCategories()).some((c) => c.name === 'ZZ TEST Sistem'));
    });

    await okAsync('reorder: the new order is what the employee list shows; a stale id list is refused', async () => {
      const all = (await listHoldCategoriesAdmin()).map((c) => c.id);
      const swapped = [...all];
      const i = swapped.indexOf(created[0]);
      const j = swapped.indexOf(created[1]);
      [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
      assert.ok((await reorderHoldCategories(swapped)).success);
      assert.deepEqual(mine(await listActiveHoldCategories()).map((c) => c.name), ['ZZ TEST Sistem', 'ZZ TEST Selisih 2']);
      assert.equal((await reorderHoldCategories(all.slice(1))).success, false);
      assert.equal((await reorderHoldCategories([])).success, false);
    });

    await okAsync('default template: save, read back, bad text refused, reset to the built-in text', async () => {
      const saved = await saveHoldTemplate(it.id, { title: 'Hold {{store}}', description: 'Alasan {{reason}} ({{category}})' });
      assert.ok(saved.success && saved.data.isCustom && saved.data.title === 'Hold {{store}}');
      assert.equal((await saveHoldTemplate(it.id, { title: 'ok', description: 'tanpa alasan' })).success, false);
      assert.equal((await saveHoldTemplate(it.id, { title: '', description: '{{reason}}' })).success, false);
      assert.equal((await getHoldTemplate()).description, 'Alasan {{reason}} ({{category}})');
      const reset = await resetHoldTemplate();
      assert.ok(reset.success && !reset.data.isCustom);
      assert.equal(reset.success && reset.data.title, DEFAULT_HOLD_TITLE_TEMPLATE);
      assert.equal(reset.success && reset.data.description, DEFAULT_HOLD_DESCRIPTION_TEMPLATE);
    });

    await okAsync('delete: gone for good, a missing id is reported', async () => {
      const id = created.pop()!;
      assert.ok((await deleteHoldCategory(id)).success);
      assert.equal((await deleteHoldCategory(id)).success, false);
    });
  } finally {
    for (const id of created) await deleteHoldCategory(id);
    // Put back whatever IT had saved before this ran.
    if (originalTemplate.isCustom) {
      await saveHoldTemplate(it.id, { title: originalTemplate.title, description: originalTemplate.description });
    } else {
      await resetHoldTemplate();
    }
    console.log('  (test categories removed, stored template restored)');
  }
}

dbPart()
  .then(() => {
    console.log(`\n${checks} checks passed`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
