// ============================================================
//  lib/budget.test.js — цэвэр функцийн тест (node --test)
//  Ажиллуулах:  node --test dashboard/src/lib/budget.test.js
//  paydayFor (weekend ухралт), getCycle, isWithinCycle, захиалга/ханш.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  paydayFor, getCycle, isWithinCycle, isWeekend, ymd,
  cycleSubscriptions, subscriptionMarkers, incomeMarker, usdToMnt,
} from './budget.js';

test('paydayFor: ажлын өдөр бол яг тэр өдөр (2026-06, 15 = Даваа)', () => {
  const d = paydayFor(2026, 5, 15);
  assert.equal(ymd(d), '2026-06-15');
});

test('paydayFor: Бямба-payday сар (2026-08, 15 = Бямба) → Баасан 14 руу ухарна', () => {
  const d = paydayFor(2026, 7, 15); // 8-р сар
  assert.equal(ymd(d), '2026-08-14');
  assert.ok(!isWeekend(d), 'payday амралтын өдөр байж болохгүй');
});

test('paydayFor: Ням-payday сар (2026-02, 15 = Ням) → Баасан 13 руу ухарна', () => {
  const d = paydayFor(2026, 1, 15); // 2-р сар
  assert.equal(ymd(d), '2026-02-13');
});

test('paydayFor: ямар ч 2026 сард payday амралтын өдөр БИШ ба <= 15', () => {
  for (let m = 0; m < 12; m++) {
    const d = paydayFor(2026, m, 15);
    assert.ok(!isWeekend(d), `${m + 1}-р сар payday амралтын өдөр дээр буусан`);
    assert.ok(d.getDate() <= 15 && d.getDate() >= 13, `${m + 1}-р сар payday хэт ухарсан`);
  }
});

test('paydayFor: тохируулсан paydayDay (10) хүндэтгэгдэнэ', () => {
  const d = paydayFor(2026, 5, 10); // 2026-06-10 = Лхагва
  assert.equal(ymd(d), '2026-06-10');
});

test('paydayFor: guard — хязгаараас гадуур paydayDay-г 1–28 болгож хавчина', () => {
  assert.equal(paydayFor(2026, 5, 99).getDate() <= 28, true);
  assert.equal(ymd(paydayFor(2026, 5, 0)), ymd(paydayFor(2026, 5, 15))); // 0 → default 15
});

test('getCycle: payday → дараа сарын payday, start < end', () => {
  const { start, end } = getCycle(2026, 5, 15); // 6-р сар
  assert.equal(ymd(start), '2026-06-15');
  assert.equal(ymd(end), '2026-07-15'); // 7/15 = Лхагва (ажлын өдөр)
  assert.ok(start.getTime() < end.getTime());
});

test('getCycle: 12-р сар → дараа оны 1-р сар руу шилжинэ', () => {
  const { start, end } = getCycle(2026, 11, 15);
  assert.equal(start.getFullYear(), 2026);
  assert.equal(end.getFullYear(), 2027);
});

test('isWithinCycle: start багтана (inclusive), end багтахгүй (exclusive)', () => {
  const { start, end } = getCycle(2026, 5, 15);
  assert.equal(isWithinCycle(start, start, end), true);
  assert.equal(isWithinCycle(end, start, end), false);
  assert.equal(isWithinCycle('2026-06-25', start, end), true);
});

test('usdToMnt: ханшаар хөрвүүлнэ (тойм)', () => {
  assert.equal(usdToMnt(20, 3578), 71560);
  assert.equal(usdToMnt(3.99, 3578), Math.round(3.99 * 3578));
});

test('incomeMarker: цалин null үед amountMnt null (хуурамч тоо үгүй)', () => {
  const mk = incomeMarker(2026, 5, { paydayDay: 15, salaryAmount: null });
  assert.equal(mk.amountMnt, null);
  assert.equal(mk.type, 'income');
  const mk2 = incomeMarker(2026, 5, { paydayDay: 15, salaryAmount: 3000000 });
  assert.equal(mk2.amountMnt, 3000000);
});

test('subscriptionMarkers/cycleSubscriptions: тохиргооны subs-аас (hardcode үгүй)', () => {
  const settings = {
    paydayDay: 15, usdMnt: 3578,
    subscriptions: [{ name: 'Netflix', day: 7, amountUsd: 3.99 }, { name: 'Claude', day: 25, amountUsd: 20 }],
  };
  const marks = subscriptionMarkers(2026, 5, settings);
  assert.equal(marks.length, 2);
  assert.equal(marks[0].title, 'Netflix');
  assert.equal(marks[0].amountMnt, usdToMnt(3.99, 3578));

  // Цикл 6/15 → 7/15: Claude (6/25) багтана, Netflix (7/7) багтана, дараагийн Netflix (6/7) багтахгүй
  const cycle = getCycle(2026, 5, 15);
  const subs = cycleSubscriptions(cycle, settings);
  const titles = subs.map((s) => s.title);
  assert.ok(titles.includes('Claude'));
  assert.ok(subs.every((s) => isWithinCycle(s.date, cycle.start, cycle.end)));
});
