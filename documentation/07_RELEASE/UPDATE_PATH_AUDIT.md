# Защо обновяването не стига до Home Assistant — одит на пътя на изданието

> Проверено на 2026-11-08 срещу живата инстанция `192.168.50.4` (Home Assistant 2026.11.0)
> и срещу GitHub/GHCR — първо за издание **0.69.197**, после повторно за **0.69.200**
> (§3.2). Всяко твърдение по-долу е измерено с команда; където не е — е казано изрично.

## 1. Изводът в едно изречение

Изданието е публикувано правилно, но **инстанцията не е свързана с източника**: add-on-ът е
**локална папка** в `/addons`, интеграцията е **ръчно копие** в `/config/custom_components`,
а **HACS не е инсталиран** — тоест няма кой да сравни наличното с публикуваното и затова
„Обнови“ не се появява.

## 2. Измерено: сървърната страна е наред

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Изданието съществува и е публично | `gh release view v0.69.197 -R PasevSU/hAPI` | non-draft, 6 артефакта |
| Артефактите отговарят на `SHA256SUMS.txt` | `gh release download` + `Get-FileHash` | **5/5 съвпадат** |
| Образът за amd64 съществува | `ghcr.io/v2/pasevsu/amd64-addon-hapi_enterprise/manifests/0.69.197` | **200**, OCI index |
| Образът за aarch64 | същото, `aarch64-…` | **200** |
| Образът за armv7 | същото, `armv7-…` | **200** |
| Хранилището е валидно add-on хранилище | `repository.yaml` в корена на `PasevSU/hAPI` | има го |
| Интеграцията е валидно HACS хранилище | `PasevSU/hapi-enterprise-integration` + `hacs.json` + `custom_components/hapi_enterprise/` | release + 2× Validate зелени |

Тоест: няма проблем с публикуването. Проблемът е само в посоката „от GitHub към инстанцията“.

## 3. Измерено: какво има на инстанцията

| Проверка | Път | Резултат |
| --- | --- | --- |
| Add-on хранилище в `/addons` | `\\192.168.50.4\ADDONS\repository.yaml` | **липсва** — нито едно хранилище не е добавено като източник |
| Локални add-on папки | `\\192.168.50.4\ADDONS\hapi_enterprise\config.yaml` | **0.69.195** (локален add-on) |
| Втора, сгрешена папка | `\\192.168.50.4\ADDONS\hAPI Enterptice` | съществува — дубликат, който store-ът също вижда |
| Инсталирана интеграция | `X:\custom_components\hapi_enterprise\manifest.json` | **0.69.195**, ръчно копие |
| HACS | `X:\custom_components\hacs` | **липсва** |
| Данни на HACS | `X:\.storage\hacs.data`, `X:\.storage\hacs.repositories` | **липсват** |

Изводът от таблицата: **няма нито един автоматичен механизъм за обновяване**. Локалният
add-on се „обновява“ само ако някой подмени файловете на диска (Supervisor не сравнява
локална папка с GitHub), а ръчно копираната интеграция не се обновява от никого.

### 3.1 Какво беше приложено веднага (измерено)

`pwsh -NoProfile -File scripts/apply-update.ps1 -Mode Integration -Execute` качи интеграцията
по SMB и я свери: **26/26 файла съвпадат байт по байт**, `manifest.json` на инстанцията вече
носи `0.69.197`. Новото поведение се зарежда при следващия рестарт на Home Assistant — дотогава
в паметта работи старата версия. Add-on-ът **не е пипан**: преименуването на локалните папки
(§5.1, стъпка 3) се прави, след като add-on-ът е инсталиран от хранилището, иначе той изчезва
от store-а без замяна.

### 3.2 Повторен одит при 0.69.200 (измерено)

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Изданието е публично | `gh release view v0.69.200` | non-draft, non-prerelease, **6 артефакта** |
| Артефактите съвпадат | `gh release download` + `Get-FileHash` | **5/5 OK** (tar.gz, integration.zip, gui.zip, RELEASE.json, repository.yaml) |
| Образи за трите архитектури | `ghcr.io/v2/pasevsu/{arch}-addon-hapi_enterprise/manifests/0.69.200` (анонимен токен) | **200** за `amd64`, `aarch64`, `armv7` |
| Workflow-и по тага | `gh run list` / `gh run view` | Release **success** · Add-on image **success** (3/3 работни места) · CI · CodeQL · HACS validation — **success** |
| HACS хранилище | `gh release view v0.69.200 -R PasevSU/hapi-enterprise-integration` | release non-draft; `Release` + 2× `Validate` — **success** |
| Интеграция на инстанцията | `pwsh -File scripts/apply-update.ps1 -Mode Integration -Execute` | **26/26 файла байт по байт**; `manifest.json` = `0.69.200` |
| Add-on на инстанцията | `robocopy /MIR` + `ha store reload` + `ha apps update` | `version: 0.69.200`, `state: started`; контейнерът работи с `ghcr.io/pasevsu/aarch64-addon-hapi_enterprise:0.69.200` |
| Живо съдържание на UI | `GET :8098/ui/files-manager.js` отвътре в контейнера | HTTP 200; `data-qr-portal` ×2, `pf-qr-pop-link` ×1; в `/ui/portal-control.js` — **0** срещания на `data-block="link"` |
| PGP ключохранилище | `GET :8098/admin/api/pgp/keyring` | `available=true canDecrypt=true keys=1` |
| Политика на съхранение | `ha apps logs` → `server startup` | `dataDir=/share/hAPI/data` |

Изводът от §3 не се променя: **автоматично обновяване няма**, докато хранилището не се
добави в store-а (§5.1). Разликата спрямо първия одит е, че инстанцията вече е **на
последната версия** — измерено отвътре в контейнера, не само по файлове на диска.

## 4. Защо HACS не е решението за add-on-а

HACS е маркетплейс за **интеграции, табла и карти** — той живее в `/config/custom_components`
и инсталира файлове там. **Add-on-ите не минават през HACS изобщо.** Add-on се управлява от
Supervisor, който чете или add-on хранилище (`repository.yaml`), или локална папка в `/addons`.

Затова очакването „качвам издание в HACS и add-on-ът ще се обнови“ не може да се изпълни по
устройство. Двете неща се обновяват по два различни пътя:

| Какво | Кой го обновява | Какво трябва да е вярно |
| --- | --- | --- |
| Add-on `hapi_enterprise` | Supervisor | хранилището `https://github.com/PasevSU/hAPI` е добавено в store-а; add-on-ът е инсталиран **от него**, не от локална папка; `config.yaml` носи `image:` (носи го от 0.69.154) |
| Интеграция `hapi_enterprise` | HACS (или ръчно копие) | HACS е инсталиран; `https://github.com/PasevSU/hapi-enterprise-integration` е добавен като **custom repository** с категория Integration |

## 5. Двете решения (изберете едно за всяко от двете)

### 5.1 Add-on — през хранилище (единственото, което дава „Обнови“)

1. Settings → Add-ons → Add-on store → ⋮ → **Repositories** → добавя се
   `https://github.com/PasevSU/hAPI` → Add.
2. Отваря се страницата на хранилището → **hAPI Enterprise** → **Install**.
   Supervisor тегли готовия образ (`image:` в `config.yaml`), тоест не строи нищо локално.
3. След това локалните папки в `/addons` трябва да **изчезнат** от store-а, иначе двете
   инсталации изглеждат като два add-on-а с едно и също име. Прави се с
   `pwsh -NoProfile -File scripts/apply-update.ps1 -Mode Addon -Execute` (преименува ги на
   `*.local-<версия>.bak`; нищо не се трие) — виж §7.
4. Оттук нататък при всяко издание картата на add-on-а показва **Обнови**.

### 5.2 Интеграция — през HACS

1. Инсталира се HACS (ако липсва) и се рестартира Home Assistant.
2. HACS → ⋮ → **Custom repositories** → `https://github.com/PasevSU/hapi-enterprise-integration`,
   категория **Integration**.
3. HACS → hAPI Enterprise → **Download** — HACS пише в `custom_components/hapi_enterprise` и
   оттам нататък сам предлага новите версии (теглене на release `vX.Y.Z`, който release.yml
   създава; `manifest.json` в хранилището носи същата версия).
4. Ръчното копие се подменя от HACS при първата инсталация; ако HACS откаже заради
   „already exists“, папката се изтрива и се инсталира наново.

### 5.3 Междинен вариант, когато HACS не се иска

`scripts/apply-update.ps1` копира файловете по SMB и **сверява всеки файл байт по байт**.
Това не създава автоматично обновяване — то само прави „сега е актуално“ с доказателство.

## 6. Как се проверява, че е станало

| Проверка | Очакван резултат |
| --- | --- |
| Settings → Add-ons → hAPI Enterprise | версия **0.69.200** (или по-нова), бутон **Обнови** при ново издание |
| `X:\custom_components\hapi_enterprise\manifest.json` | `"version": "0.69.200"` |
| Developer Tools → States → `update.hapi_enterprise_update` | `installed_version` = `latest_version` |
| HACS → hAPI Enterprise (ако се ползва HACS) | „Installed: 0.69.200“, без червено предупреждение |

## 7. Скриптът

```
pwsh -NoProfile -File scripts/apply-update.ps1                       # само проверява (dry run)
pwsh -NoProfile -File scripts/apply-update.ps1 -Mode Verify          # същото, изрично
pwsh -NoProfile -File scripts/apply-update.ps1 -Mode Integration -Execute
pwsh -NoProfile -File scripts/apply-update.ps1 -Mode Addon -Execute  # преименува локалните папки
pwsh -NoProfile -File scripts/apply-update.ps1 -Mode Both -Execute   # интеграция + локални папки
```

Какво прави:

1. чете версията от `hapi_enterprise/config.yaml` (един източник на истина);
2. проверява изданието в GitHub: release не е чернова, артефактите са налице, `repository.yaml`
   е в корена, интеграционното хранилище има същата версия в `manifest.json`;
3. проверява **GHCR** за трите архитектури (`amd64`, `aarch64`, `armv7`) с анонимен pull
   токен — това е точно това, което Supervisor ще направи при „Обнови“;
4. описва състоянието на инстанцията: има ли `repository.yaml` в `/addons`, кои са локалните
   папки, каква версия е интеграцията, има ли HACS;
5. с `-Execute`: копира интеграцията (`Integration`) и/или преименува локалните add-on папки
   (`Addon`) и **сверява всеки файл по SHA-256**; при разлика излиза с код 1.

Скриптът не натиска бутони в интерфейса и не се опитва да влезе в API-то на Home Assistant:
програмният вход през `trusted_networks` е измерено невъзможен на тази инсталация (всеки
вариант на тялото връща 400 `User input malformed`), затова стъпките от §5.1 и §5.2 остават
ръчни — те са две отметки и едно рестартиране.

## 8. Какво още може да блокира обновяването (проверява се при симптом)

| Симптом | Причина | Проверка |
| --- | --- | --- |
| Картата показва стара версия, няма „Обнови“ | add-on е локална папка | `Test-Path \\<host>\ADDONS\repository.yaml` |
| „Обнови“ има, но тегленето пада | образът за тази архитектура липсва в GHCR | `ghcr.io/v2/pasevsu/<arch>-addon-hapi_enterprise/manifests/<версия>` |
| Два add-on-а с едно име | остаряла локална папка до инсталирания от хранилище | `Get-ChildItem \\<host>\ADDONS -Directory` |
| HACS не вижда интеграцията | хранилището не е добавено като custom repository или категорията не е Integration | HACS → ⋮ → Custom repositories |
| HACS вижда, но не предлага обновяване | release-ът е чернова или тагът не съвпада с `manifest.json` | `gh release view vX -R PasevSU/hapi-enterprise-integration` |
| След рестарт интеграцията е стара | ръчно копие е подменено от HACS или обратно | `manifest.json` в `/config/custom_components/hapi_enterprise` |
