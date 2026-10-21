'use strict';
// HACS издание: `scripts/build-haoss.cjs` построява самостоятелно хранилище
// (release/haoss) с точно една интеграция — така, както HACS го изисква.
//
// Тестът го построява в временна папка и валидира готовия артефакт, а не източника:
// структура, hacs.json, manifest, brand/icon.png, README, CI workflow, липса на
// кешове и на тайни. Така изданието не може да се размине с договора на HACS.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lib = require('../scripts/release-lib.cjs');

const root = path.join(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'haoss-'));

const read = (rel) => fs.readFileSync(path.join(out, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(out, rel));

try {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-haoss.cjs'), '--out', out], {
    cwd: root,
    stdio: 'pipe',
  });

  // 1. Коренът: точно това, което HACS чете.
  for (const rel of ['hacs.json', 'README.md', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'custom_components']) {
    assert.ok(exists(rel), 'липсва ' + rel);
  }
  assert.ok(fs.existsSync(path.join(out, '.github', 'workflows', 'validate.yml')), 'липсва CI workflow (hassfest + HACS action)');
  assert.ok(fs.existsSync(path.join(out, '.github', 'workflows', 'release.yml')), 'липсва release workflow (таг → GitHub release)');
  assert.ok(fs.existsSync(path.join(out, '.gitignore')), 'липсва .gitignore');

  const release = read('.github/workflows/release.yml');
  assert.match(release, /tags:/, 'release workflow: трябва да се задейства от таг');
  assert.match(release, /gh release create/, 'release workflow: трябва да създава пълно GitHub release');
  assert.match(release, /manifest\.json/, 'release workflow: трябва да сверява тага с manifest.json');

  const workflow = read('.github/workflows/validate.yml');
  assert.match(workflow, /home-assistant\/actions\/hassfest@/, 'workflow: липсва hassfest');
  assert.match(workflow, /hacs\/action@/, 'workflow: липсва HACS action');
  assert.match(workflow, /category:\s*integration/, 'workflow: HACS action трябва да е с category: integration');

  // 2. Ровно една интеграция, в папка, равна на domain.
  const components = path.join(out, 'custom_components');
  const folders = fs.readdirSync(components, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  assert.deepEqual(folders, ['hapi_enterprise'], 'HACS приема точно една интеграция на хранилище');
  const manifest = JSON.parse(read('custom_components/hapi_enterprise/manifest.json'));
  assert.equal(manifest.domain, folders[0], 'domain трябва да съвпада с името на папката');

  // 3. Задължителните ключове на manifest.json и версия, равна на add-on-а.
  for (const key of ['domain', 'name', 'version', 'documentation', 'issue_tracker', 'codeowners']) {
    assert.ok(manifest[key], 'manifest.json: липсва ' + key);
  }
  assert.equal(manifest.integration_type, 'hub', 'manifest.json: integration_type трябва да е hub');
  assert.match(manifest.documentation, /^https:\/\//, 'documentation трябва да е https');
  assert.match(manifest.issue_tracker, /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues$/, 'issue_tracker трябва да сочи GitHub Issues');
  assert.equal(manifest.version, lib.readAddonVersion(root), 'manifest.json и config.yaml трябва да са с една версия');
  assert.deepEqual(manifest.requirements, [], 'интеграцията не тегли Python пакети');
  assert.equal(manifest.ports, undefined, 'интеграцията не обявява портове');

  // 4. hacs.json — само документираните ключове.
  const hacs = JSON.parse(read('hacs.json'));
  const allowed = new Set(['name', 'content_in_root', 'zip_release', 'filename', 'render_readme', 'homeassistant', 'country', 'hide_default_branch', 'persistent_directory']);
  for (const key of Object.keys(hacs)) assert.ok(allowed.has(key), 'hacs.json: недокументиран ключ ' + key);
  assert.equal(typeof hacs.name, 'string', 'hacs.json: name е задължително');
  assert.equal(hacs.content_in_root, false, 'content_in_root трябва да е false (интеграцията е в custom_components/)');
  assert.match(String(hacs.homeassistant), /^\d{4}\.\d{1,2}(\.\d+)?$/, 'hacs.json: homeassistant трябва да е версия');

  // 5. Brand assets — HACS ги изисква, за да покаже икона.
  const icon = path.join(out, 'custom_components/hapi_enterprise/brand/icon.png');
  assert.ok(fs.existsSync(icon), 'липсва brand/icon.png');
  const head = fs.readFileSync(icon).subarray(0, 8);
  assert.ok(head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'brand/icon.png не е PNG');
  assert.ok(fs.statSync(icon).size > 512, 'brand/icon.png е подозрително малък');

  // 6. README описва инсталацията и админ порта (не публичния 8099).
  const readme = read('README.md');
  for (const needle of ['HACS', 'Custom repositories', '8098', 'custom_components', 'Troubleshooting', 'License']) {
    assert.ok(readme.includes(needle), 'README.md не споменава „' + needle + '“');
  }

  // 7. Никакви кешове и никакви тайни в артефакта.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__pycache__' || entry.name === '.git') offenders.push(abs);
        else walk(abs);
      } else if (entry.name.endsWith('.pyc') || entry.name.endsWith('.log')) offenders.push(abs);
    }
  };
  walk(out);
  assert.deepEqual(offenders, [], 'артефактът съдържа кешове/логове: ' + offenders.join(', '));

  const secrets = [/gh[pousr]_[A-Za-z0-9]{20,}/, /\bsk-[A-Za-z0-9]{20,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
  const texts = [];
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(abs);
      else if (/\.(js|cjs|json|md|ya?ml|html|css|py|txt)$/i.test(entry.name)) texts.push(abs);
    }
  };
  collect(out);
  for (const file of texts) {
    const body = fs.readFileSync(file, 'utf8');
    for (const pattern of secrets) assert.doesNotMatch(body, pattern, 'възможна тайна в ' + path.relative(out, file));
  }

  console.log(`haoss-release OK: ${manifest.name} ${manifest.version} · HACS структура (${folders[0]}) · ${texts.length} текстови файла без тайни`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
