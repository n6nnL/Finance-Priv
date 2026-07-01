// ============================================================
//  test/shared.test.js — Refactor Фаз 2-ын дундын функцүүдийн
//  CHARACTERIZATION тест. Эдгээр нь src/ + api/ хоёул дуудагддаг тул зан төлөв
//  тогтмол байхыг энд түгжинэ (refactor-ийн өмнө/дараа ижил ногоон байх ёстой).
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIsPos, isoDate } from '../config/txfields.js';
import { matchByKeywords } from '../config/categories.js';

test('detectIsPos: BOM үгийн төгсгөл → true; бусад/boundary → false', () => {
  assert.equal(detectIsPos('0930 STOREBOM'), true);
  assert.equal(detectIsPos('0930 ARD BBOM'), true);
  assert.equal(detectIsPos('SocialPay гүйлгэ'), false);
  assert.equal(detectIsPos('BOMBAY RESTAURANT'), false); // BOMB... → boundary биш
  assert.equal(detectIsPos(null), false);
  assert.equal(detectIsPos(''), false);
});

test('isoDate (anchored=false): текст доторх ЭХНИЙ огноо', () => {
  assert.equal(isoDate('2026-01-16'), '2026-01-16');
  assert.equal(isoDate('2026/01/16'), '2026-01-16');
  assert.equal(isoDate('2026.01.16'), '2026-01-16');
  assert.equal(isoDate('Огноо:2026/01/16 22:12:35'), '2026-01-16'); // anywhere
  assert.equal(isoDate('огноогүй мөр'), null);
  assert.equal(isoDate(null), null);
});

test('isoDate (anchored=true): зөвхөн мөрийн эхэнд', () => {
  assert.equal(isoDate('2026-01-16 22:12', { anchored: true }), '2026-01-16');
  assert.equal(isoDate('2026/01/16', { anchored: true }), '2026-01-16');
  assert.equal(isoDate('prefix 2026-01-16', { anchored: true }), null); // эхэнд биш → null
});

test('matchByKeywords: keyword → category; танигдаагүй → null (Бусад БИШ)', () => {
  assert.equal(matchByKeywords('KFC delivery'), 'Гадуур хооллолт');
  assert.equal(matchByKeywords('NOMIN supermarket'), 'Хүнсний зүйл');
  assert.equal(matchByKeywords('Netflix'), 'Захиалга & сервис');
  assert.equal(matchByKeywords('0930 ZZUNKNOWNXYZ'), null);
  assert.equal(matchByKeywords(''), null);
  assert.equal(matchByKeywords(null), null);
});
