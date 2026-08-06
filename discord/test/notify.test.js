// ============================================================
//  discord/test/notify.test.js — мэдэгдлийн огноо/цагийн форматлалт (017)
//
//  Invariant: email_received_at NULL бол ЗӨВХӨН огноо — хуурамч "00:00" гарахгүй.
//  Утгатай үед ISO UTC → УБ (Asia/Ulaanbaatar) цагаар HH:mm нэмэгдэнэ.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate, fmtDateTime, buildEmbed } from '../notify.js';

const baseTx = {
  id: 1, amount: 37000, type: 'expense', category: 'Хүнсний зүйл',
  description: '0930 STOREBOM', txn_date: '2026-08-05', account_last4: '0930',
  status: 'classified', is_pos: 1,
};

test('fmtDateTime: email_received_at утгатай → "огноо · УБ цаг"', () => {
  assert.equal(
    fmtDateTime({ ...baseTx, email_received_at: '2026-08-05T06:32:00.000Z' }),
    '2026-08-05 · 14:32'
  );
  // UTC-ээр өмнөх өдрийн орой ч УБ-д маргааш — цаг нь УБ-аар (00:10)
  assert.equal(
    fmtDateTime({ ...baseTx, txn_date: '2026-08-06', email_received_at: '2026-08-05T16:10:00.000Z' }),
    '2026-08-06 · 00:10'
  );
});

test('fmtDateTime: email_received_at NULL/байхгүй → ЗӨВХӨН огноо (цаг нэмэхгүй)', () => {
  assert.equal(fmtDateTime({ ...baseTx, email_received_at: null }), '2026-08-05');
  assert.equal(fmtDateTime(baseTx), '2026-08-05');
  assert.equal(fmtDateTime({ ...baseTx, email_received_at: 'буруу утга' }), '2026-08-05');
  // Огноо ч байхгүй мөр → fmtDate-ийн хэвийн '-'
  assert.equal(fmtDateTime({ txn_date: null, email_received_at: null }), '-');
  assert.equal(fmtDate(null), '-');
});

test('buildEmbed: Огноо талбарт цаг орсон/ороогүй нь email_received_at-аас хамаарна', () => {
  const withTime = buildEmbed({ ...baseTx, email_received_at: '2026-08-05T06:32:00.000Z' }).toJSON();
  const dateField = withTime.fields.find((f) => f.name === 'Огноо');
  assert.equal(dateField.value, '2026-08-05 · 14:32');

  const noTime = buildEmbed({ ...baseTx, email_received_at: null }).toJSON();
  assert.equal(noTime.fields.find((f) => f.name === 'Огноо').value, '2026-08-05');
});
