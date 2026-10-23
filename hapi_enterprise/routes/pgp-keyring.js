'use strict';
// PGP ключохранилище — компонент на HTTP слоя.
//
//   GET  /admin/api/pgp/keyring          → { ok, keyring: { available, canDecrypt, reason, keys, … } }
//   POST /admin/api/pgp/keyring/reload   → същото, след препрочитане от диска
//
// Защо съществува: дотогава липсващ или грешен ключ се виждаше само като „не се криптира“
// някъде надолу из кода. Тук състоянието се казва с точна причина (`NO_PATHS`,
// `SECRET_UNREADABLE`, `PASSPHRASE_REQUIRED`, `PASSPHRASE_WRONG`, `UNSUPPORTED_CURVE`, …)
// и БЕЗ път до файла и без парола (INV-P7).
//
// Договор: `handle()` връща `true`, когато заявката е за този компонент (и е приключена),
// и `false`, когато трябва да я поеме следващият компонент.
function create(deps) {
  const { json, fail, adminGate, audit, keyring } = deps;

  /** Препрочита и одитира — общо за `reload`. */
  async function reloadAndReport(req, res) {
    // Препрочитането е административно действие: сменя се какво вижда целият add-on,
    // затова влиза в одита (без пътища и без парола — само резултатът).
    const state = keyring.reload();
    await audit('pgp.keyring.reload', {
      available: state.available,
      canDecrypt: state.canDecrypt,
      reason: state.reason || '',
      keys: state.keys.length,
      storageKeyId: state.storageKeyId || '',
    });
    if (!state.available) {
      fail(res, 503, 'KEYRING_UNAVAILABLE: ' + (state.reason || 'unknown'));
      return true;
    }
    json(res, 200, { ok: true, reloaded: true, keyring: state });
    return true;
  }

  async function handle({ req, res, url, method }) {
    // Пътищата се сравняват позитивно (`===`) и с изричен метод — така
    // `tests/admin-api-spec.cjs` ги вижда в кода и изисква да са описани в договора.
    if (url.pathname === '/admin/api/pgp/keyring' && method === 'GET') {
      if (!adminGate(req, res, 'pgp', method)) return true;
      json(res, 200, { ok: true, keyring: keyring.status() });
      return true;
    }
    if (url.pathname === '/admin/api/pgp/keyring/reload' && method === 'POST') {
      if (!adminGate(req, res, 'pgp', method)) return true;
      return reloadAndReport(req, res);
    }
    return false;
  }

  return { handle };
}

module.exports = { create };
