// ============================================================
//  lib/debt.test.js — өрийн цэвэр логикийн тест (React-гүй)
//  ⚠️ Гол баталгаа: MNT ба EUR ХЭЗЭЭ Ч хооронд цэвэршихгүй.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signedAmount, netBalances, groupByCounterparty, totalsByCurrency,
  eurToMntDisplay, balancePhrase, effectiveShare, remainingExcludable, exclusionMarker,
  isRepayment, outstandingOf,
} from './debt.js';

const e = (over = {}) => ({
  counterparty: 'Болд', direction: 'i_lent', amount: 10000,
  currency: 'MNT', status: 'open', ...over,
});

test('signedAmount: i_lent → эерэг, i_borrowed → сөрөг', () => {
  assert.equal(signedAmount(e({ amount: 500 })), 500);
  assert.equal(signedAmount(e({ amount: 500, direction: 'i_borrowed' })), -500);
});

test('netBalances: нэг хүний хоёр бичлэг цэвэршинэ', () => {
  const out = netBalances([
    e({ amount: 50000 }),                                  // Болд надад 50,000 өртэй
    e({ amount: 20000, direction: 'i_borrowed' }),          // би Болдод 20,000 өртэй
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { counterparty: 'Болд', currency: 'MNT', net: 30000, direction: 'i_lent' });
});

test('netBalances: ⚠️ MNT ба EUR ХООРОНДОО цэвэрших ЁСГҮЙ', () => {
  const out = netBalances([
    e({ amount: 50000, currency: 'MNT' }),
    e({ amount: 20, currency: 'EUR', direction: 'i_borrowed' }),
  ]);
  assert.equal(out.length, 2); // хоёр тусдаа мөр — нэг тоонд нийлээгүй
  assert.deepEqual(out.find((r) => r.currency === 'MNT'), { counterparty: 'Болд', currency: 'MNT', net: 50000, direction: 'i_lent' });
  assert.deepEqual(out.find((r) => r.currency === 'EUR'), { counterparty: 'Болд', currency: 'EUR', net: -20, direction: 'i_borrowed' });
});

test('netBalances: settled бичлэг үлдэгдэлд ОРОХГҮЙ', () => {
  const out = netBalances([e({ amount: 10000, status: 'settled' }), e({ amount: 3000 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].net, 3000);
});

test('netBalances: бүрэн цэвэршсэн (net=0) хос буцаахгүй', () => {
  const out = netBalances([e({ amount: 7000 }), e({ amount: 7000, direction: 'i_borrowed' })]);
  assert.deepEqual(out, []);
});

test('netBalances: зайтай нэр эвдрэхгүй ("Ээж эгч")', () => {
  const out = netBalances([e({ counterparty: 'Ээж эгч', amount: 1200 })]);
  assert.equal(out[0].counterparty, 'Ээж эгч');
  assert.equal(out[0].currency, 'MNT');
});

test('netBalances: хоосон/буруу оролт → хоосон массив (хуурамч тоо гаргахгүй)', () => {
  assert.deepEqual(netBalances([]), []);
  assert.deepEqual(netBalances(null), []);
  assert.deepEqual(netBalances([e({ counterparty: '   ' })]), []);
});

test('groupByCounterparty: нэг хүн = нэг бүлэг, дотор нь валютууд', () => {
  const balances = netBalances([
    e({ counterparty: 'Болд', amount: 5000 }),
    e({ counterparty: 'Болд', amount: 20, currency: 'EUR' }),
    e({ counterparty: 'Ана', amount: 800, direction: 'i_borrowed' }),
  ]);
  const g = groupByCounterparty(balances);
  assert.deepEqual(g.map((x) => x.counterparty), ['Ана', 'Болд']); // цагаан толгойн дараалал
  assert.equal(g.find((x) => x.counterparty === 'Болд').lines.length, 2);
});

test('totalsByCurrency: ирэх/өгөх нь валют тусдаа', () => {
  const t = totalsByCurrency(netBalances([
    e({ counterparty: 'Болд', amount: 5000 }),
    e({ counterparty: 'Ана', amount: 2000, direction: 'i_borrowed' }),
    e({ counterparty: 'Ана', amount: 30, currency: 'EUR' }),
  ]));
  assert.deepEqual(t.MNT, { owedToMe: 5000, iOwe: 2000 });
  assert.deepEqual(t.EUR, { owedToMe: 30, iOwe: 0 });
});

test('eurToMntDisplay: ханш байхгүй/буруу → null (хуурамч тоо ҮГҮЙ)', () => {
  assert.equal(eurToMntDisplay(20, 4120), 82400);
  assert.equal(eurToMntDisplay(20, null), null);
  assert.equal(eurToMntDisplay(20, 0), null);
  assert.equal(eurToMntDisplay(20, undefined), null);
  assert.equal(eurToMntDisplay(null, 4120), null);
});

test('balancePhrase: чиглэлээс хамаарсан монгол өгүүлбэр', () => {
  const owed = balancePhrase({ counterparty: 'Болд', currency: 'MNT', net: 20000 });
  assert.equal(owed.subject, 'Болд танд');
  assert.equal(owed.isOwedToMe, true);
  assert.equal(owed.abs, 20000);

  const iOwe = balancePhrase({ counterparty: 'ээж', currency: 'MNT', net: -100000 });
  assert.equal(iOwe.subject, 'Та ээж-д');
  assert.equal(iOwe.isOwedToMe, false);
  assert.equal(iOwe.abs, 100000);
});

// ===================== ХЭСЭГЧИЛСЭН ХАСАЛТ (split) =====================

test('effectiveShare: exclusionShare байхгүй бол бичлэгийн бүтэн дүн', () => {
  assert.equal(effectiveShare(e({ amount: 30000 })), 30000);
  assert.equal(effectiveShare(e({ amount: 30000, exclusionShare: null })), 30000);
  assert.equal(effectiveShare(e({ amount: 30000, exclusionShare: 40000 })), 40000);
  assert.equal(effectiveShare(e({ amount: 30000, exclusionShare: 0 })), 0, '0 = холбоно ч хасахгүй');
  assert.equal(effectiveShare(null), 0);
});

test('remainingExcludable: бүтэн дүнгээс аль хэдийн хасагдсаныг хасна', () => {
  assert.equal(remainingExcludable({ amount: 90000, excluded_amount: 0 }), 90000);
  assert.equal(remainingExcludable({ amount: 90000, excluded_amount: 30000 }), 60000);
  assert.equal(remainingExcludable({ amount: 90000, excluded_amount: 90000 }), 0);
  // ⚠️ ХЭЗЭЭ Ч сөрөг болохгүй (хэрэв өгөгдөл гажсан ч)
  assert.equal(remainingExcludable({ amount: 90000, excluded_amount: 120000 }), 0);
  assert.equal(remainingExcludable(null), 0);
});

test('exclusionMarker: хасалтгүй → null, хэсэгчилсэн → цэвэр дүн, бүрэн → full', () => {
  assert.equal(exclusionMarker({ amount: 90000, excluded_amount: 0 }), null);
  assert.equal(exclusionMarker({ amount: 90000 }), null);

  const partial = exclusionMarker({ amount: 90000, excluded_amount: 55000 });
  assert.equal(partial.full, false);
  assert.equal(partial.excluded, 55000);
  assert.equal(partial.net, 35000, 'ангилалд үлдэх ӨӨРИЙН зарлага');

  const full = exclusionMarker({ amount: 600000, excluded_amount: 600000 });
  assert.equal(full.full, true);
  assert.equal(full.net, 0);
  // float бөөрөнхийлөлт "бүрэн"-ийг эвдэхгүй
  assert.equal(exclusionMarker({ amount: 0.3, excluded_amount: 0.1 + 0.2 }).full, true);
});

// ===================== ХЭСЭГЧИЛСЭН БУЦААЛТ (019) =====================

test('isRepayment: repaysEntryId байвал буцаалтын эвент', () => {
  assert.equal(isRepayment(e()), false);
  assert.equal(isRepayment(e({ repaysEntryId: null })), false);
  assert.equal(isRepayment(e({ repaysEntryId: 7 })), true);
  assert.equal(isRepayment(null), false);
});

test('★ netBalances: буцаалт нь ЭСРЭГ чиглэлээр цэвэршинэ (50,000 − 20,000 = 30,000)', () => {
  const out = netBalances([
    e({ counterparty: 'Мөнх-од', direction: 'i_lent', amount: 50000 }),
    e({ counterparty: 'Мөнх-од', direction: 'i_borrowed', amount: 20000, repaysEntryId: 1 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].net, 30000, '★ үлдэгдэл 30,000₮');
  assert.equal(out[0].direction, 'i_lent', 'тэр хүн ХЭВЭЭР надад өртэй');
});

test('★ Бүтэн буцаалт → үлдэгдэл огт харагдахгүй (тэг мөрийг буцаадаггүй)', () => {
  const out = netBalances([
    e({ counterparty: 'Мөнх-од', direction: 'i_lent', amount: 50000 }),
    e({ counterparty: 'Мөнх-од', direction: 'i_borrowed', amount: 50000, repaysEntryId: 1 }),
  ]);
  assert.equal(out.length, 0);
});

test('★ Буцаалт нь ВАЛЮТ ХООРОНД цэвэрших ЁСГҮЙ (EUR өрийг MNT-ээр хаахгүй)', () => {
  const out = netBalances([
    e({ counterparty: 'Ээж', direction: 'i_lent', amount: 100, currency: 'EUR' }),
    e({ counterparty: 'Ээж', direction: 'i_borrowed', amount: 100, currency: 'MNT', repaysEntryId: 1 }),
  ]);
  assert.equal(out.length, 2, 'хоёр ӨӨР валютын өр тусдаа үлдэнэ');
  assert.equal(out.find((b) => b.currency === 'EUR').net, 100);
  assert.equal(out.find((b) => b.currency === 'MNT').net, -100);
});

test('Хаагдсан буцаалт үлдэгдэлд оролцохгүй (эх бичлэгтэйгээ хамт хаагддаг)', () => {
  const out = netBalances([
    e({ counterparty: 'Хаалт', direction: 'i_lent', amount: 50000, status: 'settled' }),
    e({ counterparty: 'Хаалт', direction: 'i_borrowed', amount: 20000, status: 'settled', repaysEntryId: 1 }),
  ]);
  assert.equal(out.length, 0, '★ сөрөг үлдэгдэл ҮҮСЭХГҮЙ');
});

test('outstandingOf: серверийн дүнг хэрэглэнэ, буцаалтын эвент нь 0', () => {
  assert.equal(outstandingOf(e({ amount: 50000, outstanding: 30000 })), 30000);
  assert.equal(outstandingOf(e({ amount: 50000, repaysEntryId: 1, outstanding: 0 })), 0);
  // Сервер илгээгээгүй бол (хуучин хариу) бүтэн дүн
  assert.equal(outstandingOf(e({ amount: 50000 })), 50000);
  // ХЭЗЭЭ Ч сөрөг болохгүй
  assert.equal(outstandingOf(e({ amount: 50000, outstanding: -5 })), 0);
});
