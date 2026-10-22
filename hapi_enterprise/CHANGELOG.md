# Промени в hAPI Enterprise

Тази версия: **0.69.7**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.7

QR порталът за доказателства (Evidence View v1.1) е част от add-on-а и се публикува там,
където Home Assistant го сервира: **`<HA config>/www/hapi/data/`** → `/local/hapi/data/portal.html`.

### Публикуване на портала

- Пакетът е внесен в `hapi_enterprise/evidence-portal/` (`portal.html`, `assets/app.js`,
  `assets/consent.js`, `assets/style.css`, `data/demo-evidence.json`, README).
- При старт add-on-ът го копира в `<HA config>/www/hapi/data/` и пише в лога къде и колко
  файла е обновил (`evidence-portal.deployed`). Изключва се с `evidence_portal_deploy: false`.
- Копира се **само различното** (идемпотентно); symlink на целта се отказва, за да не се
  пише извън `www`; без достъп до HA конфигурацията add-on-ът не гадае — логва причината
  и продължава работа.
- Нови административни маршрути: `GET /admin/api/evidence-portal/status` и
  `POST /admin/api/evidence-portal/deploy` (повторно публикуване, с одит запис).
- Ново мапване `homeassistant_config:rw` — без него `/config/www` не съществува в контейнера.
  Пътят може да се зададе и с `EVIDENCE_PORTAL_DIR` (трябва да завършва на `www/hapi/data`).

### Проверка

- Нов тест `tests/evidence-portal.cjs`: пакетът е пълен, разпознава HA конфигурация по
  `configuration.yaml`, публикува точно в `<root>/www/hapi/data`, вторият пуск не пренаписва
  нищо, променен файл се обновява сам, произволна цел и symlink се отказват.
- `tests/addon-config.cjs` вече брои **30** опции (новата `evidence_portal_deploy` с преводи).

### Важно за сигурността

Порталът е само фронтенд. Той чака `GET /api/evidence/{folder}/manifest`,
`POST /api/evidence/{folder}/consent` и `POST /api/evidence/{folder}/access` — тези endpoint-и
**не са част от add-on-а** и трябва да ги осигури този, който публикува портала. Демо режимът
`?folder=demo-evidence` е само за тест и трябва да е изключен в употреба.
