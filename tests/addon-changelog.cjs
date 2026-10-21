'use strict';
// Home Assistant показва changelog на add-on-а само ако до `config.yaml` има `CHANGELOG.md`.
// Без него табът пише „No changelog found“ — точно каквото видяхме в Supervisor.
//
// Тестът пази две неща: файлът съществува и е актуален спрямо кореновия CHANGELOG
// (`scripts/sync-addon-changelog.cjs --check`), и първата му секция е за текущата версия.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const addonChangelog = path.join(root, 'hapi_enterprise', 'CHANGELOG.md');
const configPath = path.join(root, 'hapi_enterprise', 'config.yaml');

assert.ok(fs.existsSync(addonChangelog), 'липсва hapi_enterprise/CHANGELOG.md — Supervisor няма да покаже промени');

const version = fs.readFileSync(configPath, 'utf8').match(/^version:\s*["']?([^"'\s]+)["']?/m);
assert.ok(version, 'липсва version в hapi_enterprise/config.yaml');

const text = fs.readFileSync(addonChangelog, 'utf8');
const sections = text.split(/\r?\n/).filter((line) => /^##\s/.test(line));
assert.ok(sections.length >= 1, 'changelog-ът трябва да има поне една секция');
assert.ok(sections[0].includes(version[1]), `първата секция трябва да е за ${version[1]}, а е "${sections[0]}"`);
assert.ok(text.length > 200, 'changelog-ът е подозрително кратък');

// Актуалност спрямо кореновия CHANGELOG.
const check = spawnSync(process.execPath, [path.join(root, 'scripts', 'sync-addon-changelog.cjs'), '--check'], { encoding: 'utf8' });
assert.equal(check.status, 0, (check.stderr || check.stdout || '').trim() || 'sync-addon-changelog --check се провали');

console.log(`addon-changelog OK: ${version[1]}, ${sections.length} секция, ${text.length} знака`);
