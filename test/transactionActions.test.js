// ============================================================
//  test/transactionActions.test.js — config/transactionActions.js-ийн тест
//  Гурван client (Discord/Telegram/Website) энэ модульд тулгуурладаг тул
//  POS/энгийн талбарын ялгаа, applyToAll-ийн дүрмийг энд түгжинэ.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_SET_CATEGORY, ACTION_SET_PLACE, ACTION_SET_NOTE,
  isPosTxn, isPendingTxn, detailFieldFor, availableActions, findAction,
} from '../config/transactionActions.js';

const posTxn = { id: 1, is_pos: 1, status: 'pending_review', category: null, merchant_place: null, note: null };
const plainTxn = { id: 2, is_pos: 0, status: 'classified', category: 'Шилжүүлэг & гэр бүл', merchant_place: null, note: 'Ээжид' };

test('isPosTxn: 1/true → true; 0/null/undefined → false', () => {
  assert.equal(isPosTxn({ is_pos: 1 }), true);
  assert.equal(isPosTxn({ is_pos: true }), true); // listener талын boolean
  assert.equal(isPosTxn({ is_pos: 0 }), false);
  assert.equal(isPosTxn({}), false);
  assert.equal(isPosTxn(null), false);
});

test('isPendingTxn: pending_review ЭСВЭЛ category=null → true', () => {
  assert.equal(isPendingTxn({ status: 'pending_review', category: null }), true);
  assert.equal(isPendingTxn({ status: 'classified', category: null }), true); // category=null давамгайлна
  assert.equal(isPendingTxn({ status: 'classified', category: 'Тээвэр' }), false);
});

test('POS гүйлгээ → setPlace (Газрын нэр, merchantPlace/merchant_place)', () => {
  const f = detailFieldFor(posTxn);
  assert.equal(f.action, ACTION_SET_PLACE);
  assert.equal(f.apiField, 'merchantPlace');
  assert.equal(f.rowField, 'merchant_place');
  assert.equal(f.label, 'Газрын нэр');
  assert.equal(f.maxLength, 200);
});

test('энгийн гүйлгээ → setNote (Шалтгаан, note/note), current=одоогийн note', () => {
  const f = detailFieldFor(plainTxn);
  assert.equal(f.action, ACTION_SET_NOTE);
  assert.equal(f.apiField, 'note');
  assert.equal(f.rowField, 'note');
  assert.equal(f.label, 'Шалтгаан');
  assert.equal(f.current, 'Ээжид');
});

test('setCategory ҮРГЭЛЖ supportsApplyToAll:true; талбарын засвар ҮРГЭЛЖ false', () => {
  for (const txn of [posTxn, plainTxn]) {
    const [cat, detail] = availableActions(txn);
    assert.equal(cat.action, ACTION_SET_CATEGORY);
    assert.equal(cat.supportsApplyToAll, true);
    assert.equal(detail.supportsApplyToAll, false); // override дан талбараас ХЭЗЭЭ Ч үүсэхгүй
  }
});

test('шошго: pending → "Ангилал сонгох", classified → "Ангилал өөрчлөх" (боломж хаагдахгүй)', () => {
  const [catPending] = availableActions(posTxn);
  const [catDone] = availableActions(plainTxn);
  assert.equal(catPending.label, 'Ангилал сонгох');
  assert.equal(catDone.label, 'Ангилал өөрчлөх');
  assert.equal(catDone.current, 'Шилжүүлэг & гэр бүл'); // classified ч гэсэн үйлдэл БОЛОМЖТОЙ
});

test('findAction: нэрээр олно, олдохгүй бол null', () => {
  assert.equal(findAction(posTxn, ACTION_SET_PLACE).apiField, 'merchantPlace');
  assert.equal(findAction(posTxn, ACTION_SET_NOTE), null); // POS-д setNote БАЙХГҮЙ
  assert.equal(findAction(plainTxn, ACTION_SET_PLACE), null); // энгийнд setPlace БАЙХГҮЙ
  assert.equal(findAction(plainTxn, 'huuramch'), null);
});
