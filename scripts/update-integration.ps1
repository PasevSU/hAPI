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
    # `latest` НЕ е таг: `gh release download latest` търси точно такъв таг и пада с
    # „release not found“. Затова името се разрешава до истинския таг.
    $tag = $Version
    if ($Version -eq 'latest') {
        # Точно `--jq`: `gh release view` НЕ приема краткия `-q` (той е на `gh api`) и пада.
        $tag = (& gh release view --repo $Repo --json tagName --jq '.tagName')
        if ($LASTEXITCODE -ne 0 -or -not $tag) { throw "не мога да намеря последното издание в $Repo" }
        Write-Host "Последно издание: $tag"
    }
    $null = & gh release download $tag --repo $Repo --pattern 'hapi_enterprise-integration-*.zip' --dir $work --clobber 2>&1
    if ($LASTEXITCODE -ne 0) { throw "свалянето се провали (gh release download)" }
    $zip = Get-ChildItem $work -Filter '*.zip' | Select-Object -First 1
    Expand-Archive -LiteralPath $zip.FullName -DestinationPath (Join-Path $work 'unpacked') -Force

    $src = Join-Path $work 'unpacked/custom_components/hapi_enterprise'
    if (-not (Test-Path $src)) { throw "архивът не съдържа custom_components/hapi_enterprise" }
    $manifest = Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json
    Write-Host ("Архивът носи версия {0} · {1} файла" -f $manifest.version, (Get-ChildItem $src -Recurse -File).Count)

    if ($HaHost) {
        # Версията се пита НА САМИЯ HA: локалният `Test-Path /config/...` гледа диска на Windows
        # и винаги казва „няма“, което подвежда.
        $remoteNow = (& ssh -o BatchMode=yes "$HaUser@$HaHost" 'grep -m1 version /config/custom_components/hapi_enterprise/manifest.json 2>/dev/null')
        if ($LASTEXITCODE -ne 0 -or -not $remoteNow) { $remoteNow = 'няма (ще се създаде)' }
        Write-Host "На място на $HaHost`: $remoteNow"
    }
    elseif (Test-Path $target) {
        $current = if (Test-Path (Join-Path $target 'manifest.json')) {
            (Get-Content (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json).version
        }
        else { 'няма' }
        Write-Host "На място: $target · версия $current"
    }
    else {
        Write-Host "На място: $target · няма (ще се създаде)"
    }

    if (-not $Execute) {
        Write-Host ''
        Write-Host 'Пробен пуск: нищо не е копирано. Добави -Execute, за да се приложи.'
        return
    }

    if ($HaHost) {
        & tar -czf (Join-Path $work 'integration.tgz') -C (Join-Path $work 'unpacked/custom_components') hapi_enterprise
        if ($LASTEXITCODE -ne 0) { throw 'опаковането се провали' }

        # РЕДЪТ Е ВАЖЕН: първо КОПИРАМЕ, после разменяме. По-рано тук стоеше
        # `rm -rf …/hapi_enterprise` ПРЕДИ `scp` — при скъсана връзка интеграцията на HA
        # оставаше изтрита, а следващият рестарт на Home Assistant я няма. Сега старият
        # вариант остава на място, докато новият не е разархивиран успешно в /tmp.
        $remoteTgz = "/tmp/hapi-integration-$([guid]::NewGuid().ToString('N').Substring(0, 8)).tgz"
        & scp -q (Join-Path $work 'integration.tgz') "${HaUser}@${HaHost}:$remoteTgz"
        if ($LASTEXITCODE -ne 0) { throw 'копирането към HA се провали (старата версия е непокътната)' }

        # Внимание с кавичките: PowerShell НЕ разбира `\"` (екранирането е с обратен апостроф),
        # затова вътрешните кавички стигат до отдалечения shell счупени и grep пада с
        # „bad regex“. Затова тук няма кавички — само `grep -m1 version`.
        $swap = "set -e; " +
        "rm -rf /tmp/hapi-int; mkdir -p /tmp/hapi-int; " +
        "tar -xzf $remoteTgz -C /tmp/hapi-int; " +
        "mkdir -p /config/custom_components; " +
        "rm -rf /config/custom_components/hapi_enterprise.bak; " +
        "if [ -d /config/custom_components/hapi_enterprise ]; then mv /config/custom_components/hapi_enterprise /config/custom_components/hapi_enterprise.bak; fi; " +
        "if mv /tmp/hapi-int/hapi_enterprise /config/custom_components/hapi_enterprise; then " +
        "rm -rf /config/custom_components/hapi_enterprise.bak /tmp/hapi-int $remoteTgz; " +
        "else mv /config/custom_components/hapi_enterprise.bak /config/custom_components/hapi_enterprise; echo ROLLBACK; exit 1; fi; " +
        "grep -m1 version /config/custom_components/hapi_enterprise/manifest.json"
        & ssh -o BatchMode=yes "$HaUser@$HaHost" $swap
        if ($LASTEXITCODE -ne 0) { throw 'подмяната на HA се провали (върната е предишната версия)' }
        Write-Host "Готово на $HaHost. Рестартирай Home Assistant, да се зареди новата версия."
    }
    else {
        # Същият принцип локално: новото се сглобява до старото и се разменя накрая.
        $staging = "$target.new"
        if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
        Copy-Item $src $staging -Recurse -Force
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
        Move-Item $staging $target
        Write-Host "Готово: $target · версия $($manifest.version). Рестартирай Home Assistant."
    }
}
finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
