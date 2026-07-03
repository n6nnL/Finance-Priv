// ============================================================
//  routes/auth.js — нэвтрэлт (register/login/refresh нь PUBLIC, me нь authed)
// ============================================================

import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { hashPassword } from '../auth/passwordHash.js';
import { logger } from '../logger.js';
import { notifyOps } from '../ops-notify.js';

function publicUser(u) {
  return u ? { id: u.id, email: u.email, role: u.role, picture: u.picture ?? null } : null;
}

/**
 * Public auth router.
 *  - Google нэвтрэлт (хүний цорын ганц нэвтрэлт): GET /google, /google/callback
 *  - Google Calendar/Gmail холбох callback-ууд (Settings-ээс эхэлдэг, JWT шаардсан
 *    эхлэл нь app.js-д authMw-тай mount хийгдэнэ; энд зөвхөн PUBLIC callback):
 *    GET /google/calendar/callback, GET /gmail/callback
 *  - Local email/нууц үг (default OFF; зөвхөн localAuth=true үед): /register, /login
 *  - /refresh
 * @param {{ db, jwt, provider, allowRegister, localAuth,
 *           loginGoogleProvider, calendarGoogleProvider, gmailGoogleProvider, openSignup,
 *           allowedEmails, dashboardBaseUrl }} deps
 */
export function createAuthRouter({
  db, jwt, provider, allowRegister,
  localAuth = false, loginGoogleProvider = null, calendarGoogleProvider = null,
  gmailGoogleProvider = null,
  openSignup = false, allowedEmails = new Set(), dashboardBaseUrl = '',
}) {
  const router = Router();
  const base = String(dashboardBaseUrl || '').replace(/\/$/, ''); // '' → relative '/'
  const errorRedirect = (code) => `${base}/?error=${encodeURIComponent(code)}`;

  // ===================== GOOGLE OAUTH (хүний нэвтрэлт) =====================
  // ---- GET /api/auth/google → consent руу redirect (минимал scope, Calendar асуухгүй) ----
  router.get('/google', (req, res) => {
    if (!loginGoogleProvider || !loginGoogleProvider.enabled) {
      return res.status(503).json({ status: 'error', error: 'Google нэвтрэлт тохируулагдаагүй' });
    }
    const state = jwt.signState({ n: randomBytes(8).toString('hex') });
    return res.redirect(loginGoogleProvider.getAuthUrl(state));
  });

  // ---- GET /api/auth/google/callback ----
  router.get('/google/callback', async (req, res) => {
    try {
      if (!loginGoogleProvider || !loginGoogleProvider.enabled) {
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
      const info = await loginGoogleProvider.exchangeCode(code);
      if (!info.email || !info.emailVerified) return res.redirect(errorRedirect('email_unverified'));

      // 3) ALLOW-LIST (сервер талд) — AUTH_OPEN_SIGNUP=true үед алгасагдана
      if (!openSignup && !allowedEmails.has(info.email)) {
        logger.warn('Google нэвтрэлт татгалзав (allow-list)', { email: info.email });
        return res.redirect(errorRedirect('not_allowed'));
      }

      // 4) хэрэглэгч upsert (Calendar token ЭНД ХАДГАЛАХГҮЙ — тусдаа opt-in flow, Settings-ээс)
      // Owner admin observability: шинэ хэрэглэгч (AUTH_OPEN_SIGNUP үед) → owner-ийн
      // OPS_WEBHOOK_URL-д мэдэгдэл (зөвхөн owner харна, тохируулаагүй бол no-op).
      const isNewUser = !db.getUserByGoogleSub(info.sub) && !db.getUserByEmail(info.email);
      const user = db.upsertGoogleUser({ email: info.email, sub: info.sub, picture: info.picture });
      if (!user) return res.redirect(errorRedirect('user_failed'));
      if (isNewUser) notifyOps('new-user-registered', new Error(`Шинэ хэрэглэгч бүртгүүлэв: ${info.email}`)).catch(() => {});

      // 5) бидний JWT → SPA руу fragment-ээр (query биш → log-д орохгүй)
      const access = jwt.signAccess(user);
      const refresh = jwt.signRefresh(user);
      return res.redirect(`${base}/#access=${encodeURIComponent(access)}&refresh=${encodeURIComponent(refresh)}`);
    } catch (err) {
      logger.error('Google callback алдаа', { err: err?.message });
      return res.redirect(errorRedirect('google_failed'));
    }
  });

  // ---- GET /api/auth/google/calendar/callback (PUBLIC — Google redirect хийдэг,
  //      Authorization header байхгүй тул state дотор шифрлэгдсэн userId-аар танина) ----
  router.get('/google/calendar/callback', async (req, res) => {
    try {
      if (!calendarGoogleProvider || !calendarGoogleProvider.enabled) {
        return res.status(503).json({ status: 'error', error: 'Google Calendar тохируулагдаагүй' });
      }
      if (req.query.error) return res.redirect(`${base}/?calendarError=1`);
      const state = jwt.verify(String(req.query.state || ''), 'calendar_oauth_state');
      if (!state || !state.sub) return res.redirect(`${base}/?calendarError=1`);
      const code = String(req.query.code || '');
      if (!code) return res.redirect(`${base}/?calendarError=1`);

      const info = await calendarGoogleProvider.exchangeCode(code);
      db.saveGoogleTokens(state.sub, { refreshToken: info.refreshToken, scope: info.scope });
      return res.redirect(`${base}/?settings=1`);
    } catch (err) {
      logger.error('Google Calendar callback алдаа', { err: err?.message });
      return res.redirect(`${base}/?calendarError=1`);
    }
  });

  // ---- GET /api/auth/gmail/callback (PUBLIC — Google redirect хийдэг; calendar
  //      callback-тай ижил загвар, тусдаа state typ = өөр CSRF namespace) ----
  router.get('/gmail/callback', async (req, res) => {
    try {
      if (!gmailGoogleProvider || !gmailGoogleProvider.enabled) {
        return res.status(503).json({ status: 'error', error: 'Gmail холболт тохируулагдаагүй' });
      }
      if (req.query.error) return res.redirect(`${base}/?gmailError=1`);
      const state = jwt.verify(String(req.query.state || ''), 'gmail_oauth_state');
      if (!state || !state.sub) return res.redirect(`${base}/?gmailError=1`);
      const code = String(req.query.code || '');
      if (!code) return res.redirect(`${base}/?gmailError=1`);

      const info = await gmailGoogleProvider.exchangeCode(code);
      if (!info.refreshToken) {
        // refresh_token-гүйгээр listener ажиллахгүй (prompt=consent тавьсан тул ховор)
        logger.warn('Gmail callback: refresh_token ирсэнгүй');
        return res.redirect(`${base}/?gmailError=1`);
      }
      // info.email = холбогдсон inbox-ийн бодит хаяг (login email-ээс өөр байж болно)
      db.saveGmailTokens(state.sub, { refreshToken: info.refreshToken, scope: info.scope, email: info.email });
      // Owner admin observability: хэн нэгэн Gmail холбох бүрд OPS_WEBHOOK_URL-д мэдэгдэл
      // (зөвхөн owner харна, тохируулаагүй бол no-op).
      const loginUser = db.getUserById(state.sub);
      notifyOps('gmail-connected', new Error(`Gmail холбогдлоо: ${loginUser?.email ?? state.sub} (inbox: ${info.email})`)).catch(() => {});
      return res.redirect(`${base}/?settings=1`);
    } catch (err) {
      logger.error('Gmail callback алдаа', { err: err?.message });
      return res.redirect(`${base}/?gmailError=1`);
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
    const u = publicUser(user);
    if (u) {
      const tokens = db.getGoogleTokens(req.userId);
      u.calendarConnected = Boolean(tokens && tokens.calendar_connected);
      const gmail = db.getGmailInfo(req.userId);
      u.gmailConnected = gmail.connected;
      u.gmailStatus = gmail.status;
      u.gmailEmail = gmail.email;
      u.telegramConnected = Boolean(db.getTelegramLink(req.userId));
    }
    return res.status(200).json({ status: 'ok', user: u, authKind: req.authKind });
  };
}

/**
 * Calendar холбох/салгах handler-ууд (authMw-ийн ард mount хийгдэнэ, app.js).
 *  - start: consent URL-г JSON-оор буцаана (302 биш) — SPA нь localStorage-д JWT
 *    хадгалдаг тул browser шууд navigate хийхэд Authorization header дамжихгүй;
 *    frontend эхлээд fetch-ээр URL авч, дараа нь өөрөө navigate хийнэ.
 * @param {{ db, jwt, calendarGoogleProvider }} deps
 */
export function createCalendarConnectHandlers({ db, jwt, calendarGoogleProvider }) {
  function start(req, res) {
    if (!calendarGoogleProvider || !calendarGoogleProvider.enabled) {
      return res.status(503).json({ status: 'error', error: 'Google Calendar тохируулагдаагүй' });
    }
    const state = jwt.signState({ typ: 'calendar_oauth_state', sub: req.userId, n: randomBytes(8).toString('hex') });
    return res.status(200).json({ status: 'ok', url: calendarGoogleProvider.getAuthUrl(state) });
  }
  function disconnect(req, res) {
    db.disconnectGoogleCalendar(req.userId);
    return res.status(200).json({ status: 'ok' });
  }
  return { start, disconnect };
}

/**
 * Gmail холбох/салгах handler-ууд (authMw-ийн ард mount, app.js) — calendar
 * handlers-ийн ижил загвар, тусдаа state typ (CSRF namespace давхцахгүй).
 * Салгахад listener дараагийн reconcile poll дээрээ холболтыг зогсооно.
 * @param {{ db, jwt, gmailGoogleProvider }} deps
 */
export function createGmailConnectHandlers({ db, jwt, gmailGoogleProvider }) {
  function start(req, res) {
    if (!gmailGoogleProvider || !gmailGoogleProvider.enabled) {
      return res.status(503).json({ status: 'error', error: 'Gmail холболт тохируулагдаагүй' });
    }
    const state = jwt.signState({ typ: 'gmail_oauth_state', sub: req.userId, n: randomBytes(8).toString('hex') });
    return res.status(200).json({ status: 'ok', url: gmailGoogleProvider.getAuthUrl(state) });
  }
  function disconnect(req, res) {
    db.disconnectGmail(req.userId);
    return res.status(200).json({ status: 'ok' });
  }
  return { start, disconnect };
}

export default createAuthRouter;
