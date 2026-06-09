// ============================================================
//  middleware/auth.js — API key (+ сонголтоор HMAC) шалгах
//
//  Listener тал явуулдаг:
//    X-API-Key: <key>            (эсвэл Authorization: Bearer <key>)
//    X-Signature: <hmac-sha256-hex>   (HMAC тохируулсан үед)
//
//  - API key буруу/байхгүй → 401
//  - HMAC secret тохируулсан бол body-н гарын үсгийг дахин тооцоолж тулгана
//    → таарахгүй бол 401
//
//  timing-safe харьцуулалт ашиглаж timing attack-аас хамгаална.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../logger.js';

/** Хоёр string-г тогтмол хугацаанд харьцуулах (urt ялгаатай ч аюулгүй) */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Header-аас API key-г X-API-Key эсвэл Authorization: Bearer-ээс гаргах */
function extractKey(req) {
  const xKey = req.get('x-api-key');
  if (xKey) return xKey.trim();
  const auth = req.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  return null;
}

/**
 * Auth middleware factory.
 * @param {{ apiKey: string, hmacSecret?: string }} opts
 */
export function createAuth({ apiKey, hmacSecret }) {
  return function auth(req, res, next) {
    // 1) API key
    const provided = extractKey(req);
    if (!provided || !safeEqual(provided, apiKey)) {
      logger.warn('Auth амжилтгүй — API key буруу/байхгүй', { ip: req.ip, path: req.path });
      return res.status(401).json({ status: 'error', error: 'Unauthorized' });
    }

    // 2) HMAC (тохируулсан бол)
    if (hmacSecret) {
      const sig = req.get('x-signature');
      // req.rawBody-г app.js-ийн express.json verify-д хадгална
      const body = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const expected = createHmac('sha256', hmacSecret).update(body).digest('hex');
      if (!sig || !safeEqual(sig, expected)) {
        logger.warn('Auth амжилтгүй — HMAC гарын үсэг таарахгүй', { ip: req.ip });
        return res.status(401).json({ status: 'error', error: 'Invalid signature' });
      }
    }

    return next();
  };
}

export default createAuth;
