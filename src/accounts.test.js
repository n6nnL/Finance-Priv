// ============================================================
//  accounts.test.js — API DB-ээс данс унших/seed/status (multi-tenant)
//  API-ийн createDb-ээр бодит schema-тай түр файл DB үүсгэж шалгана
//  (listener бодит байдалд яг ийм файлыг нээдэг).
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../api/db.js';
import { createAccountsStore } from './accounts.js';
import { isEncrypted } from '../config/tokenCrypto.js';

const KEY = 'c'.repeat(64);
let dir, dbPath, apiDb, store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'accounts-test-'));
  dbPath = join(dir, 'api.sqlite');
  apiDb = createDb(dbPath, { tokenEncKey: KEY });
  // 2 хэрэглэгч: owner + B
  apiDb.upsertGoogleUser({ email: 'owner@example.com', sub: 'sub-owner' });
  apiDb.upsertGoogleUser({ email: 'b@example.com', sub: 'sub-b' });
  store = createAccountsStore({ apiDbPath: dbPath, tokenEncKey: KEY });
});

after(() => {
  store.close();
  apiDb.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('seedOwnerFromEnv: env token-ыг owner-т шифрлэж оруулна (идемпотент)', () => {
  const seeded = store.seedOwnerFromEnv({ refreshToken: 'legacy-refresh-token', email: 'Inbox@Gmail.com' });
  assert.equal(seeded, true);

  // DB-д ил текстээр ХАДГАЛАГДААГҮЙ
  const raw = apiDb._raw.prepare('SELECT gmail_refresh_token, gmail_email FROM google_tokens WHERE user_id = 1').get();
  assert.ok(isEncrypted(raw.gmail_refresh_token), 'token ил текстээр байна!');
  assert.equal(raw.gmail_email, 'inbox@gmail.com');

  // Дахин дуудахад юу ч хийхгүй (идемпотент)
  assert.equal(store.seedOwnerFromEnv({ refreshToken: 'other-token', email: 'x@y.z' }), false);
  const raw2 = apiDb._raw.prepare('SELECT gmail_refresh_token FROM google_tokens WHERE user_id = 1').get();
  assert.equal(raw2.gmail_refresh_token, raw.gmail_refresh_token, 'seed давхар бичигдсэн');
});

test('listActiveAccounts: decrypt зөв, зөвхөн active данс', () => {
  const accounts = store.listActiveAccounts();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].userId, 1);
  assert.equal(accounts[0].email, 'inbox@gmail.com');
  assert.equal(accounts[0].refreshToken, 'legacy-refresh-token'); // тайлагдсан
  assert.equal(accounts[0].oauthClient, 'desktop'); // legacy seed → desktop client

  // B хэрэглэгч Gmail холбоно (API-ийн saveGmailTokens загвараар)
  apiDb.saveGmailTokens(2, { refreshToken: 'b-refresh', scope: 'https://mail.google.com/', email: 'b-inbox@gmail.com' });
  const two = store.listActiveAccounts();
  assert.equal(two.length, 2);
  const b = two.find((a) => a.userId === 2);
  assert.equal(b.refreshToken, 'b-refresh');
  assert.equal(b.email, 'b-inbox@gmail.com');
  assert.equal(b.oauthClient, 'web'); // Settings-ээс холбосон → web client (unauthorized_client incident)
});

test('markReauthNeeded: тухайн данс жагсаалтаас гарна, БУСАД хэвээр (fault isolation)', () => {
  store.markReauthNeeded(1);
  const accounts = store.listActiveAccounts();
  assert.equal(accounts.length, 1, 'reauth_needed данс жагсаалтад үлдсэн эсвэл бусад нь унасан');
  assert.equal(accounts[0].userId, 2);

  // API талд /me-д харагдах төлөв
  assert.equal(apiDb.getGmailInfo(1).status, 'reauth_needed');
  assert.equal(apiDb.getGmailInfo(1).connected, true);
});

test('disconnectGmail (API тал) → listener жагсаалтаас гарна', () => {
  apiDb.disconnectGmail(2);
  assert.equal(store.listActiveAccounts().length, 0);
});
