'use strict';
// 0.69.95 — TSA адрес по ОТКРИТ канал (http) се вижда, а подразбиращото се е https.
//
// Защо: времевият печат (RFC 3161) доказва „това съдържание е съществувало в този момент“.
// Ако TSA адресът е `http://`, всеки по пътя може да върне ЧУЖД валиден отговор с друга
// дата — подписът остава верен, а твърдението за времето е лъжа. Дотук подразбиращата се
// стойност в add-on-а беше точно `http://timestamp.digicert.com`, тоест конфигурацията
// подканваше към това. Сега: https по подразбиране + предупреждение, когато някой остане
// на http (стара инсталация не бива да спира от ъпдейт).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const configPath = path.join(__dirname, '..', 'hapi_enterprise', 'config.yaml');

/** Чака даден текст да се появи в stderr (сървърът пише преди да е готов за заявки). */
async function waitForLog(server, needle, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (String(server.logs() || '').includes(needle)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return String(server.logs() || '').includes(needle);
}

(async () => {
  // 1. Подразбиращото се в add-on-а е https и за двата адреса.
  const cfg = fs.readFileSync(configPath, 'utf8');
  const start = /^\s{2}tsa_start_url:\s*"?'"?$/m.test(cfg) ? '' : (cfg.match(/^\s{2}tsa_start_url:\s*(.+)$/m) || [])[1];
  const stop = (cfg.match(/^\s{2}tsa_stop_url:\s*(.+)$/m) || [])[1];
  assert.ok(start !== undefined && stop, 'и двата TSA адреса са налични в config.yaml');
  assert.match(String(stop).trim(), /^"?https:\/\//, 'подразбиращият се tsa_stop_url е https: ' + String(stop).trim());
  assert.match(String(start).trim(), /^"?https:\/\//, 'подразбиращият се tsa_start_url е https: ' + String(start).trim());

  // 2. http адрес при включен TSA → предупреждение с името на опцията.
  const insecure = await startServer({ env: { TSA_ENABLED: 'true', TSA_STOP_URL: 'http://timestamp.example.test' } });
  try {
    assert.ok(
      await waitForLog(insecure, 'TSA_INSECURE_TRANSPORT'),
      'http TSA адресът се съобщава: ' + String(insecure.logs() || '').slice(-300),
    );
    assert.match(String(insecure.logs()), /tsa_stop_url/, 'предупреждението назовава опцията');
  } finally {
    await insecure.stop();
  }

  // 3. https адрес → НЯМА такова предупреждение (иначе шумът прави истинското невидимо).
  const secure = await startServer({ env: { TSA_ENABLED: 'true', TSA_STOP_URL: 'https://timestamp.example.test' } });
  try {
    assert.equal(
      String(secure.logs() || '').includes('TSA_INSECURE_TRANSPORT'),
      false,
      'https адресът не вдига предупреждение: ' + String(secure.logs() || '').slice(-200),
    );
  } finally {
    await secure.stop();
  }

  // 4. TSA е изключен → http адресът не струва нищо, значи и не се съобщава.
  const off = await startServer({ env: { TSA_ENABLED: 'false', TSA_STOP_URL: 'http://timestamp.example.test' } });
  try {
    assert.equal(
      String(off.logs() || '').includes('TSA_INSECURE_TRANSPORT'),
      false,
      'при изключен TSA няма предупреждение',
    );
  } finally {
    await off.stop();
  }

  console.log('PASS tsa-insecure-url: подразбиране https · http при включен TSA → TSA_INSECURE_TRANSPORT с името на опцията · https и изключен TSA → без шум');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
