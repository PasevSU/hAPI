# hAPI ENTERPRISE — File Delivery & Export Manager + Download Access Control

> **Статус:** приет план (изпълнителен). Транскрипция на спецификацията „Enterprise
> Specification · File Delivery & Export Manager · Проектна спецификация v1.0“ и на
> „управление на достъпността за изтегляне“, дадени от собственика на 2026-10-20, с карта
> към текущото репо и етапи на изпълнение.
> **Връзки:** [`15-unified-master-plan-v6.0.md`](15-unified-master-plan-v6.0.md),
> [`16-implementation-plan-from-chat.md`](16-implementation-plan-from-chat.md),
> [`17-portal-files-management-plan.md`](17-portal-files-management-plan.md) (F-серия:
> файлове и управление), [`18-enterprise-control-center-plan.md`](18-enterprise-control-center-plan.md)
> (Report Studio), [`20-unified-plan-v7.md`](20-unified-plan-v7.md) (програмен план и двата канала),
> [`../../documentation/03_ADR/ADR-0026-public-gateway-and-digital-delivery.md`](../../documentation/03_ADR/ADR-0026-public-gateway-and-digital-delivery.md).

---

## 1. Основна цел

Изтеглянето не е бутон „Download“, а **контролиран процес**: създаване → удостоверяване →
съхранение → предоставяне. Двата модула са задължителен компонент на Enterprise изданието:

- **File Delivery & Export Manager** — единен интерфейс за трансфер с отделни адаптери за
  Windows, USB, SMB/NAS, Home Assistant и браузър.
- **Download Access Control** — централни правила за достъпност, прилагани на няколко нива
  (system → storage → portal → folder → file → user/role → token → session).

### 1.1 Инварианти (от правилата на спецификацията)

| # | Правило | Как се налага |
| - | ------- | ------------- |
| 1 | Изтеглянето не променя оригинала | трансферът е read-only; източникът се отваря само за четене |
| 2 | Оригинали и резултати се съхраняват отделно | `originals/` и `report/` са различни клони на пакета |
| 3 | Всеки изходен файл има ID и собствен SHA-256 | `PACKAGE_INDEX.json` записва `path/size/sha256/kind/source/verified` |
| 4 | Без презапис без изрична политика; за доказателства — забранено | `overwrite:false` по подразбиране, `evidence.overwrite:'forbidden'` |
| 5 | Изтегляне и генериране са отделни операции | `Generate PDF` и `Export …` са различни действия (Report Studio §9) |
| 6 | Проверката на цялостта е задължителна за доказателствени пакети | `requiresVerification()` форсира `verify_sha256`, GUI не може да го изключи |
| 7 | Всички файлови операции се одитират | `auditRecord()` за всяка задача; `download_audit.json` |
| 8 | При прекъсване няма успешен трансфер | финализиране само след `VERIFYING`; иначе `FAILED`/`RECOVERY_REQUIRED` |
| 9 | Имена и пътища се валидират преди запис | `safeSegment`/`safeRelPath` + Windows резервирани имена + case-fold колизии |
| 10 | Нито един бутон не е декоративен | всеки GUI бутон или изчислява реално, или е надписан „планирано“ |

---

## 2. Режими на изтегляне (12)

| Режим | Format | Съдържание | Право | Проверка |
| ----- | ------ | ---------- | ----- | -------- |
| Single File | FILE | `originals` | `files.download` | по избор |
| Selected Files | ZIP | `originals` | `files.download` | по избор |
| Full Report | ZIP | `pdf`, `manifest` | `reports.export` | по избор |
| Evidence Package | ZIP | `pdf`, `manifest`, `hashes`, `timestamps`, `originals`, `audit`, `certificates` | `evidence.export` | **задължителна** |
| Manifest Only | JSON | `manifest` | `reports.export` | по избор |
| Certificates | ZIP | `certificates`, `timestamps` | `audit.export` | **задължителна** |
| PDF Export | PDF | `pdf` | `reports.export` | по избор |
| Template Export | JSON | `templates` | `templates.export` | по избор |
| Project Backup | ZIP | `originals`, `manifest`, `audit` | `backups.create` | **задължителна** |
| Audit Export | JSON | `audit` | `audit.export` | **задължителна** |
| Bulk Export | ZIP | `originals` | `bulk.export` | по избор |
| Verified Transfer | FOLDER | `originals` | `files.download` | **задължителна** |

Режимът не е „етикет“: той определя формата, съдържанието, правото и дали проверката е
задължителна. `requiresVerification(mode)` е единственият източник на тази истина.

---

## 3. Графични панели

### 3.1 Export & Download Center (`ui/export-center.js`, навигация „Експорт“)

- режим (12), съдържание (8 категории), формат, местоназначение;
- политика при съществуващ файл: **ново уникално име / пропусни и регистрирай / прекрати**;
- „Проверка на SHA-256 след запис“ — заключена вкл. за доказателствени режими;
- „Read-only атрибут, когато се поддържа“;
- име на пакета (`RPT-YYYYMMDD-HHMMSS-CASE`), дърво на пакета, `PACKAGE_INDEX.json`;
- ред с обобщение: `Избрани категории: 5 · Формат: ZIP · SHA-256: Включена · Цел: FOLDER`;
- „Копирай конфигурацията като JSON“ (реален clipboard) и сваляне на `export_config.json`;
- списък `capabilities` с изричен надпис „планирано“, за да няма фиктивни функции.

### 3.2 Download Access Control (`ui/download-access.js`, навигация „Достъп“)

- ниво портал: режим (`FREE` / `KEY_REQUIRED` / `AUTHENTICATED` / `PRIVATE` / `DISABLED`),
  валидност (дни), максимални изтегляния, парола, проверка при предоставяне, одит;
- ниво файл: демонстрационни файлове `Public_Report.pdf` (FREE), `Evidence_Package.zip`
  (KEY_REQUIRED), `Internal_Audit.json` (PRIVATE), `Revoked_File.pdf` (DISABLED);
- **преглед на решението**: контекст (потребител/токен/право) → `allowed` + `reason` +
  пълен списък проверки; показва, че файловата политика може да е по-строга от портала;
- състояния в GUI: публичен, изисква ключ, ограничен, изтекъл, отозван, изчерпан лимит,
  забранен;
- „Копирай правилата като JSON“.

Панелите са **интерактивни модели** (без реален трансфер). Реалното прилагане е в backend
(§11) — GUI никога не е достатъчен контрол.

---

## 4. Именуване и структура на пакета

```
RPT-20261020-174800-CASE001/
├── report/          forensic_report.pdf
├── manifest/        input_manifest.json, result_manifest.json
├── timestamps/      start.tsr, stop.tsr
├── hashes/          sha256sum.txt
├── certificates/    (сертификати и проверки)
├── audit/           export_audit.json
├── originals/       (само при изрично включване)
├── templates/       (само при Template Export)
└── PACKAGE_INDEX.json
```

Правила: без `../` и абсолютни пътища в архива; без Windows резервирани имена
(`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`); без крайни точки/интервали; без два файла,
които се различават само по главни/малки букви; дължина на относителен път ≤ 240 знака.

---

## 5. Среди и адаптери

| Среда | Механизъм |
| ----- | --------- |
| Windows локално | избор на директория, проверка на права и свободно място, дълги пътища, без UNC като cwd на `cmd.exe` |
| USB | проверка на файлова система, наличност, капацитет; временен файл + финализиране |
| SMB / NAS | проверка на връзка/разрешения; възстановяване при прекъсване |
| Home Assistant | само разрешени директории и storage mounts |
| Browser | поточно предаване, контрол на достъпа, коректно име на файла |

**Един интерфейс, отделни адаптери.** Интерфейсът е фиксиран:

```
preflight(ctx) → { ok, blockers[], warnings[] }
copy(entry, ctx) → { ok, bytes, sha256, tempPath }
verify(entry, ctx) → { ok, reason }
finalize(entry, ctx) → { ok, finalPath }
```

`hapi_enterprise/export-manager.js` съдържа общия state machine и „локален файлов“ адаптер,
който е еднакъв за Windows/USB/NAS (разликите са само в preflight проверките). HA адаптерът
ще налага allowlist от `download_rules.json` (`storage.allowed_roots`).

---

## 6. Контрол на целостта (фиксирана последователност)

1. проверка на източника и правата за четене;
2. SHA-256 на източника;
3. запис във временен файл (`.part`);
4. flush + затваряне на дескриптора;
5. повторно SHA-256 на записаното копие;
6. сравняване на размер и хеш;
7. финализиране (атомарно преименуване) + одитен запис.

Съвпадащ SHA-256 доказва идентичност на байтовете с избрания източник, но **не** доказва
произхода на източника — това остава задача на RFC 3161/подписа (Report Studio).

---

## 7. Права и йерархия

| Право | Описание |
| ----- | -------- |
| `files.read` | преглед |
| `files.download` | изтегляне |
| `reports.export` | експорт на отчет |
| `evidence.export` | експорт на доказателства |
| `templates.export` | експорт на шаблони |
| `audit.export` | експорт на логове |
| `backups.create` | създаване на архив |
| `bulk.export` | групов експорт |

Йерархия: **system → storage → portal → folder → file → user/role → token → session**.
Сливане: **най-строгата политика печели** (`FREE < KEY_REQUIRED < AUTHENTICATED < PRIVATE <
DISABLED`). Достъп се дава само когато **всички** приложими проверки минат. Индивидуален
файлов ключ не може да заобиколи системна забрана или липсващо право.

Публичните портални токени не дават достъп до вътрешни forensic/audit файлове: те имат
собствен обхват (`scope`), а `evidence.export`/`audit.export` не се наследяват от портален ключ.

---

## 8. Състояния и възстановяване

```
QUEUED → PREFLIGHT → COPYING → VERIFYING → FINALIZING → COMPLETED
                       ↘ FAILED / CANCELLED / RECOVERY_REQUIRED
```

Журналът пази: `operation_id`, източник, цел, размер, очакван хеш, записани байтове, статус,
грешка. При рестарт незавършените операции се проверяват; възобновяване само когато
частично записаните данни могат да бъдат проверени надеждно (`resume()`).

---

## 9. Report Studio — четири отделни действия

| Действие | Какво прави | Статус |
| -------- | ----------- | ------ |
| **Save Template** | записва структурата (без START/STOP) | ✅ `Export Manifest` днес; отделен шаблон — FD-8 |
| **Export Manifest** | JSON конфигурация | ✅ `report-manifest.js` + GUI |
| **Generate PDF** | процесна верига → документ | 🟡 PDF без подпис (RS-05) |
| **Export Evidence Package** | събира реално наличните артефакти | 🟡 планът + правилата са готови (FD-7) |

Ако START или STOP липсва, пакетът **не** се обозначава като криптографски завършен;
възможен е диагностичен пакет с видим статус `INCOMPLETE` и в GUI, и в `PACKAGE_INDEX.json`.
Предварителен PDF се обозначава `DRAFT` и не може да бъде публикуван като удостоверен.

---

## 10. Enterprise опции = capabilities

Компресия (нива), разделяне на големи архиви, проверка на всяка част, ограничаване на
скоростта, паралелни трансфери, изчисляване на нужното място, криптиране на пакета,
retention на временните файлове. Всички са **отделни способности** с `implemented` флаг;
докато флагът е `false`, GUI показва „планирано“, а `normalizeConfig` не ги приема като активни.

---

## 11. Конфигурация и схеми (създадени в този етап)

```
config/
├── rules/
│   ├── download_rules.json        глобални правила (презапис, проверка, именуване, temp, retention)
│   ├── download_access.json       системен default + йерархия на нивата
│   ├── portal_policies.json       политика за портал
│   ├── file_permissions.json      индивидуални файлови политики
│   ├── token_policies.json        TTL, лимити, обхват, отзоваване
│   ├── rate_limits.json           лимити и блокиране
│   ├── download_audit.json        какво се одитира
│   ├── export_permissions.json    право → режими/роли
│   ├── export_profiles.json       12 режима (единствен източник за GUI и backend)
│   └── public_gateway.json        портове, изолация, токен схема, маршрути (PG-0)
└── schemas/
    ├── package_manifest.schema.json
    └── transfer_state.schema.json
```

Файловете са декларативни; прилагането е в backend. GUI чете същите стойности чрез
`HapiExportRules`/`HapiDownloadAccess` (UMD), а `tests/export-config.cjs` проверява, че
JSON файловете и модулните default-и не се разминават.

---

## 12. Карта към репото

| Компонент | Днес | Ново в този етап |
| --------- | ---- | ---------------- |
| правила за експорт | ❌ | `hapi_enterprise/export-rules.js` |
| политики за достъп | 🟡 `fileMode()` (FREE/KEY_REQUIRED/DISABLED) в `server.js` | `hapi_enterprise/download-access.js` (5 режима, 8 нива) |
| трансфер/проверка | 🟡 `streamDownload`, `verifyPortalFiles` | `hapi_enterprise/export-manager.js` (state machine + verified copy) |
| GUI | ❌ | `ui/export-center.js`, `ui/download-access.js` |
| конфигурация | ❌ | `config/rules/*`, `config/schemas/*` |
| тестове | ❌ | `tests/export-rules.cjs`, `tests/download-access.cjs`, `tests/export-manager.cjs`, `tests/export-config.cjs` |
| backend endpoints | 🟡 `streamDownload`, `verifyPortalFiles` | ✅ FD-6: `GET /admin/api/v2/export/rules`, `POST /admin/api/v2/export/preflight`, публичен gateway :8088 |

---

## 13. Етапи на изпълнение

| Етап | Обхват | Резултат |
| ---- | ------ | -------- |
| **FD-0** | правила и модели | `export-rules.js`, `download-access.js`, конфигурационни файлове и схеми |
| **FD-1** | трансферно ядро | `export-manager.js`: state machine, preflight, verified copy, индекс, одит |
| **FD-2** | GUI модели | Export & Download Center + Download Access Control (интерактивни, без трансфер) |
| **FD-3** | тестове L1–L4 | 4 нови теста, покриващи правила, йерархия, колизии, state machine |
| **FD-4** | интеграция с Report Studio | Evidence Package от манифеста; `DRAFT`/`INCOMPLETE` статуси |
| **FD-5** | портални файлове | действията от план 17 (Преглед/Изтегли/Версии/…) минават през `decide()` |
| **FD-6** | backend endpoints | реално прилагане: preflight, стартиране на задача, отказ при липсващо право |
| **FD-7** | адаптери | HA allowlist, SMB reconnect, USB preflight, browser streaming |
| **FD-8** | шаблони | `Save Template` + профили (план 18, RS) |
| **FD-9** | enterprise опции | компресия/части/криптиране/лимити — всяка със собствен флаг и тест |

### Критерии за приемане на FD-0…FD-3

1. `node scripts/run-tests.cjs` е зелен (всички тестове, не само новите).
2. `normalizeConfig` форсира `verify_sha256:true` за доказателствени режими, независимо от входа.
3. `decide()` отказва при: system забрана, `DISABLED`, липсващо право, невалиден/изтекъл/
   отзован/изчерпан токен, извън времеви прозорец, IP в denylist, над лимит.
4. `decide()` не разрешава на файлова политика да е по-слаба от порталната (сливане „най-строга“).
5. `copyVerified` не оставя финален файл при грешка; временният файл е с `.part` и се чисти.
6. `PACKAGE_INDEX.json` съдържа за всеки файл `path`, `size`, `sha256`, `kind`, `source`, `verified`.
7. Имена: `CON.pdf`, `a/../../b.pdf`, `C:\x.pdf`, `file.`, двойка `A.pdf`/`a.pdf` → отказ/уникализиране.
8. Нито един GUI бутон не твърди трансфер, който не се извършва.

---

## 14. Тестови нива

| Ниво | Какво покрива |
| ---- | ------------- |
| L1 | чисти функции: режими, съдържание, именуване, safe paths, capabilities |
| L2 | йерархия и сливане на политики; пълен `decide()` матрица |
| L3 | state machine: легални/нелегални преходи, resume, cancel |
| L4 | реален файлов тест в `os.tmpdir()`: verified copy, колизия, прекъсване, индекс |
| L5 | backend endpoints (FD-6) |
| L6 | E2E в GUI (ръчно + browser проверка) |

---

## 15. Извън обхват / рискове

- **Не** се въвежда втори файлов формат за архиви — ZIP остава единственият за пакети.
- Географски ограничения — само при надежден източник на геолокация; иначе не се показват.
- IP ограниченията не са защита срещу подправен `X-Forwarded-For`; изисква се доверен proxy.
- SHA-256 не доказва произход (само идентичност на байтовете).
- GUI не е контрол: всички решения се вземат повторно в backend при всяка заявка.
- `capabilities` с `implemented:false` не се показват като работещи (правило 10).
