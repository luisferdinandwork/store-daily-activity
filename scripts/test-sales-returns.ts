import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseSalesReturnQuery, salesReturnPhotos, validateSalesReturnPhotos, validateSalesReturnReceipts,
  SALES_RETURN_MAX_PHOTO_BYTES, SALES_RETURN_MAX_TOTAL_BYTES, SALES_RETURN_SORT_LABELS,
  type SalesReturnReceipts,
} from '../lib/sales-returns';

test('new receipt is required even when an old receipt was supplied', () => {
  const result = validateSalesReturnReceipts('OLD-001', '  ');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /baru wajib/);
});

test('old receipt is optional and numbers are normalized', () => {
  assert.deepEqual(validateSalesReturnReceipts('  ', ' new-001 '), {
    ok: true, oldReceiptNumber: null, newReceiptNumber: 'NEW-001',
  });
  assert.deepEqual(validateSalesReturnReceipts('old / 001', 'new / 002'), {
    ok: true, oldReceiptNumber: 'OLD/001', newReceiptNumber: 'NEW/002',
  });
});

test('supplied old receipt and required new receipt enforce POS format and length', () => {
  for (const value of ['AB', 'A'.repeat(41), 'ABC<>', '#ABC']) {
    assert.equal(validateSalesReturnReceipts(value, 'NEW-001').ok, false);
    assert.equal(validateSalesReturnReceipts('', value).ok, false);
  }
});

const photo = (name: string, size = 4) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
function photoForm(oldSize = 4, newSize = 4) {
  const form = new FormData();
  // Reverse multipart order on purpose: the labels must determine the saved roles.
  form.append('newReceiptPhoto', photo('new.jpg', newSize));
  form.append('oldReceiptPhoto', photo('old.jpg', oldSize));
  return form;
}

test('both photos are required and returned in old/new role order', () => {
  const result = validateSalesReturnPhotos(photoForm());
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.files.map((f) => f.name), ['old.jpg', 'new.jpg']);
  for (const field of ['oldReceiptPhoto', 'newReceiptPhoto']) {
    const form = photoForm();
    form.delete(field);
    assert.equal(validateSalesReturnPhotos(form).ok, false);
  }
});

test('duplicate, empty and string photo fields are rejected', () => {
  for (const field of ['oldReceiptPhoto', 'newReceiptPhoto']) {
    const duplicate = photoForm();
    duplicate.append(field, photo('extra.jpg'));
    assert.equal(validateSalesReturnPhotos(duplicate).ok, false);
    const empty = photoForm();
    empty.set(field, photo('empty.jpg', 0));
    assert.equal(validateSalesReturnPhotos(empty).ok, false);
    const text = photoForm();
    text.set(field, 'https://example.test/not-a-file.jpg');
    assert.equal(validateSalesReturnPhotos(text).ok, false);
  }
  const legacy = new FormData();
  legacy.append('files', photo('unlabeled.jpg'));
  assert.equal(validateSalesReturnPhotos(legacy).ok, false);
});

test('per-photo and total payload limits are enforced', () => {
  assert.equal(validateSalesReturnPhotos(photoForm(SALES_RETURN_MAX_PHOTO_BYTES, 4)).ok, true);
  assert.deepEqual(validateSalesReturnPhotos(photoForm(SALES_RETURN_MAX_PHOTO_BYTES + 1, 4)), {
    ok: false, error: 'Ukuran satu foto maksimal 5 MB.', status: 413,
  });
  assert.equal(validateSalesReturnPhotos(photoForm(SALES_RETURN_MAX_TOTAL_BYTES / 2, SALES_RETURN_MAX_TOTAL_BYTES / 2)).ok, true);
  const tooLarge = validateSalesReturnPhotos(photoForm(SALES_RETURN_MAX_PHOTO_BYTES, SALES_RETURN_MAX_PHOTO_BYTES));
  assert.equal(tooLarge.ok, false);
  if (!tooLarge.ok) assert.equal(tooLarge.status, 413);
});

const legacy: SalesReturnReceipts = {
  receiptNumber: 'LEGACY-001', oldReceiptNumber: null, newReceiptNumber: null,
  oldReceiptImageUrl: null, newReceiptImageUrl: null, imageUrls: ['one.jpg', 'two.jpg', 'three.jpg'],
};
test('legacy photos are preserved without inventing old/new labels', () => {
  const photos = salesReturnPhotos(legacy);
  assert.equal(photos.length, 3);
  assert.ok(photos.every((p) => p.label.includes('jenis belum tercatat')));
});
test('new submissions identify the old and new images explicitly', () => {
  assert.deepEqual(salesReturnPhotos({ ...legacy, oldReceiptImageUrl: 'old.jpg', newReceiptImageUrl: 'new.jpg' }), [
    { url: 'old.jpg', label: 'Foto struk lama' }, { url: 'new.jpg', label: 'Foto struk baru' },
  ]);
});

test('default list order is newest first', () => {
  const query = parseSalesReturnQuery(new URLSearchParams());
  assert.equal(query.ok, true);
  if (query.ok) { assert.equal(query.sort, 'date'); assert.equal(query.dir, 'desc'); }
});
test('every supported sort works in both directions with filters and pagination', () => {
  for (const sort of Object.keys(SALES_RETURN_SORT_LABELS)) for (const dir of ['asc', 'desc']) {
    const query = parseSalesReturnQuery(new URLSearchParams({ from: '2026-11-01', to: '2026-11-13', sort, dir, storeId: '1', areaId: '2', q: 'old-001', page: '2' }));
    assert.equal(query.ok, true);
    if (query.ok) {
      assert.equal(query.sort, sort); assert.equal(query.dir, dir);
      assert.equal(query.page, 2); assert.equal(query.storeId, 1); assert.equal(query.areaId, 2);
      assert.equal(query.q, 'old-001');
    }
  }
});
test('invalid sort, direction, IDs and reversed dates are rejected', () => {
  for (const params of ['sort=DROP TABLE', 'sort=toString', 'sort=__proto__', 'dir=sideways', 'areaId=-1', 'storeId=abc', 'from=2026-11-14&to=2026-11-13']) {
    assert.equal(parseSalesReturnQuery(new URLSearchParams(params)).ok, false, params);
  }
});
