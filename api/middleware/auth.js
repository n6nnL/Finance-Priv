// ============================================================
//  middleware/auth.js — JWT (хэрэглэгчийн dashboard) + API key (machine)
//
//  - Authorization: Bearer <JWT>  → хэрэглэгчийн нэвтрэлт. req.userId, req.userRole.
//  - X-API-Key: <LISTENER_API_KEY> → machine (listener/discord). req.userId = owner.
//  - HMAC (сонголтоор) нь API key замд хэвээр.
//
//  timing-safe харьцуулалт; нууц утга log-д хэвлэхгүй.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../logger.js';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function bearer(req) {
  const auth = req.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return null;
}

/**
 * @param {{ apiKey: string, hmacSecret?: string, jwt: object, ownerUserId: number|null }} opts
 *   jwt = createJwt(...) (verify-тэй). ownerUserId = machine дуудлага хамаарах хэрэглэгч.
 */
export function createAuth({ apiKey, hmacSecret, jwt, ownerUserId }) {
  return function auth(req, res, next) {
    // 1) JWT (хэрэглэгчийн dashboard)
    const tok = bearer(req);
    if (tok) {
      const payload = jwt && jwt.verify(tok, 'access');
      if (payload) {
        req.userId = payload.sub;
        req.userRole = payload.role || 'user';
        req.authKind = 'jwt';
        return next();
      }
      // Bearer байгаа ч буруу JWT — мөн API key байж болзошгүй тул доош үргэлжилнэ
    }

    // 2) API key (machine: listener/discord) → owner-д хамаарна
    const xKey = req.get('x-api-key') || tok; // X-API-Key эсвэл Bearer-ээр key явуулсан байж болно
    if (xKey && safeEqual(xKey, apiKey)) {
      if (hmacSecret) {
        const sig = req.get('x-signature');
        const body = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
        const expected = createHmac('sha256', hmacSecret).update(body).digest('hex');
        if (!sig || !safeEqual(sig, expected)) {
          logger.warn('Auth амжилтгүй — HMAC таарахгүй', { ip: req.ip });
          return res.status(401).json({ status: 'error', error: 'Invalid signature' });
        }
      }
      req.userId = ownerUserId;
      req.userRole = 'admin';
      req.authKind = 'apikey';
      return next();
    }

    logger.warn('Auth амжилтгүй', { ip: req.ip, path: req.path });
    return res.status(401).json({ status: 'error', error: 'Unauthorized' });
  };
}

export default createAuth;
