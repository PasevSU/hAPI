'use strict';
// PasevSU Document Generator — ШАБЛОНИ ОТ ДИСКА, ИНДЕКС НА ЖИВО.
//
// Защо този модул съществува: браузърът не може да изброи файловете в сървърна папка.
// Затова генераторът има нужда от индекс. Досега той се строеше с `tools/build-index.mjs`
// (ръчна стъпка) и се записваше в `temp/index.json` — тоест след добавяне или изтриване на
// шаблон индексът лъжеше, докато някой не пусне скрипта. Тук индексът се строи при ВСЯКА
// заявка от реалното съдържание на папката: няма кеш, няма ръчна стъпка, няма как да се
// разминава.
//
// Правила:
//   • само `*.html` с име `[A-Za-z0-9_.-]{1,80}` — без наклонени черти, без водеща точка;
//   • твърд таван на размера (512 KiB), за да не се качи „шаблон“ от гигабайти;
//   • записът е атомарен (временен файл + rename), за да не се чете половин файл;
//   • съдържанието се сервира като `text/plain`, а генераторът го почиства в браузъра —
//     така шаблонът не се изпълнява от сървъра дори да съдържа скрипт.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const NAME_RE = /^[A-Za-z0-9_.-]{1,80}\.html$/;
const MAX_BYTES = 512 * 1024;

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

/** Заглавие за списъка: `<title>`, после първият `<h1>`, иначе името на файла. */
function titleOf(html, file) {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html) || /<h1[^>]*>([^<]*)<\/h1>/i.exec(html);
  const text = match && match[1] ? match[1].replace(/\s+/g, ' ').trim() : '';
  return text || file.replace(/\.html$/i, '');
}

function create({ root } = {}) {
  if (!root) throw Error('generator: необходим е root (DATA_DIR)');
  const dir = path.join(root, 'generator', 'temp');

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true });
    try {
      if (fs.lstatSync(dir).isSymbolicLink()) throw bad('папката на шаблоните е симлинк', 500);
    } catch (e) {
      if (e.code === 'ENOENT') throw e;
      if (e.status) throw e;
      throw e;
    }
    return dir;
  }

  function checkName(name) {
    const value = String(name == null ? '' : name);
    if (!NAME_RE.test(value) || value.startsWith('.')) throw bad('името трябва да е *.html без наклонени черти и без водеща точка');
    return value;
  }

  /** Списък на шаблоните — четен от диска ВСЕКИ път, без кеш. */
  function list() {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const out = [];
    for (const file of names.sort()) {
      if (!NAME_RE.test(file) || file.startsWith('.')) continue;
      const abs = path.join(dir, file);
      let stat;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue; // файлът е изчезнал между readdir и stat — не е шаблон
      }
      if (!stat.isFile()) continue;
      let html = '';
      try {
        html = fs.readFileSync(abs, 'utf8');
      } catch {
        continue; // нечетим файл не влиза в индекса, вместо да чупи целия списък
      }
      out.push({ file, title: titleOf(html, file), bytes: stat.size, updatedAt: stat.mtime.toISOString() });
    }
    return out;
  }

  /** Индексът, който генераторът чете. `live: true` казва, че не е файл, а моментна снимка. */
  function index() {
    return { version: 1, live: true, folder: 'generator/temp', templates: list() };
  }

  function read(name) {
    const file = checkName(name);
    const abs = path.join(dir, file);
    let html;
    try {
      html = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') throw bad('няма такъв шаблон: ' + file, 404);
      throw e;
    }
    return { file, html, bytes: Buffer.byteLength(html, 'utf8') };
  }

  function save(name, html, options = {}) {
    const file = checkName(name);
    const body = String(html == null ? '' : html);
    if (!body.trim()) throw bad('шаблонът е празен');
    if (/[\u0000]/.test(body)) throw bad('шаблонът съдържа нулев байт');
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > MAX_BYTES) throw bad(`шаблонът е ${Math.round(bytes / 1024)} KiB — таванът е ${MAX_BYTES / 1024} KiB`, 413);
    ensureDir();
    const abs = path.join(dir, file);
    if (!options.overwrite && fs.existsSync(abs)) throw bad('шаблон с това име вече съществува (overwrite: true за замяна)', 409);
    const tmp = path.join(dir, '.' + file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
    try {
      fs.writeFileSync(tmp, body, { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, abs);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch { /* временният файл може вече да не съществува */ }
      throw e;
    }
    return { file, bytes, ...index() };
  }

  function remove(name) {
    const file = checkName(name);
    try {
      fs.unlinkSync(path.join(dir, file));
    } catch (e) {
      if (e.code === 'ENOENT') throw bad('няма такъв шаблон: ' + file, 404);
      throw e;
    }
    return { file, ...index() };
  }

  return { dir, list, index, read, save, remove, MAX_BYTES };
}

module.exports = { create, titleOf, NAME_RE, MAX_BYTES };
