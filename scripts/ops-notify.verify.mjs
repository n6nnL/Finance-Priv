// Standalone verification for ops-notify (no network, no Discord).
// Захиалга: global fetch-ийг override хийж payload-уудыг барьж шалгана.
import assert from 'node:assert';

process.env.OPS_WEBHOOK_URL = 'https://discord.test/webhook/FAKE';
process.env.OPS_PROCESS_NAME = 'bank-listener';

const sent = [];
let failNextFetch = false;
globalThis.fetch = async (url, opts) => {
  if (failNextFetch) throw new Error('getaddrinfo ENOTFOUND discord.test');
  sent.push({ url, body: JSON.parse(opts.body) });
  return { ok: true, status: 204 };
};

const { notifyOps, notifyOpsRecovered, scrub, _resetOpsState } = await import(
  '../src/ops-notify.js'
);

let pass = 0;
const ok = (label) => { console.log('  ✅', label); pass++; };

// ---------- Scenario 1: invalid_grant → 1 alert, repeats suppressed, 1 recovery ----------
console.log('\n[1] invalid_grant: 1 alert, suppress repeats, 1 recovery');
_resetOpsState();
sent.length = 0;
const grantErr = new Error('invalid_grant');
for (let i = 0; i < 88; i++) await notifyOps('oauth-invalid-grant', grantErr); // 88 цикл дуурайлга
assert.strictEqual(sent.length, 1, `1 alert хүлээсэн, ${sent.length} ирлээ`);
ok('88 давталтаас ЯГ 1 сэрэмжлүүлэг илгээгдсэн (debounce)');
assert.match(sent[0].body.embeds[0].title, /🚨.*oauth-invalid-grant/);
ok('Сэрэмжлүүлгийн title зөв');

// recovery — нэг л удаа
await notifyOpsRecovered('oauth-invalid-grant', 'reconnected');
await notifyOpsRecovered('oauth-invalid-grant', 'reconnected'); // 2 дахь нь no-op
assert.strictEqual(sent.length, 2, `recovery дараа нийт 2 хүлээсэн, ${sent.length}`);
assert.match(sent[1].body.embeds[0].title, /✅.*сэргэлээ/);
ok('Сэргэснийг ЯГ 1 удаа илгээсэн (давталт no-op)');

// асаагүй түлхүүрт recovery дуудвал юу ч илгээхгүй
await notifyOpsRecovered('never-fired', 'x');
assert.strictEqual(sent.length, 2);
ok('Асаагүй түлхүүрт recovery → юу ч илгээхгүй');

// ---------- Scenario 2: payload-д токен/PII байхгүй ----------
console.log('\n[2] Payload-д токен/PII байхгүй (scrub)');
_resetOpsState();
sent.length = 0;
const dirty =
  'refresh 1//01uBO3UyJrrKICgYIARAAGAESNwF-L9Ir87 for tuguldur.b307@gmail.com ' +
  'Bearer ya29.A0ARrdaM9xKVeryLongAccessTokenValue123456 secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';
await notifyOps('oauth-invalid-grant', new Error(dirty));
const bodyStr = JSON.stringify(sent[0].body);
assert.ok(!/1\/\/01uBO3/.test(bodyStr), 'refresh token задарсан!');
assert.ok(!/ya29\.A0ARrdaM9/.test(bodyStr), 'access token задарсан!');
assert.ok(!/tuguldur\.b307@gmail\.com/.test(bodyStr), 'имэйл задарсан!');
assert.ok(!/ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd/.test(bodyStr), 'secret задарсан!');
ok('refresh/access token, имэйл, secret бүгд redact хийгдсэн');
console.log('     scrub() гаралт:', JSON.stringify(scrub(dirty)));
// payload-д зөвхөн зөвшөөрөгдсөн талбарууд
const emb = sent[0].body.embeds[0];
assert.deepStrictEqual(Object.keys(emb).sort(), ['color','description','fields','timestamp','title']);
assert.ok(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(emb.timestamp), 'UTC timestamp ISO');
ok('Payload-д зөвхөн process/key/мессеж/timestamp(UTC) л байна');

// ---------- Scenario 3: webhook амжилтгүй → локал log, throw хийхгүй ----------
console.log('\n[3] Webhook алдаа → throw хийхгүй, процесс үргэлжилнэ');
_resetOpsState();
sent.length = 0;
failNextFetch = true;
let threw = false;
try {
  await notifyOps('oauth-invalid-grant', new Error('invalid_grant'));
} catch {
  threw = true;
}
failNextFetch = false;
assert.strictEqual(threw, false, 'notifyOps throw хийсэн!');
assert.strictEqual(sent.length, 0, 'fetch амжилтгүй атал payload бүртгэгдсэн');
ok('Webhook POST унасан ч throw гараагүй (локал log-д бичсэн, доор харагдана)');
// процесс үргэлжилж байгааг батлах — дараагийн дуудлага хэвийн ажиллана
failNextFetch = false;
await notifyOpsRecovered('oauth-invalid-grant', 'back'); // өмнө firing болсон
assert.strictEqual(sent.length, 1, 'алдааны дараа сэргэлт ажиллахгүй байна');
ok('Алдааны дараа процесс хэвийн үргэлжилж recovery илгээсэн');

console.log(`\n🎉 Бүх шалгалт PASS (${pass} баталгаа)\n`);
