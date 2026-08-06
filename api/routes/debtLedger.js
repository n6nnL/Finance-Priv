// ============================================================
//  routes/debtLedger.js — Хүн хоорондын өр төлбөрийн дэвтэр (IOU)
//
//  "Болд надад 20,000₮ өртэй", "Би ээждээ 100,000₮ өртэй" гэх мэт хүн бүрээр
//  бүртгэж, цэвэршүүлж (net), хаах (settle) боломж. manual_ledger_entries-тэй
//  ижилхэн — энэ бол хэрэглэгчийн ШУУД бичдэг хүснэгт (bot-ууд хүрэхгүй).
//
//  ⚠️ Дүнг ЭХ ВАЛЮТААР нь хадгална, backend ХЭЗЭЭ Ч хөрвүүлэхгүй. Хүн бүрийн
//  цэвэр үлдэгдэл ВАЛЮТ ТУС БҮРЭЭР тооцогдоно (50,000₮ ба 20 EUR хоорондоо
//  цэвэрших ЁСГҮЙ). Хөрвүүлэлт зөвхөн frontend-ийн display үед амьд ханшаар.
//
//  Маршрутууд (бүгд /api/debt-ledger дор, req.userId-аар тусгаарлагдсан):
//    GET    /            — жагсаалт (?counterparty=, ?status=)
//    GET    /balances    — хүн × валют тус бүрийн цэвэр үлдэгдэл (нээлттэй мөр)
//    POST   /            — шинэ бичлэг (+ linkedTransactionId бол тэр гүйлгээг хасна)
//    PATCH  /:id         — засах / хаах (settle) / дахин нээх
//    DELETE /:id         — устгах (+ энэ бичлэгээс үүдсэн хасалтыг буцаана)
//
//  Гүйлгээ холбох нь тухайн гүйлгээнээс ЭНЭ БИЧЛЭГИЙН ХУВЬ ХЭМЖЭЭГ (016:
//  exclusionShare ?? amount) төсвөөс хасна — найзын билетийн зардал ТӨСӨВ/
//  ангиллаас гарна, харин ҮЛДЭГДЭЛД хэвээр тоологдоно (мөнгө бодитоор дансаас
//  гарсан). Нэг гүйлгээнд ОЛОН бичлэг холбогдож болно (хуваасан зоогийн газрын
//  данс): гүйлгээний excluded_amount = холбогдсон бүх бичлэгийн хувь хэмжээний
//  НИЙЛБЭР. Холбоос тасрахад ЗӨВХӨН тэр бичлэгийн хувь хэмжээ хасагдаж, дүн
//  дахин тооцоологдоно (нөгөө хүмүүсийн хувь хэвээр).
//
//  ⚠️ Валют: өрийн бичлэг ба гүйлгээний валют ЗААВАЛ таарна (30 EUR-ыг MNT
//  гүйлгээнээс хасах боломжгүй) — таарахгүй бол 400. Хөрвүүлэлт backend-д БАЙХГҮЙ.
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Хувь хэмжээ: 0-ээс багагүй, сонголттой (null = "бичлэгийн бүтэн amount").
const EXCL_SHARE = z.number({ invalid_type_error: 'exclusionShare нь тоо байх ёстой' })
  .finite().nonnegative('exclusionShare сөрөг байж болохгүй').nullable().optional();

const CreateSchema = z.object({
  counterparty: z.string().trim().min(1, 'counterparty шаардлагатай').max(100),
  direction: z.enum(['i_lent', 'i_borrowed'], {
    errorMap: () => ({ message: "direction нь 'i_lent' эсвэл 'i_borrowed' байх ёстой" }),
  }),
  amount: z.number({ invalid_type_error: 'amount нь тоо байх ёстой' }).finite().positive('amount эерэг байх ёстой'),
  currency: z.enum(['MNT', 'EUR'], {
    errorMap: () => ({ message: "currency нь 'MNT' эсвэл 'EUR' байх ёстой" }),
  }).default('MNT'),
  entryDate: z.string().regex(YMD, 'entryDate нь YYYY-MM-DD байх ёстой'),
  note: z.string().max(500).nullable().optional(),
  linkedTransactionId: z.number().int().positive().nullable().optional(),
  // Холбосон гүйлгээнээс ХЭДИЙГ эзлэх вэ. null/өгөөгүй → бичлэгийн amount
  // (түгээмэл: өр нь буцаагдах хэсэгтэй тэнцүү). 0 → холбоно ч хасахгүй.
  exclusionShare: EXCL_SHARE,
});

// PATCH — бүх талбар сонголттой (өгсөнийг Л шинэчилнэ)
const PatchSchema = z.object({
  counterparty: z.string().trim().min(1).max(100).optional(),
  direction: z.enum(['i_lent', 'i_borrowed']).optional(),
  amount: z.number().finite().positive('amount эерэг байх ёстой').optional(),
  currency: z.enum(['MNT', 'EUR']).optional(),
  entryDate: z.string().regex(YMD, 'entryDate нь YYYY-MM-DD байх ёстой').optional(),
  note: z.string().max(500).nullable().optional(),
  status: z.enum(['open', 'settled']).optional(),
  linkedTransactionId: z.number().int().positive().nullable().optional(),
  settledTransactionId: z.number().int().positive().nullable().optional(),
  exclusionShare: EXCL_SHARE,
}).strict();

function zodErrors(error) {
  return error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }));
}

/**
 * Хасалтын дүрмийн зөрчил (валют таарахгүй / дүн хэтэрсэн) → 400.
 * db давхарга нь ExclusionError-оор шидэж, SQLite транзакц бүхэлдээ rollback
 * болсон байна — тал дутуу төлөв ҮЛДЭХГҮЙ.
 * @returns {boolean} боловсруулсан эсэх
 */
function handleExclusionError(err, res) {
  if (err?.name !== 'ExclusionError') return false;
  res.status(400).json({ status: 'error', error: err.message, code: err.code });
  return true;
}

export function createDebtLedgerRouter({ db }) {
  const router = Router();

  // ---- GET /api/debt-ledger/balances ----
  //  '/:id' биш тул дарааллын мөргөлдөөн байхгүй, гэхдээ тодорхой байдлын
  //  үүднээс жагсаалтын өмнө бүртгэв.
  router.get('/balances', (req, res) => {
    try {
      return res.status(200).json({ status: 'ok', data: db.getDebtBalances(req.userId) });
    } catch (err) {
      logger.error('GET /debt-ledger/balances алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/debt-ledger ----
  router.get('/', (req, res) => {
    try {
      const { counterparty, status } = req.query;
      if (status && status !== 'open' && status !== 'settled') {
        return res.status(400).json({ status: 'error', error: "status нь 'open' эсвэл 'settled' байх ёстой" });
      }
      return res.status(200).json({ status: 'ok', data: db.listDebtEntries(req.userId, { counterparty, status }) });
    } catch (err) {
      logger.error('GET /debt-ledger алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- POST /api/debt-ledger ----
  router.post('/', (req, res) => {
    try {
      const parsed = CreateSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ status: 'error', error: 'Хүчингүй мөр', details: zodErrors(parsed.error) });
      }
      // Өөр хэрэглэгчийн гүйлгээ рүү холбохыг зөвшөөрөхгүй (tenant isolation)
      if (!db.transactionBelongsToUser(req.userId, parsed.data.linkedTransactionId ?? null)) {
        return res.status(400).json({ status: 'error', error: 'linkedTransactionId олдсонгүй' });
      }
      const entry = db.addDebtEntry(req.userId, parsed.data);
      return res.status(201).json({ status: 'ok', entry, balances: db.getDebtBalances(req.userId) });
    } catch (err) {
      if (handleExclusionError(err, res)) return undefined;
      logger.error('POST /debt-ledger алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- PATCH /api/debt-ledger/:id — засах / settle / re-open ----
  router.patch('/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ status: 'error', error: 'id буруу' });
      }
      const parsed = PatchSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ status: 'error', error: 'Хүчингүй мөр', details: zodErrors(parsed.error) });
      }
      if (Object.keys(parsed.data).length === 0) {
        return res.status(400).json({ status: 'error', error: 'Шинэчлэх талбар алга' });
      }
      for (const key of ['linkedTransactionId', 'settledTransactionId']) {
        if (parsed.data[key] != null && !db.transactionBelongsToUser(req.userId, parsed.data[key])) {
          return res.status(400).json({ status: 'error', error: `${key} олдсонгүй` });
        }
      }
      const entry = db.updateDebtEntry(req.userId, id, parsed.data);
      if (!entry) return res.status(404).json({ status: 'error', error: 'Мөр олдсонгүй' });
      return res.status(200).json({ status: 'ok', entry, balances: db.getDebtBalances(req.userId) });
    } catch (err) {
      if (handleExclusionError(err, res)) return undefined;
      logger.error('PATCH /debt-ledger алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- DELETE /api/debt-ledger/:id ----
  router.delete('/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ status: 'error', error: 'id буруу' });
      }
      const changes = db.deleteDebtEntry(req.userId, id);
      if (changes === 0) return res.status(404).json({ status: 'error', error: 'Мөр олдсонгүй' });
      return res.status(200).json({ status: 'ok', deleted: id, balances: db.getDebtBalances(req.userId) });
    } catch (err) {
      logger.error('DELETE /debt-ledger алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  return router;
}

export default createDebtLedgerRouter;
