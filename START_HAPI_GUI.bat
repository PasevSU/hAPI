@echo off
rem ============================================================================
rem  hAPI Enterprise — Enterprise Control Center (GUI за тестове)
rem  Стартира hapi_enterprise\ui\index.html директно от диска: без сървър, без npm, без backend.
rem  Ако има Edge/Chrome — отваря се в самостоятелен app прозорец (WebView стил).
rem ============================================================================
setlocal

set "GUI=%~dp0hapi_enterprise\ui\index.html"
if not exist "%GUI%" (
  echo [x] Липсва "%GUI%"
  pause
  exit /b 1
)

set "URL=file:///%GUI:\=/%"

set "EDGE1=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE2=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME1=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME2=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if exist "%EDGE1%" goto edge1
if exist "%EDGE2%" goto edge2
if exist "%CHROME1%" goto chrome1
if exist "%CHROME2%" goto chrome2
goto default

:edge1
start "" "%EDGE1%" --app="%URL%" --window-size=1440,900
exit /b 0

:edge2
start "" "%EDGE2%" --app="%URL%" --window-size=1440,900
exit /b 0

:chrome1
start "" "%CHROME1%" --app="%URL%" --window-size=1440,900
exit /b 0

:chrome2
start "" "%CHROME2%" --app="%URL%" --window-size=1440,900
exit /b 0

:default
start "" "%GUI%"
exit /b 0
