'use strict';
// L2 (бач B4): работната папка — единственото място, което знае как се пише и чете
// файл в папката на портала, когато `pgp_encrypt_workdir` е включено.
//
// Защо отделен модул: `server.js` има твърд таван на редовете (2722), а тези четири
// помощни функции се ползват на четири места (качване, регистриране, пакетиране, дърво).
//
// Правило: при изключено L2 всичко работи както преди (`pack` връща данните, `read` чете
// файла). При включено — на диска стои контейнер, а четенето го разпознава по заглавката.
// Старите открити файлове продължават да се четат, докато не се мигрират.
const workdir = require('./workdir-crypto');

function create({ fsp, keyring }) {
  const on = () => keyring.status().encryptWorkdir;
  /** Каквото отива на диска: контейнер при L2, иначе самите данни. */
  const pack = (data) => (on() ? workdir.seal(data, keyring) : data);
  /** Откритото съдържание на файл от работната папка (криптиран или не). */
  const read = async (full) => {
    const raw = await fsp.readFile(full);
    return workdir.isSealed(raw) ? workdir.open(raw, keyring) : raw;
  };
  /** Оригиналният размер за дървото (при L2), иначе `null` — тогава се ползва `stat.size`. */
  const size = async (full) => {
    if (!on()) return null;
    const fd = await fsp.open(full, 'r');
    try {
      const head = Buffer.alloc(21);
      const { bytesRead } = await fd.read(head, 0, 21, 0);
      const magic = head.subarray(0, bytesRead);
      return workdir.isSealed(magic) ? workdir.plainSize(magic) : null;
    } finally {
      await fd.close();
    }
  };
  return { on, pack, read, size };
}

module.exports = { create };
