// ============================================================
//  test/google-provider.test.js — createGoogleProvider scope/offline unit тест
//  (LOGIN_SCOPES vs CALENDAR_SCOPES, offline flag → access_type/prompt)
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleProvider, LOGIN_SCOPES, CALENDAR_SCOPES } from '../auth/providers/google.js';

test('Login provider: calendar scope байхгүй, offline params байхгүй', () => {
  const provider = createGoogleProvider({
    clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost/cb',
    scopes: LOGIN_SCOPES, offline: false,
  });
  const url = provider.getAuthUrl('state123');
  assert.doesNotMatch(url, /calendar/);
  assert.doesNotMatch(url, /access_type/);
  assert.doesNotMatch(url, /prompt=consent/);
  assert.match(url, /state=state123/);
});

test('Calendar provider: calendar.readonly scope + offline/consent params байгаа', () => {
  const provider = createGoogleProvider({
    clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost/cb2',
    scopes: CALENDAR_SCOPES, offline: true,
  });
  const url = provider.getAuthUrl('state456');
  assert.match(url, /calendar\.readonly/);
  assert.match(url, /access_type=offline/);
  assert.match(url, /prompt=consent/);
});

test('enabled: clientId/secret байхгүй бол false', () => {
  const provider = createGoogleProvider({ clientId: '', clientSecret: '', redirectUri: '' });
  assert.equal(provider.enabled, false);
});
