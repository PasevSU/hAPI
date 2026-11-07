<#
.SYNOPSIS
    Прилага изданието на hAPI Enterprise върху жива Home Assistant инстанция — dry run по подразбиране.

.DESCRIPTION
    Защо съществува: одитът в `documentation/07_RELEASE/UPDATE_PATH_AUDIT.md` показа, че
    „Обнови“ не се появява, защото инстанцията не е свързана с източника — add-on-ът е
    локална папка в `/addons`, интеграцията е ръчно копие, а HACS липсва. Затова този
    скрипт прави двете неща, които НЕ изискват натискане на бутон в интерфейса:

      1) проверява, че изданието наистина е публикувано и че Supervisor има какво да
         издърпа (release, артефакти, образ в GHCR за всяка архитектура);
      2) с `-Execute` копира интеграцията и/или преименува локалните add-on папки, като
         сверява ВСЕКИ файл по SHA-256 и излиза с код 1 при разлика.

    Какво остава ръчно (и защо): добавянето на хранилището в Supervisor и натискането на
    „Обнови“. Програмният вход в API-то на Home Assistant е измерено невъзможен на тази
    инсталация (trusted_networks връща 400 `User input malformed` за всяко тяло), затова
    скриптът не се преструва, че може да го направи.

.PARAMETER Mode
    Verify (по подразбиране, нищо не се променя) · Integration (копира интеграцията) ·
    Addon (преименува локалните add-on папки, за да не пречат на този от хранилището) ·
    Both.

.PARAMETER ConfigShare
    Път до `/config` на инстанцията (SMB). По подразбиране `X:\`.

.PARAMETER AddonShare
    Път до `/addons` на инстанцията (SMB). По подразбиране `\\192.168.50.4\ADDONS`.

.PARAMETER Execute
    Без него скриптът само проверява и показва какво би направил.

.EXAMPLE
    pwsh -NoProfile -File scripts/apply-update.ps1

.EXAMPLE
    pwsh -NoProfile -File scripts/apply-update.ps1 -Mode Both -Execute
#>
[CmdletBinding()]
param(
    [ValidateSet('Verify', 'Integration', 'Addon', 'Both')]
    [string]$Mode = 'Verify',
    [string]$ConfigShare = 'X:\',
    [string]$AddonShare = '\\192.168.50.4\ADDONS',
    [string]$Repo = 'PasevSU/hAPI',
    [string]$IntegrationRepo = 'PasevSU/hapi-enterprise-integration',
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
# Два брояча с различна тежест: находка („така стоят нещата“) не е грешка при прилагане.
$script:Errors = 0
$script:Findings = 0
$script:Applied = 0

function Step([string]$Text) { Write-Host "`n▸ $Text" -ForegroundColor Cyan }
function Ok([string]$Text) { Write-Host "  ✔ $Text" -ForegroundColor Green }
function Warn([string]$Text) { Write-Host "  ! $Text" -ForegroundColor Yellow; $script:Findings++ }
function Bad([string]$Text) { Write-Host "  ✘ $Text" -ForegroundColor Red; $script:Errors++ }

# ── Версията: един източник на истина ────────────────────────────────────────
$configPath = Join-Path $PSScriptRoot '..\hapi_enterprise\config.yaml'
$version = (Select-String -Path $configPath -Pattern '^version:\s*"([^"]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
if (-not $version) { throw "Не намирам version в $configPath" }
Write-Host "════ Прилагане на изданието — hAPI Enterprise $version ════" -ForegroundColor White
if (-not $Execute) { Write-Host "  режим: ПРОВЕРКА (нищо не се променя; добави -Execute за прилагане)" -ForegroundColor Yellow }

# ── 1/6 GitHub: изданието е публично и пълно ─────────────────────────────────
Step "1/6 GitHub: release v$version"
try {
    $release = gh release view "v$version" -R $Repo --json tagName,isDraft,isPrerelease,assets | ConvertFrom-Json
    if ($release.isDraft) { Bad "release v$version е ЧЕРНОВА — HACS и хората не го виждат" }
    elseif ($release.isPrerelease) { Warn "release v$version е предварително издание" }
    else { Ok "release v$version е публично, артефакти: $($release.assets.Count)" }
    $sums = $release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' }
    if ($sums) { Ok "SHA256SUMS.txt е приложен ($($sums.size) B)" } else { Bad "липсва SHA256SUMS.txt" }
} catch { Bad "release v$version не е намерен в $Repo ($($_.Exception.Message))" }

# ── 2/6 GitHub: хранилището е валидно add-on хранилище ───────────────────────
Step "2/6 GitHub: $Repo е add-on хранилище (repository.yaml + config.yaml)"
foreach ($probe in @('repository.yaml', 'hapi_enterprise/config.yaml')) {
    try {
        gh api "repos/$Repo/contents/$probe`?ref=main" | Out-Null
        Ok "$probe е в корена на main"
    } catch { Bad "$probe липсва в $Repo — Supervisor няма да разпознае хранилището" }
}

# ── 3/6 GitHub: интеграционното хранилище носи същата версия ────────────────
Step "3/6 GitHub: $IntegrationRepo (HACS пътят)"
try {
    $raw = gh api "repos/$IntegrationRepo/contents/custom_components/hapi_enterprise/manifest.json" -H "Accept: application/vnd.github.raw"
    $manifest = $raw | ConvertFrom-Json
    if ($manifest.version -eq $version) { Ok "manifest.json = $version" } else { Warn "manifest.json = $($manifest.version), а add-on-ът е $version" }
    $hacsRelease = gh release view "v$version" -R $IntegrationRepo --json isDraft | ConvertFrom-Json
    if ($hacsRelease.isDraft) { Bad "release v$version в $IntegrationRepo е чернова" } else { Ok "release v$version в $IntegrationRepo е публично" }
} catch { Warn "не мога да проверя $IntegrationRepo ($($_.Exception.Message))" }

# ── 4/6 GHCR: образът за всяка архитектура (точно това тегли Supervisor) ────
Step "4/6 GHCR: образи за $version"
foreach ($arch in @('amd64', 'aarch64', 'armv7')) {
    $image = "pasevsu/$arch-addon-hapi_enterprise"
    try {
        $token = (Invoke-RestMethod "https://ghcr.io/token?scope=repository:$image`:pull&service=ghcr.io").token
        $headers = @{
            Authorization = "Bearer $token"
            Accept = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json'
        }
        Invoke-RestMethod -Headers $headers "https://ghcr.io/v2/$image/manifests/$version" | Out-Null
        Ok "$arch → ghcr.io/$image`:$version"
    } catch { Bad "$arch → няма образ $image`:$version (Supervisor ще върне грешка при теглене)" }
}

# ── 5/6 Инстанцията: какво има и защо не се обновява само ───────────────────
Step "5/6 Инстанцията: какво е инсталирано"
$localAddons = @()
if (Test-Path $AddonShare) {
    if (Test-Path (Join-Path $AddonShare 'repository.yaml')) {
        Ok "/addons съдържа repository.yaml — хранилището е добавено като източник"
    } else {
        Warn "/addons НЕ съдържа repository.yaml — нито едно хранилище не е добавено; локалните папки не се обновяват от GitHub"
    }
    $localAddons = @(Get-ChildItem $AddonShare -Directory -ErrorAction SilentlyContinue | Where-Object {
        Test-Path (Join-Path $_.FullName 'config.yaml')
    })
    if ($localAddons.Count -gt 0) {
        foreach ($dir in $localAddons) {
            $v = (Select-String -Path (Join-Path $dir.FullName 'config.yaml') -Pattern '^version:\s*"([^"]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
            Warn "локален add-on: $($dir.Name) = $v (Supervisor не го сравнява с GitHub)"
        }
    } else { Ok "няма локални add-on папки" }
} else { Warn "няма достъп до $AddonShare — провери SMB" }

$installedManifest = Join-Path $ConfigShare 'custom_components\hapi_enterprise\manifest.json'
if (Test-Path $installedManifest) {
    $installed = (Get-Content $installedManifest -Raw | ConvertFrom-Json).version
    if ($installed -eq $version) { Ok "инсталирана интеграция: $installed (актуална)" } else { Warn "инсталирана интеграция: $installed — изостава от $version" }
} else { Warn "няма инсталирана интеграция в $ConfigShare" }
if (Test-Path (Join-Path $ConfigShare 'custom_components\hacs')) {
    Ok "HACS е инсталиран — интеграцията може да се обновява през него"
} else {
    Warn "HACS липсва — интеграцията се обновява само ръчно (или с този скрипт)"
}

# ── 6/6 Прилагане (само с -Execute) ─────────────────────────────────────────
function Assert-Identical([string]$Source, [string]$Target, [string]$Label) {
    # Пътят трябва да е РЕАЛЕН (без `..`): `FileInfo.FullName` е нормализиран и разликата в
    # дължините дава безсмислени имена („липсва: y“) — измерено при първото пускане.
    $Source = (Resolve-Path $Source).Path.TrimEnd('\')
    $Target = [System.IO.Path]::GetFullPath($Target).TrimEnd('\')
    $files = Get-ChildItem $Source -Recurse -File | Where-Object { $_.FullName -notmatch '\\(__pycache__|\.git)\\' }
    $bad = 0
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($Source.Length).TrimStart('\')
        $copy = Join-Path $Target $relative
        if (-not (Test-Path $copy)) { Bad "$Label липсва: $relative"; $bad++; continue }
        $a = (Get-FileHash -Algorithm SHA256 $file.FullName).Hash
        $b = (Get-FileHash -Algorithm SHA256 $copy).Hash
        if ($a -ne $b) { Bad "$Label различен: $relative"; $bad++ }
    }
    if ($bad -eq 0) { Ok "${Label}: $($files.Count) файла съвпадат байт по байт" }
    return $files.Count
}

Step "6/6 Прилагане (режим $Mode$(if (-not $Execute) { ', ПРОБА' }))"
$integrationSource = (Resolve-Path (Join-Path $PSScriptRoot '..\custom_components\hapi_enterprise')).Path
if ($Mode -in @('Integration', 'Both')) {
    $target = Join-Path $ConfigShare 'custom_components\hapi_enterprise'
    if (-not $Execute) {
        Write-Host "  → би копирал $integrationSource → $target (с /MIR, без __pycache__)" -ForegroundColor Yellow
    } else {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        robocopy $integrationSource $target /MIR /XD __pycache__ /XF *.pyc /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { Bad "robocopy върна $LASTEXITCODE" }
        Assert-Identical $integrationSource $target 'интеграция' | Out-Null
        $script:Applied++
        Write-Host "  ✔ качи се; рестартирай Home Assistant, за да се зареди новата версия" -ForegroundColor Green
    }
}

if ($Mode -in @('Addon', 'Both')) {
    if ($localAddons.Count -eq 0) {
        Ok "няма локални add-on папки за преименуване"
    } elseif (-not $Execute) {
        foreach ($dir in $localAddons) { Write-Host "  → би преименувал $($dir.FullName) → $($dir.Name).local-<версия>.bak" -ForegroundColor Yellow }
        Write-Host "  (целта: store-ът да не показва два add-on-а с едно име; нищо не се трие)" -ForegroundColor Yellow
    } else {
        foreach ($dir in $localAddons) {
            $v = (Select-String -Path (Join-Path $dir.FullName 'config.yaml') -Pattern '^version:\s*"([^"]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
            $backup = Join-Path $dir.Parent.FullName ("{0}.local-{1}.bak" -f $dir.Name, ($v -replace '\.', '_'))
            if (Test-Path $backup) { Rename-Item $backup ("{0}-{1}" -f $backup, (Get-Date -Format HHmmss)) }
            Rename-Item $dir.FullName $backup
            Ok "преименувана: $($dir.Name) → $(Split-Path $backup -Leaf)"
            $script:Applied++
        }
        Write-Host "  → сега добави хранилището в Supervisor: Settings → Add-ons → ⋮ → Repositories → https://github.com/PasevSU/hAPI" -ForegroundColor Yellow
    }
}

# ── Присъда ─────────────────────────────────────────────────────────────────
Write-Host "`n═══ Обобщение ═══" -ForegroundColor White
if ($script:Errors -eq 0) {
    Write-Host "  ✔ няма грешки при проверките" -ForegroundColor Green
} else {
    Write-Host "  ✘ грешки: $($script:Errors)" -ForegroundColor Red
}
if ($script:Findings -gt 0) {
    Write-Host "  ! находки за поправяне: $($script:Findings) (те са причината „Обнови“ да липсва)" -ForegroundColor Yellow
}
if ($Execute -and $script:Applied -gt 0) {
    Write-Host "  ✔ приложени стъпки: $($script:Applied)" -ForegroundColor Green
}
Write-Host "  ръчни стъпки, които остават:" -ForegroundColor White
Write-Host "    1) Settings → Add-ons → ⋮ → Repositories → https://github.com/PasevSU/hAPI, после Install"
Write-Host "    2) при желание за автоматични обновявания на интеграцията: HACS → ⋮ → Custom repositories →"
Write-Host "       https://github.com/PasevSU/hapi-enterprise-integration (категория Integration)"
Write-Host "    3) Settings → System → Restart Home Assistant"
Write-Host "  пълният одит: documentation/07_RELEASE/UPDATE_PATH_AUDIT.md" -ForegroundColor DarkGray

if ($script:Errors -gt 0) { exit 1 }
exit 0
