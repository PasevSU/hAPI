![hAPI ENTERPRICE](/img/banner-bg.png)

# 🏠 HOME ASSISTANT Portal Enterprise - hAPI ENTERPRICE

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-yellow.svg?color=ff00d8)](https://www.apache.org/licenses/LICENSE-2.0)
[![Version](https://img.shields.io/badge/version-0.47.0-ff00d8.svg)](https://github.com/PasevSU/hAPI-enterprice)
[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg?color=ff00d8)](https://hacs.xyz)

[![Home Assistant](https://img.shields.io/badge/.-HOME_ASSISTANT-blue?logo=homeassistant)](https://www.home-assistant.io/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-blue?logo=nodedotjs)](https://nodejs.org)
[![Windows](https://img.shields.io/badge/.-WINDOWS-blue?logo=windows)](https://www.microsoft.com/windows)

[![Български](https://img.shields.io/badge/BG-ЕЗИК-green?logo=translate&labelColor=gray&style=flat-square)](BG.md)
[![Deutsch](https://img.shields.io/badge/DE-SPRACHE-green?logo=translate&labelColor=gray&style=flat-square)](DE.md)
[![English](https://img.shields.io/badge/EN-LANGUAGE-green?logo=translate&labelColor=gray&style=flat-square)](README.md)

**hAPI ENTERPRICE** (Home Assistant Portal Enterprise) е корпоративна платформа за
управление на файлове и портали, която работи на ръба между **Home Assistant** и
**Windows**. Един споделен Node.js backend, една административна конзола, две среди —
добавката за Home Assistant и самостоятелната Windows desktop среда. Нищо не е
премахнато: всяка функция идва с реален backend обработчик и автоматизиран тест.

✅ Добавка за Home Assistant + HACS компонент
✅ Саморазопаковащ се Windows инсталатор с вграден Node.js
✅ Admin токенът се задава преди стартиране на Home Assistant добавката
✅ RBAC + Home Assistant Ingress SSO
✅ SQLite транзакционно хранилище за метаданни
✅ Постоянни задачи, групови операции, резервни копия, диагностика
✅ Пълно desktop GUI с 1:1 покритие на backend

---

## 📦 Съдържание

- [✨ Функции](#-функции)
- [📦 Два готови пакета](#-два-готови-пакета)
  - [💻 Windows пакет (вграден Node)](#-windows-пакет-вграден-node)
  - [🏠 Home Assistant пакет (HACS)](#-home-assistant-пакет-hacs)
- [🚀 Windows - бърз старт](#-windows---бърз-старт)
- [🏠 Home Assistant - бърз старт](#-home-assistant---бърз-старт)
- [🗂️ Структура на хранилището](#️-структура-на-хранилището)
- [🔐 Сигурност](#-сигурност)
- [📄 Лиценз и приноси](#-лиценз-и-приноси)
- [🧭 Промени](#-промени)

---

## ✨ Функции

Всяка корпоративна функция по-долу е реализирана като **реален backend обработчик с
автоматизиран тест** — никога само като бутон в интерфейса:

| Модул | Какво прави |
|-------|-------------|
| 🔧 Адаптивен контрол на натоварването | Мащабира конкурентността на изтеглянията според heap и честотата на грешки. |
| 📦 Групови операции | Промяна на режима на достъп и видимостта на много файлове с преглед преди прилагане. |
| 🧰 Профили за конфигурация | Именувани, валидирани, атомарно запазвани профили на настройки. |
| 💾 Резервни копия и възстановяване | Консистентни SQLite резервни копия с проверка на целостта при възстановяване. |
| 🔍 Проверки на хранилищата | Периодични проверки за наличност и запис на всяко хранилище. |
| 📒 Журнал за грешки | Ограничен JSONL журнал с филтриране по ниво и източник. |
| 🗃️ Опашка от задачи | FIFO, ограничена конкурентност, прогрес, отмяна, пауза/възобновяване, възстановяване. |
| 🔑 RBAC + SSO | admin / operator / viewer токени плюс HA Ingress `X-Remote-User` съпоставяне. |
| 📱 QR артефакти | Генериране на QR за публикувани портали и връзки за достъп. |
| 🩺 Диагностика | RAM/heap, изтегляния, заявки, грешки, портали, файлове, хранилища — без тайни. |
| 🗄️ SQLite хранилище | Транзакционни метаданни чрез `node:sqlite` `DatabaseSync`. |
| 🖥️ Desktop GUI | pywebview GUI, което излага всяка административна възможност 1:1. |

---

## 📦 Два готови пакета

> [!NOTE]
> Един и същ backend (`download_portal/server.js`) и административна конзола захранват
> двата пакета — ръба между Home Assistant и Windows.

### 💻 Windows пакет (вграден Node)

Един **саморазопаковащ се инсталатор** (`hAPI_enterprice-v0.47.0-Windows-Setup.exe`) и
**преносим ZIP** (`hAPI_enterprice-v0.47.0-Windows-Portable.zip`). И двата вграждат
преносим **Node.js 22.16 runtime** (не се изисква системен Node), пълния backend,
pywebview desktop GUI, SDK, пълната документация и бранд материалите.

![Windows](/img/windows-bg.png)

Windows edge средата:

- създава директорията си с данни в `%LOCALAPPDATA%\hAPI_enterprice`,
- автоматично генерира и запазва admin токен (`admin-token`) при първо стартиране,
- стартира пълния backend и отваря настолния GUI (Enterprise Control Center).

Браузърната администраторска конзола е отделен интерфейс на
`http://127.0.0.1:8098/admin` (само loopback). Избери browser режима от интерактивното
меню; той не е настолният GUI.

### 🏠 Home Assistant пакет (HACS)

Пълно HACS-съвместимо хранилище:

- **Supervisor добавка** (`download_portal/` → `portal_enterprise`),
- **HACS компонент** (`custom_components/portal_enterprise/` с `hacs.json`,
  `icon.png`, `logo.png`),
- `repository.yaml` и `hacs.json` за добавяне / инсталиране с един клик.

Преди стартиране задай уникален admin токен с поне 24 знака в **Configuration** на
добавката. Стартирането отказва при липсващ/кратък токен, стойността-заглушка или
очевидно повтарящ се шаблон; токенът никога не се извежда в журнала.
Home Assistant Ingress използва същата HTTP/HTTPS схема като Home Assistant интерфейса:
TLS се прекратява в Home Assistant, а добавката използва HTTP само на вътрешния порт.
Не са необходими пътища към сертификат или частен ключ в конфигурацията на добавката.

---

## 🚀 Windows - бърз старт

Windows пакетът е самостоятелен (вграден Node). Разархивирай пакета и стартирай
единствения интерактивен вход `START_hAPI_ENTERPRICE.bat`. Той пита дали да отвори
настолния GUI, браузърния админ панел или само backend-а. При избор на настолен GUI
проверява и при нужда инсталира Python 3, `pywebview` и Microsoft Edge WebView2.
Браузърният режим проверява само Python. И двата GUI режима стартират backend-а
автоматично; режимът само за backend остава в конзолата до Ctrl+C.

```bat
:: Незадължителен SFX инсталатор (двоен клик). Инсталира в %LOCALAPPDATA%\hAPI ENTERPRICE.
hAPI_enterprice-v0.47.0-Windows-Setup.exe

:: Преносим ZIP (извлечи навсякъде), след това стартирай интерактивния вход
START_hAPI_ENTERPRICE.bat
```

SFX файлът остава инсталатор; използвай интерактивния BAT файл в инсталираната или
извлечената папка, за да избереш режим. За отделно инсталиране на зависимостите за
настолния GUI (ако Python вече е наличен):

```bat
Install_GUI_Dependency.bat
```

Браузърният админ панел е отделен интерфейс от пълния настолен GUI.

---

## 🏠 Home Assistant - бърз старт

> [!CAUTION]
> Добавката изисква **Node.js ≥ 22.13** (вграден в образа на добавката), за да е наличен
> `node:sqlite` `DatabaseSync` за транзакционното хранилище.

1. В **HACS** добави това хранилище като потребителско (тип **Integration**) и инсталирай
   **hAPI ENTERPRICE**.
2. В **Supervisor → Add-on Store → ⋮ → Repositories** добави URL на хранилището от
   `repository.yaml`.
3. Отвори **Configuration** на добавката, задай уникален admin токен (поне 24 знака),
   запази и след това инсталирай/стартирай добавката **hAPI ENTERPRICE**.
4. Отвори **Ingress** и въведи зададения admin токен в административната конзола.

Връзките към публикувани HTML проекти от админ конзолата използват текущия Ingress маршрут
и остават достъпни само за удостоверени потребители в Home Assistant.

> [!TIP]
> Компонентът (`portal_enterprise`) излага fail-closed read мост на
> `/api/portal_enterprise/v1/{tail}`; никога не препраща административни API.

---

## 🗂️ Структура на хранилището

```
download_portal/            # споделен Node.js backend (server.js + модули)
  server.js                 #   основен HTTP backend (HA + Windows)
  standalone.js             #   Windows edge bootstrap (с вграден Node)
  run.sh / Dockerfile       #   вход на HA добавката + образ
  config.yaml               #   метаданни / опции на добавката
  admin.html / admin.js     #   уеб административна конзола
custom_components/portal_enterprise/  # HACS компонент (fail-closed мост)
ui/                         # pywebview desktop GUI (12 панела, пълно покритие)
sdk/                        # клиентски SDK
tests/                      # Node тестов пакет (build.cjs ги изпълнява)
img/                        # банери, лого и бранд изображения (README)
brand/                      # пълен бранд комплект (лого, банери, икони, Windows .ico)
build.cjs                   # възпроизводима квалификационна компилация
build-platforms.cjs         # Windows + HA платформени пакети
build-release.cjs           # саморазопаковащ се инсталатор + HACS хранилище
```

---

## 🔐 Сигурност

Публичният API използва потребителски акаунти, създадени от администратор. Потребителските
имена, осолените `scrypt` хешове на паролите и сесиите се пазят в SQLite. Клиентите се
удостоверяват чрез `POST /api/v1/auth/login` и изпращат получения bearer токен за сесия.
Деактивирането на потребител обезсилва сесиите му. Admin токенът е отделен от тези данни.

Виж [SECURITY.md](SECURITY.md) за пълната политика: RBAC, bootstrap на токена, ingress SSO
граница на доверие, loopback изолация, диагностика без тайни и timing-safe сравнение на
токени.

---

## 📄 Лиценз и приноси

Лицензирано под **Apache License, Version 2.0** — виж [LICENSE](LICENSE).

Приносите са добре дошли — виж [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 🧭 Промени

- **v0.47.0** — Саморазопаковащ се Windows инсталатор с вграден Node; HACS-готово
  хранилище с `hacs.json` + брандирани икони; добавката изисква предварително зададен
  admin токен; многоезична документация (BG / DE / EN) и брандирани `img/`.
- **v0.46.2** — Поправен `Dockerfile` на добавката (всички модули се копират); добавен
  `build-platforms.cjs`.
- **v0.46.1** — URL-ите на хранилището към `https://pasev.asuscomm.com/`.
- **v0.46.0** — Пълно покритие на backend от desktop GUI (1:1 с admin API).
- **v0.45.0** — Edge/standalone среда (HA + Windows), loopback-изолиран admin listener.
- **v0.44.0** — Постоянни задачи, HA Ingress SSO, възпроизводима компилация.
- **v0.44 RC8** — Корпоративни модули: контрол на натоварването, журнал за грешки,
  профили за конфигурация, резервни копия и възстановяване, проверки на хранилищата, RBAC.
- **v0.43 RC7** — Мениджър на задачи (първи слой).

---

Създадено от **PasevSU DEV** · Home Assistant Projects · част от доброволческата кампания
**NO TRUST Cybersecurity**.
