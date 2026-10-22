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

/** Корените, в които може да живее HA конфигурацията, по ред на доверие. */
function candidateRoots(env = process.env) {
  const roots = [];
  if (env.EVIDENCE_PORTAL_ROOT) roots.push(env.EVIDENCE_PORTAL_ROOT);
  // `/config` е конфигурацията на HA при standalone/Docker употреба (там HA сервира `www/`
  // на `/local/`). В add-on обаче `/config` е СОБСТВЕНАТА папка на add-on-а (`app_config`),
  // а HA конфигурацията е монтирана на `/homeassistant`.
  roots.push('/config', '/homeassistant');
  return [...new Set(roots)];
}

/**
 * Корен, който наистина изглежда като HA конфигурация. Маркерът е `configuration.yaml`;
 * `www/` само подрежда кандидатите. Висящ симлинк не се брои за корен.
 */
function detectRoot(roots = candidateRoots()) {
  // Кой корен е HA конфигурация се решава САМО по `configuration.yaml`. Наличието на
  // `www/` НЕ е доказателство: add-on-ът има своя папка `/config` (app_config), а първото
  // погрешно публикуване създава точно `/config/www/hapi/data` — и ако `www/` се броеше
  // за маркер, тази папка щеше да печели вечно и порталът щеше да остава извън HA.
  const usable = (root) => {
    try {
      if (!fs.statSync(root).isDirectory()) return false; // stat следва симлинк: висящият гърми
      return true;
    } catch {
      return false; // липсващ или висящ симлинк — не е корен
    }
  };
  const has = (root, name) => {
    try {
      return fs.existsSync(path.join(root, name));
    } catch {
      return false;
    }
  };
  const passes = [
    (root) => has(root, 'configuration.yaml') && has(root, 'www'),
    (root) => has(root, 'configuration.yaml'),
  ];
  for (const pass of passes) {
    for (const root of roots) if (usable(root) && pass(root)) return root;
  }
  return null;
}

/** Защо даден корен не е приет — показва се в грешката, за да не се гадае. */
function whyNot(root) {
  const notes = [];
  let isDir = false;
  try {
    isDir = fs.statSync(root).isDirectory();
  } catch {
    return root + ' (липсва)';
  }
  if (!isDir) return root + ' (не е папка)';
  for (const name of ['configuration.yaml', 'www']) {
    try {
      if (fs.existsSync(path.join(root, name))) notes.push('има ' + name);
    } catch { /* нечетима папка — отчита се като липсващ маркер */ }
  }
  return root + (notes.length ? ' (' + notes.join(', ') + ')' : ' (без configuration.yaml)');
}

/**
 * Целева директория. Изричната настройка печели; иначе <root>/www/hapi/data.
 * Връща { dir, root } или { error } — без гадаене и без мълчаливо писане на случайно място.
 */
function targetDir({ env = process.env, roots } = {}) {
  // Изричният корен е ДУМАТА НА ОПЕРАТОРА: не се проверява за маркери, само трябва да е папка.
  // Така може да се публикува и на нестандартно място, без кодът да гадае.
  if (env.EVIDENCE_PORTAL_ROOT) {
    const root = path.resolve(env.EVIDENCE_PORTAL_ROOT);
    try {
      if (!fs.statSync(root).isDirectory()) return { error: `EVIDENCE_PORTAL_ROOT не е папка: ${root}` };
    } catch {
      return { error: `EVIDENCE_PORTAL_ROOT липсва: ${root}` };
    }
    return { dir: path.join(root, SUBPATH), root };
  }
  if (env.EVIDENCE_PORTAL_DIR) {
    const dir = path.resolve(env.EVIDENCE_PORTAL_DIR);
    if (!dir.endsWith(path.join('www', 'hapi', 'data')) && !env.EVIDENCE_PORTAL_ALLOW_ANY_DIR) {
      return { error: `EVIDENCE_PORTAL_DIR трябва да завършва на ${SUBPATH_TEXT} (получено: ${dir})` };
    }
    return { dir, root: null };
  }
  const list = roots || candidateRoots(env);
  const root = detectRoot(list);
  if (!root) {
    return {
      error:
        'няма достъп до конфигурацията на Home Assistant (търся configuration.yaml): ' +
        list.map(whyNot).join('; ') +
        ' — задай EVIDENCE_PORTAL_ROOT, ако е на друго място',
    };
  }
  return { dir: path.join(root, SUBPATH), root };
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
  return { ok: true, dir, root: target.root || null, copied, unchanged, total: FILES.length };
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
