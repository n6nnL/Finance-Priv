// ============================================================
//  manager.test.js — reconcile логик: асаах/зогсоох/restart + fault isolation
//  Mock listener factory — бодит IMAP шаардахгүй.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createManager } from './manager.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function mockListenerFactory(log) {
  return (acc) => {
    const l = {
      userId: acc.userId,
      stopped: false,
      run: () => new Promise(() => {}), // stop болтол дуусдаггүй (бодит run загвар)
      stop: async () => { l.stopped = true; log.push(`stop:${acc.userId}`); },
      msSinceLastMessage: () => 0,
    };
    log.push(`start:${acc.userId}`);
    return l;
  };
}

test('reconcile: шинэ данс асаана, хасагдсан данс зогсооно', async () => {
  const log = [];
  let accounts = [
    { userId: 1, email: 'a@g.com', refreshToken: 'ra' },
    { userId: 2, email: 'b@g.com', refreshToken: 'rb' },
  ];
  const mgr = createManager({
    listAccounts: () => accounts,
    createListener: mockListenerFactory(log),
    logger: silentLogger,
  });

  await mgr.reconcile();
  assert.deepEqual(log, ['start:1', 'start:2']);
  assert.equal(mgr.running.size, 2);

  // Данс 1 салгагдлаа (disconnect/reauth) — зөвхөн 1 зогсоно, 2 ХЭВЭЭР
  accounts = [{ userId: 2, email: 'b@g.com', refreshToken: 'rb' }];
  await mgr.reconcile();
  assert.ok(log.includes('stop:1'));
  assert.ok(!log.includes('stop:2'), 'данс 2 буруугаар зогссон — fault isolation зөрчигдөв');
  assert.equal(mgr.running.size, 1);
  assert.ok(mgr.running.has(2));
});

test('reconcile: token өөрчлөгдвөл (дахин холболт) restart хийнэ', async () => {
  const log = [];
  let accounts = [{ userId: 1, email: 'a@g.com', refreshToken: 'old' }];
  const mgr = createManager({
    listAccounts: () => accounts,
    createListener: mockListenerFactory(log),
    logger: silentLogger,
  });

  await mgr.reconcile();
  await mgr.reconcile(); // өөрчлөлтгүй — restart хийхгүй
  assert.deepEqual(log, ['start:1']);

  accounts = [{ userId: 1, email: 'a@g.com', refreshToken: 'new' }];
  await mgr.reconcile();
  assert.deepEqual(log, ['start:1', 'stop:1', 'start:1']);
});

test('reconcile: listAccounts throw → running listener-үүд ХӨНДӨГДӨХГҮЙ', async () => {
  const log = [];
  let fail = false;
  const mgr = createManager({
    listAccounts: () => {
      if (fail) throw new Error('db locked');
      return [{ userId: 1, email: 'a@g.com', refreshToken: 'ra' }];
    },
    createListener: mockListenerFactory(log),
    logger: silentLogger,
  });
  await mgr.reconcile();
  fail = true;
  await mgr.reconcile(); // throw хийхгүй, зогсоохгүй
  assert.equal(mgr.running.size, 1);
  assert.ok(!log.includes('stop:1'));
});

test('stopAll: бүх listener зогсоно', async () => {
  const log = [];
  const mgr = createManager({
    listAccounts: () => [
      { userId: 1, email: 'a@g.com', refreshToken: 'ra' },
      { userId: 2, email: 'b@g.com', refreshToken: 'rb' },
    ],
    createListener: mockListenerFactory(log),
    logger: silentLogger,
  });
  await mgr.reconcile();
  await mgr.stopAll();
  assert.ok(log.includes('stop:1') && log.includes('stop:2'));
  assert.equal(mgr.running.size, 0);
});
