// ============================================================
//  test/emailReceivedAt.test.js — Мэдэгдэл ирсэн цаг (email `Date:` header)
//
//  Голомтын имэйлийн BODY-д ЗӨВХӨН огноо (цаггүй) байдаг тул гүйлгээний цагийг
//  Gmail имэйлийн `Date:` header-ээс авдаг. Энэ файл нь listener-ийн замыг
//  бүхэлд нь түгжинэ: simpleParser → isoInstant → push payload.
//
//  ⚠️ Гол invariant: цаг олдохгүй бол null — ХЭЗЭЭ Ч одоогийн цагаар нөхөхгүй,
//     мөн tx.date (txn_date) нь огноо (YYYY-MM-DD) хэвээрээ үлдэнэ.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simpleParser } from 'mailparser';
import { isoInstant, ubTimeLabel } from '../config/txfields.js';
import { buildPushPayload } from '../src/payload.js';
import { parseGolomt } from '../src/parsers/golomt.js';

const BODY = [
  'ЗАРЛАГЫН ГҮЙЛГЭЭ',
  'Гүйлгээний дүн: -37,000.00',
  'Гүйлгээ хийгдсэн огноо: 2026-08-05',
  'Дансны дугаар: 116*****50',
  'Гүйлгээний утга: 0930 STOREBOM',
  'Үлдэгдэл: 1,240,500.00',
].join('\r\n');

/** Түүхий имэйл (RFC822) бүтээх — Date: header-тэй эсвэл огт байхгүй. */
function rawEmail(dateHeader) {
  return [
    'From: alert@golomtbank.com',
    'To: user@example.com',
    'Subject: Golomt Bank',
    ...(dateHeader ? [`Date: ${dateHeader}`] : []),
    'Message-ID: <abc-123@golomtbank.com>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    BODY,
  ].join('\r\n');
}

test('simpleParser: `Date:` header → parsed.date (JS Date) → ISO UTC', async () => {
  // УБ цагаар 14:32 = 06:32 UTC
  const parsed = await simpleParser(rawEmail('Wed, 5 Aug 2026 14:32:00 +0800'));
  assert.ok(parsed.date instanceof Date, 'simpleParser нь date талбарыг Date болгож өгөх ёстой');
  assert.equal(isoInstant(parsed.date), '2026-08-05T06:32:00.000Z');
});

test('push payload: emailReceivedAt нь ISO UTC-ээр орно; txn_date огноо ХЭВЭЭР', async () => {
  const parsed = await simpleParser(rawEmail('Wed, 5 Aug 2026 14:32:00 +0800'));
  const tx = parseGolomt(parsed);
  const payload = buildPushPayload({
    messageId: parsed.messageId,
    userId: 7,
    tx,
    category: 'Хүнсний зүйл',
    emailReceivedAt: isoInstant(parsed.date),
    subject: parsed.subject,
  });

  assert.equal(payload.emailReceivedAt, '2026-08-05T06:32:00.000Z');
  assert.equal(payload.date, '2026-08-05', 'date нь ОГНОО хэвээр (цаг наалдахгүй)');
  assert.equal(payload.amount, 37000);
  assert.equal(payload.userId, 7);
});

test('`Date:` header БАЙХГҮЙ → emailReceivedAt = null (одоогийн цагаар НӨХӨХГҮЙ)', async () => {
  const parsed = await simpleParser(rawEmail(null));
  const emailReceivedAt = isoInstant(parsed.date);
  assert.equal(emailReceivedAt, null);

  const tx = parseGolomt(parsed);
  const payload = buildPushPayload({ messageId: 'x', userId: 1, tx, category: null, emailReceivedAt });
  assert.equal(payload.emailReceivedAt, null);
  assert.equal(payload.date, '2026-08-05', 'цаг байхгүй ч огноо задарсан хэвээр');
});

test('isoInstant: буруу/хоосон утга → null, throw ХИЙХГҮЙ', () => {
  assert.equal(isoInstant(null), null);
  assert.equal(isoInstant(undefined), null);
  assert.equal(isoInstant(''), null);
  assert.equal(isoInstant('огноо биш'), null);
  assert.equal(isoInstant(new Date('буруу')), null);
  assert.equal(isoInstant('2026-08-05T06:32:00.000Z'), '2026-08-05T06:32:00.000Z');
  assert.equal(isoInstant(new Date(Date.UTC(2026, 7, 5, 6, 32))), '2026-08-05T06:32:00.000Z');
});

test('ubTimeLabel: ISO UTC → УБ (UTC+8) HH:mm; NULL → null', () => {
  assert.equal(ubTimeLabel('2026-08-05T06:32:00.000Z'), '14:32');
  assert.equal(ubTimeLabel('2026-08-05T16:10:00.000Z'), '00:10'); // УБ-д маргааш болсон
  assert.equal(ubTimeLabel('2026-08-05T00:00:00.000Z'), '08:00'); // 24 цагийн формат (h23)
  assert.equal(ubTimeLabel(null), null);
  assert.equal(ubTimeLabel(''), null);
  assert.equal(ubTimeLabel('буруу'), null);
});
