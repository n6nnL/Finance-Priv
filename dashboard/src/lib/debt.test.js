// ============================================================
//  lib/debt.test.js — өрийн цэвэр логикийн тест (React-гүй)
//  ⚠️ Гол баталгаа: MNT ба EUR ХЭЗЭЭ Ч хооронд цэвэршихгүй.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signedAmount, netBalances, groupByCounterparty, totalsByCurrency,
  eurToMntDisplay, balancePhrase,
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
