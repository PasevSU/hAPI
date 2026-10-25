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
// разчита s3 адрес. Изходен код 1 при провал.
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
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(work, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 300)) }
    }
  }
})().catch((e) => { console.error('artifact-smoke FAILED: ' + e.message); process.exit(1) });
