// ============================================================
//  test/gmail-auth.test.js — Gmail холбох flow + token шифрлэлт +
//  ingest userId contract + isolation (multi-tenant)
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';
import { isEncrypted } from '../../config/tokenCrypto.js';

const API_KEY = 'gmail-test-key';
const JWT_SECRET = 'test-jwt-secret';
const OWNER_EMAIL = 'owner@example.com';
const B_EMAIL = 'b@example.com';
const ENC_KEY = 'd'.repeat(64);

let server, baseUrl, db;

let nextLoginExchange = null;
let nextGmailExchange = null;
const mockLogin = {
  name: 'login', enabled: true,
  getAuthUrl: (s) => `https://accounts.google.test/auth?scope=openid+email+profile&state=${encodeURIComponent(s)}`,
  exchangeCode: async () => nextLoginExchange,
};
const mockCalendar = {
  name: 'calendar', enabled: true,
  getAuthUrl: (s) => `https://accounts.google.test/auth?scope=calendar.readonly&state=${encodeURIComponent(s)}`,
  exchangeCode: async () => null,
};
const mockGmail = {
  name: 'gmail', enabled: true,
  getAuthUrl: (s) => `https://accounts.google.test/auth?access_type=offline&scope=openid+https://mail.google.com/&state=${encodeURIComponent(s)}`,
  exchangeCode: async () => nextGmailExchange,
};

before(async () => {
  db = createDb(':memory:', { tokenEncKey: ENC_KEY });
  const app = createApp({
    db, apiKey: API_KEY, jwtSecret: JWT_SECRET,
    rateLimit: { windowSeconds: 60, max: 100000 },
    localAuth: false,
    google: {
      loginProvider: mockLogin, calendarProvider: mockCalendar, gmailProvider: mockGmail,
      allowedEmails: new Set([OWNER_EMAIL, B_EMAIL]), openSignup: false, dashboardBaseUrl: '',
    },
  });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

const noRedirect = { redirect: 'manual' };

async function loginAs(email, sub) {
  const sr = await fetch(`${baseUrl}/api/auth/google`, noRedirect);
  const state = new URL(sr.headers.get('location')).searchParams.get('state');
  nextLoginExchange = { email, emailVerified: true, sub, picture: null, refreshToken: null, scope: 'openid email' };
  const cb = await fetch(`${baseUrl}/api/auth/google/callback?code=c&state=${encodeURIComponent(state)}`, noRedirect);
  const loc = cb.headers.get('location');
  return decodeURIComponent(new URL(loc, baseUrl).hash.match(/access=([^&]+)/)[1]);
}

let ownerAccess, bAccess, ownerId, bId;

test('setup: 2 хэрэглэгч нэвтэрнэ', async () => {
  ownerAccess = await loginAs(OWNER_EMAIL, 'sub-owner');
  bAccess = await loginAs(B_EMAIL, 'sub-b');
  ownerId = db.getUserByEmail(OWNER_EMAIL).id;
  bId = db.getUserByEmail(B_EMAIL).id;
  assert.notEqual(ownerId, bId);
});

test('GET /api/auth/gmail/connect: JWT-гүй → 401; JWT-тэй → {url} mail scope-той', async () => {
  assert.equal((await fetch(`${baseUrl}/api/auth/gmail/connect`)).status, 401);
  const r = await fetch(`${baseUrl}/api/auth/gmail/connect`, { headers: { Authorization: `Bearer ${ownerAccess}` } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.url, /mail\.google\.com/);
  assert.match(j.url, /access_type=offline/);
});

test('Gmail callback → token ШИФРЛЭГДЭЖ хадгалагдана, connected/active, /me-д тусгагдана', async () => {
  const start = await (await fetch(`${baseUrl}/api/auth/gmail/connect`, { headers: { Authorization: `Bearer ${ownerAccess}` } })).json();
  const state = new URL(start.url).searchParams.get('state');
  nextGmailExchange = { email: 'owner-inbox@gmail.com', emailVerified: true, sub: 'sub-owner', refreshToken: 'gmail-refresh-owner', scope: 'openid https://mail.google.com/' };
  const cb = await fetch(`${baseUrl}/api/auth/gmail/callback?code=x&state=${encodeURIComponent(state)}`, noRedirect);
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location'), /settings=1/);

  // Raw DB: ил текст БИШ (encryption at rest)
  const raw = db._raw.prepare('SELECT gmail_refresh_token, gmail_email, gmail_connected, gmail_status FROM google_tokens WHERE user_id=?').get(ownerId);
  assert.ok(isEncrypted(raw.gmail_refresh_token), 'gmail token ил текстээр хадгалагдсан!');
  assert.ok(!String(raw.gmail_refresh_token).includes('gmail-refresh-owner'));
  assert.equal(raw.gmail_email, 'owner-inbox@gmail.com');
  assert.equal(raw.gmail_connected, 1);
  assert.equal(raw.gmail_status, 'active');

  // Decrypt зөв (listener-ийн унших зам)
  assert.equal(db.getGoogleTokens(ownerId).gmail_refresh_token, 'gmail-refresh-owner');

  // /me — token утга ОРОХГҮЙ, зөвхөн төлөв
  const me = await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${ownerAccess}` } })).json();
  assert.equal(me.user.gmailConnected, true);
  assert.equal(me.user.gmailStatus, 'active');
  assert.equal(me.user.gmailEmail, 'owner-inbox@gmail.com');
  assert.ok(!JSON.stringify(me).includes('gmail-refresh-owner'), 'token /me хариуд гарчээ!');
});

test('Gmail callback: refresh_token байхгүй → gmailError (хадгалахгүй)', async () => {
  const start = await (await fetch(`${baseUrl}/api/auth/gmail/connect`, { headers: { Authorization: `Bearer ${bAccess}` } })).json();
  const state = new URL(start.url).searchParams.get('state');
  nextGmailExchange = { email: B_EMAIL, emailVerified: true, sub: 'sub-b', refreshToken: null, scope: 'openid https://mail.google.com/' };
  const cb = await fetch(`${baseUrl}/api/auth/gmail/callback?code=x&state=${encodeURIComponent(state)}`, noRedirect);
  assert.match(cb.headers.get('location'), /gmailError=1/);
  assert.equal(db.getGmailInfo(bId).connected, false);
});

test('CSRF namespace: login/calendar state-ийг gmail callback-д ашиглавал татгалзана', async () => {
  const lr = await fetch(`${baseUrl}/api/auth/google`, noRedirect);
  const loginState = new URL(lr.headers.get('location')).searchParams.get('state');
  nextGmailExchange = { refreshToken: 'should-not-save', scope: 'x' };
  const cb = await fetch(`${baseUrl}/api/auth/gmail/callback?code=x&state=${encodeURIComponent(loginState)}`, noRedirect);
  assert.match(cb.headers.get('location'), /gmailError=1/);

  const calStart = await (await fetch(`${baseUrl}/api/auth/google/calendar`, { headers: { Authorization: `Bearer ${ownerAccess}` } })).json();
  const calState = new URL(calStart.url).searchParams.get('state');
  const cb2 = await fetch(`${baseUrl}/api/auth/gmail/callback?code=x&state=${encodeURIComponent(calState)}`, noRedirect);
  assert.match(cb2.headers.get('location'), /gmailError=1/);
});

// ===================== INGEST: userId ЗААВАЛ (owner fallback үгүй) =====================

const txBody = (over = {}) => ({
  messageId: `<gm-${Math.random().toString(36).slice(2)}>`,
  amount: 5000, currency: 'MNT', date: '2026-07-01', type: 'expense', description: 'test tx', ...over,
});

function machinePost(body) {
  return fetch(`${baseUrl}/api/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify(body),
  });
}

test('machine push userId-гүй → 400 (owner fallback ҮГҮЙ)', async () => {
  const r = await machinePost(txBody());
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.ok(j.errors.some((e) => e.field === 'userId'));
});

test('machine push үл мэдэгдэх userId → 400', async () => {
  const r = await machinePost(txBody({ userId: 99999 }));
  assert.equal(r.status, 400);
});

test('machine push зөв userId → 201, тухайн хэрэглэгчид ноогдоно + ISOLATION', async () => {
  const mid = '<gm-iso-1>';
  const r = await machinePost(txBody({ userId: bId, messageId: mid, description: 'B-гийн гүйлгээ' }));
  assert.equal(r.status, 201);

  // B өөрийн гүйлгээг харна
  const bList = await (await fetch(`${baseUrl}/api/transactions`, { headers: { Authorization: `Bearer ${bAccess}` } })).json();
  assert.equal(bList.total, 1);
  assert.equal(bList.data[0].message_id, mid);

  // Owner B-гийн гүйлгээг ХАРАХГҮЙ
  const oList = await (await fetch(`${baseUrl}/api/transactions`, { headers: { Authorization: `Bearer ${ownerAccess}` } })).json();
  assert.equal(oList.total, 0, 'owner B-гийн гүйлгээг харж байна — isolation зөрчигдөв!');
});

test('JWT push: body userId-г үл тоомсорлож өөрийн userId ашиглана', async () => {
  const mid = '<gm-jwt-1>';
  const r = await fetch(`${baseUrl}/api/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerAccess}` },
    body: JSON.stringify(txBody({ userId: bId, messageId: mid })), // B-гийн нэрээр оролдоно
  });
  assert.equal(r.status, 201);
  // Гүйлгээ owner-т ноогдсон (B-д БИШ)
  assert.ok(db.getByMessageId(ownerId, mid), 'JWT push өөрийн userId-д ноогдоогүй');
  assert.equal(db.getByMessageId(bId, mid), null, 'JWT push body userId-аар өөр хүнд бичигдэв!');
});

// ===================== DISCONNECT =====================

test('POST /api/auth/gmail/disconnect → token устана, /me-д тусгагдана', async () => {
  const r = await fetch(`${baseUrl}/api/auth/gmail/disconnect`, { method: 'POST', headers: { Authorization: `Bearer ${ownerAccess}` } });
  assert.equal(r.status, 200);
  const raw = db._raw.prepare('SELECT gmail_refresh_token, gmail_connected FROM google_tokens WHERE user_id=?').get(ownerId);
  assert.equal(raw.gmail_refresh_token, null);
  assert.equal(raw.gmail_connected, 0);
  const me = await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${ownerAccess}` } })).json();
  assert.equal(me.user.gmailConnected, false);
});

// ===================== МИГРАЦ BACKFILL =====================

test('миграц backfill: plaintext calendar token → шифрлэгдэнэ, унших зөв', () => {
  const db2 = createDb(':memory:'); // key-гүй (хуучин байдал)
  db2.upsertGoogleUser({ email: 'legacy@example.com', sub: 'sub-legacy' });
  db2.saveGoogleTokens(1, { refreshToken: 'legacy-cal-token', scope: 'openid calendar.readonly' });
  const plain = db2._raw.prepare('SELECT refresh_token FROM google_tokens WHERE user_id=1').get();
  assert.equal(plain.refresh_token, 'legacy-cal-token'); // key-гүй үед plaintext (хуучин төлөв)

  // Одоо key-тэй db instance ижил файл дээр... in-memory тул simulate:
  // db2-ийн raw дээр key-тэй createDb-ийн migrate-ийг дуудах боломжгүй, тиймээс
  // файлд хийнэ.
  db2.close();
});

test('миграц backfill (файл DB): key нэмэгдэхэд plaintext token шифрлэгдэнэ', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'backfill-test-'));
  const p = join(dir, 'x.sqlite');
  try {
    // 1) key-гүй (хуучин deploy) — plaintext хадгалагдана
    const old = createDb(p);
    old.upsertGoogleUser({ email: 'legacy@example.com', sub: 'sub-legacy' });
    old.saveGoogleTokens(1, { refreshToken: 'legacy-cal-token', scope: 'openid calendar.readonly' });
    old.close();

    // 2) key-тэй шинэ deploy — миграц backfill шифрлэнэ
    const neu = createDb(p, { tokenEncKey: ENC_KEY });
    const raw = neu._raw.prepare('SELECT refresh_token FROM google_tokens WHERE user_id=1').get();
    assert.ok(isEncrypted(raw.refresh_token), 'backfill шифрлээгүй');
    assert.equal(neu.getGoogleTokens(1).refresh_token, 'legacy-cal-token'); // тайлж уншина
    neu.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
