'use strict';
// Страница за преглед на тайна връзка. ЦЯЛАТА информация е във фрагмента на адреса
// (`/secret#<id><ключ>`), който браузърът не изпраща — затова тук няма нищо секретно и
// няма параметър: само черупка, която зарежда `/secret-view.js`, а той декриптира в
// браузъра (WebCrypto AES-GCM). Сервира се и на `/secret/<каквото-и-да-е`, за да не
// дава 404 на подрязан или стар линк.
//
// Стилът е вграден, а скриптът е самостоятелен файл: CSP-то на страницата е
// `script-src 'self'`, тоест inline JavaScript не се изпълнява — нарочно.
function secretPageHtml() {
  return (
    '<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><title>Тайна връзка · hAPI Enterprise</title><style>' +
    ':root{color-scheme:light}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f6fa;color:#151a2d;display:grid;place-items:center;min-height:100vh}' +
    'main{width:min(92vw,560px);background:#fff;border:1px solid #e2e5f0;border-radius:16px;padding:28px;box-shadow:0 10px 30px rgba(20,25,60,.08)}' +
    '.brand{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7c8299;margin-bottom:14px}' +
    'h1{font-size:20px;margin:0 0 8px}p{color:#41496b;line-height:1.5}pre{white-space:pre-wrap;word-break:break-word;background:#f8fafc;border:1px solid #e2e5f0;' +
    'border-radius:10px;padding:14px;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0 0 12px;max-height:60vh;overflow:auto}' +
    '.row{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;padding:8px 14px;border-radius:10px;border:1px solid #cfd5e6;background:#fff;cursor:pointer}' +
    'button:hover{background:#eef2ff}input[type=password]{font:inherit;padding:8px 10px;border-radius:10px;border:1px solid #cfd5e6;min-width:220px}' +
    '.status{margin:14px 0;padding:10px 12px;border-radius:10px;font-size:14px;background:#eef2ff;color:#1e2a5a}' +
    '.status.error{background:#fef2f2;color:#991b1b}.status.hint{background:#f0fdf4;color:#14532d}.status.wait{background:#fff7ed;color:#7c2d12}' +
    '.muted{font-size:12px;color:#7c8299;margin-top:16px}</style></head><body><main id="secret">' +
    '<div class="brand">hAPI Enterprise · тайна връзка</div>' +
    '<h1>Тайната се отваря само в този браузър</h1>' +
    '<p>Ключът е частта след „#“ в адреса и не се изпраща към сървъра — сървърът пази само шифротекст и ' +
    'дори не знае кой запис отваряш. Ако презаредиш страницата след като ключът е премахнат от адреса, ' +
    'ще ти трябва оригиналният линк.</p>' +
    '<div id="status" class="status" hidden></div>' +
    '<div id="unlock" hidden><label for="password" style="display:block;font-size:13px;color:#67708c;margin:0 0 6px">' +
    'Тази тайна иска и парола (подателят я дава отделно от линка)</label>' +
    '<div class="row"><input id="password" type="password" autocomplete="off" spellcheck="false">' +
    '<button id="open" type="button">Отвори</button></div></div>' +
    '<div id="result" hidden></div>' +
    '<div class="muted">Zero-knowledge: AES-GCM 256 в браузъра · тайната се изтрива след преглед или след срока.</div>' +
    '</main><script src="/secret-view.js" defer></script></body></html>'
  );
}

module.exports = { secretPageHtml };
