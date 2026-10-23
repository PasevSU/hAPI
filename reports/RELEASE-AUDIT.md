# Одит на изданията — какво е имало и го няма

Сравнение на всички тагове (62) с `HEAD` (3944aad).

| Таг | файлове | функции | секции в панела | опции |
| --- | --- | --- | --- | --- |
| v0.69.45 | 146 | 1442 | 17 | 33 |
| v0.69.46 | 148 | 1451 | 17 | 33 |
| v0.69.47 | 148 | 1451 | 17 | 33 |
| v0.69.48 | 148 | 1451 | 17 | 33 |
| v0.69.49 | 149 | 1468 | 17 | 33 |
| v0.69.50 | 149 | 1468 | 17 | 33 |
| v0.69.51 | 149 | 1469 | 17 | 33 |
| v0.69.52 | 150 | 1484 | 17 | 33 |
| v0.69.53 | 150 | 1487 | 17 | 33 |
| v0.69.54 | 152 | 1495 | 17 | 33 |
| v0.69.55 | 152 | 1498 | 17 | 33 |
| v0.69.56 | 152 | 1498 | 17 | 33 |
| **HEAD** | **152** | **1498** | **17** | **33** |

## Изчезнали файлове
- `custom_components/portal_enterprise/__init__.py` (имаше го в v0.54.0)
- `custom_components/portal_enterprise/config_flow.py` (имаше го в v0.54.0)
- `custom_components/portal_enterprise/const.py` (имаше го в v0.54.0)
- `custom_components/portal_enterprise/coordinator.py` (имаше го в v0.54.0)
- `custom_components/portal_enterprise/manifest.json` (имаше го в v0.54.0)
- `custom_components/portal_enterprise/portal.css` (имаше го в v0.54.0)
- `custom_components/portal_enterprise/portal.html` (имаше го в v0.54.0)
- `custom_components/portal_enterprise/portal.js` (имаше го в v0.54.0)
- `custom_components/portal_enterprise/sensor.py` (имаше го в v0.54.0)
- `custom_components/portal_enterprise/strings.json` (имаше го в v0.54.0)
- `custom_components/portal_enterprise/translations/bg.json` (имаше го в v0.54.0)
- `hapi_enterprise/admin.html` (имаше го в v0.63.0)
- `hapi_enterprise/admin.js` (имаше го в v0.63.0)

## Изчезнали функции (файлът съществува, функцията — не)
- `hapi_enterprise/ooxml.js:t` (имаше я в v0.69.13)
- `hapi_enterprise/pdf-writer.js:rows` (имаше я в v0.63.0)
- `hapi_enterprise/preview.js:rows` (имаше я в v0.69.13)
- `hapi_enterprise/server.js:releaseDownloadSlot` (имаше я в v0.69.53)
- `hapi_enterprise/server.js:acquireDownloadSlot` (имаше я в v0.69.53)
- `hapi_enterprise/server.js:streamDownload` (имаше я в v0.69.53)
- `hapi_enterprise/server.js:loginGate` (имаше я в v0.69.14)
- `hapi_enterprise/ui/app.js:statsHtml` (имаше я в v0.67.0)
- `hapi_enterprise/ui/app.js:tableHtml` (имаше я в v0.67.0)
- `hapi_enterprise/server.js:withSecretLock` (имаше я в v0.69.42)
- `hapi_enterprise/shared-data.js:equal` (имаше я в v0.69.18)
- `hapi_enterprise/shared-data.js:mergeLists` (имаше я в v0.69.18)
- `hapi_enterprise/shared-data.js:merge` (имаше я в v0.69.18)
- `hapi_enterprise/shared-data.js:giveUp` (имаше я в v0.69.18)

## Изчезнали секции в панела
- няма

## Изчезнали опции на add-on-а
- `visitor_trust_proxy`

## Б. Спецификация срещу код — какво е обещано и го няма

### Б.1 Експортни способности (`export-rules.js`) — обявени за „планирано“

| id | Какво липсва |
| --- | --- |
| `resume_transfer` | Възобновяване на прекъснат трансфер |

### Б.2 Report Studio (`ui/report-objects.js`) — изключени типове

| тип | Обект |
| --- | --- |
| `logo` | Лого |
| `certificate` | Сертификат (X.509) |
| `columns` | Колони |
| `dynamic` | Динамичен блок |

### Б.3 Документирани, но нереализирани функции

| Идентификатор | Какво е |
| --- | --- |
| FD-7 | адаптер за мрежово (SMB) хранилище |
| FD-8 | адаптер за USB хранилище |
| FD-9 | „Save Template“ в Document Generator |
| RS-06 | валидация на PDF/A-3 с veraPDF |
| W8/F9 | Windows Edition и опаковане |

### Б.4 Проверено и НЕ е липса

| Изчезнало | Защо не е проблем |
| --- | --- |
| `custom_components/portal_enterprise/*` | преименувано на `hapi_enterprise`; същите файлове съществуват под новото име |
| `admin.js`, `admin.html` | старият панел, премахнат съзнателно в 0.69.8; заместен от `ui/` |
| `server.js:loginGate` | входът с парола не съществува; ограничението на опитите е по самоличност (`adminGate`) |
| `server.js:withSecretLock` | изнесено в `secret-lock.js` (0.69.43), с тест |
| `shared-data.js:merge/mergeLists/equal/giveUp` | заменени от `reconcile()` + `clone()`, покрити от 6 теста |
| `ooxml.js:t`, `pdf-writer.js:rows`, `preview.js:rows`, `ui/app.js:statsHtml/tableHtml` | локални помощни функции, преименувани/инлайн |
| опция `visitor_trust_proxy` | премахната съзнателно в 0.69.27; живее в конзолата и като `TRUST_PROXY` |

