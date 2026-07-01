// ============================================================
//  test/google-auth.test.js — Google нэвтрэлт (allow-list, upsert, token)
//  Mock google provider тарина (бодит сүлжээ ХЭРЭГГҮЙ). redirect-ийг
//  гар аргаар дагана (manual redirect) → fragment-аас JWT задлана.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';

const API_KEY = 'gauth-test-key';
const JWT_SECRET = 'test-jwt-secret';
const ALLOWED = 'me@example.com';

let server, baseUrl, db;

// Mock Google provider — exchangeCode-г тестийн хяналттай утга буцаадаг болгоно.
let nextExchange = null; // { email, emailVerified, sub, picture, refreshToken, scope }
const mockGoogle = {
  name: 'google',
  enabled: true,
  getAuthUrl: (state) => `https://accounts.google.test/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`,
  exchangeCode: async (_code) => nextExchange,
};

before(async () => {
  db = createDb(':memory:');
  const app = createApp({
    db, apiKey: API_KEY, jwtSecret: JWT_SECRET,
    rateLimit: { windowSeconds: 60, max: 100000 },
    localAuth: false, // Google нь хүний цорын ганц нэвтрэлт
    google: {
      provider: mockGoogle,
      allowedEmails: new Set([ALLOWED]),
      dashboardBaseUrl: '', // relative
    },
  });
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
});

// callback-д хүчинтэй state хэрэгтэй тул эхлээд /google-аас аваад дахин ашиглана.
async function freshState() {
  const r = await fetch(`${baseUrl}/api/auth/google`, noRedirect);
  const loc = new URL(r.headers.get('location'));
  return loc.searchParams.get('state');
}

test('callback: allow-listed email → хэрэглэгч үүснэ + Calendar token + JWT (fragment)', async () => {
  nextExchange = {
    email: ALLOWED, emailVerified: true, sub: 'google-sub-1', picture: 'http://x/p.png',
    refreshToken: 'refresh-xyz', scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
  };
  const state = await freshState();
  const r = await fetch(`${baseUrl}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, noRedirect);
  assert.equal(r.status, 302);
  const loc = r.headers.get('location');
  // fragment-д access/refresh JWT (query биш)
  assert.match(loc, /#access=/);
  assert.match(loc, /[&#]refresh=/);

  // хэрэглэгч үүссэн
  const user = db.getUserByEmail(ALLOWED);
  assert.ok(user, 'хэрэглэгч үүсээгүй');
  assert.equal(user.google_sub, 'google-sub-1');

  // Calendar token хадгалагдсан (НУУЦ — DB-д шалгана)
  const tok = db.getGoogleTokens(user.id);
  assert.equal(tok.refresh_token, 'refresh-xyz');
  assert.equal(tok.calendar_connected, 1);

  // гарсан access token-оор /me ажиллана
  const access = decodeURIComponent(new URL(loc, baseUrl).hash.match(/access=([^&]+)/)[1]);
  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${access}` } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, ALLOWED);
});

test('callback: refresh_token дахин null ирвэл хуучныг хадгална (COALESCE)', async () => {
  const user = db.getUserByEmail(ALLOWED);
  nextExchange = { email: ALLOWED, emailVerified: true, sub: 'google-sub-1', picture: null,
    refreshToken: null, scope: 'openid email https://www.googleapis.com/auth/calendar.readonly' };
  const state = await freshState();
  await fetch(`${baseUrl}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, noRedirect);
  assert.equal(db.getGoogleTokens(user.id).refresh_token, 'refresh-xyz', 'хуучин refresh_token устсан');
});

test('callback: allow-list-д БАЙХГҮЙ email → татгалзана, хэрэглэгч үүсэхгүй', async () => {
  nextExchange = { email: 'intruder@example.com', emailVerified: true, sub: 'sub-evil',
    refreshToken: 'r', scope: 'openid email' };
  const state = await freshState();
  const r = await fetch(`${baseUrl}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, noRedirect);
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /error=not_allowed/);
  assert.equal(db.getUserByEmail('intruder@example.com'), null, 'татгалзсан хэрэглэгч үүссэн!');
});

test('callback: баталгаажаагүй email → татгалзана', async () => {
  nextExchange = { email: ALLOWED, emailVerified: false, sub: 'google-sub-1', refreshToken: 'r', scope: 'openid email' };
  const state = await freshState();
  const r = await fetch(`${baseUrl}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, noRedirect);
  assert.match(r.headers.get('location'), /error=email_unverified/);
});

test('callback: state буруу (CSRF) → татгалзана', async () => {
  nextExchange = { email: ALLOWED, emailVerified: true, sub: 'google-sub-1', refreshToken: 'r', scope: 'openid email' };
  const r = await fetch(`${baseUrl}/api/auth/google/callback?code=abc&state=forged`, noRedirect);
  assert.match(r.headers.get('location'), /error=bad_state/);
});

test('localAuth=false үед /login, /register → 404', async () => {
  const l = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ALLOWED, password: 'x' }) });
  assert.equal(l.status, 404);
  const r = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: 'pass1234' }) });
  assert.equal(r.status, 404);
});
