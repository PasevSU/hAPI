# Промени в hAPI Enterprise

Тази версия: **0.69.212**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.212

- **Образът вече СЕ билдва — и без npm.** В 0.69.210/0.69.211 Dockerfile-ът теглеше Node от
  `https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-<arch>-musl.tar.xz`. Такъв файл **не
  съществува** за официалните издания: и трите джоба на „Add-on image“ паднаха с
  `curl: (22) The requested URL returned error: 404` (плюс CI и Release workflow-ите).
  Причината: локалният тест четеше Dockerfile-а с регулярни изрази и „минаваше“, без никога
  да билдва образа. Сега Dockerfile-ът е на **два етапа**: `node:22.23.2-alpine` е етап 1 и от
  него се копира **само** `/usr/local/bin/node`; етап 2 е чист `alpine:3.24` с `libstdc++`
  (динамичният Node го иска). npm/npx/corepack остават в изхвърления етап — не съществуват
  нито във файловата система, нито в историята на слоевете. Измерено на истински build:
  `node --version` → `v22.23.2`, `npm/npx/corepack` → няма, `require("node:sqlite").DatabaseSync`
  → `function`, `zlib-1.4-r0`.
- **Заключеният critical в zlib е поправен; musl/openssl чакат Alpine.** `apk policy` в
  `alpine:3.24` показва, че хранилището дава `zlib 1.4-r0` (вдигнат от `--available`) и **само**
  `musl 1.2.6-r3` / `openssl 3.5.9-r0` — тоест за тях поправка в този клон още няма, а
  `alpine:3.25` не съществува (`docker pull` → `not found`). Записано е в `SECURITY.md` с
  точните версии и с едноредовия изход (`FROM alpine:3.2X`), когато клонът излезе.
