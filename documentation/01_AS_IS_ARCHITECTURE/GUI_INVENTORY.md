# GUI Inventory — hAPI Enterprise (As-Is)

## 1. Enterprise Control Center (единствен административен интерфейс)

| Aspect | Detail |
| ------ | ------ |
| Files | `hapi_enterprise/ui/` (index.html, app.js, 16 панелни модула, styles.css, icons.js) |
| Purpose | Пълен административен обхват: портали и файлове, контакти, дела, публичен gateway, експорт, Report Studio, настройки |
| Access | Home Assistant **Ingress** (`ingress_entry: /`) или Windows loopback `http://127.0.0.1:8098/ui/index.html` |
| Стар панел | `admin.html` / `admin.js` са **премахнати в 0.69.8**; `GET /admin` пренасочва към `/ui/index.html` |

Навигацията следва плана (UI-01, §6.11): Dashboard, Портали, Контакти, Дела, Публичен gateway,
Експорт, Потребители & RBAC, Задачи, Хранилища, Анализи, Сигурност, Резервни копия, QR архиви,
Report Studio, Настройки, Относно. Панелите без собствен модул отварят точно своята секция в
„Настройки“ — едно място за логиката, без копия (проверява се от `tests/ui-navigation.cjs`).

## 2. Public portal (QR landing)

| Aspect | Detail |
| ------ | ------ |
| Files | `portal.html`, `portal.css`, `portal.js` |
| Purpose | Branded landing page for QR-shared records (file list + download) |
| Note | Phase 7 upgrades this into the full evidence portal |

## 3. Desktop GUI (Windows)

| Aspect | Detail |
| ------ | ------ |
| Runtime | `pywebview` + Microsoft Edge WebView2 |
| Purpose | Native window wrapping the same backend/admin surface (1:1 coverage) |
| Starter | `START_hAPI_Enterprise.bat` (installs Python 3 + pywebview + WebView2 on demand) |

## 4. HACS component surface

| Aspect | Detail |
| ------ | ------ |
| Files | `custom_components/hapi_enterprise/__init__.py`, `manifest.json` |
| Purpose | Fail-closed read bridge `/api/hapi_enterprise/v1/{tail}`; never forwards admin APIs |
