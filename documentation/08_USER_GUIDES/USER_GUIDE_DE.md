# hAPI Enterprise — Benutzerhandbuch

## Was ist hAPI Enterprise

Ein professionelles Home-Assistant-Add-on für Dokumentenverarbeitung, QR-basiertes
Teilen und kryptografischen Echtheitsnachweis vor Gericht und Staatsanwaltschaft.

## Schnellstart

1. Add-on installieren.
2. **Admin Console** öffnen (Ingress oder `http://127.0.0.1:8098/admin`).
3. **Gruppe** und **Profil** anlegen (Verzeichnis/Kabinett).
4. Dokument hochladen — es wird automatisch gehasht und versioniert.

## Teilen per QR-Code

1. Datei öffnen → **Teilen**.
2. Ablaufdatum und optional PIN festlegen.
3. **QR-Code** erzeugen.
4. Empfänger scannt und öffnet das geschützte Portal.

## Nachweis prüfen

1. Dokument, Manifest, Signatur und Zeitstempel herunterladen.
2. Portal öffnen → **Prüfen**.
3. SHA-256/SHA-512 werden neu berechnet; Signatur (PKCS#7) und Zeitstempel
   (RFC 3161) werden verifiziert.
4. Grün = Dokument unverfälscht.

## FAQ

- **Was beweist der QR-Code?** Nicht nur einen Link, sondern kryptografisch gebundene
  Daten — Hash, Signatur und Zeitstempel — die ein Gericht unabhängig prüfen kann.
- **Sind Fälschungen Geschichte?** Ja — jede Änderung ändert den Hash und die
  Prüfung schlägt fehl.
