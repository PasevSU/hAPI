'use strict';
// Проверка на САМОТО ИЗДАНИЕ, не на работното дърво: разопакова `dist/hapi_enterprise-<в>.tar.gz`
// и пуска сървъра оттам. Защо е нужно: `verify-release` проверява архива (списък, hashes) и
// `audit-gui-compat` S19 гледа само `/health`; никой не проверява, че НОВИТЕ функции работят
// в това, което ще се публикува. Точно този клас грешка (модул забравен в COPY) минава
// всички тестове в репото и гърми при потребителя.
//
// Употреба:
//   node scripts/artifact-smoke.cjs               # последното издание от dist/
//   node scripts/artifact-smoke.cjs --version=0.69.87
//   node scripts/artifact-smoke.cjs --archive=path.tar.gz
//
// Проверява: старт от архива, договор `file` (200 + точен SHA-256), `qr` в списъка на
// порталите, `mirror/verify` без огледало → 409, `site-csp` е пясъчник, `mirror-target`
// разчита s3 адрес, `transfer` копира със сверен SHA-256 и нов `content_id`, а изтриването
// на доказателство се отказва с 409. Изходен код 1 при провал.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const opt = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(hit.indexOf('=') + 1) : '';
};
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const configYaml = fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8');
const versionFromConfig = (configYaml.match(/^version: "([^"]+)"/m) || [])[1] || '';
const version = opt('version') || versionFromConfig;
const archive = opt('archive') || path.join(dist, `hapi_enterprise-${version}.tar.gz`);
if (!fs.existsSync(archive)) {
  console.error(`artifact-smoke: няма архив ${archive} — пусни първо node scripts/build-release.cjs`);
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-smoke-'));
execFileSync('tar', ['-xzf', archive, '-C', work], { stdio: 'inherit' });
const appDir = path.join(work, 'hapi_enterprise');
if (!fs.existsSync(path.join(appDir, 'server.js'))) {
  console.error('artifact-smoke: архивът не съдържа hapi_enterprise/server.js');
  process.exit(1);
}

const port = 19700 + (process.pid % 200);
const token = 'artifact-smoke-token-0123456789abcdef';
const dataDir = path.join(work, 'data');
const slug = 'artifact-' + Date.now().toString(36);
const shareRoot = path.resolve('/share');
const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
const checks = [];

(async () => {
  const child = spawn(process.execPath, [path.join(appDir, 'server.js')], {
    env: { ...process.env, DATA_DIR: dataDir, ADMIN_TOKEN: token, PORT: String(port), PUBLIC_GATEWAY_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString() });
  child.stderr.on('data', (d) => { log += d.toString() });
  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (let i = 0; i < 150 && !up; i++) {
      try { up = (await fetch(base + '/health')).ok } catch { /* още не слуша */ }
      if (!up) await new Promise((r) => setTimeout(r, 60));
    }
    if (!up) throw new Error('сървърът от изданието не вдигна /health:\n' + log.slice(-600));
    checks.push('сървърът стартира от архива');

    const created = await fetch(base + '/admin/api/portals', { method: 'POST', headers: H, body: JSON.stringify({ slug, title: 'Издание', visibility: 'public' }) });
    const portal = await created.json();
    if (created.status !== 201) throw new Error('порталът не се създава: ' + created.status + ' ' + JSON.stringify(portal));

    const folder = path.join(shareRoot, slug);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'договор.txt'), 'съдържание от изданието');
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, 'договор.txt'))).digest('hex');

    const page = await fetch(base + '/file.html?file=' + encodeURIComponent(slug + '/договор.txt'));
    const html = await page.text();
    if (page.status !== 200) throw new Error('/file.html → ' + page.status);
    if (!html.includes(sha)) throw new Error('/file.html не показва точния SHA-256');
    checks.push('договор `file` → 200 с точен SHA-256');

    const list = await (await fetch(base + '/admin/api/portals', { headers: H })).json();
    const hit = (list.portals || []).find((p) => p.slug === slug);
    if (!hit || !hit.qr || hit.qr.active !== 'QR-001') throw new Error('списъкът не носи qr: ' + JSON.stringify(hit && hit.qr));
    checks.push('списъкът на порталите носи qr (QR-001)');

    const mv = await fetch(base + '/admin/api/storage/mirror/verify', { method: 'POST', headers: H, body: '{}' });
    if (mv.status !== 409) throw new Error('mirror/verify без огледало → ' + mv.status);
    checks.push('огледало без настройка → 409');

    const csp = require(path.join(appDir, 'site-csp.js')).forFile('.html', base);
    if (!/^sandbox /.test(csp) || /allow-same-origin/.test(csp)) throw new Error('site-csp в изданието не е пясъчник');
    checks.push('site-csp → sandbox без allow-same-origin');

    const spec = require(path.join(appDir, 'mirror-target.js')).parseSpec('s3://hapi-evidence/backup?lock=30&region=eu-central-1');
    if (spec.kind !== 's3' || spec.lockDays !== 30 || spec.bucket !== 'hapi-evidence') throw new Error('mirror-target в изданието е счупен');
    checks.push('mirror-target → s3 адрес с lock=30');

    // `!secret` с ДВЕ разстояния: точно това кара Home Assistant да откаже запис с
    // `Unknown secret ' hapi_pgp_path_pass'`. В изданието причината трябва да е ИМЕНУВАНА,
    // а не `SECRET_UNREADABLE` — иначе човек търси файл, който никога не е бил път.
    const keyring = require(path.join(appDir, 'path-crypto.js'));
    const spaced = keyring
      .create({ env: { PGP_PATH_PASS: '!secret  hapi_pgp_path_pass', PGP_PATH_PUBLIC: 'x.asc' } })
      .status();
    if (spaced.reason !== 'SECRET_NAME_HAS_SPACE' || spaced.secretOption !== 'pgp_path_pass') {
      throw new Error('незаместен !secret в изданието → ' + spaced.reason + ' / ' + spaced.secretOption);
    }
    // Втората половина на същата конфигурация: относителен път (`config/…`) в контейнера
    // се чете като `/app/config/…` и без тази причина изглежда като „файлът не се чете“.
    const relative = keyring.create({ env: { PGP_PATH_PUBLIC: 'config/_openpgpV6/public.asc' } }).status();
    if (relative.reason !== 'SECRET_PATH_RELATIVE') throw new Error('относителен път в изданието → ' + relative.reason);
    checks.push('незаместен !secret → SECRET_NAME_HAS_SPACE · относителен път → SECRET_PATH_RELATIVE');

    // ── Новото в 0.69.87 трябва да работи ИМЕННО в публикувания архив ──────────────
    // `routes/file-transfer.js` е нов файл: ако не влезе в архива, тестовете в репото
    // минават, а при потребителя маршрутът липсва. Точно този клас грешка проверяваме.
    const dstRes = await fetch(base + '/admin/api/portals', { method: 'POST', headers: H, body: JSON.stringify({ slug: slug + '-dst', title: 'Цел', visibility: 'public' }) });
    const dst = await dstRes.json();
    if (dstRes.status !== 201) throw new Error('вторият портал не се създава: ' + dstRes.status);
    // Същите байтове като файла в папката на портала — така записът влиза в манифеста
    // по съдържание и отказът при изтриване е проверим, не случаен.
    const bytes = fs.readFileSync(path.join(folder, 'договор.txt'));
    const upload = await fetch(base + `/admin/api/portals/${portal.id}/files`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'x-file-name': encodeURIComponent('договор.txt'), 'content-type': 'application/octet-stream' },
      body: bytes,
    });
    const regFile = await upload.json();
    if (upload.status !== 201) throw new Error('качване в изданието → ' + upload.status + ' ' + JSON.stringify(regFile));

    const transferred = await fetch(base + `/admin/api/portals/${portal.id}/files/${regFile.id}/transfer`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ mode: 'copy', targetPortalId: dst.id }),
    });
    const copy = await transferred.json();
    if (transferred.status !== 201) throw new Error('transfer в изданието → ' + transferred.status + ' ' + JSON.stringify(copy));
    if (copy.verified !== true || copy.sha256 !== regFile.sha256 || copy.contentId === regFile.contentId) {
      throw new Error('transfer в изданието не е сверен или преизползва content_id: ' + JSON.stringify(copy));
    }
    checks.push('transfer copy → 201 · сверен SHA-256 · нов content_id');

    // Повторената заявка НЕ бива да създава второ копие (`idempotency.js` в изданието).
    // Проверява се на две стъпки: първата ключова заявка добавя едно копие, втората със
    // СЪЩИЯ ключ и СЪЩОТО тяло трябва да върне първия отговор и да не добави нищо.
    const dstFiles = async () => ((await (await fetch(base + `/admin/api/portals/${dst.id}`, { headers: H })).json()).files || []).length;
    const idemBody = JSON.stringify({ mode: 'copy', targetPortalId: dst.id });
    const idemHeaders = { ...H, 'idempotency-key': 'artifact-smoke-transfer-1' };
    const beforeKeyed = await dstFiles();
    const keyed = await fetch(base + `/admin/api/portals/${portal.id}/files/${regFile.id}/transfer`, { method: 'POST', headers: idemHeaders, body: idemBody });
    const keyedBody = await keyed.json();
    if (keyed.status !== 201) throw new Error('Idempotency-Key в изданието → ' + keyed.status + ' ' + JSON.stringify(keyedBody));
    const repeated = await fetch(base + `/admin/api/portals/${portal.id}/files/${regFile.id}/transfer`, { method: 'POST', headers: idemHeaders, body: idemBody });
    const repeatedBody = await repeated.json();
    if (repeated.status !== 201 || repeatedBody.target?.fileId !== keyedBody.target?.fileId) {
      throw new Error('повторената заявка не върна първия отговор: ' + repeated.status + ' ' + JSON.stringify(repeatedBody));
    }
    if (repeated.headers.get('idempotency-replayed') !== 'true') throw new Error('липсва Idempotency-Replayed при повторение');
    const afterKeyed = await dstFiles();
    if (afterKeyed !== beforeKeyed + 1) throw new Error('повторената заявка е създала второ копие: ' + beforeKeyed + ' → ' + afterKeyed);
    checks.push('Idempotency-Key → повтореното копиране връща същия файл, копието остава едно');

    const archived = await fetch(base + `/admin/api/portals/${portal.id}/qr/archive`, { method: 'POST', headers: H, body: JSON.stringify({ note: 'artifact-smoke' }) });
    if (archived.status !== 201) throw new Error('QR архивът в изданието → ' + archived.status);
    const refusedDelete = await fetch(base + `/admin/api/portals/${portal.id}/files/${regFile.id}`, { method: 'DELETE', headers: H });
    const refusedBody = await refusedDelete.json();
    if (refusedDelete.status !== 409 || !/qr-manifest/.test(String(refusedBody.error))) {
      throw new Error('изтриване на доказателство в изданието → ' + refusedDelete.status + ' ' + JSON.stringify(refusedBody));
    }
    checks.push('доказателство → DELETE 409 (qr-manifest)');

    // Отговорът се пише точно веднъж (`SINGLE_RESPONSE`). Точно този клас грешка се виждаше
    // в error-log-а на жива инсталация като двойки `ERR_HTTP_HEADERS_SENT`, при които втората
    // грешка замазва първата. Проверява се ИЗДАНИЕТО, а не работното дърво.
    if (/ERR_HTTP_HEADERS_SENT|Cannot write headers after they are sent/i.test(log)) {
      throw new Error('изданието отговори два пъти на една заявка:\n' + log.slice(-500));
    }
    checks.push('нито един двоен отговор (няма ERR_HTTP_HEADERS_SENT)');

    console.log('artifact-smoke OK: ' + path.basename(archive) + ' · ' + checks.join(' · '));
  } finally {
    try { child.kill() } catch { /* вече е спрян */ }
    // Windows държи файловете на убития процес още миг — изчакваме изхода му.
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      setTimeout(resolve, 3000);
    });
    fs.rmSync(path.join(shareRoot, slug), { recursive: true, force: true });
    fs.rmSync(path.join(shareRoot, slug + '-dst'), { recursive: true, force: true });
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(work, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 300)) }
    }
  }
})().catch((e) => { console.error('artifact-smoke FAILED: ' + e.message); process.exit(1) });
