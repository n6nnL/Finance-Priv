// ============================================================
//  test/golomt.test.js — parseGolomt-ийн unit test
//  Ажиллуулах:  node --test
//
//  Fixture-ууд нь Голомт банкны "Easy Info гүйлгээний мэдээлэл" имэйлийн
//  бодит label-value форматыг загварчилсан. parseGolomt нь simpleParser-ийн
//  үр дүн ({ html, text, subject, messageId }) -г ШУУД авдаг.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGolomt, detectIsPos } from '../src/parsers/golomt.js';

// ---------- Олон загварын тест (reparse-д шаардлагатай) ----------

test('EASYINFO: огноо labelгүй дангаар мөрөнд (хуучин загвар)', () => {
  const t = [
    'ЗАРЛАГЫН ГҮЙЛГЭЭ',
    'Гүйлгээний дүн:',
    '-5,550.00MNT',
    '2022-12-04',
    'Дансны дугаар: 116*****50 Гүйлгээний утга: 0930 STOREBOM Үлдэгдэл: 18,380.00MNT',
  ].join('\n');
  const tx = parseGolomt({ messageId: '<e1>', text: t, html: false });
  assert.equal(tx.amount, 5550);
  assert.equal(tx.type, 'expense');
  assert.equal(tx.date, '2022-12-04'); // labelгүй ч fallback-аар олно
  assert.equal(tx.accountLast4, '50');
  assert.equal(tx.description, '0930 STOREBOM');
  assert.equal(tx.isPos, true); // BOM-оор төгссөн → POS
});

test('VERBOSE: "Гүйлгээ хийгдсэн огноо" + олон мөрт бүтэц (орлого)', () => {
  const t = [
    'ЭРХЭМ ХАРИЛЦАГЧ ТАНД ЭНЭ ӨДРИЙН МЭНД ХҮРГЭЕ.',
    'Таны дансанд орлогын гүйлгээ хийгдлээ.',
    'Гүйлгээ хийгдсэн огноо',
    '2022-11-01',
    'Дансны дугаар',
    '116*****50',
    'Гүйлгээний дүн',
    '210,000.00',
    'Гүйлгээний утга',
    'AMJILT ACADEMY t',
    'Үлдэгдэл',
    '210,000.00',
  ].join('\n');
  const tx = parseGolomt({ messageId: '<v1>', text: t, html: false });
  assert.equal(tx.amount, 210000);
  assert.equal(tx.type, 'income');
  assert.equal(tx.date, '2022-11-01');
  assert.equal(tx.accountLast4, '50');
  assert.equal(tx.description, 'AMJILT ACADEMY t');
  assert.equal(tx.isPos, false);
});

test('CARD: "Картын дугаар" + налуу зураастай огноо (Огноо:2026/01/16)', () => {
  const t = [
    'Эрхэм харилцагч ТӨГӨЛДӨР БАТСАЙХАН таны картнаас ЗАРЛАГА гарлаа.',
    'Картын дугаар:****0930',
    'Гүйлгээний дүн: 50,720.00MNT',
    'Огноо:2026/01/16 22:12:35',
  ].join('\n');
  const tx = parseGolomt({ messageId: '<c1>', text: t, html: false });
  assert.equal(tx.amount, 50720);
  assert.equal(tx.type, 'expense');
  assert.equal(tx.date, '2026-01-16'); // YYYY/MM/DD → ISO
  assert.equal(tx.accountLast4, '0930');
});

test('detectIsPos: BOM төгсгөл → true, бусад → false', () => {
  assert.equal(detectIsPos('0930 STOREBOM'), true);
  assert.equal(detectIsPos('0930 ARD BBOM'), true);
  assert.equal(detectIsPos('SocialPay гүйлгэ'), false);
  assert.equal(detectIsPos('HER-БАТСАЙХАН ТӨ'), false);
  assert.equal(detectIsPos(null), false);
  assert.equal(detectIsPos('BOMBAY RESTAURANT'), false); // BOMB... → boundary биш
});

// ---------- Үндсэн (EASYINFO labelтэй) тестүүд ----------

// --- Зарлагын гүйлгээ (plain text) ---
const expenseText = [
  'ЗАРЛАГЫН ГҮЙЛГЭЭ',
  'Гүйлгээний дүн: -14,412.34MNT',
  'Гүйлгээний огноо: 2026-06-07',
  'Дансны дугаар: 116*****50',
  'Гүйлгээний утга: 2266 NetflMCI',
  'Үлдэгдэл: 17,499.92 MNT',
].join('\n');

test('зарлагын plain text → amount эерэг, type expense', () => {
  const tx = parseGolomt({
    messageId: '<golomt-1@golomtbank.com>',
    subject: 'Easy Info',
    text: expenseText,
    html: false,
  });
  assert.equal(tx.amount, 14412.34);
  assert.equal(tx.type, 'expense');
  assert.equal(tx.currency, 'MNT');
  assert.equal(tx.date, '2026-06-07');
  assert.equal(tx.description, '2266 NetflMCI');
  assert.equal(tx.accountLast4, '50');
  assert.equal(tx.accountMasked, '116*****50');
  assert.equal(tx.balance, 17499.92);
  assert.equal(tx.messageId, '<golomt-1@golomtbank.com>');
});

test('бодит формат: нэг мөрөнд 3 label холилдсон ч зөв салгана', () => {
  // Голомтын бодит имэйл: Дансны дугаар + Гүйлгээний утга + Үлдэгдэл нэг мөрөнд,
  // мөн "Гүйлгээний дүн:" label, дүн нь дараагийн мөрөнд.
  const realText = [
    'ЗАРЛАГЫН ГҮЙЛГЭЭ',
    'Гүйлгээний дүн:',
    '-14,412.34MNT',
    'Гүйлгээний огноо: 2026-06-07',
    'Дансны дугаар: 116*****50 Гүйлгээний утга: 2266 NetflMCI Үлдэгдэл: 17,499.92 MNT',
  ].join('\n');
  const tx = parseGolomt({ messageId: '<real>', text: realText, html: false });
  assert.equal(tx.amount, 14412.34);
  assert.equal(tx.type, 'expense');
  assert.equal(tx.date, '2026-06-07');
  assert.equal(tx.accountLast4, '50');
  assert.equal(tx.description, '2266 NetflMCI'); // "Үлдэгдэл..." холилдоогүй
  assert.equal(tx.balance, 17499.92);
});

test('орлогын plain text → type income (- тэмдэггүй, зарлаг үггүй)', () => {
  const incomeText = [
    'ОРЛОГЫН ГҮЙЛГЭЭ',
    'Гүйлгээний дүн: 50,000.00MNT',
    'Гүйлгээний огноо: 2026-06-08',
    'Дансны дугаар: 116*****50',
    'Гүйлгээний утга: Цалин',
    'Үлдэгдэл: 67,499.92 MNT',
  ].join('\n');
  const tx = parseGolomt({ messageId: '<g2>', text: incomeText, html: false });
  assert.equal(tx.amount, 50000);
  assert.equal(tx.type, 'income');
  assert.equal(tx.description, 'Цалин');
});

test('HTML хүснэгтээс label→value уншина', () => {
  const html = `
    <html><body>
      <h2>ЗАРЛАГЫН ГҮЙЛГЭЭ</h2>
      <table>
        <tr><td>Гүйлгээний дүн</td><td>-14,412.34MNT</td></tr>
        <tr><td>Гүйлгээний огноо</td><td>2026-06-07</td></tr>
        <tr><td>Дансны дугаар</td><td>116*****50</td></tr>
        <tr><td>Гүйлгээний утга</td><td>2266 NetflMCI</td></tr>
        <tr><td>Үлдэгдэл</td><td>17,499.92 MNT</td></tr>
      </table>
    </body></html>`;
  const tx = parseGolomt({ messageId: '<g3>', subject: 'Easy Info', html });
  assert.equal(tx.amount, 14412.34);
  assert.equal(tx.type, 'expense');
  assert.equal(tx.date, '2026-06-07');
  assert.equal(tx.description, '2266 NetflMCI');
  assert.equal(tx.accountLast4, '50');
});

test('гүйлгээ биш имэйл → amount null (index.js parse_failed гэж үзнэ)', () => {
  const tx = parseGolomt({
    messageId: '<g4>',
    subject: 'Сурталчилгаа',
    text: 'Сайн байна уу. Энэ бол ямар ч дүнгүй мэдээллийн имэйл.',
    html: false,
  });
  assert.equal(tx.amount, null);
});

test('хоосон имэйл → amount null', () => {
  const tx = parseGolomt({ messageId: '<g5>', text: '', html: false });
  assert.equal(tx.amount, null);
});

test('Үлдэгдэл талбар байхгүй ч бусад талбар зөв бол throw хийхгүй, balance null', () => {
  const t = [
    'ЗАРЛАГЫН ГҮЙЛГЭЭ',
    'Гүйлгээний дүн: -3,000.00MNT',
    'Гүйлгээний огноо: 2026-06-09',
    'Дансны дугаар: 116*****50',
    'Гүйлгээний утга: TEST NO BALANCE',
  ].join('\n');
  assert.doesNotThrow(() => {
    const tx = parseGolomt({ messageId: '<nobal>', text: t, html: false });
    assert.equal(tx.amount, 3000);
    assert.equal(tx.type, 'expense');
    assert.equal(tx.balance, null);
  });
});
