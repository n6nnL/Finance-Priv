// ============================================================
//  test/telegram.test.js — Telegram linking код API (JWT-only routes)
//  + db.js функцүүд (createTelegramLinkCode/getTelegramLink/disconnectTelegram)
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { createApp } from '../app.js';

const API_KEY = 'telegram-test-key';
const JWT_SECRET = 'test-jwt-secret';

let server, baseUrl, db, access, userId;

before(async () => {
  db = createDb(':memory:');
  const user = db.upsertGoogleUser({ email: 'tguser@example.com', sub: 'sub-tg' });
  userId = user.id;
  const app = createApp({
    db, apiKey: API_KEY, jwtSecret: JWT_SECRET,
    rateLimit: { windowSeconds: 60, max: 100000 },
    localAuth: false,
    google: { allowedEmails: new Set(), openSignup: false, dashboardBaseUrl: '' },
  });
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });

  // JWT-г шууд jwt модулиар mint (login flow дундаас гарахгүйгээр)
  const { createJwt } = await import('../auth/jwt.js');
  access = createJwt({ secret: JWT_SECRET }).signAccess(user);
});
after(async () => { await new Promise((r) => server.close(r)); db.close(); });

test('POST /api/telegram/link-code: JWT-гүй → 401', async () => {
  const r = await fetch(`${baseUrl}/api/telegram/link-code`, { method: 'POST' });
  assert.equal(r.status, 401);
});

test('POST /api/telegram/link-code: 6 оронтой код + TTL буцаана, /me-д telegramConnected=false', async () => {
  const r = await fetch(`${baseUrl}/api/telegram/link-code`, { method: 'POST', headers: { Authorization: `Bearer ${access}` } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.code, /^\d{6}$/);
  assert.ok(j.expiresAt);

  const me = await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${access}` } })).json();
  assert.equal(me.user.telegramConnected, false);
});

test('createTelegramLinkCode: дахин дуудахад хуучин ашиглаагүй кодыг цэвэрлэнэ', () => {
  const c1 = db.createTelegramLinkCode(userId);
  const c2 = db.createTelegramLinkCode(userId);
  assert.notEqual(c1.code, c2.code);
  const stillExists = db._raw.prepare('SELECT 1 FROM telegram_link_codes WHERE code=?').get(c1.code);
  assert.equal(stillExists, undefined, 'хуучин код цэвэрлэгдээгүй');
});

test('getTelegramLink/disconnectTelegram: холбогдоогүй бол null, шууд DB-ээр холбож unlink шалгах', () => {
  assert.equal(db.getTelegramLink(userId), null);
  db._raw.prepare(
    `INSERT INTO telegram_links (user_id, chat_id) VALUES (?, ?)`
  ).run(userId, '123456789');
  const link = db.getTelegramLink(userId);
  assert.equal(link.chatId, '123456789');

  db.disconnectTelegram(userId);
  assert.equal(db.getTelegramLink(userId), null);
});

test('POST /api/telegram/unlink: JWT-тэй, 200; давхар дуудахад ч 200 (idempotent)', async () => {
  db._raw.prepare(`INSERT INTO telegram_links (user_id, chat_id) VALUES (?, ?)`).run(userId, '987');
  const r1 = await fetch(`${baseUrl}/api/telegram/unlink`, { method: 'POST', headers: { Authorization: `Bearer ${access}` } });
  assert.equal(r1.status, 200);
  assert.equal(db.getTelegramLink(userId), null);
  const r2 = await fetch(`${baseUrl}/api/telegram/unlink`, { method: 'POST', headers: { Authorization: `Bearer ${access}` } });
  assert.equal(r2.status, 200);
});

test('/me: telegramConnected=true холбогдсоны дараа', async () => {
  db._raw.prepare(`INSERT INTO telegram_links (user_id, chat_id) VALUES (?, ?)`).run(userId, '555');
  const me = await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${access}` } })).json();
  assert.equal(me.user.telegramConnected, true);
});
