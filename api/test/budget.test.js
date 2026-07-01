// ============================================================
//  test/budget.test.js — Тохиргоо (settings) + хувийн event
//  in-memory DB; JWT-ээр 2 хэрэглэгч → per-user isolation шалгана.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { hashPasswordSync } from '../auth/passwordHash.js';

const API_KEY = 'budget-test-key';
const JWT_SECRET = 'test-jwt-secret';
let server, baseUrl, db, OWNER;

before(async () => {
  db = createDb(':memory:');
  OWNER = db.createUser('admin', hashPasswordSync('testpw'), 'admin').id;
  const app = createApp({ db, apiKey: API_KEY, jwtSecret: JWT_SECRET, allowRegister: true, localAuth: true, rateLimit: { windowSeconds: 60, max: 100000 } });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

// machine API key = owner хэрэглэгч
const OWNER_H = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY };
const reqJson = (path, method, body, headers) =>
  fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });

async function registerUser(email) {
  const r = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  });
  assert.equal(r.status, 201, `register ${email}`);
  const { accessToken } = await r.json();
  return { Authorization: `Bearer ${accessToken}` };
}

test('GET /settings: default — салин null, payday 15, Netflix/Claude seed', async () => {
  const r = await reqJson('/api/settings', 'GET', null, OWNER_H);
  assert.equal(r.status, 200);
  const { settings } = await r.json();
  assert.equal(settings.salaryAmount, null, 'цалин default null байх ёстой (хуурамч тоо БИШ)');
  assert.equal(settings.paydayDay, 15);
  assert.equal(settings.usdMnt, 3578);
  assert.deepEqual(settings.subscriptions.map((s) => s.name), ['Netflix', 'Claude']);
});

test('PUT then GET settings round-trip (server-side хадгална)', async () => {
  const payload = {
    salaryAmount: 3200000,
    paydayDay: 10,
    usdMnt: 3600,
    subscriptions: [{ name: 'Spotify', day: 3, amountUsd: 9.99 }],
    categoryAllocations: [{ category: 'Хадгаламж', amountMnt: 700000 }],
  };
  const put = await reqJson('/api/settings', 'PUT', payload, OWNER_H);
  assert.equal(put.status, 200);
  assert.equal((await put.json()).settings.salaryAmount, 3200000);

  // дахин GET → хадгалагдсан байх
  const get = await reqJson('/api/settings', 'GET', null, OWNER_H);
  const { settings } = await get.json();
  assert.equal(settings.salaryAmount, 3200000);
  assert.equal(settings.paydayDay, 10);
  assert.equal(settings.usdMnt, 3600);
  assert.deepEqual(settings.subscriptions, payload.subscriptions);
  assert.deepEqual(settings.categoryAllocations, payload.categoryAllocations);
});

test('PUT settings validation: цалин сөрөг → 400; payday 0/29 → 400', async () => {
  const bad1 = await reqJson('/api/settings', 'PUT', { salaryAmount: -5, paydayDay: 15, usdMnt: 3578, subscriptions: [], categoryAllocations: [] }, OWNER_H);
  assert.equal(bad1.status, 400);
  const bad2 = await reqJson('/api/settings', 'PUT', { salaryAmount: 100, paydayDay: 29, usdMnt: 3578, subscriptions: [], categoryAllocations: [] }, OWNER_H);
  assert.equal(bad2.status, 400);
  const bad3 = await reqJson('/api/settings', 'PUT', { salaryAmount: 100, paydayDay: 15, usdMnt: 0, subscriptions: [], categoryAllocations: [] }, OWNER_H);
  assert.equal(bad3.status, 400);
});

test('per-user isolation: B хэрэглэгч owner-ийн цалинг ХАРАХГҮЙ', async () => {
  // owner-д дээр 3200000 хадгалсан. B шинэ хэрэглэгч → default (null).
  const bHdr = await registerUser('biso@test.mn');
  const bGet = await reqJson('/api/settings', 'GET', null, bHdr);
  assert.equal((await bGet.json()).settings.salaryAmount, null, 'B-д owner-ийн цалин алдагдсан!');

  // B өөрийн цалин хадгална
  await reqJson('/api/settings', 'PUT', { salaryAmount: 999000, paydayDay: 15, usdMnt: 3578, subscriptions: [], categoryAllocations: [] }, bHdr);
  // owner-ийнх хэвээр (B-гийнхээр дарагдаагүй)
  const oGet = await reqJson('/api/settings', 'GET', null, OWNER_H);
  assert.equal((await oGet.json()).settings.salaryAmount, 3200000, 'owner-ийн цалин B-гийнхээр дарагдсан!');
  // B-гийнх өөрийнх
  const bGet2 = await reqJson('/api/settings', 'GET', null, bHdr);
  assert.equal((await bGet2.json()).settings.salaryAmount, 999000);
});

test('events: POST → GET → DELETE, per-user isolation', async () => {
  // owner event нэмнэ
  const post = await reqJson('/api/events', 'POST', { title: 'Төрсөн өдөр', date: '2026-07-12', amountMnt: 50000 }, OWNER_H);
  assert.equal(post.status, 201);
  const { event } = await post.json();
  assert.ok(event.id > 0);
  assert.equal(event.amountMnt, 50000);

  const list = await reqJson('/api/events', 'GET', null, OWNER_H);
  const owned = (await list.json()).data;
  assert.ok(owned.some((e) => e.id === event.id));

  // B хэрэглэгч owner-ийн event-ийг ХАРАХГҮЙ ба УСТГАЖ ЧАДАХГҮЙ (404)
  const bHdr = await registerUser('cev@test.mn');
  const bList = await reqJson('/api/events', 'GET', null, bHdr);
  assert.equal((await bList.json()).data.length, 0);
  const bDel = await reqJson(`/api/events/${event.id}`, 'DELETE', null, bHdr);
  assert.equal(bDel.status, 404, 'B owner-ийн event-ийг устгаж чадаж байна!');

  // owner өөрийнхөө event-ийг устгана
  const del = await reqJson(`/api/events/${event.id}`, 'DELETE', null, OWNER_H);
  assert.equal(del.status, 200);
  const after2 = await reqJson('/api/events', 'GET', null, OWNER_H);
  assert.ok(!(await after2.json()).data.some((e) => e.id === event.id));
});

test('POST /events validation: огноо буруу → 400', async () => {
  const r = await reqJson('/api/events', 'POST', { title: 'X', date: '2026/07/12' }, OWNER_H);
  assert.equal(r.status, 400);
});
