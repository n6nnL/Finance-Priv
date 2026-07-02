// ============================================================
//  test/token-crypto.test.js — tokenCrypto (AES-256-GCM) unit тест
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptToken, decryptToken, isEncrypted } from '../../config/tokenCrypto.js';

const KEY = 'a'.repeat(64); // 32 byte hex (тестийн түлхүүр)
const OTHER_KEY = 'b'.repeat(64);

test('roundtrip: encrypt → decrypt буцаад ижил', () => {
  const plain = '1//refresh-token-example-value';
  const enc = encryptToken(plain, KEY);
  assert.notEqual(enc, plain);
  assert.ok(isEncrypted(enc));
  assert.match(enc, /^enc:v1:/);
  assert.equal(decryptToken(enc, KEY), plain);
});

test('encrypt идемпотент: аль хэдийн шифрлэгдсэн утгыг дахин шифрлэхгүй', () => {
  const enc = encryptToken('tok', KEY);
  assert.equal(encryptToken(enc, KEY), enc);
});

test('decrypt: шифрлэгдээгүй (хуучин plaintext) утгыг шууд буцаана', () => {
  assert.equal(decryptToken('plain-legacy-token', KEY), 'plain-legacy-token');
});

test('хоосон/null утга хэвээр', () => {
  assert.equal(encryptToken(null, KEY), null);
  assert.equal(encryptToken('', KEY), '');
  assert.equal(decryptToken(null, KEY), null);
  assert.equal(decryptToken('', KEY), '');
});

test('tamper → throw (GCM auth tag)', () => {
  const enc = encryptToken('secret', KEY);
  const parts = enc.slice('enc:v1:'.length).split(':');
  const ct = Buffer.from(parts[2], 'base64');
  ct[0] ^= 0xff; // ciphertext-ийг гэмтээнэ
  const tampered = 'enc:v1:' + [parts[0], parts[1], ct.toString('base64')].join(':');
  assert.throws(() => decryptToken(tampered, KEY));
});

test('өөр key-ээр decrypt → throw', () => {
  const enc = encryptToken('secret', KEY);
  assert.throws(() => decryptToken(enc, OTHER_KEY));
});

test('буруу key формат → throw', () => {
  assert.throws(() => encryptToken('x', 'short'), /64 hex/);
  assert.throws(() => encryptToken('x', ''), /64 hex/);
});
