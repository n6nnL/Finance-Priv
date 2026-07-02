// ============================================================
//  test/google-auth.test.js — Google нэвтрэлт (allow-list/open-signup, upsert)
//  + Calendar холболт (тусдаа opt-in flow, JWT-тэй эхэлдэг, state-д userId шифрлэгдсэн)
//  Mock google provider (login/calendar тус тусдаа) тарина (бодит сүлжээ ХЭРЭГГҮЙ).
//  redirect-ийг гар аргаар дагана (manual redirect) → fragment-аас JWT задлана.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';

const API_KEY = 'gauth-test-key';
const JWT_SECRET = 'test-jwt-secret';
const ALLOWED = 'me@example.com';

let server, baseUrl, db;

// Mock providers — exchangeCode-г тестийн хяналттай утга буцаадаг болгоно.
let nextLoginExchange = null;
let nextCalendarExchange = null;
let lastCalendarAuthUrlArgs = null; // getAuthUrl-д дамжсан state-г шалгахад
const mockLogin = {
  name: 'google-login',
  enabled: true,
  getAuthUrl: (state) => `https://accounts.google.test/o/oauth2/v2/auth?scope=openid+email+profile&state=${encodeURIComponent(state)}`,
  exchangeCode: async (_code) => nextLoginExchange,
};
const mockCalendar = {
  name: 'google-calendar',
  enabled: true,
  getAuthUrl: (state) => {
    lastCalendarAuthUrlArgs = { state };
    return `https://accounts.google.test/o/oauth2/v2/auth?access_type=offline&prompt=consent&scope=openid+calendar.readonly&state=${encodeURIComponent(state)}`;
  },
  exchangeCode: async (_code) => nextCalendarExchange,
};

function buildApp({ openSignup = false } = {}) {
  const app = createApp({
    db, apiKey: API_KEY, jwtSecret: JWT_SECRET,
    rateLimit: { windowSeconds: 60, max: 100000 },
    localAuth: false, // Google нь хүний цорын ганц нэвтрэлт
    google: {
      loginProvider: mockLogin,
      calendarProvider: mockCalendar,
      allowedEmails: new Set([ALLOWED]),
      openSignup,
      dashboardBaseUrl: '', // relative
    },
  });
  return app;
}

before(async () => {
  db = createDb(':memory:');
  const app = buildApp();
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

const noRedirect = { redirect: 'manual' };

// /google → consent руу 302 (state-тэй)
test('GET /api/auth/google → 302 Google consent руу, state параметртэй', async () => {
  const r = await fetch(`${baseUrl}/api/auth/google`, noRedirect);
  assert.equal(r.status, 302);
  const loc = r.headers.get('location');
  assert.match(loc, /accounts\.google\.test/);
  assert.match(loc, /state=/);
  // Login scope-д calendar орохгүй
  assert.doesNotMatch(loc, /calendar/);
});

// callback-д хүчинтэй state хэрэгтэй тул эхлээд /google-аас аваад дахин ашиглана.
async function freshState() {
  const r = await fetch(`${baseUrl}/api/auth/google`, noRedirect);
  const loc = new URL(r.headers.get('location'));
  return loc.searchParams.get('state');
}

async function loginAs({ email, sub, picture = null, emailVerified = true }) {
  nextLoginExchange = { email, emailVerified, sub, picture, refreshToken: 'ignored', scope: 'openid email profile' };
  const state = await freshState();
  const r = await fetch(`${baseUrl}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, noRedirect);
  return r;
}

function accessFromRedirect(loc) {
  return decodeURIComponent(new URL(loc, baseUrl).hash.match(/access=([^&]+)/)[1]);
}

test('callback: allow-listed email → хэрэглэгч үүснэ + JWT (fragment), Calendar token ХАДГАЛАГДАХГҮЙ', async () => {
  const r = await loginAs({ email: ALLOWED, sub: 'google-sub-1', picture: 'http://x/p.png' });
  assert.equal(r.status, 302);
  const loc = r.headers.get('location');
  assert.match(loc, /#access=/);
  assert.match(loc, /[&#]refresh=/);

  const user = db.getUserByEmail(ALLOWED);
  assert.ok(user, 'хэрэглэгч үүсээгүй');
  assert.equal(user.google_sub, 'google-sub-1');

  // Login endpoint нь Calendar token ХЭЗЭЭ Ч хадгалдаггүй болсон
  const tok = db.getGoogleTokens(user.id);
  assert.equal(tok, null, 'login callback Calendar token хадгалж байна — болохгүй');

  const access = accessFromRedirect(loc);
  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${access}` } });
  assert.equal(me.status, 200);
  const meJson = await me.json();
  assert.equal(meJson.user.email, ALLOWED);
  assert.equal(meJson.user.calendarConnected, false);
});

test('callback: allow-list-д БАЙХГҮЙ email → татгалзана, хэрэглэгч үүсэхгүй (AUTH_OPEN_SIGNUP=false)', async () => {
  const r = await loginAs({ email: 'intruder@example.com', sub: 'sub-evil' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /error=not_allowed/);
  assert.equal(db.getUserByEmail('intruder@example.com'), null, 'татгалзсан хэрэглэгч үүссэн!');
});

test('callback: баталгаажаагүй email → татгалзана', async () => {
  const r = await loginAs({ email: ALLOWED, sub: 'google-sub-1', emailVerified: false });
  assert.match(r.headers.get('location'), /error=email_unverified/);
});

test('callback: state буруу (CSRF) → татгалзана', async () => {
  nextLoginExchange = { email: ALLOWED, emailVerified: true, sub: 'google-sub-1', refreshToken: 'r', scope: 'openid email' };
  const r = await fetch(`${baseUrl}/api/auth/google/callback?code=abc&state=forged`, noRedirect);
  assert.match(r.headers.get('location'), /error=bad_state/);
});

test('localAuth=false үед /login, /register → 404', async () => {
  const l = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ALLOWED, password: 'x' }) });
  assert.equal(l.status, 404);
  const r = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: 'pass1234' }) });
  assert.equal(r.status, 404);
});

// ===================== CALENDAR (opt-in, JWT-тэй) =====================

test('GET /api/auth/google/calendar — Bearer-гүй бол 401', async () => {
  const r = await fetch(`${baseUrl}/api/auth/google/calendar`);
  assert.equal(r.status, 401);
});

test('Calendar холбох: start → JSON {url} (calendar.readonly+offline), callback → calendar_connected=1, /me-д тусгагдана', async () => {
  const r = await loginAs({ email: ALLOWED, sub: 'google-sub-1' });
  const access = accessFromRedirect(r.headers.get('location'));
  const user = db.getUserByEmail(ALLOWED);

  const startRes = await fetch(`${baseUrl}/api/auth/google/calendar`, { headers: { Authorization: `Bearer ${access}` } });
  assert.equal(startRes.status, 200);
  const startJson = await startRes.json();
  assert.match(startJson.url, /calendar\.readonly/);
  assert.match(startJson.url, /access_type=offline/);
  assert.ok(lastCalendarAuthUrlArgs.state, 'calendar state дамжаагүй');

  const calState = new URL(startJson.url).searchParams.get('state');
  nextCalendarExchange = { email: ALLOWED, emailVerified: true, sub: 'google-sub-1', refreshToken: 'cal-refresh-1', scope: 'openid https://www.googleapis.com/auth/calendar.readonly' };
  const cbRes = await fetch(`${baseUrl}/api/auth/google/calendar/callback?code=xyz&state=${encodeURIComponent(calState)}`, noRedirect);
  assert.equal(cbRes.status, 302);
  assert.match(cbRes.headers.get('location'), /settings=1/);

  const tok = db.getGoogleTokens(user.id);
  assert.equal(tok.refresh_token, 'cal-refresh-1');
  assert.equal(tok.calendar_connected, 1);

  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${access}` } });
  assert.equal((await me.json()).user.calendarConnected, true);

  // ---- disconnect ----
  const discRes = await fetch(`${baseUrl}/api/auth/google/calendar/disconnect`, { method: 'POST', headers: { Authorization: `Bearer ${access}` } });
  assert.equal(discRes.status, 200);
  const tok2 = db.getGoogleTokens(user.id);
  assert.equal(tok2.calendar_connected, 0);
  assert.equal(tok2.refresh_token, null);
  const me2 = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${access}` } });
  assert.equal((await me2.json()).user.calendarConnected, false);
});

test('Calendar callback: login-ий oauth_state-ийг ашиглахад татгалзана (CSRF namespace давхцахгүй)', async () => {
  const loginState = await freshState(); // typ='oauth_state', sub алга
  nextCalendarExchange = { refreshToken: 'should-not-save', scope: 'openid calendar.readonly' };
  const cbRes = await fetch(`${baseUrl}/api/auth/google/calendar/callback?code=xyz&state=${encodeURIComponent(loginState)}`, noRedirect);
  assert.match(cbRes.headers.get('location'), /calendarError=1/);
});

// ===================== AUTH_OPEN_SIGNUP + ISOLATION =====================

test('AUTH_OPEN_SIGNUP=true: allow-list-гүй email нэвтэрч шинэ хэрэглэгч үүснэ, БАЙГАА хэрэглэгчийн гүйлгээг ХАРАХГҮЙ (isolation)', async () => {
  const db2 = createDb(':memory:');
  // owner (allow-listed) хэрэглэгч + гүйлгээ seed
  const owner = db2.upsertGoogleUser({ email: ALLOWED, sub: 'owner-sub', picture: null });
  db2.insertTransaction({
    userId: owner.id, messageId: 'm1', amount: 1000, currency: 'MNT',
    date: '2026-01-01', description: 'owner txn', type: 'expense', category: 'Хүнсний зүйл',
  });
  db2.insertTransaction({
    userId: owner.id, messageId: 'm2', amount: 2000, currency: 'MNT',
    date: '2026-01-02', description: 'owner txn 2', type: 'income',
  });

  const app2 = createApp({
    db: db2, apiKey: API_KEY, jwtSecret: JWT_SECRET,
    rateLimit: { windowSeconds: 60, max: 100000 },
    localAuth: false,
    google: {
      loginProvider: mockLogin, calendarProvider: mockCalendar,
      allowedEmails: new Set([ALLOWED]), openSignup: true, dashboardBaseUrl: '',
    },
  });
  const srv2 = await new Promise((resolve) => {
    const s = app2.listen(0, () => resolve(s));
  });
  const base2 = `http://127.0.0.1:${srv2.address().port}`;

  try {
    // шинэ (allow-list-д БАЙХГҮЙ) хэрэглэгч нэвтэрнэ
    const startR = await fetch(`${base2}/api/auth/google`, noRedirect);
    const state = new URL(startR.headers.get('location')).searchParams.get('state');
    nextLoginExchange = { email: 'newbie@example.com', emailVerified: true, sub: 'newbie-sub', refreshToken: 'x', scope: 'openid email profile' };
    const cbR = await fetch(`${base2}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, noRedirect);
    assert.equal(cbR.status, 302);
    const loc = cbR.headers.get('location');
    assert.match(loc, /#access=/, 'open signup дор шинэ хэрэглэгч нэвтэрч чадсангүй');

    const newUser = db2.getUserByEmail('newbie@example.com');
    assert.ok(newUser, 'шинэ хэрэглэгч үүсээгүй');
    assert.notEqual(newUser.id, owner.id);

    const newAccess = decodeURIComponent(new URL(loc, base2).hash.match(/access=([^&]+)/)[1]);
    const txRes = await fetch(`${base2}/api/transactions`, { headers: { Authorization: `Bearer ${newAccess}` } });
    assert.equal(txRes.status, 200);
    const txJson = await txRes.json();
    assert.equal(txJson.total, 0, 'шинэ хэрэглэгч owner-ийн гүйлгээг харж байна — isolation зөрчигдсөн!');
    assert.deepEqual(txJson.data, []);
  } finally {
    await new Promise((r) => srv2.close(r));
    db2.close();
  }
});

test('AUTH_OPEN_SIGNUP=false (энэ файлын үндсэн app): allow-list-гүй email хэвээр татгалзсаар байна', async () => {
  const r = await loginAs({ email: 'still-not-allowed@example.com', sub: 'sub-x' });
  assert.match(r.headers.get('location'), /error=not_allowed/);
});
