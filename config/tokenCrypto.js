// ============================================================
//  tokenCrypto.js — OAuth refresh token-ыг DB-д хадгалахын өмнөх
//  шифрлэлт (encryption at rest). Дундын модуль: api/ (бичих/унших)
//  БА src/ listener (унших) хоёулаа ашиглана.
//
//  Алгоритм: AES-256-GCM (authenticated — tamper илэрвэл throw).
//  Түлхүүр: TOKEN_ENC_KEY env (64 hex тэмдэгт = 32 byte). Root .env
//  болон api/.env-д ИЖИЛ утга байх ёстой. Түлхүүр/token-ыг log-д
//  ХЭЗЭЭ Ч хэвлэхгүй.
//
//  Хадгалах формат: enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
//  isEncrypted() префиксээр шалгадаг тул миграц backfill идемпотент.
// ============================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const ALG = 'aes-256-gcm';

function keyBuffer(keyHex) {
  const k = String(keyHex || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error('TOKEN_ENC_KEY буруу — 64 hex тэмдэгт (32 byte) байх ёстой');
  }
  return Buffer.from(k, 'hex');
}

/** Хадгалагдсан утга шифрлэгдсэн форматтай эсэх */
export function isEncrypted(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

/** Plain token → enc:v1 формат. Аль хэдийн шифрлэгдсэн бол хэвээр буцаана (идемпотент). */
export function encryptToken(plain, keyHex) {
  if (plain == null || plain === '') return plain;
  if (isEncrypted(plain)) return plain;
  const key = keyBuffer(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/**
 * enc:v1 формат → plain token. Шифрлэгдээгүй утгыг (хуучин plaintext)
 * шууд буцаана — миграц дуусаагүй үед ч унших боломжтой.
 * Tamper/буруу key → throw.
 */
export function decryptToken(stored, keyHex) {
  if (stored == null || stored === '') return stored;
  if (!isEncrypted(stored)) return stored;
  const key = keyBuffer(keyHex);
  const parts = stored.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Шифрлэгдсэн token-ы формат буруу');
  const [ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALG, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export default { encryptToken, decryptToken, isEncrypted };
