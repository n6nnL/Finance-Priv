// ============================================================
//  routes/meta.js — хураангуй, AI ангилал, overrides, categories
//
//  Маршрутууд (бүгд /api дор):
//    GET  /api/summary          — нийт зарлага/орлого + ангиллаар (шүүлттэй)
//    GET  /api/balance          — одоогийн үлдэгдэл (сүүлийн txn_date-тэй мөрөөс)
//    GET  /api/balance-history  — өдөр тутмын үлдэгдлийн сэргээлт + өдөр тутмын
//                                  гүйлгээний drill-down (READ-ONLY). Хугацааны муж:
//                                  ?range=7d|30d|90d|180d|365d (сервер today-гоос
//                                  тооцно) ЭСВЭЛ ?from=YYYY-MM-DD[&to=YYYY-MM-DD]
//                                  (custom, to сонголт — өгөхгүй бол өнөөдөр).
//    GET  /api/categories       — боломжит ангиллын жагсаалт (dropdown-д)
//    POST /api/ai-categorize    — AI ангилал санал { description }
//    GET  /api/overrides        — learned override жагсаалт
//    POST /api/overrides        — learned override нэмэх { merchantPattern, category }
//    GET  /api/fx-rates         — өнөөдрийн USD→MNT, EUR→MNT амьд ханш (1ц кэштэй)
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { listCategories } from '../categorize.js';
import { ubYmd, addDaysYmd, reconstructBalanceSeries, detectGaps } from '../balanceHistory.js';
import { getLiveFxRates } from '../fx.js';
import { logger } from '../logger.js';

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '365d': 365 };
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const BalanceHistoryQuerySchema = z
  .object({
    range: z.enum(['7d', '30d', '90d', '180d', '365d']).optional(),
    from: z.string().regex(YMD_RE, 'from нь YYYY-MM-DD байх ёстой').optional(),
    to: z.string().regex(YMD_RE, 'to нь YYYY-MM-DD байх ёстой').optional(),
  })
  .refine((v) => v.range || v.from, { message: 'range ЭСВЭЛ from параметр шаардлагатай' });

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

  // ---- GET /api/analytics/by-category?month=YYYY-MM — сарын ангиллын задаргаа ----
  //  Зөвхөн ЗАРЛАГА (орлогыг pie-д оруулахгүй; totalIncome тусдаа). Ангилаагүй/
  //  pending → 'Ангилаагүй' зүсэм. Сар нь txn_date-аар (UB орон нутгийн огноо).
  //  Нэгтгэлийг SQL GROUP BY-аар хийнэ (бүх мөрийг browser руу илгээхгүй).
  router.get('/analytics/by-category', (req, res) => {
    try {
      const month = String(req.query.month || '');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return res.status(400).json({ status: 'error', error: 'month нь YYYY-MM (01–12) хэлбэртэй байх ёстой' });
      }
      const out = db.getByCategory(req.userId, month);
      return res.status(200).json({
        status: 'ok',
        timezone: 'Asia/Ulaanbaatar (txn_date — өдрийн нарийвчлал)',
        ...out,
      });
    } catch (err) {
      logger.error('GET /analytics/by-category алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/balance — одоогийн үлдэгдэл (сүүлийн txn_date-тэй мөрөөс) ----
  //  Мөр байхгүй/бүгд account_balance NULL бол balance:null (backfill хийгээгүй
  //  хуучин гүйлгээнүүдэд ердийн байдал — алдаа биш).
  router.get('/balance', (req, res) => {
    try {
      const balance = db.getCurrentBalance(req.userId);
      return res.status(200).json({ status: 'ok', balance });
    } catch (err) {
      logger.error('GET /balance алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/balance-history?from=YYYY-MM-DD — өдөр тутмын үлдэгдлийн сэргээлт ----
  //  READ-ONLY: transactions/category_overrides-д огт бичихгүй. Anchor (сүүлийн
  //  бодит account_balance-тай мөр)-аас цэвэр гүйлгээгээр ухраад тооцно. Anchor
  //  байхгүй бол хоосон цуврал + available:false (хуурамч тоо ХЭЗЭЭ Ч гаргахгүй).
  //  >2 дараалсан гүйлгээгүй өдрийн цоорхойг тэмдэглэнэ (Gmail listener downtime
  //  — тухайн үеийн сэргээлт бага итгэлтэй байж болзошгүй).
  router.get('/balance-history', (req, res) => {
    try {
      const parsed = BalanceHistoryQuerySchema.safeParse(req.query || {});
      if (!parsed.success) {
        return res.status(400).json({ status: 'error', error: 'range эсвэл from параметр (YYYY-MM-DD) шаардлагатай' });
      }
      const today = ubYmd();
      const to = parsed.data.to || today;
      if (to > today) {
        return res.status(400).json({ status: 'error', error: 'to нь өнөөдрөөс хойш байж болохгүй' });
      }
      // range (ж: '90d') байвал сервер өөрөө today-гоос from тооцно (client TZ-оос
      // үл хамааран тогтвортой); эс бөгөөс тодорхой from ашиглана.
      const from = parsed.data.range ? addDaysYmd(to, -(RANGE_DAYS[parsed.data.range] - 1)) : parsed.data.from;
      if (from > to) {
        return res.status(400).json({ status: 'error', error: 'from нь to-оос хойш байж болохгүй' });
      }

      const anchor = db.getBalanceAnchor(req.userId);
      if (!anchor) {
        return res.status(200).json({ status: 'ok', from, to, available: false, anchor: null, series: [], gaps: [] });
      }

      const rangeStart = from < anchor.date ? from : anchor.date;
      const rangeEnd = to > anchor.date ? to : anchor.date;
      const stats = db.getDailyTxnStats(req.userId, rangeStart, rangeEnd);
      const dailyNetMap = new Map(stats.map((s) => [s.date, s.net]));

      const series = reconstructBalanceSeries({
        anchorDate: anchor.date, anchorBalance: anchor.balance, dailyNetMap, from, to,
      });

      // Өдөр тутмын drill-down: ХҮСЭЛТИЙН цонхонд (from..to) орсон гүйлгээг өдрөөр
      // бүлэглэж, цуврал цэг бүрт залгана (график дээр дараад тухайн өдрийн
      // гүйлгээг харуулахад — нэмэлт round-trip хэрэггүй).
      const txnRows = db.getDailyTransactionRows(req.userId, from, to);
      const txnByDate = new Map();
      for (const t of txnRows) {
        if (!txnByDate.has(t.date)) txnByDate.set(t.date, []);
        txnByDate.get(t.date).push(t);
      }
      for (const point of series) {
        point.transactions = txnByDate.get(point.date) || [];
      }

      // Цоорхойг зөвхөн ХҮСЭЛТИЙН цонхонд (from..to) илрүүлнэ — сэргээлтийн
      // өргөтгөсөн range (anchor хүртэлх) БИШ, тодорхой асуусан хугацаанд шүүнэ.
      const daysWithTxn = new Set(stats.filter((s) => s.date >= from && s.date <= to && s.count > 0).map((s) => s.date));
      const gaps = detectGaps({ from, to, daysWithTxn });

      return res.status(200).json({ status: 'ok', from, to, available: true, anchor, series, gaps });
    } catch (err) {
      logger.error('GET /balance-history алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/fx-rates — өнөөдрийн USD→MNT, EUR→MNT амьд ханш (READ-ONLY) ----
  //  Тохиргоо хэсэгт "өнөөдрийн ханш" харуулж, хэрэглэгч дараа нь тохиргоондоо
  //  (usdMnt/eurMnt) хэрэглэхээр авахад ашиглана. Гадаад провайдер унавал 502 +
  //  тодорхой алдаа буцаана — тохиргоо гараар засах боломж үргэлж үлдэнэ.
  router.get('/fx-rates', async (_req, res) => {
    try {
      const rates = await getLiveFxRates();
      return res.status(200).json({ status: 'ok', ...rates });
    } catch (err) {
      logger.error('GET /fx-rates алдаа', { err: err?.message });
      return res.status(502).json({ status: 'error', error: 'Ханшийн мэдээлэл татаж чадсангүй' });
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
