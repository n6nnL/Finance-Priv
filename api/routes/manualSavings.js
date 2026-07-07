// ============================================================
//  routes/manualSavings.js — Гар аргаар удирдсан хөрөнгө (бэлэн мөнгө/EUR)
//
//  Голомт Gmail listener харахгүй мөнгө (гэрт байгаа бэлэн EUR, хараахан
//  хөрвүүлээгүй хэсэг г.м) — хэрэглэгч өөрөө гараар бүртгэнэ. ЭНЭ хүснэгт
//  (manual_ledger_entries) нь төслийн "transactions/category_overrides-д шууд
//  бичихгүй" дүрмээс ХАСАГДСАН — яг үүний зорилго нь хэрэглэгчийн шууд бичдэг
//  цорын ганц санхүүгийн хүснэгт байх явдал.
//
//  Маршрутууд (бүгд /api/manual-savings дор, req.userId-аар тусгаарлагдсан):
//    GET    /                — жагсаалт (entry_date DESC) + balance (signed sum)
//    POST   /                — шинэ мөр нэмэх
//    PUT    /:id             — мөр засах (hard update)
//    DELETE /:id             — мөр устгах (hard delete)
//
//  amount (MNT) ЗААВАЛ, эерэг — balance-д ашиглагдах цорын ганц утга. amountEur/
//  exchangeRate — сонголттой, зөвхөн лавлагаа (frontend доторх auto-calc-ийн үр
//  дүнг ХЭЗЭЭ Ч дахин тооцохгүй/шалгахгүй, ирсэн утгыг шууд хадгална).
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';

const EntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date нь YYYY-MM-DD байх ёстой'),
  type: z.enum(['deposit', 'withdrawal'], {
    errorMap: () => ({ message: "type нь 'deposit' эсвэл 'withdrawal' байх ёстой" }),
  }),
  amount: z.number({ invalid_type_error: 'amount нь тоо байх ёстой' }).finite().positive('amount эерэг байх ёстой'),
  amountEur: z.number().finite().positive('amountEur эерэг байх ёстой').nullable().optional(),
  exchangeRate: z.number().finite().positive('exchangeRate эерэг байх ёстой').nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

function zodErrors(error) {
  return error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }));
}

export function createManualSavingsRouter({ db }) {
  const router = Router();

  // ---- GET /api/manual-savings ----
  router.get('/', (req, res) => {
    try {
      const { rows, balance } = db.listManualLedger(req.userId);
      return res.status(200).json({ status: 'ok', data: rows, balance });
    } catch (err) {
      logger.error('GET /manual-savings алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- POST /api/manual-savings ----
  router.post('/', (req, res) => {
    try {
      const parsed = EntrySchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ status: 'error', error: 'Хүчингүй мөр', details: zodErrors(parsed.error) });
      }
      const entry = db.addManualLedgerEntry(req.userId, parsed.data);
      return res.status(201).json({ status: 'ok', entry, balance: db.getManualLedgerBalance(req.userId) });
    } catch (err) {
      logger.error('POST /manual-savings алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- PUT /api/manual-savings/:id ----
  router.put('/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ status: 'error', error: 'id буруу' });
      }
      const parsed = EntrySchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ status: 'error', error: 'Хүчингүй мөр', details: zodErrors(parsed.error) });
      }
      const entry = db.updateManualLedgerEntry(req.userId, id, parsed.data);
      if (!entry) return res.status(404).json({ status: 'error', error: 'Мөр олдсонгүй' });
      return res.status(200).json({ status: 'ok', entry, balance: db.getManualLedgerBalance(req.userId) });
    } catch (err) {
      logger.error('PUT /manual-savings алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- DELETE /api/manual-savings/:id ----
  router.delete('/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ status: 'error', error: 'id буруу' });
      }
      const changes = db.deleteManualLedgerEntry(req.userId, id);
      if (changes === 0) return res.status(404).json({ status: 'error', error: 'Мөр олдсонгүй' });
      return res.status(200).json({ status: 'ok', deleted: id, balance: db.getManualLedgerBalance(req.userId) });
    } catch (err) {
      logger.error('DELETE /manual-savings алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  return router;
}

export default createManualSavingsRouter;
