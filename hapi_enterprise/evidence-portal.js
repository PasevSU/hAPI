'use strict';
// Публикуване на Evidence View портала в папката, която Home Assistant сервира статично.
//
// Пакетът (`evidence-portal/`) е самостоятелен HTML/ES-module фронтенд. За да се отвори
// от телефон по QR, файловете трябва да стоят в <HA config>/www, защото HA сервира точно
// тази папка на `/local/...`. Затова add-on-ът ги копира в `<config>/www/hapi/data/`.
//
// Правила:
//   • никакви пътища от заявка — целта се смята само от познати корени или от изрична
//     настройка `EVIDENCE_PORTAL_DIR`;
//   • копира се само когато съдържанието е различно (идемпотентно, без излишни записи);
//   • симлинк на целта се отказва — иначе „публукуването“ може да пише извън www;
//   • без HA config директория не се гадае: връща се ясна причина.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Файловете на пакета. Демо-данните са `sample-evidence.json` (не в `data/`): папка
// `data/` се пропуска от експорта на хранилището, а този файл трябва да е част от изданието.
const FILES = ['portal.html', 'README.md', 'assets/app.js', 'assets/consent.js', 'assets/style.css', 'sample-evidence.json'];
const SUBPATH = path.join('www', 'hapi', 'data');
// За съобщения: винаги с прави наклонени черти, за да е еднакво на Windows и в контейнера.
const SUBPATH_TEXT = 'www/hapi/data';

const sourceDir = () => path.join(__dirname, 'evidence-portal');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Корените, в които може да живее HA конфигурацията (в контейнера). */
function candidateRoots(env = process.env) {
  const roots = [];
  if (env.EVIDENCE_PORTAL_ROOT) roots.push(env.EVIDENCE_PORTAL_ROOT);
  roots.push('/homeassistant', '/config');
  return [...new Set(roots)];
}

/** Корен, който наистина изглежда като HA конфигурация (има configuration.yaml или www/). */
function detectRoot(roots = candidateRoots()) {
  for (const root of roots) {
    try {
      if (!fs.statSync(root).isDirectory()) continue;
      const hasConfig = fs.existsSync(path.join(root, 'configuration.yaml'));
      const hasWww = fs.existsSync(path.join(root, 'www'));
      if (hasConfig || hasWww) return root;
    } catch {
      /* коренът липсва — продължаваме */
    }
  }
  return null;
}

/**
 * Целева директория. Изричната настройка печели; иначе <root>/www/hapi/data.
 * Връща { dir } или { error } — без гадаене и без мълчаливо писане на случайно място.
 */
function targetDir({ env = process.env, roots } = {}) {
  if (env.EVIDENCE_PORTAL_DIR) {
    const dir = path.resolve(env.EVIDENCE_PORTAL_DIR);
    if (!dir.endsWith(path.join('www', 'hapi', 'data')) && !env.EVIDENCE_PORTAL_ALLOW_ANY_DIR) {
      return { error: `EVIDENCE_PORTAL_DIR трябва да завършва на ${SUBPATH_TEXT} (получено: ${dir})` };
    }
    return { dir };
  }
  const root = detectRoot(roots || candidateRoots(env));
  if (!root) return { error: 'няма достъп до конфигурацията на Home Assistant (очаквам /homeassistant или /config с www/)' };
  return { dir: path.join(root, SUBPATH) };
}

/** Списък на файловете, които пакетът трябва да има — за проверка на цялостта. */
function missingSourceFiles() {
  const base = sourceDir();
  return FILES.filter((rel) => !fs.existsSync(path.join(base, rel)));
}

/**
 * Копира пакета в целевата папка. Идемпотентно: записва само различните файлове.
 * @returns {{ok:true, dir:string, copied:string[], unchanged:string[], total:number}|{ok:false, error:string}}
 */
function deploy({ env = process.env, roots } = {}) {
  const missing = missingSourceFiles();
  if (missing.length) return { ok: false, error: `липсват файлове в пакета: ${missing.join(', ')}` };
  const target = targetDir({ env, roots });
  if (target.error) return { ok: false, error: target.error };

  const base = sourceDir();
  const dir = target.dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.lstatSync(dir).isSymbolicLink()) return { ok: false, error: `целта е симлинк: ${dir}` };
  } catch (e) {
    return { ok: false, error: `${dir}: ${e.message}` };
  }

  const copied = [];
  const unchanged = [];
  for (const rel of FILES) {
    const from = path.join(base, rel);
    const to = path.join(dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.existsSync(to) && !fs.lstatSync(to).isSymbolicLink() && hash(from) === hash(to)) {
      unchanged.push(rel);
      continue;
    }
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o644);
    copied.push(rel);
  }
  return { ok: true, dir, copied, unchanged, total: FILES.length };
}

/** Състояние без писане: има ли пакетът, къде е целта и изостава ли нещо. */
function status({ env = process.env, roots } = {}) {
  const target = targetDir({ env, roots });
  if (target.error) return { ok: false, error: target.error, files: FILES.length };
  const base = sourceDir();
  const dir = target.dir;
  const files = FILES.map((rel) => {
    const from = path.join(base, rel);
    const to = path.join(dir, rel);
    const present = fs.existsSync(to);
    const current = present && fs.existsSync(from) && hash(from) === hash(to);
    return { rel, present, current };
  });
  return {
    ok: true,
    dir,
    files: files.length,
    present: files.filter((f) => f.present).length,
    outdated: files.filter((f) => f.present && !f.current).map((f) => f.rel),
    missing: files.filter((f) => !f.present).map((f) => f.rel),
  };
}

module.exports = { FILES, SUBPATH, sourceDir, candidateRoots, detectRoot, targetDir, missingSourceFiles, deploy, status };
