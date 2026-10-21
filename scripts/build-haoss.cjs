'use strict';
// Builds a standalone, HACS-compatible integration repository in release/haoss.
//
//   node scripts/build-haoss.cjs                       # → release/haoss
//   node scripts/build-haoss.cjs --out <dir>           # друга папка (ползва се от теста)
//   node scripts/build-haoss.cjs --repo-url <url>      # адрес на публикуваното репо
//
// The output is the standard HACS layout (hacs.xyz/docs/publish/integration):
//
//   hacs.json
//   README.md
//   LICENSE
//   custom_components/<domain>/...   ← exactly one integration per repository
//     manifest.json                  ← domain, documentation, issue_tracker,
//                                      codeowners, name, version (HACS requirement)
//     brand/icon.png                 ← HACS "brand assets" requirement
//
// Single source of truth stays in this monorepo: the builder copies
// custom_components/hapi_enterprise and refuses to emit an artifact that violates
// the HACS/Home Assistant contract (it verifies before it returns).
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./release-lib.cjs');

const root = path.join(__dirname, '..');
const SRC = path.join(root, 'custom_components', 'hapi_enterprise');
const DOMAIN = 'hapi_enterprise';
const DEFAULT_REPO_URL = 'https://github.com/PasevSU/hAPI';

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf('--' + name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const OUT = path.resolve(option('out') || path.join(root, 'release', 'haoss'));
const REPO_URL = (option('repo-url') || DEFAULT_REPO_URL).replace(/\/+$/, '');

// Никога не влизат в изданието: кешове, локално състояние, логове, OS файлове.
const SKIP_DIRS = new Set(['__pycache__', '.pytest_cache', '.mypy_cache', '.git']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', 'Desktop.ini']);
const SKIP_EXT = new Set(['.pyc', '.pyo', '.log', '.swp', '.bak', '.tmp']);

const problems = [];
const fail = (message) => problems.push(message);

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
    if (SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}
const rel = (abs) => path.relative(OUT, abs).split(path.sep).join('/');

// ── 1. Източник ─────────────────────────────────────────────────────────────
if (!fs.existsSync(SRC)) {
  console.error(`✗ липсва източник: ${SRC}`);
  process.exit(1);
}
const addonVersion = lib.readAddonVersion(root);
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const minHa = JSON.parse(fs.readFileSync(path.join(root, 'hacs.json'), 'utf8')).homeassistant || '2024.6.0';

// ── 2. Изходна папка ──────────────────────────────────────────────────────────
// Изтриваме само предишно издание: празна папка или такава с hacs.json /
// custom_components. Никога не трием чуждо дърво (--out сочи нанякъде другаде)
// и НЕ пипаме `.git` — иначе всяко пресъздаване би изтрило историята на
// самостоятелното хранилище и публикуването щеше да започва от нула.
function cleanOutput(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir).filter((name) => name !== '.git');
  if (entries.length && !entries.includes('hacs.json') && !entries.includes('custom_components')) {
    console.error(`✗ отказвам да изтрия ${dir}: не изглежда като предишно HACS издание (липсва hacs.json)`);
    process.exit(1);
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry);
    try {
      fs.rmSync(abs, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows понякога държи файл (антивирусна, индексиране) — втори опит.
      fs.rmSync(abs, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    }
  }
}
cleanOutput(OUT);
fs.mkdirSync(OUT, { recursive: true });

copyTree(SRC, path.join(OUT, 'custom_components', DOMAIN));

for (const file of ['LICENSE', 'SECURITY.md', 'CHANGELOG.md']) {
  const source = path.join(root, file);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(OUT, file));
  else fail(`липсва ${file} в монорепото`);
}

// ── 3. hacs.json (само документираните ключове) ─────────────────────────────
const hacs = {
  name: manifest.name,
  homeassistant: minHa,
  render_readme: true,
  content_in_root: false,
};
fs.writeFileSync(path.join(OUT, 'hacs.json'), JSON.stringify(hacs, null, 2) + '\n');

// ── 4. manifest.json: адреси към публикуваното репо ─────────────────────────
manifest.documentation = REPO_URL + '#readme';
manifest.issue_tracker = REPO_URL + '/issues';
fs.writeFileSync(
  path.join(OUT, 'custom_components', DOMAIN, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

// ── 5. README (HACS рендира точно него) ────────────────────────────────────
const README = `# hAPI Enterprise — Home Assistant integration

[![Version](https://img.shields.io/badge/version-${addonVersion}-ff00d8.svg)](${REPO_URL})
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-%3E%3D${minHa}-41BDF5?logo=homeassistant)](${REPO_URL})
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

Home Assistant integration for **hAPI Enterprise** — the document vault add-on with verifiable
integrity (SHA-256, audit hash chain, RFC 3161 timestamps, PGP-signed export packages).

The integration is the Home-Assistant side of the add-on:

- **Telemetry sensors** — visits, downloads, files, portals, file storage, database and telemetry size.
- **Portal bridge (fail-closed)** — read and download of token-protected portal APIs on Home
  Assistant's own address; administrative APIs are **never** proxied.
- **Public gateway** — the read-only public portal surface on Home Assistant's port, so external
  visitors never need a second port or a second login.

> **Това е хранилище за HACS интеграция — не е app (add-on) хранилище.**
> Ако го добавиш в **Settings → Add-ons → Repositories**, Home Assistant отговаря
> *"is not a valid app repository"*. Тук му е мястото само в
> **HACS → Integrations → Custom repositories**.
>
> | Какво инсталираш | Кое хранилище | Къде се добавя |
> | --- | --- | --- |
> | Add-on (сървъра) | ${REPO_URL} | Settings → Add-ons → Repositories |
> | Тази интеграция | това хранилище | HACS → Integrations → Custom repositories |

Release notes: [CHANGELOG.md](CHANGELOG.md).

## Requirements

| Component | Requirement |
| --------- | ----------- |
| Home Assistant | ${minHa} or newer |
| hAPI Enterprise add-on | installed and running (the integration talks to its admin listener) |
| Admin token | at least 24 characters — generated by the add-on on first start |

## Installation

### HACS (recommended)

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=PasevSU&repository=hAPI&category=integration)

1. HACS → **Integrations** → ⋮ → **Custom repositories**.
2. Add \`${REPO_URL}\` with category **Integration**.
3. Install **hAPI Enterprise** and restart Home Assistant.
4. **Settings → Devices & services → Add integration → hAPI Enterprise**.

### Manual

Copy \`custom_components/hapi_enterprise\` into \`/config/custom_components/\` and restart.
The folder name matters: Home Assistant loads an integration only from the folder that equals
\`domain\` in \`manifest.json\`.

## Configuration

The setup form asks for three values:

| Field | Description |
| ----- | ----------- |
| **Admin API URL** | The add-on's **admin listener**, \`http://<add-on-hostname>:8098\` — the internal hostname is the add-on slug shown on the add-on page (usually \`hapi_enterprise\`). Port \`8099\` is the public read API and does **not** serve \`/admin\`; port \`8098\` stays inside the Home Assistant network. |
| **Admin token** | A token of at least 24 characters. The add-on generates one on first start and stores it in \`/data/admin-token\`; the same value is available under **Configuration → token** in the add-on. |
| **Update interval** | 10–86400 seconds (default 60). |

Options can be changed later from the integration's **Configure** button. Leaving the token
empty while reconfiguring keeps the stored value.

## Entities

| Entity | Meaning |
| ------ | ------- |
| \`sensor.hapi_enterprise_visits\` | Portal visits |
| \`sensor.hapi_enterprise_downloads\` | File downloads |
| \`sensor.hapi_enterprise_files\` | Registered files |
| \`sensor.hapi_enterprise_portals\` | Portals |
| \`sensor.hapi_enterprise_file_storage\` | File storage (bytes) |
| \`sensor.hapi_enterprise_database_size\` | Metadata database size (bytes) |
| \`sensor.hapi_enterprise_telemetry_size\` | Telemetry log size (bytes) |

Entity ids depend on the name you give the integration; the list above is what a default
install produces.

## What the bridge exposes

| Route | Purpose |
| ----- | ------- |
| \`/api/hapi_enterprise/v1/p/<portal-id>\` | Portal API through Home Assistant (bearer token or portal key) |
| \`/api/hapi_enterprise/public/v1/...\` | Read-only public gateway (portals, files, download) |
| \`/api/hapi_enterprise/portal/<slug>\` | Portal landing page and its assets |
| \`/api/public/v1/...\` | Legacy alias, answers with \`Deprecation\` + \`Link: rel="successor-version"\` |

Every forwarded path is matched against an allowlist (\`p/<slug>\`, \`files/<id>/download\`,
\`manifest\`, \`openapi.json\`, \`qr.svg\`, \`storage\`). Admin endpoints such as \`/admin/api/*\`
are not reachable through the bridge.

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| \`invalid_auth\` during setup | wrong or too short token | copy the token from the add-on Configuration tab, or read \`/data/admin-token\` |
| \`cannot_connect\` | wrong URL/port, add-on stopped | use \`http://<add-on-hostname>:8098\` (admin listener), start the add-on |
| Sensors show \`unavailable\` | add-on restarted or token rotated | reload the integration (⋮ → Reload) or re-enter options |
| Bridge returns \`404\` | portal is private or the path is not on the allowlist | make the portal public or use a supported path |
| \`502\` on the public gateway | add-on unreachable | check the add-on log and that port 8099 is running |

Enable debug logging when reporting a problem:

\`\`\`yaml
logger:
  logs:
    custom_components.hapi_enterprise: debug
\`\`\`

## Removal

HACS → **Integrations** → hAPI Enterprise → **Remove**, then restart. The add-on and its data
(\`/config/hapi_enterprise\` on the host, plus \`/data\`) are not touched by removing the integration.

## Security

- The bridge is fail-closed: only read/download paths are forwarded, never \`/admin\`.
- The integration never opens a port of its own; everything runs on Home Assistant's port.
- Credentials live in the config entry, not in YAML; see [SECURITY.md](SECURITY.md) for the
  reporting process.

## License

Apache-2.0 — see [LICENSE](LICENSE).
`;
fs.writeFileSync(path.join(OUT, 'README.md'), README);

// ── 6. CI: hassfest + HACS action (изискват се за включване в HACS) ─────────
fs.mkdirSync(path.join(OUT, '.github', 'workflows'), { recursive: true });
fs.writeFileSync(
  path.join(OUT, '.github', 'workflows', 'validate.yml'),
  `name: Validate

on:
  push:
  pull_request:
  schedule:
    - cron: "0 0 * * *"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  hassfest:
    name: hassfest
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: home-assistant/actions/hassfest@master

  hacs:
    name: HACS action
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Topics (home-assistant, hacs, integration), описание и Issues са зададени в
      # GitHub, затова HACS action минава без изключение — изискване за списъка по подразбиране.
      - uses: hacs/action@main
        with:
          category: integration
`,
);

// Таг → GitHub Release: HACS показва изданията и предпочита пълно release пред гол таг.
// Версията в тага трябва да съвпада с manifest.json, иначе workflow-ът спира.
fs.writeFileSync(
  path.join(OUT, '.github', 'workflows', 'release.yml'),
  `name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  release:
    name: GitHub release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Tag matches manifest version
        run: |
          manifest=$(node -p "require('./custom_components/${DOMAIN}/manifest.json').version")
          if [ "v$manifest" != "$GITHUB_REF_NAME" ]; then
            echo "::error::тагът $GITHUB_REF_NAME не съвпада с manifest.json ($manifest)"
            exit 1
          fi
      - name: Create GitHub release
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gh release create "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --generate-notes
`,
);

fs.writeFileSync(
  path.join(OUT, '.gitignore'),
  ['__pycache__/', '*.py[cod]', '*.egg-info/', '.venv/', '.DS_Store', '*.log', ''].join('\n'),
);

// ── 7. Проверки на HACS договора ────────────────────────────────────────────
const outFiles = walk(OUT);
const integrationRoot = path.join(OUT, 'custom_components');
const integrations = fs.readdirSync(integrationRoot).filter((name) => fs.statSync(path.join(integrationRoot, name)).isDirectory());

if (integrations.length !== 1) fail(`custom_components/ трябва да съдържа точно една интеграция, намерени: ${integrations.join(', ') || '0'}`);
if (integrations[0] !== manifest.domain) fail(`папката „${integrations[0]}“ ≠ domain „${manifest.domain}“`);

for (const key of ['domain', 'name', 'version', 'documentation', 'issue_tracker', 'codeowners']) {
  if (!manifest[key] || (Array.isArray(manifest[key]) && !manifest[key].length)) fail(`manifest.json липсва „${key}“`);
}
if (manifest.version !== addonVersion) fail(`manifest.json ${manifest.version} ≠ add-on ${addonVersion}`);
if (!Array.isArray(manifest.requirements) || manifest.requirements.length) fail('manifest.json: requirements трябва да е празен (stdlib + HA)');
if (manifest.ports) fail('manifest.json не бива да обявява ports — интеграцията не отваря порт');

const buildDir = path.join(OUT, 'custom_components', DOMAIN);
const icon = path.join(buildDir, 'brand', 'icon.png');
if (!fs.existsSync(icon)) fail('липсва brand/icon.png (HACS изисква brand assets)');
else if (fs.statSync(icon).size < 513) fail('brand/icon.png е подозрително малък');

for (const file of ['translations/en.json', 'strings.json', 'portal.html', 'portal.css', 'portal.js']) {
  if (!fs.existsSync(path.join(buildDir, file))) fail(`липсва ${file}`);
}

const portalHtml = fs.readFileSync(path.join(buildDir, 'portal.html'), 'utf8');
for (const asset of [...portalHtml.matchAll(/\/api\/hapi_enterprise\/assets\/([A-Za-z0-9._-]+)/g)].map((m) => m[1])) {
  if (!fs.existsSync(path.join(buildDir, asset))) fail(`portal.html сочи липсващ asset: ${asset}`);
}

const initSource = fs.readFileSync(path.join(buildDir, '__init__.py'), 'utf8');
if (/web\.TCPSite|asyncio\.start_server\(/.test(initSource)) fail('__init__.py отваря собствен порт — забранено за интеграция');

const hacsParsed = JSON.parse(fs.readFileSync(path.join(OUT, 'hacs.json'), 'utf8'));
const HACS_KEYS = new Set(['name', 'content_in_root', 'zip_release', 'filename', 'render_readme', 'homeassistant', 'country', 'hide_default_branch', 'persistent_directory']);
for (const key of Object.keys(hacsParsed)) if (!HACS_KEYS.has(key)) fail(`hacs.json: недокументиран ключ „${key}“`);
if (!hacsParsed.name) fail('hacs.json липсва name');

for (const file of ['README.md', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'hacs.json', '.github/workflows/validate.yml', '.github/workflows/release.yml']) {
  if (!fs.existsSync(path.join(OUT, file))) fail(`липсва ${file}`);
}
const readme = fs.readFileSync(path.join(OUT, 'README.md'), 'utf8');
for (const needle of ['HACS', '8098', 'custom_components', 'Troubleshooting']) {
  if (!readme.includes(needle)) fail(`README.md не споменава „${needle}“`);
}

const SECRETS = [/gh[pousr]_[A-Za-z0-9]{20,}/, /\bsk-[A-Za-z0-9]{20,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
for (const file of outFiles) {
  if (!/\.(js|cjs|json|md|ya?ml|html|css|py|txt)$/i.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of SECRETS) if (pattern.test(text)) fail(`възможен тайна в ${rel(file)}`);
  if (file.endsWith('.pyc')) fail(`бинарни кешове в изданието: ${rel(file)}`);
}

// ── 8. Отчет ────────────────────────────────────────────────────────────────
const py = outFiles.filter((f) => f.endsWith('.py')).length;
const assets = outFiles.length - py;
console.log(`HACS repository → ${OUT}`);
console.log(`  ${manifest.name} ${manifest.version} · domain ${manifest.domain} · HA ≥ ${hacsParsed.homeassistant}`);
console.log(`  ${outFiles.length} файла (${py} Python, ${assets} assets) · интерфейс: ${integrations.join(', ')}`);
console.log(`  репо адрес в manifest: ${manifest.documentation}`);

if (problems.length) {
  console.error('\n✗ изданието не отговаря на HACS договора:');
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}
console.log('\n✓ HACS структура: hacs.json + README + LICENSE + custom_components/<domain> + brand/icon.png, без тайни и без собствени портове');
