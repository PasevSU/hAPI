# hAPI ENTERPRISE — цялостен план до Enterprise Control Center

> **Статус:** приет план (изпълнителен). Транскрипция на спецификацията, дадена от
> собственика на 2026-10-20, с добавена карта към текущото репо.
> **Връзки:** [`15-unified-master-plan-v6.0.md`](15-unified-master-plan-v6.0.md) (обединен roadmap),
> [`16-implementation-plan-from-chat.md`](16-implementation-plan-from-chat.md) (виртуално хранилище),
> [`17-portal-files-management-plan.md`](17-portal-files-management-plan.md) (портали/файлове/управление).

---

## 1. Основна цел

Модулна Enterprise платформа с **единна визуална система**, а не поредица добавки към стар
интерфейс. Целевият продукт:

- **Windows Edition** — самостоятелен прозорец (`.pyw` + WebView2), без браузър и без HTTP сървър.
- **Home Assistant Edition** — същият дизайн, собствен runtime адаптер.
- **Report Studio** — визуално конструиране на отчети чрез блокове, таблици, профили и
  JSON манифести, при строга последователност `RFC 3161 START → процесни модули → RFC 3161 STOP`.

### Принципи

1. Единна визуална система (цветове, типография, размери, компоненти).
2. Всеки панел е независим модул — отделен JS файл + декларативна конфигурация.
3. GUI и логика са разделени — интерфейсът работи с демо данни без backend.
4. Windows без браузър/HTTP сървър; `.bat` е стартер и инсталатор.
5. Home Assistant е отделен runtime със същата дизайн система.
6. **Manifest-driven** Report Studio.
7. Централизирано оформление (A4, header/footer, таблици, номерация, QR).
8. Без фиктивни функции — демото е надписано; release само след тестове.

---

## 2. Навигация — 15 панела

| № | Панел | Предназначение | В репото днес |
| - | ----- | -------------- | ------------- |
| 01 | Dashboard | статус, ресурси, бързи действия | ✅ обвивка |
| 02 | File Portals | портали, ключове, QR, статистика | 🟡 демо + API генератор |
| 03 | PGP / Keys | OpenPGP идентичности и ключове | ❌ нов |
| 04 | Encrypt / Sign | криптиране, подписване, проверка | ❌ нов |
| 05 | OTS / Blockchain | изолиран модул | ❌ нов |
| 06 | RFC 3161 Timestamp | TSA профили, токени, проверки | ❌ нов |
| 07 | Forensic Analysis | файлови и метаданни анализи | ❌ нов |
| 08 | Metadata / EXIF | извличане и сравнение | 🟡 частично (preview/meta) |
| 09 | Hash Generator | алгоритми, хеширане, сравнение | 🟡 backend `integrity` |
| 10 | Reports / PDF | история и експорт | 🟡 Report Studio |
| 11 | Report Studio | визуален конструктор | ✅ прототип |
| 12 | Profiles / Templates | профили, шаблони, версии | ❌ нов |
| 13 | Tasks / Automation | задачи и изпълнение | 🟡 backend jobs |
| 14 | Settings / System | настройки, диагностика, логове | 🟡 демо |
| 15 | About / NOTICE | версия, лиценз, third-party | ✅ |

**Правило:** всеки съществуващ модул се **картографира** към новата навигация без загуба на
функционалност. Старите 13 панела не се смесват безконтролно с новите.

---

## 3. Фази 0–11

| Фаза | Съдържание | Резултат |
| ---- | ---------- | -------- |
| 0 | Инвентаризация и замразяване на изискванията | `REQUIREMENTS.md`, `FEATURE_MATRIX.json`, `ARCHITECTURE.md`, `MIGRATION_MAP.json` |
| 1 | Архитектурен скелет (без копиране на стари HTML) | `ui/core/*`, `config/*`, `runtime/*`, `services/*`, `manifests/*`, `templates/*` |
| 2 | Enterprise Design System | `ui/styles/{tokens,layout,components,themes}.css` |
| 3 | Windows приложение | `.pyw` + WebView2, позиция/размер, диагностика |
| 4 | 15 панела | договор: `id/title/icon/render/mount/unmount/permissions/capabilities` |
| 5 | Report Studio: библиотека с обекти | текст/данни/таблици/медия/сертификати/оформление/правни/динамични |
| 6 | Manifest Engine | `manifest.schema.json`, проверки, миграции |
| 7 | Визуален редактор | избор, преместване, дублиране, свойства, Undo/Redo |
| 8 | A4 Preview + PDF правила | 20/20/25/15 mm, header/footer, X/Y, повторение на заглавия |
| 9 | RFC 3161 интеграция | START/STOP като криптографска граница |
| 10 | Home Assistant runtime | Supervisor/Ingress/API/storage |
| 11 | Одит, тестове, Release Gate | L1–L9 PASS |

### Критерий за успех (финален)

> Потребителят стартира Windows приложението, отваря Report Studio, създава отчет от блокове
> и таблици, запазва манифест, проверява го, изпълнява `START → Modules → STOP` и получава
> **проверим PDF**, без ръчна редакция на код.

---

## 4. Report Studio — правила

### 4.1 Разделяне на понятията

| Понятие | Значение |
| ------- | -------- |
| **Обект** | визуален елемент в отчета |
| **Процесен модул** | изпълнява реална операция |
| **Data Binding** | свързва резултата от процеса с обекта |
| **Manifest** | структура, зависимости, конфигурация |
| **Profile** | разрешени модули, политики, изходни формати |

Един процесен резултат може да се показва в различни шаблони без повторно изпълнение.

### 4.2 Обекти (8 категории)

Text · Data · Table · Media · Certificate · Layout · Legal · Dynamic.
Всеки обект: `id`, `type`, заглавие, източник на данни, позиция, размер, стил, видимост,
статус на проверка, версия. Таблиците: избор/подредба на колони, ширини, повторение на
заглавен ред, пренос между страници.

### 4.3 Manifest Engine

Схема (целева, v1.0):

```json
{
  "schema_version": "1.0",
  "report_id": "RPT-DEMO-001",
  "profile": "forensic_full",
  "page": { "format": "A4", "orientation": "portrait", "style_profile": "enterprise" },
  "process": {
    "start": { "type": "rfc3161_start", "required": true },
    "modules": [
      { "id": "system_info", "type": "data_block", "enabled": true },
      { "id": "hash_table", "type": "table", "enabled": true,
        "columns": ["filename", "size", "sha256", "sha512"] }
    ],
    "stop": { "type": "rfc3161_stop", "required": true }
  }
}
```

Проверки: JSON Schema, разрешени блокове, последователност, миграция между версии.

### 4.4 START / STOP

- START/STOP **не се местят** от визуалния редактор.
- START подписва хеша на каноничния входен манифест; STOP — на резултатния.
- Пази се `messageImprint`, подпис, сертификат, policy OID, nonce.
- При неуспешен START или STOP **не се показва VERIFIED**.
- PDF, създаден след STOP, има **собствена** процедура за удостоверяване (DocTimeStamp/подпис).

### 4.5 Три независими операции

1. **Save Draft** — запазва шаблона.
2. **Validate Manifest** — структура, зависимости, правила.
3. **Generate Report** — реални процеси и артефакти.

Успешно запазен шаблон ≠ валиден манифест ≠ удостоверен отчет.

---

## 5. Тестови нива

| Ниво | Проверки |
| ---- | -------- |
| L1 Static | JS/Python синтаксис, JSON Schema, структура |
| L2 Unit | всеки компонент и процесен модул |
| L3 GUI | навигация, размери, действия, редактиране |
| L4 Integration | манифест → процес → PDF |
| L5 Security | достъп, пътища, входни данни, файлове |
| L6 Recovery | прекъсване, рестарт, непълни операции |
| L7 Windows | реален WebView2 |
| L8 Home Assistant | Supervisor, Ingress, API, storage |
| L9 Release | чиста инсталация и регресия |

`PARTIAL`, `NOT VERIFIED`, `FAIL` блокират публикуване.

---

## 6. Приоритет за следващата реализация (зададен от собственика)

1. **Библиотеката с обекти** и **редакторът на таблици**.
2. **Манифестът** и **A4 Preview**.
3. Едва след тях — **реалната RFC 3161/PDF интеграция**.

---

## 7. Карта към текущото репо (делта)

| Ново изискване | Днес в репото | Липсва |
| -------------- | ------------- | ------ |
| 15 панела | 13 панела (`ui/app.js`) | PGP, Encrypt/Sign, OTS, RFC 3161, Forensic, Profiles, отделен Hash Generator |
| Дизайн система | `ui/styles.css` (един файл) | `tokens/layout/components/themes` |
| Панел като модул | `ui/*.js` (app, portals, report-studio) | регистър + `render/mount/unmount/permissions/capabilities` |
| Обектна библиотека | 9 плоски типа | 8 категории, planned обекти |
| Редактор на таблици | колони като текст | подредба/добавяне/изтриване на колони, ширини (v2) |
| Undo/Redo | ❌ | стек + бутони |
| Manifest | `report-manifest.js` (v1) | `manifest.schema.json`, миграции, profiles |
| A4 Preview | ✅ | съответствие preview ↔ PDF (проверки) |
| PDF | ✅ `report-render.js` | header/footer по 20/20/25/15, повторение на заглавия, QR |
| RFC 3161 | ❌ | реален TSA, imprint, проверка |
| Profiles/Templates | ❌ | мениджър с версии |
| Windows `.pyw` | `.bat` (Edge app) | WebView2 стартер |
| HA runtime | add-on backend | отделен адаптер слой |

---

## 8. Следващи стъпки (конкретно)

1. `ui/report-objects.js` — регистър на обектите по 8 категории (`ready` / `planned`).
2. Редактор на таблици: колони (добавяне, ред, изтриване) + бележка за ширини (v2).
3. Undo/Redo в Report Studio.
4. `manifests/manifest.schema.json` + проверка в `report-manifest.js`.
5. Разделяне на `ui/styles.css` на `tokens/layout/components/themes`.
6. Профили/шаблони (мениджър) → A4 header/footer → RFC 3161.

**Правило:** нищо не се обявява за готово, докато няма ред в §7, който да е преместен от
„липсва“ в „има“, плюс тест.
