# Преглед: `hapi-evidence-portal v1.2` (външен пакет) → какво от него вече е в hAPI

**Дата на прегледа:** 2026-10-24 · **Източник:** `hapi-evidence-portal-v1.2-ha-frontend.zip`
(`VERSION.json`, `HOME_ASSISTANT_DEPLOY.md`, `README.md`, `portal.html`, `assets/*`, `data/demo-evidence.json`)
**Извод в едно изречение:** пакетът е вече интегриран в `hapi_enterprise/evidence-portal/` и в по-нова
форма; липсва единствено сървърната част (три endpoint-а), а поисканият адрес
`/portal.html:<папка>` вече работи **нативно** (без прокси) от 0.69.80.

## 1. Сверка файл по файл

| Файл в пакета | В hAPI | Разлика |
| --- | --- | --- |
| `portal.html` | `hapi_enterprise/evidence-portal/portal.html` | **същият** (еднакъв SHA-256) |
| `assets/style.css` | `…/assets/style.css` | **същият** (еднакъв SHA-256) |
| `assets/app.js` | `…/assets/app.js` | локалният е **по-нов**: API-то е `/api/evidence` (не `/api/hapi/evidence`), няма браузърен одит, манифестът се зарежда през отделна `loadManifest()` |
| `assets/consent.js` | `…/assets/consent.js` | локалният е по-нов: същият префикс `/api/evidence` |
| `assets/audit-client.js` | **липсва нарочно** | браузърният одит е премахнат: одитът е САМО сървърен (иначе клиентът „доказва“ какво е правил) |
| `data/demo-evidence.json` | `…/data/demo-evidence.json` (1906 B) | локалният е скъсен; пакетът носи по-пълен пример (2503 B) |
| `README.md` | `…/README.md` | локалният е разширен (правила за публикуване) |
| `VERSION.json`, `HOME_ASSISTANT_DEPLOY.md` | липсват | описват статично публикуване в `/config/www/hapi/portal/`; hAPI публикува в `www/hapi/data/` през `evidence-portal.js` |

Проверката е байтова (`Get-FileHash`), не „на око“.

## 2. Проверка за сигурност на пакета

- **Няма тайни**: нито токени, нито ключове, нито пароли в `app.js`, `consent.js`, `audit-client.js`,
  `demo-evidence.json` (за разлика от външния пакет `d:\js_pack`, който съдържаше жив HA токен).
- Всички стойности се показват през `textContent`; **няма `innerHTML`** → няма DOM-XSS от манифеста.
- Адресът за достъп се проверява: трябва да започва с `/` и да не започва с `//` (без чужд origin).
- Демо режимът е изрично отделен (`?folder=demo-evidence`) и пакетът сам казва, че **не е защита**:
  „A read-only UI is not a security boundary“, „Do not place private evidence in `/config/www`“,
  „The `demo-evidence` mode MUST be disabled in production“.
- Съгласието в браузъра е само UX: истинското съгласие трябва да е сървърно, с версия на условията.

**Присъда:** пакетът е коректен като фронтенд и честен за собствените си граници. Нищо от него не
бива да се приема за доказателство — точно както казва и неговият README.

## 3. Какво пакетът иска от сървъра и какво има hAPI

| Изискване на пакета | В hAPI |
| --- | --- |
| `GET /api/evidence/:folder/manifest` | **няма** (има `/api/v1/p/<slug>/tree`, `/manifest` за пакета, но не в тази схема) |
| `POST /api/evidence/:folder/consent` | **няма** (условия с версия не се пазят) |
| `POST /api/evidence/:folder/access` → `{url}` с еднократен билет | **частично**: `routes/portal-storage.js` дава файл по относителен път с всички проверки; няма endpoint, който връща билет в тази схема |
| `/portal.html:<папка>` без прокси | **има от 0.69.80** (`routes/portal-storage.js`, правило в `public-route-allowlist.js`) |
| Одит `PORTAL_OPEN`, `TERMS_ACCEPTED`, `FILE_VIEW`, `FILE_DOWNLOAD`, `ACCESS_DENIED` | **частично**: `audit-chain.js` пази `portal.order.open`, `portal.tree.file.download`, отказите по политика; няма „приемане на условия“ |

## 4. Защо не се копира пакетът в репото

- Локалната версия е по-нова; копиране би върнало `/api/hapi/evidence` и браузърния одит.
- ESM файлове, сложени под `archive/`, чупят `npx eslint .` (Parsing error: `import`/`export`).
  Затова пакетът се разархивира извън репото и се сравнява, вместо да се съхранява.

## 5. Следваща стъпка (когато се реши)

1. `GET /api/evidence/<folder>/manifest` — порталът се намира по slug, правото се решава от
   `portal-policy.decide()`, схемата е схемата на пакета (`items` с `children`). Без съгласие → `403`
   с код `CONSENT_REQUIRED`.
2. `POST /api/evidence/<folder>/consent` — `terms_version` се сверява със сървърна константа,
   съгласието се пази с бисквитка, вързана към портала, и се записва в одитната верига.
3. `POST /api/evidence/<folder>/access` — паролата се проверява сървърно (съществуващият механизъм
   за ключ на файл), връща се адрес с еднократен билет; файлът се отдава само след повторна
   проверка на правото и само като `attachment`.

Точки 1–3 не са реализирани. Дотогава публикуваният фронтенд работи **само** в демо режим и това е
записано и в `RUNTIME_EXECUTION_FLOWS.md` (§10).
