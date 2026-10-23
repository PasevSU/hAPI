'use strict';
// L2 миграция (бач B4): откритите файлове в работните папки стават контейнери.
//
// Защо отделен модул: `server.js` има твърд таван на редовете, а тази операция пипа
// файловете на потребителя и трябва да е четима — с копие, атомарна замяна и точни числа.
//
// Правила:
//   • копие ПРЕДИ промяната — в `backupRoot/<timestamp>/<портал>/<път>`; ако копието не
//     мине, файлът не се пипа (по-добре отказ, отколкото загуба);
//   • атомарна замяна (`<файл>.hapi-tmp` + rename), за да няма половин контейнер;
//   • вече криптираните се броят като `already` и не се пипат (идемпотентност);
//   • символни връзки и скрити имена се пропускат — същата политика като при четене;
//   • твърди лимити за брой файлове и байтове, за да не блокира add-on-а.
const { seal, isSealed } = require('./workdir-crypto');

const MAX_FILES = 5000;
const MAX_BYTES = 512 * 1024 * 1024;

function factory(deps) {
  const { fsp, path, portalRoot, keyring, backupRoot } = deps;

  async function walk(dir, rel, out) {
    let list;
    try {
      list = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'EACCES') return;
      throw e;
    }
    list.sort((a, b) => a.name.localeCompare(b.name, 'bg'));
    for (const entry of list) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      const next = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        await walk(full, next, out);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fsp.stat(full).catch(() => null);
      if (!stat) continue;
      out.push({ full, rel: next, size: stat.size });
      if (out.length > MAX_FILES) {
        throw Object.assign(new Error(`Твърде много файлове за миграция (макс. ${MAX_FILES})`), { status: 413 });
      }
      if (out.reduce((sum, f) => sum + f.size, 0) > MAX_BYTES) {
        throw Object.assign(new Error('Работните папки надвишават лимита за миграция'), { status: 413 });
      }
    }
  }

  /**
   * Минава през всички портали и криптира откритите файлове в папките им.
   * Връща точни числа: колко са криптирани, колко вече са били, колко са пропуснати.
   */
  async function sealPortals(portals) {
    if (!keyring.status().encryptWorkdir) {
      throw Object.assign(new Error('L2 е изключено (`pgp_encrypt_workdir`)'), { code: 'PGP_WORKDIR_DISABLED', status: 409 });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(backupRoot, stamp);
    let sealed = 0;
    let already = 0;
    let skipped = 0;
    let bytes = 0;
    const failed = [];

    for (const portal of portals || []) {
      const root = portalRoot((portal && portal.storage_root) || '/share');
      // Целият /share или /media не се пипа — само отделена папка на портал.
      if (root === '/share' || root === '/media') {
        skipped++;
        continue;
      }
      const files = [];
      await walk(root, '', files);
      for (const file of files) {
        const raw = await fsp.readFile(file.full).catch(() => null);
        if (!raw) {
          failed.push({ portal: portal.id, path: file.rel, reason: 'UNREADABLE' });
          continue;
        }
        if (isSealed(raw)) {
          already++;
          continue;
        }
        // Копие преди промяната: без него миграцията е необратима при грешен ключ.
        const backup = path.join(backupDir, String(portal.id || 'portal'), ...file.rel.split('/'));
        try {
          await fsp.mkdir(path.dirname(backup), { recursive: true });
          await fsp.writeFile(backup, raw, { flag: 'wx', mode: 0o600 });
        } catch (e) {
          failed.push({ portal: portal.id, path: file.rel, reason: 'BACKUP_FAILED:' + (e.code || 'error') });
          continue;
        }
        try {
          const container = seal(raw, keyring);
          const tmp = file.full + '.hapi-tmp';
          await fsp.writeFile(tmp, container, { mode: 0o600 });
          await fsp.rename(tmp, file.full);
          sealed++;
          bytes += raw.length;
        } catch (e) {
          await fsp.rm(file.full + '.hapi-tmp', { force: true }).catch(() => {});
          failed.push({ portal: portal.id, path: file.rel, reason: e.code || 'SEAL_FAILED', detail: String(e.message || '').slice(0, 120) });
        }
      }
    }
    return { sealed, already, skipped, bytes, failed: failed.slice(0, 20), failedCount: failed.length, backup: stamp };
  }

  return { sealPortals };
}

module.exports = { create: factory, MAX_FILES, MAX_BYTES };
