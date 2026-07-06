// ============================================================
//  balanceAlert.test.js — Үлдэгдэл parse-drift сэрэмжлүүлгийн threshold
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackBalanceParse, _resetBalanceAlertState, BALANCE_MISS_THRESHOLD } from './balanceAlert.js';

test('ганц (isolated) miss дээр сэрэмжлүүлэхгүй', () => {
  _resetBalanceAlertState();
  let calls = 0;
  trackBalanceParse(false, { notify: () => { calls += 1; } });
  assert.equal(calls, 0);
});

test(`${BALANCE_MISS_THRESHOLD} дараалсан miss хүрэхэд сэрэмжлүүлнэ`, () => {
  _resetBalanceAlertState();
  let calls = 0;
  const notify = () => { calls += 1; };
  for (let i = 0; i < BALANCE_MISS_THRESHOLD - 1; i++) trackBalanceParse(false, { notify });
  assert.equal(calls, 0, 'threshold хүрэхээс өмнө дуудагдахгүй');
  trackBalanceParse(false, { notify });
  assert.equal(calls, 1, 'threshold дээр яг нэг удаа дуудагдана');
});

test('амжилттай parse counter-г reset хийнэ — дараагийн batch дахин threshold шаардана', () => {
  _resetBalanceAlertState();
  let calls = 0;
  const notify = () => { calls += 1; };
  for (let i = 0; i < BALANCE_MISS_THRESHOLD - 1; i++) trackBalanceParse(false, { notify });
  trackBalanceParse(true, { notify }); // амжилттай → reset
  for (let i = 0; i < BALANCE_MISS_THRESHOLD - 1; i++) trackBalanceParse(false, { notify });
  assert.equal(calls, 0, 'reset хийсний дараа дахин threshold-1 удаа miss хийвэл сэрэмжлүүлэхгүй');
});

test('сэрэмжлүүлсний дараа counter reset хийгдэж, дараагийн N miss дахин сэрэмжлүүлнэ', () => {
  _resetBalanceAlertState();
  let calls = 0;
  const notify = () => { calls += 1; };
  for (let i = 0; i < BALANCE_MISS_THRESHOLD; i++) trackBalanceParse(false, { notify });
  assert.equal(calls, 1);
  for (let i = 0; i < BALANCE_MISS_THRESHOLD; i++) trackBalanceParse(false, { notify });
  assert.equal(calls, 2);
});
