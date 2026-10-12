![hAPI ENTERPRICE](/img/banner-de.png)

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

**hAPI ENTERPRICE** (Home Assistant Portal Enterprise) ist eine Enterprise-Plattform für
Datei- und Portalverwaltung, die an der Grenze zwischen **Home Assistant** und **Windows**
läuft. Ein gemeinsames Node.js-Backend, eine Admin-Konsole, zwei Umgebungen — das
Home-Assistant-Add-on und eine eigenständige Windows-Desktop-Laufzeit. Nichts wird
entfernt: Jede Funktion liefert einen echten Backend-Handler und einen automatisierten Test.

✅ Home-Assistant-Add-on + HACS-Komponente
✅ Selbstextrahierendes Windows-Installationsprogramm mit eingebettetem Node.js
✅ Admin-Token vor dem Start des Home-Assistant-Add-ons konfigurierbar
✅ RBAC + Home-Assistant-Ingress-SSO
✅ Transaktionaler SQLite-Metadaten-Store
✅ Persistente Jobs, Gruppenoperationen, Backups, Diagnose
✅ Vollständiges Desktop-GUI mit 1:1-Backend-Abdeckung

---

## 📦 Inhaltsverzeichnis

- [✨ Funktionen](#-funktionen)
- [📦 Zwei einsatzbereite Pakete](#-zwei-einsatzbereite-pakete)
  - [💻 Windows-Paket (eingebettetes Node)](#-windows-paket-eingebettetes-node)
  - [🏠 Home-Assistant-Paket (HACS)](#-home-assistant-paket-hacs)
- [🚀 Windows - Schnellstart](#-windows---schnellstart)
- [🏠 Home Assistant - Schnellstart](#-home-assistant---schnellstart)
- [🗂️ Repository-Struktur](#️-repository-struktur)
- [🔐 Sicherheit](#-sicherheit)
- [📄 Lizenz & Beiträge](#-lizenz--beiträge)
- [🧭 Änderungsprotokoll](#-änderungsprotokoll)

---

## ✨ Funktionen

Jede unten aufgeführte Enterprise-Funktion ist als **echter Backend-Handler mit
automatisiertem Test** implementiert — niemals nur als UI-Schaltfläche:

| Modul | Funktion |
|-------|----------|
| 🔧 Adaptive Laststeuerung | Skaliert die Download-Parallelität anhand von Heap-Nutzung und Fehlerrate. |
| 📦 Gruppenoperationen | Änderung von Zugriffsmodus und Sichtbarkeit vieler Dateien mit Vorschau. |
| 🧰 Konfigurationsprofile | Benannte, validierte, atomar gespeicherte Einstellungsprofile. |
| 💾 Backup & Restore | Konsistente SQLite-Backups mit Integritätsprüfung beim Wiederherstellen. |
| 🔍 Speicherprüfungen | Periodische Verfügbarkeits-/Schreibprüfungen pro Speicher. |
| 📒 Fehlerprotokoll | Begrenztes JSONL-Protokoll mit Filterung nach Ebene und Quelle. |
| 🗃️ Job-Warteschlange | FIFO, begrenzte Parallelität, Fortschritt, Abbruch, Pause/Fortsetzen, Wiederherstellung. |
| 🔑 RBAC + SSO | admin / operator / viewer-Token plus HA-Ingress-`X-Remote-User`-Zuordnung. |
| 📱 QR-Artefakte | QR-Erzeugung für veröffentlichte Portale und Zugriffslinks. |
| 🩺 Diagnose | RAM/Heap, Downloads, Anfragen, Fehler, Portale, Dateien, Speicher — ohne Geheimnisse. |
| 🗄️ SQLite-Store | Transaktionale Metadaten über `node:sqlite` `DatabaseSync`. |
| 🖥️ Desktop-GUI | pywebview-GUI, das jede Admin-Funktion 1:1 abbildet. |

---

## 📦 Zwei einsatzbereite Pakete

> [!NOTE]
> Dasselbe Backend (`download_portal/server.js`) und dieselbe Admin-Konsole betreiben beide
> Pakete — die Grenze zwischen Home Assistant und Windows.

### 💻 Windows-Paket (eingebettetes Node)

Ein einzelnes **selbstextrahierendes Installationsprogramm**
(`hAPI_enterprice-v0.47.0-Windows-Setup.exe`) und ein **portables ZIP**
(`hAPI_enterprice-v0.47.0-Windows-Portable.zip`). Beide betten eine portable
**Node.js-22.16-Laufzeit** (kein System-Node erforderlich), das vollständige Backend, das
pywebview-Desktop-GUI, das SDK, die komplette Dokumentation und die Brand-Assets ein.

![Windows](/img/windows-de.png)

Die Windows-Edge-Laufzeit:

- erstellt ihr Datenverzeichnis unter `%LOCALAPPDATA%\hAPI_enterprice`,
- generiert und speichert beim ersten Start automatisch ein Admin-Token (`admin-token`),
- startet das vollständige Backend und bedient die Admin-Konsole unter
  `http://127.0.0.1:8098/admin` (nur Loopback).

### 🏠 Home-Assistant-Paket (HACS)

Ein vollständiges HACS-kompatibles Repository:

- das **Supervisor-Add-on** (`download_portal/` → `portal_enterprise`),
- die **HACS-Komponente** (`custom_components/portal_enterprise/` mit `hacs.json`,
  `icon.png`, `logo.png`),
- `repository.yaml` und `hacs.json` für Installation mit einem Klick.

Lege vor dem Start in der Add-on-**Konfiguration** ein eindeutiges Admin-Token mit
mindestens 24 Zeichen fest. Der Start wird verweigert, wenn das Token fehlt, zu kurz oder
ein Standardplatzhalter bzw. ein offensichtliches Wiederholungsmuster ist. Das Token wird
nicht im Add-on-Protokoll ausgegeben. Home Assistant Ingress verwendet dasselbe
HTTP/HTTPS-Schema wie die Home-Assistant-Oberfläche: TLS endet bei Home Assistant; das
Add-on verwendet HTTP nur am internen Port. Zertifikat- oder Schlüsselpfade sind in der
Add-on-Konfiguration nicht erforderlich.

---

## 🚀 Windows - Schnellstart

Das Windows-Paket ist eigenständig (eingebettetes Node). Beim ersten Start werden
**fehlende GUI-Abhängigkeiten automatisch installiert** — Python 3, `pywebview` und
Microsoft Edge WebView2 Runtime — ganz ohne manuelle Einrichtung.

```bat
:: Optionaler SFX-Installer (Doppelklick). Installiert nach %LOCALAPPDATA%\hAPI ENTERPRICE.
hAPI_enterprice-v0.47.0-Windows-Setup.exe

:: Portables ZIP (entpacken), danach den interaktiven Starter ausführen
START_hAPI_ENTERPRICE.bat
```

Das Windows-Paket enthält nur diesen interaktiven Starter. Er fragt, ob die Desktop-GUI,
das Browser-Admin-Panel oder nur das Backend gestartet werden soll. Die Desktop-GUI prüft
Python, `pywebview` und WebView2; der Browsermodus benötigt nur Python. Beide GUI-Modi
starten das Backend automatisch. Der Nur-Backend-Modus läuft bis Ctrl+C.

Der SFX-Installer bleibt ein Installer; verwende danach den interaktiven BAT-Starter im
installierten Ordner. GUI-Abhängigkeiten separat installieren (wenn Python vorhanden ist):

```bat
Install_GUI_Dependency.bat
```

Das Browser-Admin-Panel ist eine separate Oberfläche von der vollständigen Desktop-GUI.

---

## 🏠 Home Assistant - Schnellstart

> [!CAUTION]
> Das Add-on benötigt **Node.js ≥ 22.13** (im Add-on-Image enthalten), damit `node:sqlite`
> `DatabaseSync` für den transaktionalen Store verfügbar ist.

1. In **HACS** dieses Repository als benutzerdefiniertes Repository (Typ **Integration**)
   hinzufügen und **hAPI ENTERPRICE** installieren.
2. Unter **Supervisor → Add-on Store → ⋮ → Repositories** die Add-on-Repository-URL aus
   `repository.yaml` hinzufügen.
3. In der Add-on-**Konfiguration** ein eindeutiges Admin-Token mit mindestens 24 Zeichen
   festlegen und speichern; anschließend das Add-on **hAPI ENTERPRICE** installieren/starten.
4. Die **Ingress**-Oberfläche öffnen und das konfigurierte Admin-Token in der Admin-Konsole eingeben.

Links zu veröffentlichten HTML-Projekten aus der Admin-Konsole verwenden die aktuelle
Ingress-Route und sind nur für authentifizierte Home-Assistant-Benutzer verfügbar.

> [!TIP]
> Die Komponente (`portal_enterprise`) stellt eine Fail-Closed-Lesebrücke unter
> `/api/portal_enterprise/v1/{tail}` bereit; sie leitet niemals administrative APIs weiter.

---

## 🗂️ Repository-Struktur

```
download_portal/            # gemeinsames Node.js-Backend (server.js + Module)
  server.js                 #   maßgebliches HTTP-Backend (HA + Windows)
  standalone.js             #   Windows-Edge-Bootstrap (mit eingebettetem Node)
  run.sh / Dockerfile       #   HA-Add-on-Einstieg + Image
  config.yaml               #   Add-on-Metadaten / Optionen
  admin.html / admin.js     #   Web-Admin-Konsole
custom_components/portal_enterprise/  # HACS-Komponente (Fail-Closed-Brücke)
ui/                         # pywebview-Desktop-GUI (12 Panels, volle Abdeckung)
sdk/                        # Client-SDK
tests/                      # Node-Testsuite (build.cjs führt sie aus)
img/                        # Banner, Logo und Brand-Bilder (README)
brand/                      # vollständiges Brand-Kit (Logo, Banner, Icons, Windows .ico)
build.cjs                   # reproduzierbarer Qualifikations-Build
build-platforms.cjs         # Windows- + HA-Plattformpakete
build-release.cjs           # selbstextrahierendes Installationsprogramm + HACS-Bundle
```

---

## 🔐 Sicherheit

Konten für die öffentliche API werden von einem Administrator angelegt. Benutzernamen,
gesalzene `scrypt`-Passwort-Hashes und Sitzungen werden in SQLite gespeichert. Clients
authentifizieren sich mit `POST /api/v1/auth/login` und senden das zurückgegebene
Bearer-Sitzungstoken. Das Deaktivieren eines Kontos macht seine Sitzungen ungültig. Das
Admin-Token ist davon getrennt.

Die vollständige Richtlinie steht unter [SECURITY.md](SECURITY.md): RBAC, Token-Bootstrap,
Ingress-SSO-Vertrauensgrenze, Loopback-Isolation, geheimnisfreie Diagnose und
timing-sicherer Token-Vergleich.

---

## 📄 Lizenz & Beiträge

Lizenziert unter der **Apache License, Version 2.0** — siehe [LICENSE](LICENSE).

Beiträge sind willkommen — siehe [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 🧭 Änderungsprotokoll

- **v0.47.0** — Selbstextrahierendes Windows-Installationsprogramm mit eingebettetem Node;
  HACS-fähiges Repository mit `hacs.json` + Brand-Icons; das Add-on erfordert ein
  vorab konfiguriertes Admin-Token; mehrsprachige Dokumentation (BG / DE / EN) und
  Brand-`img/`-Assets.
- **v0.46.2** — `Dockerfile` des Add-ons korrigiert (alle Module werden kopiert);
  `build-platforms.cjs` hinzugefügt.
- **v0.46.1** — Repository-URLs auf `https://pasev.asuscomm.com/` gesetzt.
- **v0.46.0** — Desktop-GUI mit voller Backend-Abdeckung (1:1 zur Admin-API).
- **v0.45.0** — Edge/Standalone-Laufzeit (HA + Windows), Loopback-isolierter Admin-Listener.
- **v0.44.0** — Persistente Jobs, HA-Ingress-SSO, reproduzierbarer Build.
- **v0.44 RC8** — Enterprise-Module: Laststeuerung, Fehlerprotokoll, Konfigurationsprofile,
  Backup & Restore, Speicherprüfungen, RBAC.
- **v0.43 RC7** — Job-Manager (erste Ausbaustufe).

---

Erstellt von **PasevSU DEV** · Home Assistant Projects · Teil der freiwilligen Kampagne
**NO TRUST Cybersecurity**.
