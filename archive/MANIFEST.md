# Archive Manifest — инвентар на старите артефакти

> Съответства на §1 (инвентар) и §9 (трассируемост) от
> [`docs/plan/15-unified-master-plan-v6.0.md`](../docs/plan/15-unified-master-plan-v6.0.md).
> Решения: `KEEP` · `MERGE` · `DROP` · `DEFER`.

## A. Активни източници (не са архив)

| Източник | Съдържание | Решение |
| --- | --- | --- |
| `hapi_enterprise/` | Backend, ~40 модула | `KEEP` |
| `custom_components/hapi_enterprise/` | HA мост към публичното API | `KEEP` |
| `tests/*.cjs` | 76 интеграционни теста | `KEEP` |
| `docs/plan/00…15` | Изискване → v5.0 → фази 4–7 → обединен план v6.0 | `KEEP` |
| `documentation/00…08` | Governance, ADR-0001…0024, миграция, тестове, release | `KEEP` |

## B. Worktree `hAPI Enterptice.worktrees/pr/3-dependabot`

| Артефакт | Съдържание | Решение | Фаза |
| --- | --- | --- | --- |
| `.github/workflows` | Dependabot PR | `MERGE` | 10 |

## C. `hapi_old/hAPI_enterprice` (v0.43-rc7)

| Артефакт | Съдържание | Решение | Фаза |
| --- | --- | --- | --- |
| `build.cjs`, `build-release.cjs`, `build-platforms.cjs` | 6 пакета от един build | `MERGE` | 9 |
| `hacs.json`, `repository.yaml`, `install.bat`, `START_WINDOWS.bat` | Дистрибуция | `MERGE` | 9 |
| `Brand_Kit/`, `img/` | Бранд | `MERGE` | 9 |
| `01…08 *.png` (8 екрана) | UI макети | `DEFER` (UX референция) | 10 |
| `hAPI_enterprice.7z`, `hAPI_enterprice-v0.43-rc7.zip` | Бинарни пакети | `DROP` от git | — |
| `BG.md`, `DE.md`, `README.md`, `SECURITY.md`, `LICENSE` | Документация | `KEEP` | — |

## D. `hapi_old/hAPI_Enterptice_v0.47_snapshot`

| Артефакт | Съдържание | Решение | Фаза |
| --- | --- | --- | --- |
| `sdk/client.mjs` | `PortalClient` — първи публичен клиент | `MERGE` (копиран в `archive/SDK/`) | 8 |
| `ui/` (`Start_hAPI_ENTERPRICE.pyw`, `runtime.js`, `live.js`, `lang.js`, `styles.css`) | Desktop обвивка (PyWebView) | `MERGE` | 9 |
| `gui/` (`hapi-core.js`, 8 panel JS, `launch.html`) | Макет „8 Separate JS Panels“ | `DEFER` | 10 |
| `download_portal/` | Backend v0.47 | `DROP` | — |
| `release/` | Стари пакети | `DROP` (виж `RELEASES.md`) | — |

## E. `hapi_old/HAPI.SU` (v0.49.1)

| Артефакт | Съдържание | Решение | Фаза |
| --- | --- | --- | --- |
| `ANALYSIS.md` | Критичен анализ, 13 находки | `MERGE` (копиран в `archive/ANALYSIS-v0.49.1.md`) | 10 |
| `sdk/client.mjs` | Същият клиент | `MERGE` | 8 |
| `custom_components/portal_enterprise/` | Стар HA мост | `DROP` | — |
| `runtime/node.exe` (85 MB) | Node runtime | `DROP` от git (сваля се при билд) | 9 |
| `ui/` | Desktop UI | `MERGE` | 9 |
| `download_portal/` | Стар backend (76 KB `server.js`) | `DROP` | — |
| `release/` (~40 архива, ~660 MB) | История на пакетите | `DROP` от git (виж `RELEASES.md`) | — |
| `ADMIN_TOKEN.txt` | Локален тестов токен | `DROP` (**не се копира**) | — |

## F. `hapi_old/hAPI_Enterptice_v0.47_snapshot/release`, `HAPI.SU/ha-portal-enterprise-v0.42-rc6*`

| Артефакт | Решение |
| --- | --- |
| Стари `.zip` / `.7z` пакети | `DROP` от git; запис в `RELEASES.md` |

## G. `hapi_old/doku/plan`

| Артефакт | Съдържание | Решение |
| --- | --- | --- |
| `plan001_чернова.txt`, `plan001_v1.0.md` | Първоначална визия | `KEEP` като история (дубликат на `docs/plan/01-specification-v1.0.md`) |
| `v2.0.md` … `v4.3.md` | DOCFLOW → DDD → Multi-tenancy → Zero Trust | `KEEP` като история (дубликати на `docs/plan/02…07`) |
| `v4.4.md` (0 байта) | Празен | `DROP` |

> Забележка: съдържанието на `doku/plan/v1.0…v4.3` вече е пренесено в `docs/plan/`
> (`01-specification-v1.0.md` … `07-security-v4.3.md`). Приетите идеи са отразени в §9
> на обединения план; отхвърлените (`data JSONB`, microservices, polyglot) са `DROP`.

## H. `hapi_old/portal_enterprise`

| Артефакт | Съдържание | Решение |
| --- | --- | --- |
| `.first-run-done` (24 B) | Маркер, без код | `DROP` |

## I. ChatGPT разговор (публичен share, прочетен 2026-10-20)

`https://chatgpt.com/share/6ad77e1b-6d28-83ed-862b-f3ca3e73586c` (7–10.10.2026)

| Тема | Артефакт | Решение | Фаза |
| --- | --- | --- | --- |
| Публично API на портал + токен | `/api/v1/p/{slug}`, `openapi.json`, `api-version.js`, HA мост, `archive/SDK/client.mjs` | `KEEP` + разширяване | 8 |
| Липсва в API-то | scoped токени, `problem+json`, idempotency, webhooks, SDK пакет | `MERGE` | 8 |
| Enterprise Dashboard (визуален дизайн) | 12–13 панела, тъмна enterprise тема | `MERGE` | 10 |
| Standalone JS GUI | без npm/backend, `localStorage`, JSON експорт | `MERGE` | 10 |
| Report Studio | библиотека + подредба + свойства + A4 preview, `RFC 3161 START→STOP`, JSON манифест, 8 елемента | `MERGE` | **11** |
| Банеры | 2 издания × 3 езика, 1280×640 Open Graph | `MERGE` | 9 |
| Windows WebView2 | `Install_GUI_Dependency.bat`, `Start_hAPI_ENTERPRICE.bat`, pywebview | `MERGE` | 9 |
| Референтен пакет `HASH_REPORT_ENTERPRICE.7z` | report profiles, тема, PDF проверки, RFC 3161 | `DROP` — **отделен проект, не е част от hAPI** | — |
| Правило „без фалшиви RFC 3161 токени“ | — | `KEEP` (задължително) | 11 |

## J. Какво НЕ се копира в git

- Бинарни release пакети (`.zip`, `.7z`, `.exe`) — ~660 MB.
- `node.exe` (85 MB) и други runtime бинари.
- `ADMIN_TOKEN.txt` и всякакви локални тайни.
- `__pycache__/`, `*.pyc`.

## K. Проверка

Всеки ред по-горе трябва да има решение. Ако откриеш артефакт без ред — добави го тук
преди да го изтриеш или преместиш.
