// ============================================================
//  routes/meta.js — хураангуй, AI ангилал, overrides, categories
//
//  Маршрутууд (бүгд /api дор):
//    GET  /api/summary          — нийт зарлага/орлого + ангиллаар (шүүлттэй)
//    GET  /api/categories       — боломжит ангиллын жагсаалт (dropdown-д)
//    POST /api/ai-categorize    — AI ангилал санал { description }
//    GET  /api/overrides        — learned override жагсаалт
//    POST /api/overrides        — learned override нэмэх { merchantPattern, category }
// ============================================================

import { Router } from 'express';
import { listCategories } from '../categorize.js';
import { logger } from '../logger.js';

export function createMetaRouter({ db, ai }) {
  const router = Router();

  // ---- GET /api/summary — хураангуй (шүүлттэй) ----
  router.get('/summary', (req, res) => {
    try {
      const { from, to, category, type, q, minAmount, maxAmount } = req.query;
      const summary = db.getSummary(req.userId, { from, to, category, type, q, minAmount, maxAmount });
      return res.status(200).json({ status: 'ok', ...summary });
    } catch (err) {
      logger.error('GET /summary алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/monthly — сараар орлого/зарлага (Шинжилгээ хэсэгт) ----
  router.get('/monthly', (req, res) => {
    try {
      const months = req.query.months;
      return res.status(200).json({ status: 'ok', data: db.getMonthly(req.userId, { months }) });
    } catch (err) {
      logger.error('GET /monthly алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/categories — ангиллын жагсаалт ----
  router.get('/categories', (_req, res) => {
    return res.status(200).json({ status: 'ok', categories: listCategories() });
  });

  // ---- POST /api/ai-categorize — AI санал (дотоод) ----
  router.post('/ai-categorize', async (req, res) => {
    try {
      const { description } = req.body || {};
      if (!description || typeof description !== 'string') {
        return res.status(400).json({ status: 'error', error: 'description шаардлагатай' });
      }
      if (!ai || !ai.enabled) {
        return res.status(200).json({ status: 'ok', enabled: false, category: 'other', confidence: 'low' });
      }
      const result = await ai.aiCategorize(description);
      return res.status(200).json({ status: 'ok', enabled: true, ...result });
    } catch (err) {
      // AI алдаа гарвал систем унтрахгүй — 'other'/low буцаана
      logger.warn('AI categorize алдаа', { err: err?.message });
      return res.status(200).json({ status: 'ok', enabled: true, category: 'other', confidence: 'low', error: 'ai_failed' });
    }
  });

  // ---- GET /api/overrides — learned override жагсаалт ----
  router.get('/overrides', (req, res) => {
    try {
      return res.status(200).json({ status: 'ok', data: db.getOverrides(req.userId) });
    } catch (err) {
      logger.error('GET /overrides алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- POST /api/overrides — learned override нэмэх ----
  router.post('/overrides', (req, res) => {
    try {
      const { merchantPattern, category, friendlyName, defaultNote } = req.body || {};
      if (!merchantPattern || !category) {
        return res.status(400).json({ status: 'error', error: 'merchantPattern болон category шаардлагатай' });
      }
      const valid = listCategories();
      if (!valid.includes(category)) {
        return res.status(400).json({ status: 'error', error: `category нь дараахын нэг байх ёстой: ${valid.join(', ')}` });
      }
      const override = db.addOverride(req.userId, merchantPattern, category, friendlyName || null, defaultNote || null);
      return res.status(201).json({ status: 'ok', override });
    } catch (err) {
      logger.error('POST /overrides алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  return router;
}

export default createMetaRouter;
