// ============================================================
//  middleware/rateLimit.js — Энгийн in-memory fixed-window rate limiter
//  (нэмэлт пакетгүй). Нэг key (API key + IP)-д цонх тутамд хязгаар.
//
//  ⚠️ Энэ нь нэг процессын санах ойд ажилладаг. Олон instance / cluster-т
//  Redis суурьтай limiter руу шилжүүлэхийг README-д тэмдэглэв.
// ============================================================

import { logger } from '../logger.js';

/**
 * @param {{ windowSeconds: number, max: number }} opts
 */
export function createRateLimit({ windowSeconds, max }) {
  const windowMs = windowSeconds * 1000;
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map();

  // Хуучирсан bucket-уудыг тогтмол цэвэрлэх (санах ой хуримтлахаас сэргийлэх)
  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }, windowMs);
  if (cleaner.unref) cleaner.unref();

  return function rateLimit(req, res, next) {
    if (max <= 0) return next(); // 0 буюу сөрөг бол хязгааргүй

    const key = `${req.get('x-api-key') || 'nokey'}:${req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;

    const remaining = Math.max(max - b.count, 0);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));

    if (b.count > max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      logger.warn('Rate limit хэтэрлээ', { key, ip: req.ip });
      return res.status(429).json({ status: 'error', error: 'Too Many Requests', retryAfter });
    }
    return next();
  };
}

export default createRateLimit;
