# GUI Inventory — hAPI Enterprise (As-Is)

## 1. Web admin console

| Aspect | Detail |
| ------ | ------ |
| Files | `admin.html` (~51 KB), `admin.js` (~121 KB) |
| Purpose | Full admin API surface (files, groups, profiles, QR, security, ops) |
| Access | Home Assistant **Ingress** (authenticated) or Windows loopback `http://127.0.0.1:8098/admin` |

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
