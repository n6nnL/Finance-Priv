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
 * Dashboard session token — API key-ээс HMAC-аар гаргана. Хэрэглэгчийн нэр/нууц
 * үг зөв бол энэ token-г буцаана. Бодит API key browser-т хэзээ ч гарахгүй.
 */
export function dashboardToken(apiKey, user, password) {
  if (!apiKey || !password) return null;
  return createHmac('sha256', apiKey).update(`dash|${user}|${password}`).digest('hex');
}

/**
 * Auth middleware factory.
 * Хүлээн авах key: (a) LISTENER_API_KEY (listener/discord — машин хооронд) эсвэл
 * (b) dashboard session token (browser, нэвтэрсний дараа).
 * @param {{ apiKey: string, hmacSecret?: string, dashboardUser?: string, dashboardPassword?: string }} opts
 */
export function createAuth({ apiKey, hmacSecret, dashboardUser, dashboardPassword }) {
  const dashToken = dashboardToken(apiKey, dashboardUser, dashboardPassword);
  return function auth(req, res, next) {
    const provided = extractKey(req);
    if (!provided) {
      logger.warn('Auth амжилтгүй — key байхгүй', { ip: req.ip, path: req.path });
      return res.status(401).json({ status: 'error', error: 'Unauthorized' });
    }

    // (b) Dashboard token — HMAC шаардахгүй
    if (dashToken && safeEqual(provided, dashToken)) return next();

    // (a) Listener/discord API key
    if (!safeEqual(provided, apiKey)) {
      logger.warn('Auth амжилтгүй — key буруу', { ip: req.ip, path: req.path });
      return res.status(401).json({ status: 'error', error: 'Unauthorized' });
    }
    // API key мөн бол HMAC (тохируулсан үед body гарын үсэг)
    if (hmacSecret) {
      const sig = req.get('x-signature');
      const body = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const expected = createHmac('sha256', hmacSecret).update(body).digest('hex');
      if (!sig || !safeEqual(sig, expected)) {
        logger.warn('Auth амжилтгүй — HMAC таарахгүй', { ip: req.ip });
        return res.status(401).json({ status: 'error', error: 'Invalid signature' });
      }
    }
    return next();
  };
}

/**
 * Нэвтрэх handler factory: POST /api/login { username, password }.
 * Зөв бол dashboard token буцаана. (auth ШААРДАХГҮЙ маршрут.)
 */
export function createLoginHandler({ apiKey, user, password }) {
  return function login(req, res) {
    if (!password) {
      return res.status(503).json({ status: 'error', error: 'Нэвтрэлт тохируулаагүй (DASHBOARD_PASSWORD)' });
    }
    const u = String(req.body?.username ?? '');
    const p = String(req.body?.password ?? '');
    if (!safeEqual(u, user) || !safeEqual(p, password)) {
      logger.warn('Login амжилтгүй', { ip: req.ip });
      return res.status(401).json({ status: 'error', error: 'Нэр эсвэл нууц үг буруу' });
    }
    return res.status(200).json({ status: 'ok', token: dashboardToken(apiKey, user, password) });
  };
}

export default createAuth;
