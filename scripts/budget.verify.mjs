// Verification for dashboard/src/lib/budget.js (pure logic).
import assert from 'node:assert';
import {
  paydayFor, getCycle, cycleSubscriptions, isWithinCycle, ymd, USD_MNT,
} from 'file:///D:/Claude/dashboard/src/lib/budget.js';

let pass = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const DOW = ['Ня', 'Да', 'Мя', 'Лха', 'Пүр', 'Баа', 'Бям'];

// helper: scan years for a month whose 15th falls on a given JS weekday (0=Sun,6=Sat)
function findMonthWhere15Is(weekday) {
  for (let y = 2024; y <= 2030; y++) {
    for (let m = 0; m < 12; m++) {
      if (new Date(y, m, 15).getDay() === weekday) return { y, m };
    }
  }
  throw new Error('not found');
}

try {
  // [1] Normal month: 15 is a weekday → payday is the 15th
  console.log('\n[1] Энгийн сар (15 нь ажлын өдөр) → 15');
  // find a month where 15 is a weekday (not Sat/Sun)
  let norm;
  for (let m = 0; m < 12 && !norm; m++) { const g = new Date(2026, m, 15).getDay(); if (g !== 0 && g !== 6) norm = { y: 2026, m }; }
  const pn = paydayFor(norm.y, norm.m);
  assert.strictEqual(pn.getDate(), 15);
  ok(`2026-${norm.m + 1}/15 нь ${DOW[pn.getDay()]} → payday = 15`);

  // [2] Saturday-15 → shifts to Friday 14
  console.log('\n[2] 15 нь Бямба → Баасан 14 рүү ухрана');
  const sat = findMonthWhere15Is(6);
  const ps = paydayFor(sat.y, sat.m);
  assert.strictEqual(new Date(sat.y, sat.m, 15).getDay(), 6, '15 нь Бямба байх ёстой');
  assert.strictEqual(ps.getDate(), 14, '14 рүү ухрах ёстой');
  assert.strictEqual(ps.getDay(), 5, '14 нь Баасан байх ёстой');
  ok(`${sat.y}-${sat.m + 1}/15 = Бямба → payday = ${sat.y}-${sat.m + 1}/14 (Баасан) ✓ (shift тест)`);

  // [3] Sunday-15 → shifts to Friday 13
  console.log('\n[3] 15 нь Ням → Баасан 13 рүү ухрана');
  const sun = findMonthWhere15Is(0);
  const psu = paydayFor(sun.y, sun.m);
  assert.strictEqual(psu.getDate(), 13);
  assert.strictEqual(psu.getDay(), 5, '13 нь Баасан байх ёстой');
  ok(`${sun.y}-${sun.m + 1}/15 = Ням → payday = 13 (Баасан)`);

  // [4] Cycle = payday → next payday
  console.log('\n[4] Цикл = payday → дараа payday');
  const cyc = getCycle(2026, 5); // June 2026
  assert.ok(cyc.end.getTime() > cyc.start.getTime());
  assert.strictEqual(cyc.start.getTime(), paydayFor(2026, 5).getTime());
  assert.strictEqual(cyc.end.getTime(), paydayFor(2026, 6).getTime());
  ok(`Цикл: ${ymd(cyc.start)} → ${ymd(cyc.end)} (payday→payday)`);

  // [5] Subscriptions inside the cycle window (each once)
  console.log('\n[5] Циклийн захиалга (Netflix 7, Claude 25)');
  const subs = cycleSubscriptions(cyc);
  const titles = subs.map((s) => s.title).sort();
  assert.deepStrictEqual([...new Set(titles)].sort(), ['Claude', 'Netflix']);
  for (const s of subs) assert.ok(isWithinCycle(s.date, cyc.start, cyc.end), `${s.title} цонхонд`);
  const netflix = subs.find((s) => s.title === 'Netflix');
  assert.strictEqual(netflix.amountMnt, Math.round(3.99 * USD_MNT));
  ok(`Цонхонд: ${subs.map((s) => `${s.title}@${s.date}`).join(', ')}; Netflix=${netflix.amountMnt}₮`);

  // [6] Window boundaries: start inclusive, end exclusive
  console.log('\n[6] Цонхны хил (start inclusive, end exclusive)');
  assert.strictEqual(isWithinCycle(cyc.start, cyc.start, cyc.end), true, 'start орох ёстой');
  assert.strictEqual(isWithinCycle(cyc.end, cyc.start, cyc.end), false, 'end орохгүй (дараа цикл)');
  ok('start ∈ цикл, end ∉ цикл (давхар тооцохгүй)');

  console.log(`\n🎉 Бүх шалгалт PASS (${pass} баталгаа)\n`);
} catch (e) {
  console.error('\n❌ ШАЛГАЛТ УНАЛАА:', e.stack || e.message, '\n');
  process.exitCode = 1;
}
