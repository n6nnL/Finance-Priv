// ============================================================
//  telegram/isolation.test.js — ХАМГИЙН ЧУХАЛ баталгаажуулалт:
//  bot-ийн mint хийсэн JWT (chat_id→user_id resolve-аас гарсан) зөвхөн
//  ТУХАЙН хэрэглэгчийн гүйлгээнд хүрдэг эсэх. Бодит api/app.js сервер
//  ажиллуулж, telegram/jwtAuth.js + telegram/apiClient.js-ээр шалгана
//  (bot.js-ийн Telegram-specific давхаргагүйгээр, гол аюулгүй байдлын
//  claim-ийг шууд баталгаажуулна).
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../api/db.js';
import { createApp } from '../api/app.js';
import { createJwt } from '../api/auth/jwt.js';
import { patchCategory, getTransaction } from './apiClient.js';
import { config } from './config.js';

let server, baseUrl, db, userA, userB, txnA, txnB;
const JWT_SECRET = config.jwtSecret; // telegram/config.js уншсан (JWT_SECRET эсвэл throw)

before(async () => {
  db = createDb(':memory:');
  userA = db.upsertGoogleUser({ email: 'iso-a@example.com', sub: 'iso-sub-a' });
  userB = db.upsertGoogleUser({ email: 'iso-b@example.com', sub: 'iso-sub-b' });
  const insA = db.insertTransaction({ userId: userA.id, messageId: '<iso-a1>', amount: 1000, currency: 'MNT', date: '2026-01-01', type: 'expense', description: 'A transfer', status: 'pending_review' });
  const insB = db.insertTransaction({ userId: userB.id, messageId: '<iso-b1>', amount: 2000, currency: 'MNT', date: '2026-01-01', type: 'expense', description: 'B transfer', status: 'pending_review' });
  txnA = insA.id; txnB = insB.id;

  const app = createApp({
    db, apiKey: 'iso-test-key', jwtSecret: JWT_SECRET,
    rateLimit: { windowSeconds: 60, max: 100000 },
    localAuth: false,
    google: { allowedEmails: new Set(), openSignup: false, dashboardBaseUrl: '' },
  });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  // apiClient.js нь config.apiBase-г ашигладаг тул test-ийн ephemeral port рүү чиглүүлнэ.
  config.apiBase = baseUrl;
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

function mintFor(user) {
  return createJwt({ secret: JWT_SECRET }).signAccess(user);
}

test('B-ийн mint хийсэн token-оор A-ийн гүйлгээг ангилах оролдлого → 404 (isolation)', async () => {
  const tokenB = mintFor(userB);
  const result = await getTransaction(tokenB, txnA);
  assert.equal(result, null, 'B нь A-ийн гүйлгээг GET-ээр харж чадаж байна — isolation зөрчигдсөн!');

  await assert.rejects(
    () => patchCategory(tokenB, txnA, { category: 'Бусад', applyToAll: false }),
    (e) => e.status === 404,
    'B нь A-ийн гүйлгээг ангилж чадлаа — isolation зөрчигдсөн!'
  );
  // A-ийн гүйлгээ ХӨНДӨГДӨӨГҮЙг батал
  const stillA = db.getById(userA.id, txnA);
  assert.equal(stillA.category, null);
  assert.equal(stillA.status, 'pending_review');
});

test('A өөрийн mint хийсэн token-оор өөрийн гүйлгээг ангилж чадна', async () => {
  // Тусдаа шинэ гүйлгээ ашиглана (node:test default-ээр sibling тестүүдийг
  // зэрэг ажиллуулдаг тул txnA-г дээрх тесттэй хуваалцвал race үүснэ).
  const ins = db.insertTransaction({ userId: userA.id, messageId: '<iso-a2>', amount: 3000, currency: 'MNT', date: '2026-01-02', type: 'expense', description: 'A transfer 2', status: 'pending_review' });
  const txnA2 = ins.id;

  const tokenA = mintFor(userA);
  const current = await getTransaction(tokenA, txnA2);
  assert.equal(current.id, txnA2);

  const r = await patchCategory(tokenA, txnA2, { category: 'Шилжүүлэг & гэр бүл', applyToAll: false });
  assert.equal(r.status, 'ok');
  const updated = db.getById(userA.id, txnA2);
  assert.equal(updated.category, 'Шилжүүлэг & гэр бүл');
  assert.equal(updated.status, 'classified');

  // B-ийн гүйлгээ ХӨНДӨГДӨӨГҮЙ
  const bRow = db.getById(userB.id, txnB);
  assert.equal(bRow.category, null);
});
