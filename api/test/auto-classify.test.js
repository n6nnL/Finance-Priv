// ============================================================
//  test/auto-classify.test.js — Хуучирсан pending → авто 'Бусад'
//  (хэрэглэгчийн бодлого: N хоногоос дээш ангилагдаагүй → 'Бусад').
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { hashPasswordSync } from '../auth/passwordHash.js';

let db, U;
before(() => { db = createDb(':memory:'); U = db.createUser('o', hashPasswordSync('x'), 'admin').id; });
after(() => db.close());

let mid = 0;
const ins = (over = {}) => db.insertTransaction({
  userId: U, messageId: `<a${++mid}>`, amount: 1000, currency: 'MNT',
  type: 'expense', category: null, status: 'pending_review', ...over,
});
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

test('3+ хоногийн pending → Бусад/classified; сүүлийн 3 хоног хэвээр', () => {
  const old1 = ins({ date: daysAgo(10) });
  const old2 = ins({ date: daysAgo(4) });
  const recent = ins({ date: daysAgo(1) });
  const today = ins({ date: daysAgo(0) });

  const changed = db.autoClassifyStalePending({ days: 3 });
  assert.equal(changed, 2, 'зөвхөн 10 ба 4 хоногийнх солигдоно');
  assert.equal(db.getById(U, old1.id).category, 'Бусад');
  assert.equal(db.getById(U, old1.id).status, 'classified');
  assert.equal(db.getById(U, old2.id).status, 'classified');
  assert.equal(db.getById(U, recent.id).status, 'pending_review', 'сүүлийн 3 хоног хэвээр');
  assert.equal(db.getById(U, today.id).status, 'pending_review');
});

test('гараар зассан (manually_edited=1) мөрийг ХӨНДӨХГҮЙ', () => {
  const r = ins({ date: '2020-01-01' });
  db._raw.prepare('UPDATE transactions SET manually_edited=1 WHERE id=?').run(r.id);
  db.autoClassifyStalePending({ days: 3 });
  assert.equal(db.getById(U, r.id).status, 'pending_review');
});

test('days<=0 → унтраалттай (0 буцаана, юу ч солихгүй)', () => {
  ins({ date: '2019-01-01' });
  const before = db.getPending(U).total;
  assert.equal(db.autoClassifyStalePending({ days: 0 }), 0);
  assert.equal(db.getPending(U).total, before);
});
