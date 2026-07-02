// ============================================================
//  telegram/db.test.js — chat_id↔user_id resolve, link code consume,
//  idempotent notification, isolation (linked-only polling)
//  api/db.js-ийн createDb-ээр бодит schema-тай түр файл DB үүсгэж шалгана.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../api/db.js';
import { createTelegramStore } from './db.js';

let dir, dbPath, apiDb, store, userA, userB;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'telegram-db-test-'));
  dbPath = join(dir, 'api.sqlite');
  apiDb = createDb(dbPath);
  userA = apiDb.upsertGoogleUser({ email: 'a@example.com', sub: 'sub-a' });
  userB = apiDb.upsertGoogleUser({ email: 'b@example.com', sub: 'sub-b' });
  store = createTelegramStore({ dbPath });
});

after(() => {
  store.close();
  apiDb.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('resolveUserByChatId: холбогдоогүй chat → null', () => {
  assert.equal(store.resolveUserByChatId('999'), null);
});

test('consumeLinkCode: буруу код → invalid', () => {
  const r = store.consumeLinkCode('000000', 'chat-a');
  assert.deepEqual(r, { ok: false, reason: 'invalid' });
});

test('consumeLinkCode: зөв код → холбогдож userId буцаана', () => {
  const { code } = apiDb.createTelegramLinkCode(userA.id);
  const r = store.consumeLinkCode(code, 'chat-a');
  assert.deepEqual(r, { ok: true, userId: userA.id });
  assert.equal(store.resolveUserByChatId('chat-a'), userA.id);
});

test('consumeLinkCode: ашигласан кодыг дахин ашиглах → used', () => {
  const { code } = apiDb.createTelegramLinkCode(userB.id);
  store.consumeLinkCode(code, 'chat-b');
  const r = store.consumeLinkCode(code, 'chat-b2');
  assert.deepEqual(r, { ok: false, reason: 'used' });
});

test('consumeLinkCode: хугацаа дууссан код → expired', () => {
  apiDb._raw.prepare(
    `INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES (?, ?, datetime('now','-1 minute'))`
  ).run('111111', userA.id);
  const r = store.consumeLinkCode('111111', 'chat-late');
  assert.deepEqual(r, { ok: false, reason: 'expired' });
});

test('consumeLinkCode: өөр хэрэглэгчид аль хэдийн холбогдсон chat → chat_taken', () => {
  // userB-г шинэ chat-д холбохыг оролдоно, гэхдээ 'chat-a' нь userA-д аль хэдийн UNIQUE
  const { code } = apiDb.createTelegramLinkCode(userB.id);
  const r = store.consumeLinkCode(code, 'chat-a'); // chat-a нь userA-д холбогдсон
  assert.deepEqual(r, { ok: false, reason: 'chat_taken' });
});

test('unlinkByChatId: холбоо тасарна, дахин дуудахад false', () => {
  assert.equal(store.unlinkByChatId('chat-a'), true);
  assert.equal(store.resolveUserByChatId('chat-a'), null);
  assert.equal(store.unlinkByChatId('chat-a'), false);
});

test('listNewLinkedTransactions + markNotified: зөвхөн холбогдсон хэрэглэгчийн гүйлгээ, isolation', () => {
  // userB-г дахин холбоно (өмнөх тестүүдэд chat-b-тэй холбогдсон байсан)
  apiDb.insertTransaction({ userId: userA.id, messageId: '<a1>', amount: 1000, currency: 'MNT', date: '2026-01-01', type: 'expense', description: 'A tx' });
  apiDb.insertTransaction({ userId: userB.id, messageId: '<b1>', amount: 2000, currency: 'MNT', date: '2026-01-01', type: 'expense', description: 'B tx' });

  // userA холбогдоогүй (өмнөх тест unlink хийсэн) — зөвхөн userB (chat-b) орно
  const rows = store.listNewLinkedTransactions(0);
  assert.equal(rows.length, 1, 'зөвхөн холбогдсон хэрэглэгчийн гүйлгээ буцах ёстой');
  assert.equal(rows[0].description, 'B tx');
  assert.equal(rows[0].chat_id, 'chat-b');

  // Идэмпотентность: эхний удаа true, дараа нь false
  assert.equal(store.markNotified(rows[0].id, rows[0].chat_id), true);
  assert.equal(store.markNotified(rows[0].id, rows[0].chat_id), false);
});

test('getUserBasic: JWT mint-д хэрэгтэй мэдээлэл', () => {
  const u = store.getUserBasic(userA.id);
  assert.equal(u.email, 'a@example.com');
  assert.ok(u.id && u.role);
});

test('getGmailStatus: холбоогүй үед connected=false', () => {
  const s = store.getGmailStatus(userA.id);
  assert.equal(s.connected, false);
});
