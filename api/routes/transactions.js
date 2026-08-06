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
import { EXCLUSION_EPS as EPS } from '../db.js';
import { validateTransaction } from '../schema.js';
import { classifyTransaction } from '../classify.js';
import { listCategories, isPosDescription } from '../categorize.js';
import { isCategoryAllowedFor, categoriesFor } from '../../config/categories.js';
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

      // Multi-tenant user mapping:
      //  - machine (API key, listener): body.userId ЗААВАЛ + бодит хэрэглэгч байх ёстой.
      //    Owner-т fallback ХИЙХГҮЙ — буруу mapping нь privacy алдагдал тул reject.
      //  - JWT (хэрэглэгч): үргэлж өөрийн req.userId; body.userId-г үл тоомсорлоно
      //    (өөр хүний нэрээр push хийх боломжгүй).
      let userId;
      if (req.authKind === 'apikey') {
        if (tx.userId == null) {
          logger.warn('POST /api/transactions: machine push userId-гүй — татгалзав');
          return res.status(400).json({
            status: 'error',
            errors: [{ field: 'userId', message: 'machine push-д userId заавал (owner fallback байхгүй)' }],
          });
        }
        if (!db.getUserById(tx.userId)) {
          logger.warn('POST /api/transactions: үл мэдэгдэх userId — татгалзав', { userId: tx.userId });
          return res.status(400).json({
            status: 'error',
            errors: [{ field: 'userId', message: 'ийм хэрэглэгч байхгүй' }],
          });
        }
        userId = tx.userId;
      } else {
        userId = req.userId;
      }

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

      // ---- Ангилал ↔ гүйлгээний ТӨРЛИЙН нийцэл (server-side backstop) ----
      // Гурван клиент picker-ээ шүүдэг ч ТҮҮНД найдахгүй: шууд PATCH хийж
      // зарлаган мөрөнд "Орлого" оноох боломжийг ЭНД хаана (UI-д л байгаа
      // хамгаалалт нь хамгаалалт БИШ). Дүрэм нь config/categories.js-д.
      if (!isCategoryAllowedFor(category, row.type)) {
        const allowed = categoriesFor(row.type);
        return res.status(400).json({
          status: 'error',
          error: `"${category}" ангилал ${row.type === 'income' ? 'орлогын' : 'зарлагын'} гүйлгээнд тохирохгүй. Боломжит: ${allowed.join(', ')}`,
        });
      }

      // ⚠️ Override (сурах) нь ЗӨВХӨН хэрэглэгч applyToAll-ыг ТОДОРХОЙ сонгосон
      // үед. Газрын нэр/шалтгаан дангаараа сурахад ХҮРГЭХГҮЙ — тэдгээр нь
      // learn=false үед доорх updateCategoryById-ээр тухайн ГАНЦ мөрөнд хадгална.
      const learn = !!applyToAll;
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

  // ---- PATCH /api/transactions/:id/note — тэмдэглэл/газрын нэр засах (ангилал хөндөхгүй) ----
  // Body: { note?, merchantPlace? } — body-д БАЙГАА талбарыг л шинэчилнэ;
  // тодорхой хоосон string → NULL (утга устгах боломж). Override үүсгэхгүй.
  router.patch('/:id/note', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ status: 'error', error: 'буруу id' });
      const row = db.getById(req.userId, id);
      if (!row) return res.status(404).json({ status: 'error', error: 'Гүйлгээ олдсонгүй' });
      const body = req.body || {};
      const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
      if (!has('note') && !has('merchantPlace')) {
        return res.status(400).json({ status: 'error', error: 'note эсвэл merchantPlace шаардлагатай' });
      }
      const fields = {};
      if (has('note')) fields.note = (body.note ?? '').toString();
      if (has('merchantPlace')) fields.merchantPlace = (body.merchantPlace ?? '').toString();
      db.updateTransactionFields(req.userId, id, fields);
      const updated = db.getById(req.userId, id);
      return res.status(200).json({ status: 'ok', id, note: updated.note, merchantPlace: updated.merchant_place });
    } catch (err) {
      logger.error('PATCH note алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- PATCH /api/transactions/:id/exclusion — төсвөөс хасах/буцаах ----
  //  Body: { excluded: true|false }  — бүхэлд нь хасах/буцаах (015, хэвээр)
  //     ЭСВЭЛ { excludedAmount: number } — ХЭСЭГЧИЛСЭН хасалт (016), [0, amount].
  //  Өрийн дэвтрээс ХАМААРАЛГҮЙ шуурхай унтраалга ("энэ миний бодит зарлага биш").
  //  ⚠️ ЗӨВХӨН төсөв/ангилал/шинжилгээнд нөлөөлнө — ҮЛДЭГДЭЛД ХЭЗЭЭ Ч нөлөөлөхгүй
  //  (мөнгө бодитоор хөдөлсөн). Хасалт байхад manually_edited=1 (pipeline дахин
  //  хөндөхгүй). Дүн amount-аас хэтэрвэл 400 — ангиллын нийлбэр сөрөг болохгүй.
  router.patch('/:id/exclusion', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ status: 'error', error: 'буруу id' });
      const body = req.body || {};
      const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
      if (!has('excluded') && !has('excludedAmount')) {
        return res.status(400).json({ status: 'error', error: 'excluded эсвэл excludedAmount шаардлагатай' });
      }
      if (has('excluded') && typeof body.excluded !== 'boolean') {
        return res.status(400).json({ status: 'error', error: 'excluded нь boolean байх ёстой' });
      }
      if (has('excludedAmount') && (typeof body.excludedAmount !== 'number'
          || !Number.isFinite(body.excludedAmount) || body.excludedAmount < 0)) {
        return res.status(400).json({ status: 'error', error: 'excludedAmount нь 0-ээс багагүй тоо байх ёстой' });
      }
      const row = db.getById(req.userId, id);
      if (!row) return res.status(404).json({ status: 'error', error: 'Гүйлгээ олдсонгүй' });

      // excludedAmount давамгайлна; эс бөгөөс boolean → бүтэн amount / 0
      const target = has('excludedAmount') ? body.excludedAmount : (body.excluded ? Number(row.amount) : 0);
      if (target > Number(row.amount) + EPS) {
        return res.status(400).json({
          status: 'error',
          error: `Хасах дүн гүйлгээний дүнгээс (${Number(row.amount)}) их байж болохгүй`,
        });
      }

      // Өрийн бичлэгээс үүдсэн хасалтыг гараар ӨӨРЧЛӨХИЙГ зөвшөөрөхгүй — эхлээд
      // холбоосыг нь салгах ёстой (эс бөгөөс дэвтрийн тооцоо ба дүн зөрнө; дараагийн
      // дахин тооцоолол хэрэглэгчийн гар засварыг чимээгүй арилгана). Утга
      // өөрчлөгдөхгүй (no-op) дуудалт нь өмнөх шигээ зөвшөөрөгдөнө.
      const current = Number(row.excluded_amount) || 0;
      if (Math.abs(target - current) > EPS && db.isTransactionReferencedByOtherDebt(req.userId, id, null)) {
        return res.status(409).json({
          status: 'error',
          error: 'Энэ гүйлгээ өрийн бичлэгтэй холбоотой тул хасалтыг шууд өөрчлөх боломжгүй. Эхлээд өрийн бичлэгээс салгана уу.',
        });
      }

      db.setTransactionExcludedAmount(req.userId, id, target);
      const updated = db.getById(req.userId, id);
      const excludedAmount = Number(updated.excluded_amount) || 0;
      logger.info('Төсвөөс хасалт', { id, excludedAmount });
      return res.status(200).json({
        status: 'ok', id,
        excluded: updated.excluded_from_budget === 1, // = БҮРЭН хасагдсан
        excludedAmount,
        // Төсөв/ангилалд тоологдох цэвэр дүн (үлдэгдэлд БҮТЭН amount хэвээр)
        netAmount: Number(updated.amount) - excludedAmount,
        manuallyEdited: updated.manually_edited === 1,
      });
    } catch (err) {
      if (err?.name === 'ExclusionError') {
        return res.status(400).json({ status: 'error', error: err.message, code: err.code });
      }
      logger.error('PATCH exclusion алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  return router;
}

export default createTransactionsRouter;
