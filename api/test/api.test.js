// ============================================================
//  test/api.test.js — integration test (node:test + fetch)
//  Ажиллуулах:  npm test
//
//  Тусдаа пакет (supertest г.м) шаардахгүй — in-memory DB-тэй app-г
//  ephemeral порт дээр асааж, global fetch-ээр шалгана.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { hashPasswordSync } from '../auth/passwordHash.js';

const API_KEY = 'test-secret-key';
let server;
let baseUrl;
let db;
let OWNER;

before(async () => {
  db = createDb(':memory:');
  OWNER = db.createUser('admin', hashPasswordSync('x'), 'admin').id; // machine→owner
  const app = createApp({
    db,
    apiKey: API_KEY,
    hmacSecret: '', // HMAC-гүй үндсэн тестүүд
    jwtSecret: 'test-secret',
    rateLimit: { windowSeconds: 60, max: 1000 },
  });
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

function post(body, headers = {}) {
  return fetch(`${baseUrl}/api/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY, ...headers },
    // Machine push-д userId ЗААВАЛ (multi-tenant) — тестүүд owner-ийн нэрээр илгээнэ.
    body: typeof body === 'string' ? body : JSON.stringify({ userId: OWNER, ...body }),
  });
}

const validTx = {
  messageId: '<msg-1@golomt>',
  amount: 25000,
  currency: 'MNT',
  date: '2026-06-08',
  description: 'POS гүйлгээ - EMART',
  type: 'expense',
  category: 'Хүнс',
  accountLast4: '1234',
  raw: 'имэйлийн түүхий текст',
};

test('зөв хүсэлт → 201 created', async () => {
  const res = await post(validTx);
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.status, 'created');
  assert.ok(typeof json.id === 'number');
});

test('давхардсан messageId → 200 duplicate', async () => {
  const res = await post(validTx); // ижил messageId дахин
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, 'duplicate');
  assert.ok(typeof json.id === 'number');
});

test('буруу API key → 401', async () => {
  const res = await post({ ...validTx, messageId: '<msg-x>' }, { 'X-API-Key': 'wrong' });
  assert.equal(res.status, 401);
});

test('API key байхгүй → 401', async () => {
  const res = await fetch(`${baseUrl}/api/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...validTx, messageId: '<msg-y>' }),
  });
  assert.equal(res.status, 401);
});

test('дутуу amount → 400 validation', async () => {
  const { amount, ...noAmount } = validTx;
  const res = await post({ ...noAmount, messageId: '<msg-2>' });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.status, 'error');
  assert.ok(Array.isArray(json.errors));
  assert.ok(json.errors.some((e) => e.field === 'amount'));
});

test('сөрөг amount → 400', async () => {
  const res = await post({ ...validTx, messageId: '<msg-3>', amount: -100 });
  assert.equal(res.status, 400);
});

test('буруу type → 400', async () => {
  const res = await post({ ...validTx, messageId: '<msg-4>', type: 'foo' });
  assert.equal(res.status, 400);
});

test('listener alias (direction/accountTail) → нормализаци хийж 201', async () => {
  const res = await post({
    messageId: '<msg-alias>',
    amount: 50000,
    currency: 'MNT',
    direction: 'credit', // → type: income
    accountTail: '9999', // → accountLast4
    subject: 'Цалин орлоо', // → raw
    date: '2026-06-08',
    category: 'Цалин',
  });
  assert.equal(res.status, 201);
  // DB-д зөв хадгалагдсан эсэхийг шалгана
  const row = db.getByMessageId(OWNER, '<msg-alias>');
  assert.equal(row.type, 'income');
  assert.equal(row.account_last4, '9999');
  assert.equal(row.raw, 'Цалин орлоо');
});

test('буруу JSON → 400', async () => {
  const res = await post('{ not valid json ');
  assert.equal(res.status, 400);
});

test('GET жагсаалт + type шүүлт', async () => {
  const res = await fetch(`${baseUrl}/api/transactions?type=income`, {
    headers: { 'X-API-Key': API_KEY },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, 'ok');
  assert.ok(json.data.every((r) => r.type === 'income'));
});

test('GET auth-гүй → 401', async () => {
  const res = await fetch(`${baseUrl}/api/transactions`);
  assert.equal(res.status, 401);
});

// ---- HMAC тест: тусдаа app instance ----
test('HMAC: зөв гарын үсэг → 201, буруу → 401', async () => {
  const HMAC = 'hmac-secret';
  const db2 = createDb(':memory:');
  db2.createUser('admin', hashPasswordSync('x'), 'admin');
  const app2 = createApp({ db: db2, apiKey: API_KEY, hmacSecret: HMAC, jwtSecret: 'test-secret' });
  const srv2 = await new Promise((resolve) => {
    const s = app2.listen(0, () => resolve(s));
  });
  const url = `http://127.0.0.1:${srv2.address().port}/api/transactions`;
  const body = JSON.stringify({ ...validTx, userId: 1, messageId: '<msg-hmac>' });

  // Зөв гарын үсэг
  const goodSig = createHmac('sha256', HMAC).update(body).digest('hex');
  const okRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY, 'X-Signature': goodSig },
    body,
  });
  assert.equal(okRes.status, 201);

  // Буруу гарын үсэг
  const badRes = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      'X-Signature': 'deadbeef',
      },
    body: JSON.stringify({ ...validTx, userId: 1, messageId: '<msg-hmac-2>' }),
  });
  assert.equal(badRes.status, 401);

  await new Promise((r) => srv2.close(r));
  db2.close();
});
