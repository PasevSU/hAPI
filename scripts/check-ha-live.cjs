'use strict';
// Жива проверка на Home Assistant след поправка на токен/връзка.
//
// Защо съществува: инцидентът от 0.69.165 показа, че „изглежда добре“ не е проверка. Токенът
// беше сменен наполовина (secrets.yaml без options) и интеграцията щеше да спре да работи,
// без нито един тест да го хване — защото никой тест не гледа живата инсталация.
//
// Какво проверява (само четене, никакви промени):
//   1. Добавката е `started` и версията съвпада с package.json на репото.
//   2. `/health` отговаря `ok` отвътре в контейнера.
//   3. Публикуваният порт пуска с валиден токен (200) и отказва с грешен (401) — това е
//      точният път, по който интеграцията чете сензорите си.
//   4. Няма разминаване между опциите на Supervisor-а и `secrets.yaml` (двата трябва да
//      сочат един и същ токен, иначе интеграцията работи „наполовина“).
//   5. Няма втори консуматор на токена, който да остане със стара стойност.
//
// Тайни НЕ се отпечатват и НЕ се предават през командния ред: сравнението се прави на
// отдалечената машина и се връща само `true`/`false`.
//
// Употреба:
//   npm run audit:ha                        # 192.168.50.4 по подразбиране
//   HAPI_HA_HOST=root@10.0.0.5 npm run audit:ha
//   HAPI_HA_APP_SLUG=local_hapi npm run audit:ha
// Изход: 0 = всичко съвпада, 1 = има разминаване, 2 = няма връзка (не се брои за успех).
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const HOST = process.env.HAPI_HA_HOST || 'root@192.168.50.4';
const SLUG = process.env.HAPI_HA_APP_SLUG || '99438e72_hapi_enterprise';
const APP = 'app_' + SLUG;
const repoVersion = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

// Скриптът работи НА Home Assistant. Връща само факти без тайни.
const remote = `
set -u
SLUG="${SLUG}"
APP="${APP}"
out() { printf '%s\\n' "$1"; }

ver=$(ha apps info "$SLUG" 2>/dev/null | sed -n 's/^version: *//p' | head -1)
state=$(ha apps info "$SLUG" 2>/dev/null | sed -n 's/^state: *//p' | head -1)
out "state=$state"
out "version=$ver"

health=$(docker exec "$APP" sh -c 'wget -qO- http://127.0.0.1:8099/health' 2>/dev/null | head -c 200)
case "$health" in
  *'"status":"ok"'*) out "health=ok" ;;
  *) out "health=broken" ;;
esac

tok=$(grep -m1 '^hapi_token:' /config/secrets.yaml 2>/dev/null | sed 's/^hapi_token:[[:space:]]*//' | tr -d '"' | tr -d '\\r')
base=$(grep -m1 '^hapi_backend_url:' /config/secrets.yaml 2>/dev/null | sed 's/^hapi_backend_url:[[:space:]]*//' | tr -d '"' | tr -d '\\r')

if [ -z "$tok" ] || [ -z "$base" ]; then
  out "gate=missing-secret"
else
  good=$(curl -s -o /dev/null -m 8 -w '%{http_code}' -H "Authorization: Bearer $tok" "$base/admin/api/sensors" 2>/dev/null)
  bad=$(curl -s -o /dev/null -m 8 -w '%{http_code}' -H "Authorization: Bearer wrong-$(date +%s%N)" "$base/admin/api/sensors" 2>/dev/null)
  out "gate=good:$good bad:$bad"
fi

# Съвпадение между опциите на Supervisor-а и secrets.yaml — само булево.
if [ -n "\${SUPERVISOR_TOKEN:-}" ]; then
  same=$(curl -s -H "Authorization: Bearer $SUPERVISOR_TOKEN" "http://supervisor/addons/$SLUG/info" 2>/dev/null \\
    | jq -r --arg t "$tok" '(.data.options.token == $t)' 2>/dev/null)
  out "options_match_secrets=\${same:-unknown}"
else
  out "options_match_secrets=unknown"
fi

# Втори консуматор: config entry за hapi пази свой токен и той не бива да е стар.
if command -v jq >/dev/null 2>&1; then
  entries=$(jq -r '[.data.entries[] | select(.domain|test("hapi"))] | length' /config/.storage/core.config_entries 2>/dev/null)
  out "config_entries=\${entries:-unknown}"
fi
`;

function run() {
  const res = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, 'bash -lc "bash -s"'], {
    input: remote,
    encoding: 'utf8',
    timeout: 120000,
  });
  if (res.error) return { error: res.error.message };
  if (res.status !== 0 && !/^\w+=/m.test(res.stdout || '')) {
    return { error: (res.stderr || '').trim().slice(0, 400) || 'ssh exit ' + res.status };
  }
  const facts = {};
  for (const line of String(res.stdout || '').split(/\r?\n/)) {
    const m = /^([a-z_]+)=(.*)$/.exec(line.trim());
    if (m) facts[m[1]] = m[2];
  }
  return { facts };
}

const { facts, error } = run();
if (error) {
  console.error(`audit:ha — no connection to ${HOST}: ${error}`);
  console.error('audit:ha — това не е успех: проверете SSH достъпа или задайте HAPI_HA_HOST');
  process.exit(2);
}

const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
};

check(facts.state === 'started', `добавката не е started (state=${facts.state || '?'})`);
check(facts.version === repoVersion, `версия на добавката ${facts.version || '?'} ≠ ${repoVersion} в репото`);
check(facts.health === 'ok', `health не е ok (${facts.health || '?'})`);
check(facts.gate === 'good:200 bad:401', `токен gate е ${facts.gate || '?'} вместо good:200 bad:401`);
check(
  facts.options_match_secrets === 'true',
  `опциите на Supervisor-а и secrets.yaml не сочат един токен (${facts.options_match_secrets || '?'})`
);
check(
  !facts.config_entries || facts.config_entries === '0',
  `има ${facts.config_entries} config entry-та за hapi — проверете дали пазят стар токен`
);

if (problems.length > 0) {
  console.error('audit:ha FAIL');
  for (const problem of problems) console.error('  ✗ ' + problem);
  process.exit(1);
}

console.log(`audit:ha PASS — ${facts.version} started, health ok, gate 200/401, token на едно място`);
