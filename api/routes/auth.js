// ============================================================
//  routes/auth.js — нэвтрэлт (register/login/refresh нь PUBLIC, me нь authed)
// ============================================================

import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { hashPassword } from '../auth/passwordHash.js';
import { logger } from '../logger.js';

function publicUser(u) {
  return u ? { id: u.id, email: u.email, role: u.role, picture: u.picture ?? null } : null;
}

/**
 * Public auth router.
 *  - Google нэвтрэлт (хүний цорын ганц нэвтрэлт): GET /google, /google/callback
 *  - Local email/нууц үг (default OFF; зөвхөн localAuth=true үед): /register, /login
 *  - /refresh
 * @param {{ db, jwt, provider, allowRegister, localAuth,
 *           googleProvider, allowedEmails, dashboardBaseUrl }} deps
 */
export function createAuthRouter({
  db, jwt, provider, allowRegister,
  localAuth = false, googleProvider = null, allowedEmails = new Set(), dashboardBaseUrl = '',
}) {
  const router = Router();
  const base = String(dashboardBaseUrl || '').replace(/\/$/, ''); // '' → relative '/'
  const errorRedirect = (code) => `${base}/?error=${encodeURIComponent(code)}`;

  // ===================== GOOGLE OAUTH (хүний нэвтрэлт) =====================
  // ---- GET /api/auth/google → consent руу redirect ----
  router.get('/google', (req, res) => {
    if (!googleProvider || !googleProvider.enabled) {
      return res.status(503).json({ status: 'error', error: 'Google нэвтрэлт тохируулагдаагүй' });
    }
    const state = jwt.signState({ n: randomBytes(8).toString('hex') });
    return res.redirect(googleProvider.getAuthUrl(state));
  });

  // ---- GET /api/auth/google/callback ----
  router.get('/google/callback', async (req, res) => {
    try {
      if (!googleProvider || !googleProvider.enabled) {
        return res.status(503).json({ status: 'error', error: 'Google нэвтрэлт тохируулагдаагүй' });
      }
      if (req.query.error) return res.redirect(errorRedirect('google_denied'));
      // 1) state (CSRF) шалгах
      if (!jwt.verify(String(req.query.state || ''), 'oauth_state')) {
        return res.redirect(errorRedirect('bad_state'));
      }
      const code = String(req.query.code || '');
      if (!code) return res.redirect(errorRedirect('no_code'));

      // 2) code → токен + хэрэглэгчийн мэдээлэл
      const info = await googleProvider.exchangeCode(code);
      if (!info.email || !info.emailVerified) return res.redirect(errorRedirect('email_unverified'));

      // 3) ALLOW-LIST (сервер талд) — энэ хувийн систем
      if (!allowedEmails.has(info.email)) {
        logger.warn('Google нэвтрэлт татгалзав (allow-list)', { email: info.email });
        return res.redirect(errorRedirect('not_allowed'));
      }

      // 4) хэрэглэгч upsert + Calendar token хадгалах
      const user = db.upsertGoogleUser({ email: info.email, sub: info.sub, picture: info.picture });
      if (!user) return res.redirect(errorRedirect('user_failed'));
      db.saveGoogleTokens(user.id, { refreshToken: info.refreshToken, scope: info.scope });

      // 5) бидний JWT → SPA руу fragment-ээр (query биш → log-д орохгүй)
      const access = jwt.signAccess(user);
      const refresh = jwt.signRefresh(user);
      return res.redirect(`${base}/#access=${encodeURIComponent(access)}&refresh=${encodeURIComponent(refresh)}`);
    } catch (err) {
      logger.error('Google callback алдаа', { err: err?.message });
      return res.redirect(errorRedirect('google_failed'));
    }
  });

  // ===================== LOCAL (default OFF — зөвхөн localAuth=true) =====================
  // ---- POST /api/auth/register ----
  router.post('/register', async (req, res) => {
    try {
      if (!localAuth) return res.status(404).json({ status: 'error', error: 'Not Found' });
      if (!allowRegister) {
        return res.status(403).json({ status: 'error', error: 'Бүртгэл хаалттай' });
      }
      const email = String(req.body?.email ?? '').toLowerCase().trim();
      const password = String(req.body?.password ?? '');
      if (!email || password.length < 4) {
        return res.status(400).json({ status: 'error', error: 'email болон 4+ тэмдэгт нууц үг шаардлагатай' });
      }
      if (db.getUserByEmail(email)) {
        return res.status(409).json({ status: 'error', error: 'Энэ email бүртгэлтэй' });
      }
      const user = db.createUser(email, await hashPassword(password), 'user');
      return res.status(201).json({
        status: 'ok', user: publicUser(user),
        accessToken: jwt.signAccess(user), refreshToken: jwt.signRefresh(user),
      });
    } catch (err) {
      logger.error('register алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- POST /api/auth/login ----
  router.post('/login', async (req, res) => {
    try {
      if (!localAuth) return res.status(404).json({ status: 'error', error: 'Not Found' });
      const email = String(req.body?.email ?? '').trim();
      const password = String(req.body?.password ?? '');
      const user = await provider.authenticate({ email, password });
      if (!user) {
        logger.warn('Login амжилтгүй', { ip: req.ip });
        return res.status(401).json({ status: 'error', error: 'Email эсвэл нууц үг буруу' });
      }
      return res.status(200).json({
        status: 'ok', user: publicUser(user),
        accessToken: jwt.signAccess(user), refreshToken: jwt.signRefresh(user),
      });
    } catch (err) {
      logger.error('login алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- POST /api/auth/refresh ----
  router.post('/refresh', (req, res) => {
    const token = String(req.body?.refreshToken ?? '');
    const payload = jwt.verify(token, 'refresh');
    if (!payload) return res.status(401).json({ status: 'error', error: 'refresh token буруу' });
    const user = db.getUserById(payload.sub);
    if (!user) return res.status(401).json({ status: 'error', error: 'Хэрэглэгч олдсонгүй' });
    return res.status(200).json({ status: 'ok', accessToken: jwt.signAccess(user) });
  });

  return router;
}

/** GET /api/auth/me handler (authMw-ийн ард) */
export function createMeHandler({ db }) {
  return function me(req, res) {
    const user = db.getUserById(req.userId);
    return res.status(200).json({ status: 'ok', user: publicUser(user), authKind: req.authKind });
  };
}

export default createAuthRouter;
