// ============================================================
//  app.js — Express app factory (тест боломжтой)
//  createApp(deps) → express app (listen хийхгүй).
//  server.js production-д listen хийнэ; тестүүд энэ factory-г ашиглана.
// ============================================================

import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from './middleware/auth.js';
import { createRateLimit } from './middleware/rateLimit.js';
import { createTransactionsRouter } from './routes/transactions.js';
import { createMetaRouter } from './routes/meta.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @param {{
 *   db: object,
 *   ai?: object,
 *   apiKey: string,
 *   hmacSecret?: string,
 *   bodyLimit?: string,
 *   rateLimit?: { windowSeconds: number, max: number }
 * }} deps
 */
export function createApp(deps) {
  const {
    db,
    ai,
    apiKey,
    hmacSecret = '',
    bodyLimit = '100kb',
    rateLimit = { windowSeconds: 60, max: 120 },
  } = deps;

  const app = express();

  // Reverse proxy (nginx г.м)-ийн ард байвал req.ip зөв болгоно
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  // JSON parser — body хэмжээний хязгаар + HMAC-д зориулж raw body хадгалах
  app.use(
    express.json({
      limit: bodyLimit,
      verify: (req, _res, buf) => {
        req.rawBody = buf; // HMAC баталгаажуулалтад хэрэгтэй
      },
    })
  );

  // Эрүүл мэндийн шалгалт (auth-гүй)
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  // Rate limit → Auth → routes (бүх /api auth-аар хамгаалагдсан)
  const rateLimitMw = createRateLimit(rateLimit);
  const authMw = createAuth({ apiKey, hmacSecret });

  app.use('/api/transactions', rateLimitMw, authMw, createTransactionsRouter({ db, ai }));
  app.use('/api', rateLimitMw, authMw, createMetaRouter({ db, ai }));

  // --- Production: баригдсан dashboard-г serve хийх (нэг origin → CORS хэрэггүй) ---
  const distDir = join(__dirname, '..', 'dashboard', 'dist');
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    // SPA fallback (API биш бүх замыг index.html руу)
    app.get(/^(?!\/api|\/health).*/, (_req, res) => {
      res.sendFile(join(distDir, 'index.html'));
    });
    logger.info('Dashboard static serve идэвхтэй', { distDir });
  }

  // 404 (API замууд)
  app.use((req, res) => {
    res.status(404).json({ status: 'error', error: 'Not Found' });
  });

  // JSON parse алдаа болон бусад алдаа барих (төгсгөлийн error handler)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ status: 'error', error: 'Payload Too Large' });
    }
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      return res.status(400).json({ status: 'error', error: 'Invalid JSON' });
    }
    logger.error('Барьцаагүй алдаа', { err: err?.message });
    return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
  });

  return app;
}

export default createApp;
