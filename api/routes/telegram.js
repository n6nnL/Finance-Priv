// ============================================================
//  routes/telegram.js — Telegram холбох (linking код) — JWT-only
//
//  Bot нь ЭНЭ router-г ашигладаггүй (chat_id→user_id resolve, код consume
//  зэргийг bot өөрөө ижил DB-ээс шууд уншиж/бичдэг — telegram/db.js).
//  Энд зөвхөн dashboard хэрэглэгч (JWT) кодоо үүсгэх/холболтоо салгах.
// ============================================================

import { Router } from 'express';
import { logger } from '../logger.js';

/** @param {{ db: object }} deps */
export function createTelegramRouter({ db }) {
  const router = Router();

  // ---- POST /api/telegram/link-code — нэг удаагийн код (10 мин) ----
  router.post('/link-code', (req, res) => {
    try {
      const { code, expiresAt } = db.createTelegramLinkCode(req.userId);
      return res.status(200).json({ status: 'ok', code, expiresAt });
    } catch (err) {
      logger.error('POST /telegram/link-code алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- POST /api/telegram/unlink — холболт салгах ----
  router.post('/unlink', (req, res) => {
    try {
      db.disconnectTelegram(req.userId);
      return res.status(200).json({ status: 'ok' });
    } catch (err) {
      logger.error('POST /telegram/unlink алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  return router;
}

export default createTelegramRouter;
