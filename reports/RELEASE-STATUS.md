# Състояние на изданието — hAPI Enterprise 0.69.86

Версия: **0.69.86** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **253/253** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.86 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 424 файла · 72914 реда · **1** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 420 файла · 72550 реда · critical: 0 · high: 0 · medium: 3 · low: 178 — **има необяснени** |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 24 RBAC способности, 41 опции, 253 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.86.tar.gz` | add-on архив (171 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.86.zip` | интеграция за HACS (23 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.86

Вход през външен доставчик (OIDC) — Pocket ID, Keycloak, Authentik, без npm зависимости.

- **`GET /api/v1/auth/oidc/login`** → 302 към доставчика с **PKCE `S256`**, `state` и `nonce`;
  **`GET /api/v1/auth/oidc/callback`** → код → токен → **проверка на ID token** → сесия.
- **Проверки, без които това не е вход:** `state` живее само на сървъра и се харчи веднъж
  (5 минути), `nonce` се сверява с конкретния вход, `alg` е **само `RS256`** (`none` и HS* са
  отказ), подписът се проверява с ключ от JWKS (непознат `kid` → еднократно презареждане при
  ротация), `iss`/`aud`/`exp` се сверяват с конфигурацията.
- **Роля от групите:** `HAPI_OIDC_ADMIN_GROUP` → `admin`, иначе `viewer`; групи извън
  `HAPI_OIDC_ALLOWED_GROUPS` → `403` и одит `auth.oidc.denied`. Без конфигурация двата пътя
  връщат `404` — изключен вход, а не „почти работещ“.
- **Сесията е обикновена hAPI сесия** + HttpOnly бисквитка `hapi_sso`; токенът **не влиза в
  адреса**. `rbac` получи последна стъпка `ssoRole` (след токените и Ingress), затова
  админ панелът работи по бисквитката.
- **Поправен скрит дефект:** `parseScopes` в `sqlite-store.js` режеше всичко извън
  `read`/`download` — тоест скоупът `admin` се губеше и административен достъп през сесия беше
  невъзможен дори когато е записан.
- **Документация:** нов `documentation/02_TO_BE_ARCHITECTURE/OIDC_LOGIN.md` (настройки, какво
  се проверява и защо, регистрация при Pocket ID); матрицата §5.1 добавя `OIDC_PKCE_LOGIN`;
  `RUNTIME_EXECUTION_FLOWS.md` — точка 7г. Справочникът на API: 185 операции, 30 публични
  правила, **10 компонента**.
- **Гейт:** `tests/oidc-login.cjs` — истински протокол срещу измислен доставчик (откриване,
  `/authorize`, `/token` с проверка на `code_verifier`, JWKS): поток, бисквитка вместо токен в
  адрес, роля от групите, повторен `state` → 400, отказ → 401, `alg: none`/изтекъл → отказ.

## 4. Как се проверява наново

```
node scripts/test-matrix.cjs          # пълният набор, от начало, до 5 опита
node scripts/build-release.cjs        # dist/
node scripts/verify-release.cjs       # S01–S21 върху готовия архив
npm run audit:gui                     # GUI + съвместимост + изданието
node scripts/release-status.cjs       # този отчет
```

## 5. Извън локалните гейтове

CI, CodeQL, Release workflow и HACS проверките се виждат с `gh run list` — те не се
записват тук, за да не се представя чужд резултат за свой.
