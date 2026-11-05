'use strict';
// 0.69.96 — Диагностика за Home Assistant, която НЕ изтича токена.
//
// Home Assistant дава на потребителя „Download diagnostics“ и човек го слага в публичен issue.
// Затова отчетът трябва да е полезен (URL, интервал, състояние на координатора, телеметрия) и
// да не съдържа нито една тайна. Тестът вика ИСТИНСКИЯ Python модул `diagnostics.py` върху
// entry, в което има токен, и проверява, че стойността му не се среща никъде в отчета — вкл.
// когато е вложена по-дълбоко в данните от координатора.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { STUBS } = require('./lib/ha-stubs.cjs');

const root = path.join(__dirname, '..');
const SECRET = 'super-secret-admin-token-0123456789abcdef';

const findPython = () => {
  for (const cmd of ['python', 'py', 'python3']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return cmd;
  }
  return '';
};

const SCRIPT = [
  'import asyncio',
  'import json',
  'from custom_components.hapi_enterprise import diagnostics as diag',
  '',
  'SECRET = sys_secret',
  '',
  'class Entry:',
  '    def __init__(self):',
  '        self.title = "hAPI Enterprise"',
  '        self.domain = "hapi_enterprise"',
  '        self.entry_id = "entry-1"',
  '        self.data = {"backend_url": "http://hapi_enterprise:8099", "token": SECRET, "scan_interval": 60}',
  '        self.options = {"token": SECRET}',
  '',
  'class Coordinator:',
  '    last_update_success = True',
  '    update_interval = type("I", (), {"total_seconds": staticmethod(lambda: 60.0)})()',
  '    data = {',
  '        "version": "0.69.96",',
  '        "visits": 3,',
  '        "nested": {"deeper": [{"api_key": SECRET, "ok": 1}]},',
  '    }',
  '',
  'class Hass:',
  '    def __init__(self):',
  '        # От 0.69.153 координаторът живее във вписването (`entry.runtime_data`), не в hass.data.',
  '        self.data = {}',
  '',
  'entry = Entry()',
  'entry.runtime_data = Coordinator()',
  'report = asyncio.run(diag.async_get_config_entry_diagnostics(Hass(), entry))',
  'text = json.dumps(report)',
  'print(json.dumps({',
  '    "report": report,',
  '    "text": text,',
  '    "leaks": SECRET in text,',
  '    "direct": diag.redact({"token": SECRET}),',
  '    "nested": diag.redact([{"deeper": {"authorization": SECRET}}]),',
  '    "keeps": diag.redact({"visits": 7, "backend_url": "http://x:8099"}),',
  '}))',
].join('\n').replace('SECRET = sys_secret', 'SECRET = ' + JSON.stringify(SECRET));

(async () => {
  const python = findPython();
  if (!python) {
    console.log('ha-diag-redaction: няма python — диагностиката не се проверява');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-diag-'));
  try {
    for (const [name, body] of Object.entries(STUBS)) {
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    const script = path.join(dir, 'diag_once.py');
    fs.writeFileSync(script, SCRIPT);
    const run = spawnSync(python, [script], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: [dir, root].join(path.delimiter), PYTHONDONTWRITEBYTECODE: '1' },
    });
    assert.equal(run.status, 0, 'диагностиката се изпълнява:\n' + (run.stderr || run.stdout || ''));
    const out = JSON.parse(String(run.stdout).trim().split(/\r?\n/).pop());

    // 1. Токенът не се среща никъде в отчета.
    assert.equal(out.leaks, false, 'токенът НЕ бива да излиза в диагностиката');
    // 2. Но отчетът е полезен: URL, интервал, състояние, телеметрия.
    assert.equal(out.report.entry.backend_url, 'http://hapi_enterprise:8099', 'URL-ът се вижда');
    assert.equal(out.report.entry.token_configured, true, 'казва САМО че токен има');
    assert.equal(out.report.entry.token, undefined, 'не връща полето token');
    assert.equal(out.report.coordinator.last_update_success, true, 'състоянието на координатора');
    assert.equal(out.report.data.visits, 3, 'телеметрията остава');
    assert.equal(out.report.data.nested.deeper[0].ok, 1, 'безопасните полета остават');
    // 3. Червеното е видимо като факт, не като празно поле.
    assert.equal(out.report.data.nested.deeper[0].api_key, '**REDACTED**', 'вложеният ключ е замазан');
    // 4. Помощните функции правят същото и на най-горно ниво.
    assert.equal(out.direct.token, '**REDACTED**', 'redact() замазва token');
    assert.equal(out.nested[0].deeper.authorization, '**REDACTED**', 'redact() замазва и authorization');
    assert.equal(out.keeps.visits, 7, 'redact() не пипа безопасните полета');

    console.log('PASS ha-diag-redaction: отчетът носи URL/интервал/състояние/телеметрия · токен не се среща никъде · вложените ключове са **REDACTED**');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
