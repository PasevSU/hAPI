'use strict';
// Supervisor показва changelog само ако до `config.yaml` на add-on-а има `CHANGELOG.md`.
// Затова тук се взима секцията за текущата версия от кореновия CHANGELOG и се записва в
// `hapi_enterprise/CHANGELOG.md` — така табът „Changelog“ в Home Assistant не пише
// „No changelog found“, а показва какво реално има в изданието.
//
//   node scripts/sync-addon-changelog.cjs [--check]
//
// `--check` не пише нищо: връща код 1, ако файлът липсва или е изостанал (ползва се в тест).
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const configPath = path.join(root, 'hapi_enterprise', 'config.yaml');
const sourcePath = path.join(root, 'CHANGELOG.md');
const targetPath = path.join(root, 'hapi_enterprise', 'CHANGELOG.md');

function readAddonVersion() {
  const text = fs.readFileSync(configPath, 'utf8');
  const match = text.match(/^version:\s*["']?([^"'\s]+)["']?/m);
  if (!match) throw new Error('липсва version в hapi_enterprise/config.yaml');
  return match[1];
}

function extractSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(`^##\\s*\\[?${escaped}\\]?(\\s|$|—|-)`);
  const start = lines.findIndex((line) => startPattern.test(line));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}

function render(changelog, version) {
  const section = extractSection(changelog, version);
  const header = [
    '# Промени в hAPI Enterprise',
    '',
    `Тази версия: **${version}**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).`,
    '',
  ].join('\n');
  if (!section) {
    return header + `\n_Няма запис за ${version} в кореновия CHANGELOG._\n`;
  }
  return header + '\n' + section + '\n';
}

const version = readAddonVersion();
const changelog = fs.readFileSync(sourcePath, 'utf8');
const expected = render(changelog, version);
const check = process.argv.includes('--check');

if (check) {
  if (!fs.existsSync(targetPath)) {
    console.error(`sync-addon-changelog: липсва ${path.relative(root, targetPath)}`);
    process.exit(1);
  }
  const actual = fs.readFileSync(targetPath, 'utf8');
  if (actual.replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) {
    console.error(`sync-addon-changelog: ${path.relative(root, targetPath)} е изостанал от CHANGELOG.md`);
    console.error('  поправи с: node scripts/sync-addon-changelog.cjs');
    process.exit(1);
  }
  console.log(`sync-addon-changelog: наличен и актуален (${version})`);
  process.exit(0);
}

fs.writeFileSync(targetPath, expected, 'utf8');
console.log(`sync-addon-changelog: записан hapi_enterprise/CHANGELOG.md за ${version} (${expected.length} знака)`);
