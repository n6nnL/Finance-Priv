// ============================================================
//  routes/auth.js — нэвтрэлт (register/login/refresh нь PUBLIC, me нь authed)
// ============================================================

import { Router } from 'express';
import { hashPassword } from '../auth/passwordHash.js';
import { logger } from '../logger.js';

function publicUser(u) {
  return u ? { id: u.id, email: u.email, role: u.role } : null;
}

/**
 * Public auth router: POST /register, /login, /refresh.
 * @param {{ db, jwt, provider, allowRegister }} deps
 */
export function createAuthRouter({ db, jwt, provider, allowRegister }) {
  const router = Router();

  // ---- POST /api/auth/register ----
  router.post('/register', async (req, res) => {
    try {
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
