'use strict';
// ВРЪЗКИ ЗА QR СТУДИОТО — временна, само за четене и с парола (0.69.229).
//
// Защо: QR кодът на портала дотук беше ЕДИН адрес — страницата. Собственикът искаше от същия
// панел да издава и код, който: (а) важи само определен срок, (б) води към спътника „само за
// четене“ (без изтегляне), (в) иска парола преди да отвори портала. Трите неща НЕ бива да
// променят самия портал — иначе „временният“ код би заключил и постоянния.
//
// Затова тук живее отделен запис за ВРЪЗКА (`portal.links[]`), а не нов вид достъп:
//   • `id`        — 12 случайни знака в адреса `/x/<id>` (не е тайна, но не е и предвидим);
//   • `expiresAt` — срокът; след него връзката дава 410, а порталът остава какъвто е;
//   • `readOnly`  — води към спътника „само за преглед“ (ако съществува);
//   • `password`  — `scrypt$<salt>$<hash>` (`portal-term.js`), НИКОГА в чист вид и никога в адрес.
//
// Отварянето на връзката не измисля втори достъп: тя ПРЕНАСОЧВА към публичната страница с
// подписания достъп (`portal-access.js`), тоест всички съществуващи проверки остават в сила, а
// срокът на връзката е по-краткият от двата.
const crypto = require('node:crypto');

/** Най-краткият смислен срок и таванът (същият като на подписания достъп). */
const MIN_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 86400;
const MAX_LINKS_PER_PORTAL = 50;
const MAX_PASSWORD = 64;
const MIN_PASSWORD = 4;

const ID_BYTES = 9; // 12 знака base64url — достатъчно, за да не се подбира, и късо за QR

function create(deps) {
  const {
    json,
    fail,
    parse,
    audit,
    adminGate,
    resolvePortal,
    portals = () => [],
    update,
    portalAccess,
    portalTerm,
    baseUrl,
    htmlEsc,
    fallbackSecret = '',
  } = deps;

  const nowMs = () => Date.now();
  const isExpired = (link, now = nowMs()) => !link || !link.expiresAt || Date.parse(link.expiresAt) <= now;
  const newId = () => crypto.randomBytes(ID_BYTES).toString('base64url');
  const text = (v) => String(v == null ? '' : v);

  /** Спътникът „само за преглед“ на портала (или `null`). */
  const companionOf = (portal) =>
    (portals() || []).find((x) => x && x.readonly === true && (x.parentId === portal.id || x.parentSlug === portal.slug)) || null;

  /** Административният изглед на връзка: без хеша на паролата, с признак дали я има. */
  const adminView = (link) => ({
    id: link.id,
    url: '/x/' + link.id,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    readOnly: link.readOnly === true,
    hasPassword: Boolean(link.passwordHash),
    uses: Number(link.uses) || 0,
    lastUsedAt: link.lastUsedAt || null,
    expired: isExpired(link),
  });

  const findPortalOf = (linkId) => (portals() || []).find((p) => Array.isArray(p.links) && p.links.some((l) => l.id === linkId)) || null;

  /** Подписаният адрес, към който връзката пренасочва. */
  function targetUrl(req, link) {
    const portal = resolvePortal(link.portalId);
    if (!portal) return '';
    const access = portalAccess.issue(portal.signingSecret || fallbackSecret, portal.id, { ttl: MAX_TTL_SECONDS, hasQuery: false });
    return `${baseUrl(req)}/p/${encodeURIComponent(portal.id)}${access.query}`;
  }

  /** Минимална страница за паролата. Без външни ресурси и без скриптове (CSP). */
  function passwordPage(res, link, error) {
    const dead = isExpired(link);
    const title = dead ? 'Връзката е изтекла' : 'Връзка с парола';
    const body = dead
      ? '<p>Срокът на тази връзка е изтекъл. Поискайте нова.</p><p class="en">This link has expired — ask for a new one.</p>'
      : `<p>Въведете паролата, за да отворите портала.</p>
         <p class="en">Enter the password to open the portal.</p>
         ${error ? '<p class="err" role="alert">Грешна парола.</p>' : ''}
         <form method="post" action="/x/${encodeURIComponent(link.id)}">
           <label for="pw">Парола</label>
           <input id="pw" name="password" type="password" autocomplete="current-password" maxlength="${MAX_PASSWORD}" autofocus />
           <button type="submit">Отвори</button>
         </form>`;
    res.writeHead(dead ? 410 : error ? 401 : 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(`<!doctype html><html lang="bg"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" /><title>${htmlEsc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0d1520;color:#e6eef6;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:22rem;padding:2rem;border:1px solid #2a3a4d;border-radius:14px;background:#111c2a;box-shadow:0 12px 40px #0008}
h1{font-size:1.1rem;margin:0 0 .8rem}label{display:block;font-size:.85rem;margin:.6rem 0 .3rem}
input{width:100%;padding:.6rem;border-radius:8px;border:1px solid #2a3a4d;background:#0b1420;color:inherit}
button{margin-top:.9rem;width:100%;padding:.6rem;border-radius:8px;border:0;background:#28c8e0;color:#04121a;font-weight:600}
.en{color:#9fb3c8;font-size:.85rem}.err{color:#ff8a8a}</style></head>
<body><main><h1>${htmlEsc(title)}</h1>${body}</main></body></html>`);
  }

  function redirect(res, location) {
    res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end();
  }

  /** Чете тялото на POST от формата (JSON не минава оттук). */
  function readForm(req) {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 4096) {
          req.destroy();
          resolve({});
        }
      });
      req.on('end', () => {
        try {
          resolve(Object.fromEntries(new URLSearchParams(raw)));
        } catch {
          resolve({});
        }
      });
      req.on('error', () => resolve({}));
    });
  }

  const attempts = new Map(); // linkId → { count, resetAt }
  function tooMany(linkId, now) {
    const entry = attempts.get(linkId);
    if (!entry || entry.resetAt <= now) {
      attempts.set(linkId, { count: 1, resetAt: now + 60_000 });
      return false;
    }
    entry.count += 1;
    return entry.count > 10;
  }

  async function handle({ req, res, url: _url, parts, method }) {
    // ── Публичен вход: /x/<id> ────────────────────────────────────────────
    if (parts[0] === 'x' && parts.length === 2) {
      const linkId = parts[1];
      const owner = findPortalOf(linkId);
      const link = owner ? owner.links.find((l) => l.id === linkId) : null;
      if (!link) {
        fail(res, 404, 'Not found');
        return true;
      }
      if (method === 'GET') {
        if (isExpired(link)) {
          passwordPage(res, link);
          return true;
        }
        if (link.passwordHash) {
          passwordPage(res, link);
          return true;
        }
        const target = targetUrl(req, link);
        if (!target) {
          fail(res, 404, 'Not found');
          return true;
        }
        await update(() => {
          link.uses = (Number(link.uses) || 0) + 1;
          link.lastUsedAt = new Date().toISOString();
          return true;
        });
        void audit('portal.link.open', { portalId: owner.id, linkId, readOnly: link.readOnly === true });
        redirect(res, target);
        return true;
      }
      if (method === 'POST') {
        if (isExpired(link)) {
          void audit('portal.link.denied', { portalId: owner.id, linkId, reason: 'expired' });
          passwordPage(res, link);
          return true;
        }
        if (tooMany(linkId, nowMs())) {
          res.setHeader('Retry-After', '60');
          void audit('portal.link.denied', { portalId: owner.id, linkId, reason: 'rate' });
          passwordPage(res, link, true);
          return true;
        }
        if (!link.passwordHash) {
          // Връзка без парола не бива да стига дотук (GET я пуска), но ако стигне —
          // празно тяло не е грешна парола.
          const direct = targetUrl(req, link);
          if (!direct) {
            fail(res, 404, 'Not found');
            return true;
          }
          if (isJson) {
            json(res, 200, { ok: true, url: direct });
            return true;
          }
          redirect(res, direct);
          return true;
        }
        // JSON от панела и форма от браузъра отиват в един и същ път на проверка.
        const isJson = String(req.headers['content-type'] || '').includes('application/json');
        const body = isJson ? await parse(req) : await readForm(req);
        const password = text(body && body.password);
        if (!portalTerm.verifyPassword(password, link.passwordHash || '')) {
          void audit('portal.link.denied', { portalId: owner.id, linkId, reason: 'password' });
          if (isJson) {
            json(res, 401, { ok: false, error: 'Wrong password' });
            return true;
          }
          passwordPage(res, link, true);
          return true;
        }
        const target = targetUrl(req, link);
        if (!target) {
          fail(res, 404, 'Not found');
          return true;
        }
        await update(() => {
          link.uses = (Number(link.uses) || 0) + 1;
          link.lastUsedAt = new Date().toISOString();
          return true;
        });
        void audit('portal.link.open', { portalId: owner.id, linkId, readOnly: link.readOnly === true, withPassword: true });
        if (isJson) {
          json(res, 200, { ok: true, url: target });
          return true;
        }
        redirect(res, target);
        return true;
      }
      fail(res, 405, 'Method not allowed');
      return true;
    }

    // ── Административни: /admin/api/portals/<id>/links ───────────────────
    if (parts[0] !== 'admin' || parts[1] !== 'api' || parts[2] !== 'portals' || parts[4] !== 'links') return false;
    if (!adminGate(req, res)) return true;
    const portal = resolvePortal(parts[3]);
    if (!portal) {
      fail(res, 404, 'Not found');
      return true;
    }
    const linkId = parts[5];

    if (method === 'GET' && parts.length === 5) {
      const links = (portal.links || []).map(adminView);
      return json(res, 200, { ok: true, links }), true;
    }

    if (method === 'POST' && parts.length === 5) {
      const body = await parse(req);
      const readOnly = body.readOnly === true;
      const target = readOnly ? companionOf(portal) : portal;
      if (readOnly && !target) {
        fail(res, 400, 'Порталът няма спътник „само за преглед“ — създай портала с включен преглед');
        return true;
      }
      const rawTtl = Number(body.ttlSeconds);
      const ttl = Number.isSafeInteger(rawTtl) && rawTtl > 0 ? Math.min(Math.max(rawTtl, MIN_TTL_SECONDS), MAX_TTL_SECONDS) : 3600;
      const password = text(body.password);
      if (password && (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD)) {
        fail(res, 400, `Паролата трябва да е ${MIN_PASSWORD}…${MAX_PASSWORD} знака`);
        return true;
      }
      const links = Array.isArray(portal.links) ? portal.links : [];
      if (links.length >= MAX_LINKS_PER_PORTAL) {
        fail(res, 409, `Таван ${MAX_LINKS_PER_PORTAL} връзки на портал — изтрий старите`);
        return true;
      }
      const link = {
        id: newId(),
        portalId: target.id,
        readOnly,
        expiresAt: new Date(nowMs() + ttl * 1000).toISOString(),
        passwordHash: password ? portalTerm.hashPassword(password) : null,
        createdAt: new Date().toISOString(),
        uses: 0,
        lastUsedAt: null,
      };
      await update(() => {
        portal.links = [...(Array.isArray(portal.links) ? portal.links : []), link];
        return true;
      });
      void audit('portal.link.create', { portalId: portal.id, linkId: link.id, readOnly, hasPassword: Boolean(password), ttl });
      return json(res, 201, { ok: true, link: adminView(link) }), true;
    }

    if (method === 'DELETE' && parts.length === 6) {
      const had = (portal.links || []).some((l) => l.id === linkId);
      if (!had) {
        fail(res, 404, 'Not found');
        return true;
      }
      await update(() => {
        portal.links = (portal.links || []).filter((l) => l.id !== linkId);
        return true;
      });
      void audit('portal.link.delete', { portalId: portal.id, linkId });
      return json(res, 200, { ok: true }), true;
    }

    fail(res, 405, 'Method not allowed');
    return true;
  }

  return { handle, MIN_TTL_SECONDS, MAX_TTL_SECONDS, MAX_LINKS_PER_PORTAL };
}

module.exports = { create };
