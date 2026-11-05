# Обновява интеграцията `hapi_enterprise` от публикуваното издание — с ЕДНА команда.
#
# Защо: на инсталацията няма HACS, тоест дотук всяко обновяване на интеграцията беше ръчно
# разархивиране на `hapi_enterprise-integration-<версия>.zip` в `/config/custom_components`.
# Точно затова интеграцията на диска изоставаше от add-on-а (0.69.147 срещу 0.69.152).
#
#   pwsh -File scripts/update-integration.ps1                          # само проверка какво ще се сложи
#   pwsh -File scripts/update-integration.ps1 -Execute                  # в local ./custom_components
#   pwsh -File scripts/update-integration.ps1 -Execute -HaHost 192.168.50.4
#                                                                       # в /config/custom_components на HA
#
# Скриптът НЕ рестартира Home Assistant: след копирането се рестартира от „Настройки“ или с
# `ha core restart`, защото рестартът е решение на човека, не на обновяването.
param(
  [string]$Version = 'latest',
  [switch]$Execute,
  [string]$HaHost = '',
  [string]$HaUser = 'root',
  [string]$Repo = 'PasevSU/hAPI'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = if ($HaHost) { '/config/custom_components/hapi_enterprise' } else { Join-Path $root 'custom_components/hapi_enterprise' }
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("hapi-integration-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null

try {
  Write-Host "Издание: $Version · източник: $Repo"
  $null = & gh release download $Version --repo $Repo --pattern 'hapi_enterprise-integration-*.zip' --dir $work --clobber 2>&1
  if ($LASTEXITCODE -ne 0) { throw "свалянето се провали (gh release download)" }
  $zip = Get-ChildItem $work -Filter '*.zip' | Select-Object -First 1
  Expand-Archive -LiteralPath $zip.FullName -DestinationPath (Join-Path $work 'unpacked') -Force

  $src = Join-Path $work 'unpacked/custom_components/hapi_enterprise'
  if (-not (Test-Path $src)) { throw "архивът не съдържа custom_components/hapi_enterprise" }
  $manifest = Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json
  Write-Host ("Архивът носи версия {0} · {1} файла" -f $manifest.version, (Get-ChildItem $src -Recurse -File).Count)

  if (Test-Path $target) {
    $current = if (Test-Path (Join-Path $target 'manifest.json')) {
      (Get-Content (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json).version
    } else { 'няма' }
    Write-Host "На място: $target · версия $current"
  } else {
    Write-Host "На място: $target · няма (ще се създаде)"
  }

  if (-not $Execute) {
    Write-Host ''
    Write-Host 'Пробен пуск: нищо не е копирано. Добави -Execute, за да се приложи.'
    return
  }

  if ($HaHost) {
    # Копираме съдържанието на папката, без да трием чужди файлове: ако в изданието някой
    # файл е премахнат, той ще остане — затова накрая се показва разликата по брой файлове.
    & tar -czf (Join-Path $work 'integration.tgz') -C (Join-Path $work 'unpacked/custom_components') hapi_enterprise
    if ($LASTEXITCODE -ne 0) { throw 'опаковането се провали' }
    & ssh -o BatchMode=yes "$HaUser@$HaHost" "mkdir -p /config/custom_components && rm -rf /config/custom_components/hapi_enterprise"
    if ($LASTEXITCODE -ne 0) { throw "подготовката на папката на $HaHost се провали" }
    & scp -q (Join-Path $work 'integration.tgz') "${HaUser}@${HaHost}:/tmp/hapi-integration.tgz"
    if ($LASTEXITCODE -ne 0) { throw 'копирането към HA се провали' }
    & ssh -o BatchMode=yes "$HaUser@$HaHost" "tar -xzf /tmp/hapi-integration.tgz -C /config/custom_components && rm -f /tmp/hapi-integration.tgz && grep -m1 '\"version\"' /config/custom_components/hapi_enterprise/manifest.json"
    if ($LASTEXITCODE -ne 0) { throw 'разархивирането на HA се провали' }
    Write-Host "Готово на $HaHost. Рестартирай Home Assistant, за да се зареди новата версия."
  } else {
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item $src $target -Recurse -Force
    Write-Host "Готово: $target · версия $($manifest.version). Рестартирай Home Assistant."
  }
} finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
