// ============================================================
//  routes/budget.js — хэрэглэгчийн тохиргоо + хувийн event (per-user)
//
//  Маршрутууд (бүгд /api дор, req.userId-аар тусгаарлагдсан):
//    GET    /api/settings        — одоогийн хэрэглэгчийн тохиргоо (DEFAULT хэрэв хоосон)
//    PUT    /api/settings        — upsert (zod-оор баталгаажуулна)
//    GET    /api/events          — хувийн event жагсаалт
//    POST   /api/events          — event нэмэх { title, date, amountMnt? }
//    DELETE /api/events/:id      — event устгах
//
//  ЦАЛИН (salaryAmount)-д default БАЙХГҮЙ (null) — хэрэглэгч оруулна. Код дотор
//  хуурамч санхүүгийн дүн бичигдэхгүй (public repo).
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_SETTINGS } from '../db.js';
import { currentCycle } from '../budgetCycle.js';
import { logger } from '../logger.js';

const SubscriptionSchema = z.object({
  name: z.string().min(1, 'нэр шаардлагатай').max(60),
  day: z.number().int().min(1).max(28),
  amountUsd: z.number().nonnegative().finite(),
});

const AllocationSchema = z.object({
  category: z.string().min(1, 'ангиллын нэр шаардлагатай').max(60),
  amountMnt: z.number().int('amountMnt бүхэл тоо').nonnegative(),
});

// Дутуу талбар → DEFAULT-оор бөглөнө (PUT нь бүтэн object илгээдэг ч хамгаалалт).
const SettingsSchema = z.object({
  // цалин: эерэг бүхэл тоо ЭСВЭЛ null (оруулаагүй). Default null.
  salaryAmount: z.number().int('salaryAmount бүхэл тоо').nonnegative('salaryAmount >= 0').nullable().default(null),
  // budgetFloor: хамгаалах доод үлдэгдэл (₮) — салинтай адил DEFAULT null (заавал биш,
  // тохируулаагүй бол UI хуурамч тоо ХАРУУЛАХГҮЙ).
  budgetFloor: z.number().int('budgetFloor бүхэл тоо').nonnegative('budgetFloor >= 0').nullable().default(null),
  paydayDay: z.number().int().min(1).max(28).default(DEFAULT_SETTINGS.paydayDay),
  usdMnt: z.number().positive('usdMnt > 0').finite().default(DEFAULT_SETTINGS.usdMnt),
  subscriptions: z.array(SubscriptionSchema).max(50).default(DEFAULT_SETTINGS.subscriptions),
  categoryAllocations: z.array(AllocationSchema).max(50).default(DEFAULT_SETTINGS.categoryAllocations),
}).strict();

// %-хуваарилалт: нийлбэр 100% давж БОЛНО (constraint #5) тул дээд хязгаар тавихгүй.
const AllocPercentSchema = z.object({
  category: z.string().min(1, 'ангиллын нэр').max(60),
  percent: z.number().nonnegative('percent >= 0').finite(),
});
const AllocListSchema = z.object({
  allocations: z.array(AllocPercentSchema).max(50),
});

const EventSchema = z.object({
  title: z.string().min(1, 'title шаардлагатай').max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date нь YYYY-MM-DD байх ёстой'),
  amountMnt: z.number().int('amountMnt бүхэл тоо').nonnegative().nullable().optional(),
});

function zodErrors(error) {
  return error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }));
}

export function createBudgetRouter({ db }) {
  const router = Router();

  // ---- GET /api/settings ----
  router.get('/settings', (req, res) => {
    try {
      return res.status(200).json({ status: 'ok', settings: db.getSettings(req.userId) });
    } catch (err) {
      logger.error('GET /settings алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- PUT /api/settings ----
  router.put('/settings', (req, res) => {
    try {
      const parsed = SettingsSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ status: 'error', error: 'Хүчингүй тохиргоо', details: zodErrors(parsed.error) });
      }
      const settings = db.saveSettings(req.userId, parsed.data);
      return res.status(200).json({ status: 'ok', settings });
    } catch (err) {
      logger.error('PUT /settings алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/budget-status?cycle=current ----
  //  Идэвхтэй циклийн БОДИТ зарлага ангиллаар (real-time tracker). READ-ONLY:
  //  гүйлгээ/ангилалд огт бичихгүй. Ангилсан + тодорхойгүй = нийт зарлага (тэнцэнэ).
  router.get('/budget-status', (req, res) => {
    try {
      const settings = db.getSettings(req.userId);
      // Одоогоор зөвхөн 'current' цикл (cycle param ирээдүйд өргөтгөнө).
      const cycle = currentCycle(new Date(), settings.paydayDay);
      const spend = db.getCycleSpend(req.userId, cycle.start, cycle.end);
      return res.status(200).json({
        status: 'ok',
        cycle,                                  // { start, end, anchorDay }
        income: settings.salaryAmount ?? null,  // төлөвлөсөн циклийн орлого (тохиргооноос)
        actualIncome: spend.actualIncome,       // бодит income гүйлгээ (тусдаа)
        byCategory: spend.byCategory,           // [{ category, spent }]
        unclassified: spend.unclassified,       // тодорхойгүй зарлага (далдлахгүй)
        totalSpend: spend.totalSpend,           // = Σ byCategory + unclassified
      });
    } catch (err) {
      logger.error('GET /budget-status алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/budget-allocations — %-хуваарилалт (DEFAULT хэрэв хоосон) ----
  router.get('/budget-allocations', (req, res) => {
    try {
      return res.status(200).json({ status: 'ok', allocations: db.getBudgetAllocations(req.userId) });
    } catch (err) {
      logger.error('GET /budget-allocations алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- PUT /api/budget-allocations — бүх жагсаалтыг ATOMIC upsert ----
  router.put('/budget-allocations', (req, res) => {
    try {
      const parsed = AllocListSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ status: 'error', error: 'Хүчингүй хуваарилалт', details: zodErrors(parsed.error) });
      }
      const allocations = db.saveBudgetAllocations(req.userId, parsed.data.allocations);
      return res.status(200).json({ status: 'ok', allocations });
    } catch (err) {
      logger.error('PUT /budget-allocations алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- GET /api/events ----
  router.get('/events', (req, res) => {
    try {
      return res.status(200).json({ status: 'ok', data: db.listEvents(req.userId) });
    } catch (err) {
      logger.error('GET /events алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- POST /api/events ----
  router.post('/events', (req, res) => {
    try {
      const parsed = EventSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ status: 'error', error: 'Хүчингүй event', details: zodErrors(parsed.error) });
      }
      const event = db.addEvent(req.userId, parsed.data);
      return res.status(201).json({ status: 'ok', event });
    } catch (err) {
      logger.error('POST /events алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  // ---- DELETE /api/events/:id ----
  router.delete('/events/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ status: 'error', error: 'id буруу' });
      }
      const changes = db.deleteEvent(req.userId, id);
      if (changes === 0) return res.status(404).json({ status: 'error', error: 'Not Found' });
      return res.status(200).json({ status: 'ok', deleted: id });
    } catch (err) {
      logger.error('DELETE /events алдаа', { err: err?.message });
      return res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    }
  });

  return router;
}

export default createBudgetRouter;
