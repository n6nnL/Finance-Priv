// ============================================================
//  routes/transactions.js — гүйлгээний CRUD + ангилал
//
//  Маршрутууд:
//    POST   /api/transactions               — хүлээн авах (classify + insert)
//    GET    /api/transactions               — шүүлттэй жагсаалт
//    GET    /api/transactions/pending        — баталгаажуулах хүлээж буй
//    PATCH  /api/transactions/:id/category   — ангилал засах (+applyToAll)
//
//  Хариу (POST):
//    201 { status:'created', id, txStatus }   — шинээр орсон
//    200 { status:'duplicate', id }           — message_id давхардсан
//    400 { status:'error', errors }           — validation алдаа
//    500 { status:'error' }                   — серверийн алдаа (retry)
// ============================================================

import { Router } from 'express';
import { validateTransaction } from '../schema.js';
import { classifyTransaction } from '../classify.js';
import { listCategories, isPosDescription } from '../categorize.js';
import { logger } from '../logger.js';

/**
 * @param {{ db: object, ai?: object }} deps
 */
export function createTransactionsRouter({ db, ai }) {
  const router = Router();

  // ---- POST /api/transactions — гүйлгээ хүлээн авах ----
  router.post('/', async (req, res) => {
    try {
      // 1) Validate (+ listener alias normalize)
      const result = validateTransaction(req.body);
      if (!result.success) {
        logger.warn('Validation алдаа', { errors: result.errors });
        return res.status(400).json({ status: 'error', errors: result.errors });
      }
      const tx = result.data;
      const userId = req.userId; // machine (API key) → owner; multi-tenant scope

      // 2) Давхардал шалгах (insert хийхээс өмнө — AI дуудлага дэмий хийхгүй)
      const existing = db.getByMessageId(userId, tx.messageId);
      if (existing) {
        logger.info('Давхардсан messageId — алгасав', { id: existing.id, messageId: tx.messageId });
        return res.status(200).json({ status: 'duplicate', id: Number(existing.id) });
      }

      // 3) Ангилал шийдвэр: override → Орлого(type) → дүрэм → AI(pending_review)
      const decision = await classifyTransaction({
        description: tx.description,
        type: tx.type,
        db,
        ai,
        userId,
      });

      // 4) Insert (идэмпотентность: UNIQUE message_id, race-д найдвартай)
      //    is_pos: listener илгээсэн бол түүнийг, үгүй бол description-аас тооцоолно.
      const isPos = tx.isPos == null ? isPosDescription(tx.description) : tx.isPos;
      const { created, id, row } = db.insertTransaction({
        ...tx,
        userId,
        category: decision.category,
        status: decision.status,
        aiSuggestedCategory: decision.aiSuggestedCategory,
        aiConfidence: decision.aiConfidence,
        isPos,
      });

      if (created) {
        logger.info('Гүйлгээ үүсгэлээ', {
          id, messageId: tx.messageId, category: decision.category, txStatus: decision.status,
        });
        return res.status(201).json({ status: 'created', id, txStatus: decision.status });
      }
      // Хоёр зэрэг хүсэлтийн race — нөгөө нь түрүүлж оруулсан
      return res.status(200).json({ status: 'duplicate', id: row ? Number(row.id) : id });
    } catch (err) {
      logger.error('POST /api/transactions серверийн алдаа', { err: err?.message, stack: err?.stack });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/transactions — шүүлттэй жагсаалт ----
  router.get('/', (req, res) => {
    try {
      const { from, to, category, type, q, minAmount, maxAmount, status, limit, offset } = req.query;
      if (type && type !== 'expense' && type !== 'income') {
        return res.status(400).json({ status: 'error', error: "type нь 'expense' эсвэл 'income' байх ёстой" });
      }
      const out = db.listTransactions(req.userId, { from, to, category, type, q, minAmount, maxAmount, status, limit, offset });
      return res.status(200).json({
        status: 'ok',
        total: out.total,
        limit: out.limit,
        offset: out.offset,
        count: out.rows.length,
        data: out.rows,
      });
    } catch (err) {
      logger.error('GET /api/transactions серверийн алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/transactions/pending — баталгаажуулах хүлээж буй ----
  router.get('/pending', (req, res) => {
    try {
      const { limit, offset } = req.query;
      const out = db.getPending(req.userId, { limit, offset });
      return res.status(200).json({
        status: 'ok', total: out.total, limit: out.limit, offset: out.offset,
        count: out.rows.length, data: out.rows,
      });
    } catch (err) {
      logger.error('GET /pending алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/transactions/:id — нэг гүйлгээний одоогийн төлөв ----
  // (Discord bot interaction үед "stale эсэх"-ийг шалгахад ашиглана.)
  // '/pending'-ийн ДАРАА бүртгэгдсэн тул түүнтэй мөргөлдөхгүй.
  router.get('/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ status: 'error', error: 'буруу id' });
      }
      const row = db.getById(req.userId, id);
      if (!row) return res.status(404).json({ status: 'error', error: 'Гүйлгээ олдсонгүй' });
      return res.status(200).json({ status: 'ok', data: row });
    } catch (err) {
      logger.error('GET /:id алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- PATCH /api/transactions/:id/category — баталгаажуулах (ухаалаг) ----
  // Body: { category, applyToAll, note?, merchantPlace? (POS газрын нэр) }
  // POS бол merchantPlace (→override.friendly_name), POS биш бол note (→override.default_note).
  router.patch('/:id/category', (req, res) => {
    try {
      const id = Number(req.params.id);
      const { category, applyToAll } = req.body || {};
      // merchantPlace = POS газрын нэр; friendlyName-г alias болгон зөвшөөрнө
      const merchantPlace = (req.body?.merchantPlace ?? req.body?.friendlyName ?? '').toString().trim();
      const note = (req.body?.note ?? '').toString().trim();

      if (!Number.isInteger(id)) {
        return res.status(400).json({ status: 'error', error: 'буруу id' });
      }
      if (!category || typeof category !== 'string') {
        return res.status(400).json({ status: 'error', error: 'category шаардлагатай' });
      }
      const valid = listCategories();
      if (!valid.includes(category)) {
        return res.status(400).json({ status: 'error', error: `category нь дараахын нэг байх ёстой: ${valid.join(', ')}` });
      }
      const row = db.getById(req.userId, id);
      if (!row) return res.status(404).json({ status: 'error', error: 'Гүйлгээ олдсонгүй' });

      // Газрын нэр эсвэл note өгвөл мерчантынх тул applyToAll шиг сурна
      const learn = !!applyToAll || !!merchantPlace || !!note;
      const extra = { note: note || null, merchantPlace: merchantPlace || null };

      let updated = 1;
      let override = null;
      if (learn) {
        const pattern = db.normalizeMerchant(row.description);
        updated = db.updateCategoryByPattern(req.userId, pattern, category, extra);
        // override: POS газрын нэр → friendly_name, шалтгаан → default_note
        override = db.addOverride(req.userId, pattern, category, merchantPlace || null, note || null);
      } else {
        db.updateCategoryById(req.userId, id, category, extra);
      }
      logger.info('Баталгаажлаа', { id, category, applyToAll: learn, place: !!merchantPlace, note: !!note, updated });
      return res.status(200).json({ status: 'ok', id, category, updated, override });
    } catch (err) {
      logger.error('PATCH category алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- PATCH /api/transactions/:id/note — зөвхөн тэмдэглэл засах (inline) ----
  router.patch('/:id/note', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ status: 'error', error: 'буруу id' });
      const row = db.getById(req.userId, id);
      if (!row) return res.status(404).json({ status: 'error', error: 'Гүйлгээ олдсонгүй' });
      const note = (req.body?.note ?? '').toString();
      db.updateNote(req.userId, id, note);
      return res.status(200).json({ status: 'ok', id, note: note.trim() || null });
    } catch (err) {
      logger.error('PATCH note алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  return router;
}

export default createTransactionsRouter;
