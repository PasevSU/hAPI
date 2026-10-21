<#
.SYNOPSIS
    Публикува HACS хранилището (release/haoss) в GitHub — стъпка по стъпка, с dry run по подразбиране.

.DESCRIPTION
    Без -Execute скриптът само показва какво би направил (нищо не се качва).
    С -Execute: строи изданието, прави git хранилище, създава/използва GitHub repo,
    задава описание и topics, push-ва main и вдига таг v<версия>, от който
    workflow-ът `release.yml` създава GitHub release.

    Никога не прави force push и не трие нищо от GitHub.

.EXAMPLE
    pwsh -NoProfile -File scripts/publish-haoss.ps1
    Dry run — показва командите.

.EXAMPLE
    pwsh -NoProfile -File scripts/publish-haoss.ps1 -Execute
    Реално публикуване.
#>
[CmdletBinding()]
param(
    [string]$RepoName = 'hapi-enterprise-integration',
    [string]$Description = 'Home Assistant integration for hAPI Enterprise — document vault with verifiable integrity',
    [string[]]$Topics = @('home-assistant', 'hacs', 'integration'),
    [string]$Version,
    [switch]$SkipBuild,
    [switch]$InPlace,
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repoDir = Join-Path $root 'release/haoss'
$mode = if ($Execute) { 'ПУБЛИКУВАНЕ' } else { 'DRY RUN (нищо не се качва)' }

function Write-Step {
    param([string]$Text)
    Write-Host ''
    Write-Host "▸ $Text" -ForegroundColor Cyan
}

function Invoke-Command-Step {
    param([string]$Text, [string]$Command, [string]$WorkDir = $root)
    Write-Host "  $ $Command"
    if (-not $Execute) { return $null }
    Push-Location $WorkDir
    try {
        $output = Invoke-Expression $Command 2>&1
        if ($LASTEXITCODE -ne 0) { throw "командата се провали ($LASTEXITCODE): $Command`n$output" }
        return $output
    }
    finally { Pop-Location }
}

Write-Host ''
Write-Host "════════ Публикуване на HACS хранилището — $mode ════════" -ForegroundColor Yellow

# ── 0. Версия и собственик ──────────────────────────────────────────────────
if (-not $Version) {
    $configPath = Join-Path $root 'hapi_enterprise/config.yaml'
    $line = Select-String -Path $configPath -Pattern '^version:\s*"([^"]+)"' | Select-Object -First 1
    if (-not $line) { throw "не намирам version в $configPath" }
    $Version = $line.Matches[0].Groups[1].Value
}
$tag = "v$Version"

# Git върху мрежов диск (H: = SMB) виси дори на `git rev-parse` — затова по подразбиране
# публикуваме от локално копие във %TEMP%. С -InPlace работим направо в release/haoss.
$gitDir = if ($InPlace) { $repoDir } else { Join-Path $env:TEMP "haoss-publish-$Version" }

$owner = try { (gh api user --jq .login 2>$null).Trim() } catch { '' }
if (-not $owner) { $owner = '<owner>' }
$fullName = "$owner/$RepoName"
$repoUrl = "https://github.com/$fullName"

Write-Host "  версия: $Version   таг: $tag"
Write-Host "  хранилище: $fullName"
Write-Host "  локална папка: $repoDir"
if (-not $InPlace) { Write-Host "  git работна папка: $gitDir (локален диск)" }

if ($Execute) {
    Write-Step 'Проверка на GitHub автентикацията'
    Invoke-Command-Step -Text 'gh auth status' -Command 'gh auth status' | Out-Null
}

# ── 1. Издание ──────────────────────────────────────────────────────────────
Write-Step '1/5  Строене на изданието'
if ($SkipBuild) {
    Write-Host '  пропуснато (-SkipBuild)'
}
else {
    $buildArgs = if ($Execute) { "--repo-url $repoUrl" } else { '' }
    Invoke-Command-Step -Text 'build' -Command "node scripts/build-haoss.cjs $buildArgs".Trim() | Out-Null
}
if (-not (Test-Path (Join-Path $repoDir 'hacs.json'))) {
    if ($Execute) { throw "липсва $repoDir/hacs.json — изданието не е построено" }
}

# ── 2. Git хранилище ────────────────────────────────────────────────────────
Write-Step '2/5  Git хранилище'
# Ако хранилището вече е в GitHub, работим върху clone — така историята остава линейна
# и diff-ът е истински (без force push и без два независими корена на историята).
$repoProbe = gh repo view $fullName --json name 2>&1
$repoExists = ($LASTEXITCODE -eq 0)
Write-Host "  хранилището в GitHub съществува: $repoExists"

if (-not $InPlace) {
    if ($Execute) {
        if (Test-Path -LiteralPath $gitDir) { Remove-Item -LiteralPath $gitDir -Recurse -Force }
        if ($repoExists) {
            Write-Host "  $ git clone $repoUrl $gitDir"
            & cmd /c "git clone `"$repoUrl`" `"$gitDir`" 2>&1" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "git clone се провали" }
            # Махаме всичко освен .git, за да може build-ът да наложи точното съдържание.
            Get-ChildItem -LiteralPath $gitDir -Force |
            Where-Object { $_.Name -ne '.git' } |
            Remove-Item -Recurse -Force
        }
        else {
            New-Item -ItemType Directory -Path $gitDir -Force | Out-Null
        }
        Get-ChildItem -LiteralPath $repoDir -Force |
        Where-Object { $_.Name -ne '.git' } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $gitDir -Recurse -Force }
        Write-Host ('  копирани файлове: ' + (Get-ChildItem -LiteralPath $gitDir -Recurse -File -Force).Count)
    }
}

$hasGit = Test-Path (Join-Path $gitDir '.git')
Write-Host "  .git съществува: $hasGit"
if (-not $hasGit) {
    Write-Host "  $ git init -b main"
    if ($Execute) {
        Push-Location $gitDir
        try {
            & cmd /c 'git init -b main 2>&1' | Out-Null
            $initCode = $LASTEXITCODE
        }
        finally { Pop-Location }
        if ($initCode -ne 0 -or -not (Test-Path (Join-Path $gitDir '.git/HEAD'))) {
            throw "git init не успя в $gitDir"
        }
    }
}
Invoke-Command-Step -Text 'add' -Command 'git add -A' -WorkDir $gitDir | Out-Null

# Празни commit-и не помагат на никого: при реално изпълнение проверяваме дали има промени.
# `git rev-parse HEAD` пада при първи commit — това е „мръсно“ по определение.
if ($Execute) {
    Push-Location $gitDir
    try {
        git rev-parse --verify HEAD 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            git diff --cached --quiet
            $dirty = ($LASTEXITCODE -ne 0)
        }
        else { $dirty = $true }
    }
    finally { Pop-Location }
    if ($dirty) {
        Invoke-Command-Step -Text 'commit' -Command "git commit -m 'hAPI Enterprise $Version — HACS integration'" -WorkDir $gitDir | Out-Null
    }
    else {
        Write-Host '  няма промени — без нов commit'
    }
}
else {
    Write-Host "  `$ git commit -m 'hAPI Enterprise $Version — HACS integration'   (само ако има промени)"
}

# Първият commit иска име/имейл — задаваме локално, ако липсват (не пипаме глобалните).
if ($Execute) {
    Push-Location $gitDir
    try {
        $email = git config user.email 2>$null
        $userName = git config user.name 2>$null
    }
    finally { Pop-Location }
    if (-not $email -or -not $userName) {
        Write-Host "  няма git идентичност — задавам локално ($owner)"
        Invoke-Command-Step -Text 'identity' -Command "git config user.name '$owner'; git config user.email '$owner@users.noreply.github.com'" -WorkDir $gitDir | Out-Null
    }
    else {
        Write-Host "  git идентичност: $userName <$email>"
    }
}
else {
    Write-Host '  git идентичност се задава локално, само ако липсва'
}

# ── 3. GitHub repo ──────────────────────────────────────────────────────────
Write-Step '3/5  GitHub хранилище'
if (-not $repoExists) {
    Write-Host "  създава се публично хранилище $fullName"
    Invoke-Command-Step -Text 'create' -Command "gh repo create $fullName --public --source . --remote origin --push --description `"$Description`"" -WorkDir $gitDir | Out-Null
}
else {
    Write-Host "  хранилището съществува — push към origin (без force)"
    Invoke-Command-Step -Text 'push' -Command 'git push origin HEAD:main' -WorkDir $gitDir | Out-Null
}

# Метаданни, които HACS проверява за включване в списъка по подразбиране.
$topicArgs = ($Topics | ForEach-Object { "--add-topic $_" }) -join ' '
Invoke-Command-Step -Text 'meta' -Command "gh repo edit $fullName --description `"$Description`" $topicArgs --enable-issues" -WorkDir $gitDir | Out-Null

# ── 4. Таг → release ────────────────────────────────────────────────────────
Write-Step "4/5  Таг $tag"
# Таг се вдига само веднъж за дадена версия: ако вече сочи друг commit, не го местим
# (това е подмяна на издадено издание) — вместо това се вдига версията.
$remoteTagSha = if ($Execute) { (gh api "repos/$fullName/git/ref/tags/$tag" --jq .object.sha 2>$null) } else { $null }
Push-Location $gitDir
try { $headSha = if ($Execute) { git rev-parse HEAD } else { '' } } finally { Pop-Location }

if ($Execute -and $remoteTagSha) {
    if ($remoteTagSha -eq $headSha) {
        Write-Host "  тагът вече сочи този commit — нищо за правене"
    }
    else {
        Write-Host "  ВНИМАНИЕ: тагът $tag вече сочи друг commit — не го местя." -ForegroundColor Yellow
        Write-Host '  За ново издание вдигни версията (build-release.cjs --version X) и пусни отново.'
    }
}
else {
    Invoke-Command-Step -Text 'tag' -Command "git tag -f $tag; git push origin $tag" -WorkDir $gitDir | Out-Null
}
Write-Host '  workflow-ът release.yml създава GitHub release (сверява тага с manifest.json)'

# ── 5. Проверка ─────────────────────────────────────────────────────────────
Write-Step '5/5  Проверка'
Invoke-Command-Step -Text 'release' -Command "gh release list -R $fullName -L 3" | Out-Null

Write-Host ''
if ($Execute) {
    Write-Host "✓ Публикувано: $repoUrl" -ForegroundColor Green
    Write-Host '  HACS → Integrations → ⋮ → Custom repositories → добави адреса, категория Integration.'
    Write-Host '  Validate (hassfest + HACS action) трябва да е зелено преди PR към hacs/default.'
}
else {
    Write-Host '✓ Dry run приключи. За реално публикуване добави -Execute.' -ForegroundColor Green
    Write-Host '  Стъпките 2–5 не бяха изпълнени; стъпка 1 (build) също е само показана.'
}
