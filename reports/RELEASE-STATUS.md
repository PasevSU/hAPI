# Състояние на изданието — hAPI Enterprise 0.69.88

Версия: **0.69.88** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **314/314** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.88 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 512 файла · 85979 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 507 файла · 85389 реда · critical: 0 · high: 0 · medium: 0 · low: 193 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 314 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.88.tar.gz` | add-on архив (191 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.88.zip` | интеграция за HACS (23 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.88.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.88

- **Публичното API не отговаряше на адресите, които панелът сам пише.** Проверено на живо:
  `https://<домейн>/api/v1/p/<slug>` връща **`404: Not Found` от Home Assistant**, а
  `https://<домейн>/` връща самия HA. Причината: панелът строи адреси по `links.js`
  (`/p/<id>`, `/api/v1/p/<slug>/…`, `/portal.css`), но на порта на Home Assistant тези пътища
  изобщо не съществуваха — интеграцията сервираше само `/api/hapi_enterprise/…`. Gateway портът
  на add-on-а (8088) нарочно не се публикува, тоест адресите изглеждаха правилни и бяха мъртви,
  освен ако човек не вдигне отделен reverse proxy. Сега интеграцията регистрира СЪЩИТЕ пътища на
  HA порта и ги стриймва към backend-а (`PublicPortalAPI`, `PublicPortalPage`,
  `PublicPortalAsset`): страница, manifest, files, storage, qr, openapi и ресурсите на страницата
  работят без HA сесия и без nginx, а административните пътища остават недостъпни.
  `tests/ha-integration-python.cjs` взима пътищата **от `links.js`** и иска за всеки от тях изглед
  в интеграцията — за да не се разминат отново. **Проверено обратно:** сменен път на API-то →
  „интеграцията сервира API-то на портала на /api/v1/p/“; махнат `register_view` → „изгледът е
  регистриран: PublicPortalPage()“.

- **Изданието качваше 5 от 6 файла, а манифестът описваше 6.** `dist/SHA256SUMS.txt` изброява
  add-on архива, интеграцията, GUI пакета, `repository.yaml`, `RELEASE.json` и себе си, но стъпката
  „Attach to GitHub release“ в `.github/workflows/release.yml` нямаше шаблон за
  `hapi-enterprise-gui-*.zip`. Тоест човек, който сверява по публикувания манифест, стигаше до
  файл, който изданието не носи — точно това се случи с `v0.69.87` и се поправи ръчно, като към
  изданието беше качен файлът, който CI е построил (хешът му съвпада с реда в манифеста:
  `ac507047…`). Шаблонът е добавен, а `tests/release-workflow-assets.cjs` пази договора: списъкът с
  артефакти се строи от версията в `config.yaml` (същият списък, който пише `SHA256SUMS.txt`),
  всяко име трябва да се покрива от шаблон в `files:` и workflow-ът трябва да пуска
  `verify-release --with-tests` и `check-tag-version`. **Проверено обратно:** махнат GUI шаблон →
  „всеки артефакт от манифеста се качва към изданието“; `verify-release` без `--with-tests` →
  „workflow-ът пуска verify-release с тестовете“.

## 4. Как се проверява наново

```
node scripts/test-matrix.cjs          # пълният набор, от начало, до 5 опита
node scripts/build-release.cjs        # dist/
node scripts/verify-release.cjs       # S01–S23 върху готовия архив
npm run audit:gui                     # GUI + съвместимост + изданието
node scripts/release-status.cjs       # този отчет
```

## 5. Извън локалните гейтове

CI, CodeQL, Release workflow и HACS проверките се виждат с `gh run list` — те не се
записват тук, за да не се представя чужд резултат за свой.
