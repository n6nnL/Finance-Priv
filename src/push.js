// ============================================================
//  push.js — Гүйлгээг вэбсайтын API руу POST хийх + retry
//
//  - JSON body
//  - Auth: x-api-key header + (optional) HMAC гарын үсэг
//  - Idempotency-Key header = Message-ID (API тал давхардлыг таслана)
//  - Exponential backoff-той дахин оролдлого
// ============================================================

import { createHmac } from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * HMAC-SHA256 гарын үсэг (тохируулсан бол).
 * Сервер тал ижил secret-ээр body-г verify хийнэ.
 */
function signBody(bodyString) {
  if (!config.website.hmacSecret) return null;
  return createHmac('sha256', config.website.hmacSecret).update(bodyString).digest('hex');
}

/**
 * Нэг гүйлгээг API руу илгээх (retry-той).
 *
 * @param {object} payload - API руу явуулах JSON object
 * @param {string} idempotencyKey - Message-ID
 * @returns {Promise<{ok: boolean, status?: number, attempts: number, error?: string}>}
 */
export async function pushTransaction(payload, idempotencyKey) {
  const bodyString = JSON.stringify(payload);
  const maxRetries = config.website.maxRetries;

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': config.website.apiKey,
    'Idempotency-Key': idempotencyKey ?? '',
  };
  const sig = signBody(bodyString);
  if (sig) headers['x-signature'] = sig;

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Хүсэлт хэт удвал таслах (30с timeout)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);

      const res = await fetch(config.website.apiUrl, {
        method: 'POST',
        headers,
        body: bodyString,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        logger.info(
          { status: res.status, attempt, idempotencyKey },
          'Push амжилттай'
        );
        return { ok: true, status: res.status, attempts: attempt };
      }

      // 4xx (409 Conflict = аль хэдийн орсон) → давтахгүй
      if (res.status === 409) {
        logger.info({ idempotencyKey }, 'API: аль хэдийн бүртгэгдсэн (409) — амжилттай гэж үзнэ');
        return { ok: true, status: 409, attempts: attempt };
      }
      // 429 Too Many Requests → дахин оролдоно (Retry-After хүндэтгэнэ).
      // Catch-up үед олон гүйлгээ зэрэг илгээхэд rate limit идэвхжиж болзошгүй.
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'));
        lastError = `HTTP 429 (rate limited)`;
        logger.warn({ attempt, idempotencyKey, retryAfter }, 'Push 429 — rate limit, дахин оролдоно');
        if (attempt < maxRetries) {
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000 + Math.floor(Math.random() * 300)
            : Math.min(1000 * 2 ** (attempt - 1), 30_000) + Math.floor(Math.random() * 300);
          await sleep(wait);
        }
        continue;
      }
      if (res.status >= 400 && res.status < 500) {
        const txt = await res.text().catch(() => '');
        lastError = `HTTP ${res.status}: ${txt.slice(0, 200)}`;
        logger.warn({ status: res.status, attempt, idempotencyKey }, `Push 4xx — давтахгүй: ${lastError}`);
        return { ok: false, status: res.status, attempts: attempt, error: lastError };
      }

      // 5xx → дахин оролдоно
      lastError = `HTTP ${res.status}`;
      logger.warn({ status: res.status, attempt, idempotencyKey }, 'Push 5xx — дахин оролдоно');
    } catch (err) {
      lastError = err?.message ?? String(err);
      logger.warn({ attempt, idempotencyKey, err: lastError }, 'Push алдаа — дахин оролдоно');
    }

    // Сүүлийн оролдлого биш бол backoff хүлээнэ: 1с,2с,4с... (jitter-тэй)
    if (attempt < maxRetries) {
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000) + Math.floor(Math.random() * 300);
      await sleep(delay);
    }
  }

  logger.error({ idempotencyKey, err: lastError }, 'Push бүх оролдлого амжилтгүй');
  return { ok: false, attempts: maxRetries, error: lastError };
}

export default pushTransaction;
