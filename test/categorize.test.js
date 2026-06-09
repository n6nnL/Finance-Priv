// ============================================================
//  test/categorize.test.js — categorize (10 ангиллын систем)
//  Ажиллуулах:  node --test
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize } from '../src/categorize.js';

test('Netflix → Захиалга & сервис', () => {
  assert.equal(categorize({ description: '2266 NetflMCI' }), 'Захиалга & сервис');
});
test('SocialPay → Захиалга & сервис', () => {
  assert.equal(categorize({ description: 'SOCIALPAY ГҮЙЛГЭЭ' }), 'Захиалга & сервис');
});
test('AMJILT ACADEMY → Боловсрол', () => {
  assert.equal(categorize({ description: 'AMJILT ACADEMY' }), 'Боловсрол');
});
test('CU дэлгүүр → Хүнсний зүйл', () => {
  assert.equal(categorize({ description: '0930 CU-4 POS' }), 'Хүнсний зүйл');
});
test('SHELL PETROL → Тээвэр', () => {
  assert.equal(categorize({ description: 'SHELL PETROL' }), 'Тээвэр');
});
test('ShuluBOM (хэрэглэгч таньсан) → Гадуур хооллолт', () => {
  assert.equal(categorize({ description: '0930 SHULUBOM' }), 'Гадуур хооллолт');
});
test('income → Орлого (type-аар)', () => {
  assert.equal(categorize({ type: 'income', description: 'хүн мөнгө явуулав' }), 'Орлого');
});
test('STOREBOM (таслагдсан, таниулашгүй) → null (pending)', () => {
  assert.equal(categorize({ description: '0930 STOREBOM' }), null);
});
test('таниулашгүй → null (pending)', () => {
  assert.equal(categorize({ description: 'xyz таниулашгүй' }), null);
});
test('автоматаар "Бусад" буцаахгүй (хоосон → null)', () => {
  assert.equal(categorize({ description: '' }), null);
});
