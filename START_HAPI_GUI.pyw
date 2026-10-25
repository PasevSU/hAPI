#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""hAPI Enterprise — Enterprise Control Center, стартер за Windows.

Отваря `hapi_enterprise/ui/index.html` (GUI-ят за тестове, без сървър) в прозорец.
Два режима, в този ред:

1. **WebView2** — ако е инсталиран `pywebview` (има WebView2 runtime, който Edge
   носи), прозорецът е истински WebView2, а не браузър в режим на приложение.
2. **Резервен** — иначе същият подход като `START_HAPI_GUI.bat`: Edge или Chrome
   с `--app=`, защото това работи и без нито един Python пакет.

Защо `.pyw`, а не `.bat`: `.pyw` се стартира с `pythonw`, тоест без черен прозорец
на конзолата зад GUI-я.

Проверки (ползват се и от теста `tests/gui-starter-pyw.cjs`):
    python START_HAPI_GUI.pyw --check      # JSON: какво е намерено, без да отваря
    python START_HAPI_GUI.pyw --dry-run    # какво ЩЕ стартира, без да го стартира
    python START_HAPI_GUI.pyw --no-webview # принудително резервния път
"""
import json
import os
import subprocess
import sys

TITLE = 'hAPI Enterprise'
WINDOW = (1440, 900)

# Същите пътища и същият ред като в START_HAPI_GUI.bat — двете стартери трябва да
# намерят ЕДНО и също нещо, иначе „работи при мен“ става въпрос на вкус.
BROWSERS = [
    os.path.join(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)'),
                 r'Microsoft\Edge\Application\msedge.exe'),
    os.path.join(os.environ.get('ProgramFiles', r'C:\Program Files'),
                 r'Microsoft\Edge\Application\msedge.exe'),
    os.path.join(os.environ.get('ProgramFiles', r'C:\Program Files'),
                 r'Google\Chrome\Application\chrome.exe'),
    os.path.join(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)'),
                 r'Google\Chrome\Application\chrome.exe'),
]


def gui_path():
    """Пътят до index.html — до файла, не до сървър: GUI-ят работи и от диска."""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, 'hapi_enterprise', 'ui', 'index.html')


def gui_url(path):
    """file:/// URL с правилните наклонени черти, както го прави .bat файлът."""
    return 'file:///' + path.replace('\\', '/')


def find_browser():
    for candidate in BROWSERS:
        if candidate and os.path.exists(candidate):
            return candidate
    return ''


def webview_ready():
    """Има ли pywebview? Липсата му НЕ е грешка — има резервен път."""
    try:
        import webview  # noqa: F401
        return True
    except Exception:
        return False


def describe(force_fallback=False):
    path = gui_path()
    browser = find_browser()
    ok_webview = webview_ready() and not force_fallback
    return {
        'gui': path,
        'guiExists': os.path.exists(path),
        'url': gui_url(path),
        'browser': browser,
        'browserExists': bool(browser),
        'webview2': ok_webview,
        'mode': 'webview2' if ok_webview else ('browser-app' if browser else 'none'),
        'window': list(WINDOW),
    }


def browser_command(info):
    return [info['browser'], '--app=' + info['url'],
            '--window-size=%d,%d' % WINDOW]


def main(argv):
    force_fallback = '--no-webview' in argv
    info = describe(force_fallback)

    if '--check' in argv:
        print(json.dumps(info, ensure_ascii=False))
        return 0 if info['guiExists'] else 1

    if '--dry-run' in argv:
        # Казва какво би направил, без да отваря нищо — така тестът проверява
        # решението, а не картинка на екран.
        if info['mode'] == 'webview2':
            print(json.dumps({'mode': 'webview2', 'command': ['pywebview', info['url']]}, ensure_ascii=False))
        elif info['mode'] == 'browser-app':
            print(json.dumps({'mode': 'browser-app', 'command': browser_command(info)}, ensure_ascii=False))
        else:
            print(json.dumps({'mode': 'none', 'command': []}, ensure_ascii=False))
            return 1
        return 0

    if '--selftest-webview2' in argv:
        # Създава обекта на прозореца, но НЕ стартира цикъла на събитията: така се
        # доказва, че pywebview и WebView2 приемат този URL, без тестът да отваря
        # прозорец върху нечий екран.
        try:
            import webview
            webview.create_window(TITLE, info['url'], width=WINDOW[0], height=WINDOW[1])
            print(json.dumps({'webview2': True, 'created': True}, ensure_ascii=False))
            return 0
        except Exception as exc:                    # pragma: no cover - среда
            print(json.dumps({'webview2': False, 'created': False, 'error': str(exc)[:200]}, ensure_ascii=False))
            return 1

    if not info['guiExists']:
        print('Липсва ' + info['gui'], file=sys.stderr)
        return 1

    if info['mode'] == 'webview2':
        import webview
        webview.create_window(TITLE, info['url'], width=WINDOW[0], height=WINDOW[1])
        webview.start()
        return 0

    if info['mode'] == 'browser-app':
        # Създаваме процеса без shell — така път с интервал не се разкъсва.
        subprocess.Popen(browser_command(info))
        return 0

    print('Не е намерен нито WebView2 (pywebview), нито Edge/Chrome.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
