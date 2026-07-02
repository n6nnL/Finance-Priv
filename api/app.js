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
import { createBudgetRouter } from './routes/budget.js';
import { createTelegramRouter } from './routes/telegram.js';
import { createAuthRouter, createMeHandler, createCalendarConnectHandlers, createGmailConnectHandlers } from './routes/auth.js';
import { createJwt } from './auth/jwt.js';
import { createLocalProvider } from './auth/providers/local.js';
import { createGoogleProvider, LOGIN_SCOPES, CALENDAR_SCOPES, GMAIL_SCOPES } from './auth/providers/google.js';
import { logger } from './logger.js';
import { record5xx } from './ops-notify.js';

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
    jwtSecret,
    jwtAccessTtl = '30m',
    jwtRefreshTtl = '30d',
    allowRegister = false,
    localAuth = false,
    google = {},
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

  const rateLimitMw = createRateLimit(rateLimit);
  const jwt = createJwt({ secret: jwtSecret || apiKey, accessTtl: jwtAccessTtl, refreshTtl: jwtRefreshTtl });
  const provider = createLocalProvider({ db });
  const loginClientId = google.login?.clientId || '';
  const loginClientSecret = google.login?.clientSecret || '';
  const loginGoogleProvider = google.loginProvider || createGoogleProvider({
    clientId: loginClientId,
    clientSecret: loginClientSecret,
    redirectUri: google.login?.redirectUri || '',
    scopes: LOGIN_SCOPES,
    offline: false,
  });
  const calendarGoogleProvider = google.calendarProvider || createGoogleProvider({
    clientId: loginClientId,
    clientSecret: loginClientSecret,
    redirectUri: google.calendarRedirectUri || '',
    scopes: CALENDAR_SCOPES,
    offline: true,
  });
  // Gmail холболт — listener-ийн Gmail client (login client-ээс ТУСДАА)
  const gmailGoogleProvider = google.gmailProvider || createGoogleProvider({
    clientId: google.gmail?.clientId || '',
    clientSecret: google.gmail?.clientSecret || '',
    redirectUri: google.gmailRedirectUri || '',
    scopes: GMAIL_SCOPES,
    offline: true,
  });
  const ownerUserId = db.getOwnerUserId(); // machine (API key) дуудлага хамаарах хэрэглэгч
  const authMw = createAuth({ apiKey, hmacSecret, jwt, ownerUserId });

  // PUBLIC auth (google/login/register/refresh/calendar-callback) — auth ШААРДАХГҮЙ, rate limit-тэй
  app.use('/api/auth', rateLimitMw, createAuthRouter({
    db, jwt, provider, allowRegister, localAuth,
    loginGoogleProvider, calendarGoogleProvider, gmailGoogleProvider,
    openSignup: google.openSignup || false,
    allowedEmails: google.allowedEmails || new Set(),
    dashboardBaseUrl: google.dashboardBaseUrl || '',
  }));
  // /api/auth/me — authed
  app.get('/api/auth/me', rateLimitMw, authMw, createMeHandler({ db }));
  // Calendar холбох/салгах — authed (JWT шаардана)
  const calendarHandlers = createCalendarConnectHandlers({ db, jwt, calendarGoogleProvider });
  app.get('/api/auth/google/calendar', rateLimitMw, authMw, calendarHandlers.start);
  app.post('/api/auth/google/calendar/disconnect', rateLimitMw, authMw, calendarHandlers.disconnect);
  // Gmail холбох/салгах — authed (JWT шаардана)
  const gmailHandlers = createGmailConnectHandlers({ db, jwt, gmailGoogleProvider });
  app.get('/api/auth/gmail/connect', rateLimitMw, authMw, gmailHandlers.start);
  app.post('/api/auth/gmail/disconnect', rateLimitMw, authMw, gmailHandlers.disconnect);

  // Бусад бүх /api — auth-аар хамгаалагдсан (JWT эсвэл machine API key)
  app.use('/api/transactions', rateLimitMw, authMw, createTransactionsRouter({ db, ai }));
  app.use('/api', rateLimitMw, authMw, createMetaRouter({ db, ai }));
  app.use('/api', rateLimitMw, authMw, createBudgetRouter({ db }));
  app.use('/api/telegram', rateLimitMw, authMw, createTelegramRouter({ db }));

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
    // Тогтвортой 5xx илэрвэл ops сэрэмжлүүлэг (record5xx дотроо debounce-той).
    record5xx({ message: err?.message, code: err?.code });
    return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
  });

  return app;
}

export default createApp;
