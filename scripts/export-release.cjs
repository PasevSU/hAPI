'use strict';
// Изнася готовото издание в папка за качване (по подразбиране Downloads).
//
//   node scripts/export-release.cjs                 # ~/Downloads/hapi-enterprise-<версия>/
//   node scripts/export-release.cjs --out D:\качване
//
// Съдържание:
//   hapi_enterprise-<v>.tar.gz             add-on архив
//   hapi_enterprise-integration-<v>.zip    интеграция за HACS
//   RELEASE.json, repository.yaml, SHA256SUMS.txt
//   hapi-enterprise-<v>-source.zip         целият изходен код (без .git/dist/node_modules)
//   КАЧВАНЕ.md                             стъпките за GitHub

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('./release-lib.cjs');

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
};

const root = lib.ROOT;
const version = lib.readAddonVersion(root);
const dist = path.join(root, lib.DIST_DIR);
const outDir = path.resolve(option('out') || path.join(os.homedir(), 'Downloads', `hapi-enterprise-${version}`));

const addonArchive = `hapi_enterprise-${version}.tar.gz`;
const integrationArchive = `hapi_enterprise-integration-${version}.zip`;
const assets = [addonArchive, integrationArchive, 'RELEASE.json', 'repository.yaml', 'SHA256SUMS.txt'];

for (const asset of assets) {
  const file = path.join(dist, asset);
  if (!fs.existsSync(file)) {
    console.error(`✗ липсва dist/${asset} — пусни първо: node scripts/build-release.cjs`);
    process.exit(1);
  }
}

fs.mkdirSync(outDir, { recursive: true });
const copied = [];
for (const asset of assets) {
  fs.copyFileSync(path.join(dist, asset), path.join(outDir, asset));
  copied.push([asset, fs.statSync(path.join(outDir, asset)).size, lib.sha256File(path.join(outDir, asset))]);
}

// Пълен изходен код — едно ZIP за качване/архив (без .git, dist, node_modules, кешове).
const SKIP = new Set(['.git', 'dist', 'node_modules', '__pycache__', '.pytest_cache', '.vscode', '.idea']);
const entries = [];
const walk = (dir, prefix) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(entry.name)) continue;
    if (/\.(pyc|pyo|tmp)$/i.test(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(abs, rel);
    else if (entry.isFile()) {
      const st = fs.statSync(abs);
      entries.push({ path: rel, abs, mode: entry.name.endsWith('.sh') ? 0o755 : 0o644, mtime: Math.floor(st.mtimeMs / 1000) });
    }
  }
};
walk(root, '');
const sourceName = `hapi-enterprise-${version}-source.zip`;
const sourceBuf = lib.buildZip(entries);
fs.writeFileSync(path.join(outDir, sourceName), sourceBuf);
copied.push([sourceName, sourceBuf.length, lib.sha256(sourceBuf)]);

// Инструкции за качване.
const instructions = `# Качване на hAPI Enterprise ${version} в GitHub

Всички файлове в тази папка са готови за качване. Нищо не се трие от
https://github.com/PasevSU/hAPI — обновяването става с нов клон + таг.

## А. Публикуване като Release (най-бързо, 5 файла)

1. Отвори https://github.com/PasevSU/hAPI/releases/new
2. Tag: \`v${version}\` → **Create new tag on publish**
3. Title: \`hAPI Enterprise ${version}\`
4. Description: копирай секцията за ${version} от \`CHANGELOG.md\`
5. Прикачи файловете от тази папка:
   - \`${addonArchive}\`
   - \`${integrationArchive}\`
   - \`RELEASE.json\`
   - \`repository.yaml\`
   - \`SHA256SUMS.txt\`
6. **Publish release**

## Б. Обновяване на кода (локален клонинг)

В локално копие на хранилището (не по SMB):

\`\`\`
# разархивирай source.zip върху работно копие или го ползвай като ново дърво
git checkout -b hapi-enterprise-${version}
# копирай файловете от разархивирания source.zip в клонинга
git add -A
git commit -m "feat: hAPI Enterprise ${version} (HA add-on + HACS integration)"
git tag v${version}
git push origin hapi-enterprise-${version} --tags
\`\`\`

След push тагът \`v${version}\` стартира workflow-а \`Release\`: тестове → build →
21 проверки → качване на артефактите към release-а.

## В. Настройки в GitHub за HACS

- **Settings → Topics**: \`home-assistant\`, \`hacs\`, \`integration\`
- **Description**: hAPI Enterprise — Home Assistant add-on и интеграция за портали с документи
- **Issues**: включени (manifest.json сочи към тях)

## Проверка след качване

\`\`\`
node scripts/verify-release.cjs --with-tests
\`\`\`

Очакван резултат: 21/21 сценария, 103/103 теста.
`;
fs.writeFileSync(path.join(outDir, 'КАЧВАНЕ.md'), instructions);

// Готов текст за GitHub Release — секцията за тази версия от CHANGELOG.md.
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const section = (changelog.split(/^## /m).find((part) => part.startsWith(version + ' ')) || '').trim();
const notes = section
  ? `## hAPI Enterprise ${version}\n\n${section.replace(/^[^\n]*\n/, '').trim()}\n\n` +
    `### Артефакти\n\n` +
    `- \`${addonArchive}\` — Home Assistant add-on (разархивира се като add-on repository)\n` +
    `- \`${integrationArchive}\` — HACS интеграция (\`custom_components/hapi_enterprise\`)\n` +
    `- \`RELEASE.json\` + \`SHA256SUMS.txt\` — хешове на всеки файл\n\n` +
    `### Инсталиране\n\n` +
    `HACS → Custom repositories → \`https://github.com/PasevSU/hAPI\` (Integration) → hAPI Enterprise.\n` +
    `Add-on: Supervisor → Add-on Store → ⋮ → Repositories → същият URL.\n`
  : '';
if (notes) fs.writeFileSync(path.join(outDir, 'RELEASE_NOTES.md'), notes);

console.log(`\nГотово: ${outDir}\n`);
for (const [name, size, hash] of copied) {
  console.log(`  ${name.padEnd(46)} ${lib.fmtBytes(size).padStart(9)}  ${hash.slice(0, 16)}…`);
}
if (notes) console.log(`  ${'RELEASE_NOTES.md'.padEnd(46)} ${lib.fmtBytes(fs.statSync(path.join(outDir, 'RELEASE_NOTES.md')).size).padStart(9)}`);
console.log(`\n  КАЧВАНЕ.md — стъпките за GitHub`);
console.log(`  общо ${lib.fmtBytes(copied.reduce((n, [, size]) => n + size, 0))}`);
