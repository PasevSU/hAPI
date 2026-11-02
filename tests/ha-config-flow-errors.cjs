'use strict';
// 0.69.97 — Config flow-ът трябва да казва КОЯ е причината, а не „не се свързва“.
//
// Реалният случай: човек въвежда `http://hapi_enterprise:8099` и получава „Add-on API-то не
// отговаря. Провери адреса и дали add-on-ът работи.“ Три различни неща изглеждат еднакво:
//   • 404 — адресът отговаря, но не на този път (add-on по-стар от 0.69.96, където публичният
//     порт отказва /admin/api/* дори с токен);
//   • 403 — въведен е ingress портът 8098, който приема само Supervisor;
//   • таймаут/DNS — наистина транспорт.
// Затова тук се проверяват ТОЧНИТЕ ключове, които flow-ът връща, и че всеки от тях съществува в
// преводите (иначе Home Assistant показва празно съобщение).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { STUBS } = require('./lib/ha-stubs.cjs');

const root = path.join(__dirname, '..');
const INTEGRATION = path.join(root, 'custom_components', 'hapi_enterprise');

const findPython = () => {
  for (const cmd of ['python', 'py', 'python3']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return cmd;
  }
  return '';
};

// Минимална сесия: връща зададения статус, без мрежа.
const SCRIPT = [
  'import asyncio',
  'import json',
  'import sys',
  'import aiohttp.web as web',
  'from custom_components.hapi_enterprise import config_flow as cf',
  '',
  'class Resp:',
  '    def __init__(self, status):',
  '        self.status = status',
  '',
  '    async def __aenter__(self):',
  '        return self',
  '',
  '    async def __aexit__(self, *exc):',
  '        return False',
  '',
  'class Session:',
  '    def __init__(self, status):',
  '        self.status = status',
  '',
  '    def get(self, url, headers=None):',
  '        return Resp(self.status)',
  '',
  'class Hass:',
  '    def __init__(self, status):',
  '        self.session = Session(status)',
  '',
  'async def probe(status):',
  '    return await cf._async_test_connection(Hass(status), "http://hapi_enterprise:8099", "x" * 40)',
  '',
  'out = {}',
  'for status in (401, 403, 404, 500, 200):',
  '    out[str(status)] = asyncio.run(probe(status))',
  'print(json.dumps(out))',
].join('\n');

(async () => {
  const python = findPython();
  if (!python) {
    console.log('ha-config-flow-errors: няма python — flow-ът не се проверява');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-flow-'));
  try {
    for (const [name, body] of Object.entries(STUBS)) {
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    const script = path.join(dir, 'flow_once.py');
    fs.writeFileSync(script, SCRIPT);
    const run = spawnSync(python, [script], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: [dir, root].join(path.delimiter), PYTHONDONTWRITEBYTECODE: '1' },
    });
    assert.equal(run.status, 0, 'flow-ът се изпълнява:\n' + (run.stderr || run.stdout || ''));
    const keys = JSON.parse(String(run.stdout).trim().split(/\r?\n/).pop());

    // 1. Всеки статус дава СВОЯ ключ — иначе човекът търси грешната причина.
    assert.equal(keys['401'], 'invalid_auth', '401 = грешен токен');
    assert.equal(keys['403'], 'wrong_port', '403 = ingress портът, не мрежова грешка');
    assert.equal(keys['404'], 'addon_too_old', '404 = адресът отговаря, но не на админ API-то');
    assert.equal(keys['500'], 'cannot_connect', '5xx = сървърът отговори с грешка');
    assert.equal(keys['200'], null, '200 = всичко е наред');

    // 2. Всеки ключ съществува в преводите, иначе HA показва празен ред.
    for (const file of ['strings.json', 'translations/en.json', 'translations/bg.json']) {
      const data = JSON.parse(fs.readFileSync(path.join(INTEGRATION, file), 'utf8'));
      for (const scope of ['config', 'options']) {
        for (const key of ['invalid_auth', 'wrong_port', 'addon_too_old', 'cannot_connect']) {
          assert.ok(data[scope].error[key], file + ': липсва ' + scope + '.error.' + key);
        }
      }
    }
    // 3. Съобщенията за 403 и 404 казват какво да се направи, а не само „не работи“.
    const en = JSON.parse(fs.readFileSync(path.join(INTEGRATION, 'translations/en.json'), 'utf8'));
    assert.match(en.config.error.wrong_port, /8099/, 'съобщението за 403 дава верния порт');
    assert.match(en.config.error.addon_too_old, /0\.69\.96/, 'съобщението за 404 назовава версията');

    console.log('PASS ha-config-flow-errors: 401→invalid_auth · 403→wrong_port (сочи 8099) · 404→addon_too_old (назовава 0.69.96) · 5xx→cannot_connect · 200→без грешка · всички ключове са в преводите');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
