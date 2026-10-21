#requires -Version 7.0
<#
.SYNOPSIS
    Публикува ново издание на hAPI Enterprise в GitHub (по подразбиране PasevSU/hAPI).

.DESCRIPTION
    Многослоен, отбранителен скрипт. На всяка крачка пита преди да продължи и предлага
    всички разумни варианти, вместо да приема едно-единствено решение. Слоеве:

      0. Среда        — PowerShell 7, gh, автентикация, лимити за API.
      0б. Хранилище   — пита В КОЕ хранилище (списък от gh repo list), достъп, права, клон.
      1. Източник     — къде е новата версия (списък, ръчен път, изграждане, презареждане).
      2. Цялост       — манифест, формат на версията, артефакти, липсващи/празни файлове.
      3. Съгласуваност— config.yaml, custom_components, release/haoss, dist/RELEASE.json,
                        CHANGELOG, съществуващ таг.
      4. Контролни суми— сверява SHA256SUMS.txt; при разлика пита (преизчисли/пропусни/стоп).
      5. Текст        — CHANGELOG, файл, Notepad, ръчно въвеждане, предишно издание.
      6. Отдалечено   — съществуващо издание/таг/клон, draft/prerelease/latest, сблъсък на имена.
      7. Потвърждение — пълен преглед и изрично потвърждение чрез изписване на версията.
      8. Публикуване  — създаване, после отделно качване (за да може да се продължи при частичен
                        провал), с повторни опити и възстановяване.
      9. Проверка     — сверява каченото с очакваното, предлага отваряне/повторно качване/изтриване.
      10. HACS        — пита дали да обнови и HACS хранилището (интеграцията) до същата версия.

    Без -Execute НИЩО не се качва: показват се проверките, текстът и точната gh команда.

.PARAMETER Repo
    Подразбиращо се хранилище (owner/name). При интерактивен режим скриптът пита в кое
    хранилище да публикува и предлага списък от "gh repo list"; стойността тук е
    предварително маркираният избор. С -Yes питаенето се пропуска и се ползва тази стойност.

.PARAMETER Source
    Път до папка с custom_components/hapi_enterprise/manifest.json или до
    dist/hapi_enterprise-<версия>.tar.gz. Ако е зададен, изборът от списък се пропуска.

.PARAMETER NotesFile
    Файл с текста на изданието (Markdown).

.PARAMETER TagName
    Таг по подразбиране v<версия>.

.PARAMETER Title
    Заглавие по подразбиране 'hAPI Enterprise <версия>'.

.PARAMETER Target
    Клон/ревизия, върху която се създава тагът, ако още го няма (по подразбиране main).

.PARAMETER Execute
    Реално публикуване. Без него — само проверки и показване на командата.

.PARAMETER Force
    Позволява несъответствие на версията с работното копие и обновяване на съществуващо издание.

.PARAMETER Yes
    Неинтерактивен режим: приема подразбиращите се (безопасни) отговори и пропуска
    потвърждението с изписване на версията. Опасните избори остават отказани.

.PARAMETER Draft
    Публикува като чернова.

.PARAMETER Prerelease
    Маркира изданието като предварително.

.PARAMETER Latest
    Маркира изданието като 'latest' дори при prerelease.

.PARAMETER Retries
    Колко пъти да се повтори провалена gh команда, преди да попита (по подразбиране 3).

.PARAMETER LogFile
    Път до лог файл. По подразбиране — временен файл, който се показва накрая.

.PARAMETER Hacs
    След успешно публикуване обновява и HACS хранилището (интеграцията) без да пита.
    Без него скриптът пита; в неинтерактивен режим (-Yes) HACS НЕ се пипа.

.PARAMETER SkipHacs
    Не предлага обновяване на HACS хранилището (само add-on изданието).

.EXAMPLE
    pwsh -File release/publish-release.ps1
    Интерактивно: избираш източник, минаваш през всички проверки, потвърждаваш (dry run).

.EXAMPLE
    pwsh -File release/publish-release.ps1 -Source release/haoss_v.0.63.0 -Execute
    Публикува избраната версия; пита само за нещата, които не могат да се решат сами.

.EXAMPLE
    pwsh -File release/publish-release.ps1 -Source dist/hapi_enterprise-0.63.0.tar.gz -Force -Yes -Execute
    Напълно неинтерактивно обновяване на съществуващо издание.
#>
[CmdletBinding()]
param(
    [string]$Repo = 'PasevSU/hAPI',
    [string]$Source,
    [string]$NotesFile,
    [string]$TagName,
    [string]$Title,
    [string]$Target = 'main',
    [switch]$Execute,
    [switch]$Force,
    [switch]$Yes,
    [switch]$Draft,
    [switch]$Prerelease,
    [switch]$Latest,
    [int]$Retries = 3,
    [switch]$Hacs,
    [switch]$SkipHacs,
    [string]$LogFile
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ── Пътища и състояние ─────────────────────────────────────────────────────
$Root = Split-Path -Parent $PSScriptRoot
$ReleaseRoot = Join-Path $Root 'release'
$DistRoot = Join-Path $Root 'dist'
$Changelog = Join-Path $Root 'CHANGELOG.md'

$script:NonInteractive = [bool]$Yes
$script:RetryLimit = [Math]::Max(1, $Retries)
$script:LogPath = $null
$script:SourcePath = $Source
$script:Chosen = $null
$script:Version = $null
$script:Assets = @()
$script:AssetInfo = @()
$script:NotesText = ''
$script:NotesOrigin = ''
$script:ExistingRelease = $null
$script:Mode = 'create'
$script:TagOnRemote = $false
$script:Draft = [bool]$Draft
$script:Prerelease = [bool]$Prerelease
$script:Latest = [bool]$Latest
$script:RestartLimit = 12
$script:GhReady = $false
$script:TargetExplicit = $PSBoundParameters.ContainsKey('Target')
$script:TagExplicit = $PSBoundParameters.ContainsKey('TagName')
$script:SummaryShown = $false
$script:HacsWanted = [bool]$Hacs
$script:SkipHacs = [bool]$SkipHacs
$script:ReleaseGone = $false

# ── Изход и лог ────────────────────────────────────────────────────────────
function Write-Step([string]$Text) {
    Write-Host "`n▸ $Text" -ForegroundColor Cyan
    Write-Log "== $Text"
}
function Write-Ok([string]$Text) {
    Write-Host "  ✔ $Text" -ForegroundColor Green
    Write-Log "OK  $Text"
}
function Write-Warn2([string]$Text) {
    Write-Host "  ! $Text" -ForegroundColor Yellow
    Write-Log "WARN $Text"
}
function Write-Info([string]$Text) {
    Write-Host "  · $Text" -ForegroundColor DarkGray
    Write-Log "    $Text"
}
function Write-Log([string]$Text) {
    if (-not $script:LogPath) { return }
    try {
        Add-Content -LiteralPath $script:LogPath -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Text) -Encoding utf8
    }
    catch {
        $script:LogPath = $null
    }
}
function Stop-WithError([string]$Message) {
    Write-Host "`n✗ $Message" -ForegroundColor Red
    Write-Log "FATAL $Message"
    if ($script:LogPath) { Write-Host "  лог: $script:LogPath" -ForegroundColor DarkGray }
    exit 1
}
function Stop-Gracefully([string]$Message) {
    Write-Host "`n▸ $Message" -ForegroundColor DarkYellow
    Write-Log "STOP $Message"
    if ($script:LogPath) { Write-Host "  лог: $script:LogPath" -ForegroundColor DarkGray }
    exit 0
}

# ── Вход: всички въпроси минават през тези три ─────────────────────────────
function Ask-Choice {
    param(
        [Parameter(Mandatory)][string]$Question,
        [Parameter(Mandatory)][System.Collections.Specialized.OrderedDictionary]$Choices,
        [string]$Default = '',
        [switch]$AllowQuit,
        [string]$Help = ''
    )
    if ($script:NonInteractive -and $Default) {
        Write-Info "автоматичен избор '$Default' (-Yes)"
        return $Default
    }
    if ($script:NonInteractive -and -not $Default) {
        Stop-WithError "Не мога да реша сам: $Question (нужен е интерактивен режим или -Force)."
    }
    while ($true) {
        Write-Host ''
        Write-Host "  $Question" -ForegroundColor White
        foreach ($key in $Choices.Keys) {
            $mark = if ("$key" -eq $Default) { '*' } else { ' ' }
            Write-Host ("  {0}[{1}] {2}" -f $mark, $key, $Choices[$key]) -ForegroundColor Gray
        }
        if ($AllowQuit) { Write-Host '    [q] отказ' -ForegroundColor DarkGray }
        if ($Help) { Write-Host '    [?] повече пояснения' -ForegroundColor DarkGray }
        $hint = if ($Default) { " (Enter = $Default)" } else { '' }
        $answer = Read-Host "  Избор$hint"
        $answer = "$answer".Trim().ToLowerInvariant()
        if ($answer -eq '' -and $Default) { return $Default }
        if ($answer -eq 'q' -and $AllowQuit) { Stop-Gracefully 'Отказано от потребителя.' }
        if ($answer -eq '?' -and $Help) { Write-Host "`n$Help" -ForegroundColor DarkCyan; continue }
        foreach ($key in $Choices.Keys) {
            if ($answer -eq "$key".ToLowerInvariant()) { return "$key" }
        }
        Write-Warn2 "Невалиден избор: '$answer'. Опитай пак."
    }
}

function Ask-Text {
    param(
        [Parameter(Mandatory)][string]$Question,
        [string]$Default = '',
        [scriptblock]$Validate,
        [string]$Help = ''
    )
    if ($script:NonInteractive -and $Default) { return $Default }
    while ($true) {
        $hint = if ($Default) { " (Enter = $Default)" } else { '' }
        if ($Help) { Write-Host "  $Help" -ForegroundColor DarkGray }
        $answer = Read-Host "  $Question$hint"
        if ([string]::IsNullOrWhiteSpace($answer)) {
            if ($Default) { return $Default }
            Write-Warn2 'Нужна е стойност.'
            continue
        }
        $answer = "$answer".Trim()
        if ($Validate) {
            $problem = & $Validate $answer
            if ($problem) { Write-Warn2 $problem; continue }
        }
        return $answer
    }
}

function Ask-Confirm {
    param([Parameter(Mandatory)][string]$Question, [bool]$Default = $false)
    if ($script:NonInteractive) { Write-Info "$Question → да (-Yes)"; return $true }
    while ($true) {
        $hint = if ($Default) { '[Д/н]' } else { '[д/Н]' }
        $answer = Read-Host "  $Question $hint"
        $a = "$answer".Trim().ToLowerInvariant()
        if ($a -eq '') { return $Default }
        if ($a -in @('д', 'да', 'y', 'yes')) { return $true }
        if ($a -in @('н', 'не', 'n', 'no')) { return $false }
        Write-Warn2 "Отговори с 'д' или 'н'."
    }
}

function Confirm-Strict {
    param(
        [Parameter(Mandatory)][string]$Question,
        [Parameter(Mandatory)][string]$Expected,
        [int]$Attempts = 2
    )
    if ($script:NonInteractive) { Write-Warn2 "$Question → отказано (неинтерактивен режим)"; return $false }
    for ($i = 1; $i -le $Attempts; $i++) {
        $answer = Read-Host "  $Question (напиши '$Expected' за потвърждение, Enter = отказ)"
        $trimmed = "$answer".Trim()
        if ($trimmed -eq '') {
            # Празният ред е най-честата причина „пуснах го, а нищо не стана“ — казвам го ясно.
            Write-Warn2 'получих празен ред — приемам го като отказ, нищо не е направено'
            return $false
        }
        if ($trimmed -eq $Expected) { return $true }
        if ($trimmed -in @('q', 'quit', 'exit', 'не', 'no')) { return $false }
        Write-Warn2 "'$trimmed' не съвпада с '$Expected' — опитай пак"
    }
    return $false
}

function Read-MultilineText([string]$Hint) {
    Write-Host "  $Hint" -ForegroundColor DarkGray
    Write-Host '  (завърши с ред, съдържащ само точка: .)' -ForegroundColor DarkGray
    $lines = [System.Collections.Generic.List[string]]::new()
    while ($true) {
        $line = Read-Host
        if ($null -eq $line) { break }
        if ("$line".Trim() -eq '.') { break }
        $lines.Add("$line")
    }
    return (($lines -join "`n").Trim())
}

# ── gh: всички извиквания минават оттук (повторни опити + избор при провал) ─
function Invoke-Gh {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$AllowFailure,
        [string]$What = 'gh'
    )
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Log "$What → gh липсва"
        return [pscustomobject]@{ Ok = $false; ExitCode = 127; Text = 'gh не е инсталиран'; Skipped = $true }
    }
    $attempt = 0
    while ($true) {
        $attempt++
        $raw = & gh @Arguments 2>&1
        $code = $LASTEXITCODE
        $text = (($raw | ForEach-Object { "$_" }) -join "`n").Trim()
        if ($code -eq 0) {
            Write-Log "$What → OK"
            return [pscustomobject]@{ Ok = $true; ExitCode = 0; Text = $text; Skipped = $false }
        }
        Write-Log "$What → код $code · $text"
        if ($AllowFailure) {
            return [pscustomobject]@{ Ok = $false; ExitCode = $code; Text = $text; Skipped = $false }
        }
        if ($script:NonInteractive) { Stop-WithError "$What се провали (код $code): $text" }
        if ($attempt -lt $script:RetryLimit) {
            Write-Warn2 "$What се провали (опит $attempt/$($script:RetryLimit)) — пробвам пак."
            Write-Log "  детайл: $text"
            Start-Sleep -Seconds ([Math]::Min(8, 2 * $attempt))
            continue
        }
        Write-Warn2 "$What се провали след $attempt опита:"
        Write-Host "    $text" -ForegroundColor DarkRed
        $choice = Ask-Choice -Question 'Как да продължа?' -AllowQuit -Choices ([ordered]@{
                'r' = 'опитай още веднъж'
                'm' = 'покажи командата, за да я пусна ръчно'
                's' = 'пропусни стъпката и продължи'
            }) -Default 'r' -Help 'Избери "r" при временна мрежова грешка, "m" за ръчно изпълнение, "s" само ако стъпката не е критична.'
        if ($choice -eq 'r') { $attempt = 0; continue }
        if ($choice -eq 'm') {
            Write-Host "`n  gh $($Arguments -join ' ')" -ForegroundColor Yellow
            $null = Read-Host '  Натисни Enter, за да продължа'
            continue
        }
        return [pscustomobject]@{ Ok = $false; ExitCode = $code; Text = $text; Skipped = $true }
    }
}

# ── Слой 0 · Среда ─────────────────────────────────────────────────────────
function Test-Environment {
    Write-Step 'Слой 0 · Среда и достъп'

    if ($PSVersionTable.PSVersion.Major -lt 7) { Stop-WithError 'Нужен е PowerShell 7 или по-нов.' }
    Write-Ok "PowerShell $($PSVersionTable.PSVersion)"

    while (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Warn2 'липсва GitHub CLI (gh)'
        $guess = @(
            (Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'GitHub CLI\gh.exe'),
            (Join-Path $env:LOCALAPPDATA 'GitHubCLI\gh.exe')
        ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
        if ($guess) {
            Write-Info "намерих го тук: $guess"
            if (Ask-Confirm "Да добавя ли $guess към PATH за тази сесия?" -Default $true) {
                $env:PATH = "$(Split-Path -Parent $guess);$env:PATH"
                continue
            }
        }
        $choice = Ask-Choice -Question 'Как да продължа без gh?' -AllowQuit -Choices ([ordered]@{
                'w' = 'инсталирай с winget (winget install GitHub.cli)'
                'i' = 'покажи страницата за изтегляне'
                'c' = 'провери пак (инсталирах го междувременно)'
                'x' = 'продължи без gh — само проверки, без публикуване'
            }) -Default 'c' -Help 'Без gh публикуване е невъзможно; режимът "x" стига само до dry run.'
        if ($choice -eq 'w') {
            & winget install --id GitHub.cli --accept-source-agreements --accept-package-agreements
            continue
        }
        if ($choice -eq 'i') {
            Start-Process 'https://cli.github.com/'
            $null = Read-Host '  Натисни Enter, когато си готов'
            continue
        }
        if ($choice -eq 'x') { $script:Execute = $false; Write-Warn2 'продължавам без gh — само dry run'; return }
        continue
    }
    Write-Ok "gh $(& gh --version | Select-Object -First 1)"

    while ($true) {
        $auth = & gh auth status --hostname github.com 2>&1
        if ($LASTEXITCODE -eq 0) { $script:GhReady = $true; Write-Ok 'автентикация: ok'; break }
        Write-Warn2 'gh не е автентикиран'
        Write-Log "auth: $(($auth | ForEach-Object { "$_" }) -join ' | ')"
        $choice = Ask-Choice -Question 'Как да продължа?' -AllowQuit -Choices ([ordered]@{
                'l' = 'пусни "gh auth login" сега'
                'c' = 'провери пак'
                'x' = 'продължи без автентикация (само dry run)'
            }) -Default 'l' -Help 'Нужен е scope "repo" (и "workflow", ако хранилището ползва Actions).'
        if ($choice -eq 'l') {
            & gh auth login --hostname github.com --web --git-protocol https
            continue
        }
        if ($choice -eq 'x') { $script:Execute = $false; Write-Warn2 'само dry run'; return }
    }

    $limit = Invoke-Gh -Arguments @('api', 'rate_limit', '--jq', '.resources.core.remaining') -AllowFailure -What 'gh api rate_limit'
    if ($limit.Ok -and $limit.Text -match '^\d+$') {
        $remaining = [int]$limit.Text
        if ($remaining -lt 20) { Write-Warn2 "остават само $remaining заявки към GitHub API — възможни са откази" }
        else { Write-Info "API заявки: $remaining оставащи" }
    }
}

# ── Слой 0б · Кое хранилище ────────────────────────────────────────────────
function Get-RepoCandidates {
    $result = [System.Collections.Generic.List[object]]::new()
    $owner = ''
    $login = Invoke-Gh -Arguments @('api', 'user', '--jq', '.login') -AllowFailure -What 'gh api user'
    if ($login.Ok -and $login.Text) { $owner = $login.Text.Trim() }

    $listArgs = @('repo', 'list')
    if ($owner) { $listArgs += $owner }
    $listArgs += @('--limit', '40', '--json', 'nameWithOwner,description,visibility,pushedAt')
    $list = Invoke-Gh -Arguments $listArgs -AllowFailure -What 'gh repo list'
    if (-not $list.Ok -or -not $list.Text) { return $result }

    $items = @()
    try { $items = @($list.Text | ConvertFrom-Json) } catch { return $result }
    foreach ($item in $items) {
        $parts = [System.Collections.Generic.List[string]]::new()
        if ($item.PSObject.Properties['visibility'] -and $item.visibility) { $parts.Add([string]$item.visibility) }
        $pushed = [datetime]::MinValue
        if ($item.PSObject.Properties['pushedAt'] -and $item.pushedAt) {
            try {
                $pushed = [datetime]$item.pushedAt
                $parts.Add('последно: ' + $pushed.ToString('yyyy-MM-dd'))
            }
            catch { $pushed = [datetime]::MinValue }
        }
        if ($item.PSObject.Properties['description'] -and $item.description) { $parts.Add([string]$item.description) }
        $score = if ([string]$item.nameWithOwner -match 'hapi') { 0 } else { 1 }
        $result.Add([pscustomobject]@{
                FullName = [string]$item.nameWithOwner
                Note     = ($parts -join ' · ')
                Pushed   = $pushed
                Score    = $score
            })
    }
    # първо hAPI хранилищата, после по дата на последна промяна
    return @($result | Sort-Object -Property @{ Expression = 'Score'; Ascending = $true }, @{ Expression = 'Pushed'; Descending = $true })
}

function Select-Repo {
    Write-Step 'Слой 0б · В кое хранилище публикуваме'
    if ($script:NonInteractive) {
        Write-Ok "хранилище: $Repo (от параметъра; -Yes не пита)"
        return
    }
    if ($Repo) { Write-Info "текущо: $Repo (от -Repo или по подразбиране)" }

    $attempt = 0
    while ($true) {
        $attempt++
        if ($attempt -gt 8) { Stop-WithError 'Твърде много опити за избор на хранилище.' }
        $repos = @(Get-RepoCandidates)
        if (-not $repos.Count) { Write-Warn2 'не мога да извадя списък с хранилища от GitHub' }

        $choices = [ordered]@{}
        $default = 'm'
        for ($i = 0; $i -lt $repos.Count; $i++) {
            $choices["$($i + 1)"] = "$($repos[$i].FullName)  —  $($repos[$i].Note)"
            if ($repos[$i].FullName -eq $Repo) { $default = "$($i + 1)" }
        }
        $choices['m'] = "друго (owner/name) — сега: $Repo"
        $choices['r'] = 'презареди списъка от GitHub'

        $answer = Ask-Choice -Question 'В кое хранилище да публикуваме?' -Choices $choices -Default $default -AllowQuit `
            -Help 'Списъкът идва от "gh repo list" (до 40 хранилища, най-скоро променяните първи). Ако нужното липсва, избери "m".'

        if ($answer -eq 'r') { continue }
        if ($answer -eq 'm') {
            $script:Repo = Ask-Text -Question 'Хранилище (owner/name)' -Default $Repo -Validate {
                param($value)
                if ($value -notmatch '^[\w.-]+/[\w.-]+$') { return 'Очаквам формат owner/name (напр. PasevSU/hAPI).' }
                return $null
            }
        }
        else {
            $index = [int]$answer - 1
            $script:Repo = [string]$repos[$index].FullName
        }

        Write-Ok "хранилище: $($script:Repo)"
        if ($script:Repo -match 'integration') {
            Write-Info 'това име подсказва хранилище за HACS интеграцията — провери дали артефактите са за него'
        }
        $keep = Ask-Choice -Question 'Потвърждаваш ли това хранилище?' -Choices ([ordered]@{
                'c' = "да — $($script:Repo)"
                'b' = 'не, върни ме към списъка'
                'q' = 'прекрати'
            }) -Default 'c'
        if ($keep -eq 'c') { return }
        if ($keep -eq 'q') { Stop-Gracefully 'Отказано от потребителя.' }
    }
}

function Test-RepoAccess {
    Write-Step 'Слой 0в · Достъп до хранилището'
    while ($true) {
        $view = Invoke-Gh -Arguments @('repo', 'view', $Repo, '--json', 'nameWithOwner,visibility,viewerPermission,defaultBranchRef') -AllowFailure -What 'gh repo view'
        if (-not $view.Ok) {
            Write-Warn2 "няма достъп до $Repo"
            $choice = Ask-Choice -Question 'Хранилището не е достъпно. Какво да правим?' -AllowQuit -Choices ([ordered]@{
                    's' = 'избери друго от списъка'
                    'c' = 'въведи друго име (owner/name)'
                    'r' = 'провери пак'
                    'x' = 'продължи въпреки това (може да се провали при публикуване)'
                }) -Default 'c' -Help 'Провери името и правата на токена: gh auth status.'
            if ($choice -eq 's') { Select-Repo; continue }
            if ($choice -eq 'c') {
                $script:Repo = Ask-Text -Question 'Хранилище (owner/name)' -Default $Repo -Validate {
                    param($value)
                    if ($value -notmatch '^[\w.-]+/[\w.-]+$') { return 'Очаквам формат owner/name.' }
                    return $null
                }
                continue
            }
            if ($choice -eq 'x') { Write-Warn2 'продължавам без потвърден достъп'; return }
            continue
        }

        $info = $null
        try { $info = $view.Text | ConvertFrom-Json } catch { $info = $null }
        if ($info) {
            $perm = [string]$info.viewerPermission
            Write-Ok "$($info.nameWithOwner) · $($info.visibility) · права: $perm"
            if ($perm -notin @('ADMIN', 'MAINTAIN', 'WRITE')) {
                Write-Warn2 "правата ($perm) не позволяват публикуване"
                $choice = Ask-Choice -Question 'Правата не стигат. Какво да правим?' -AllowQuit -Choices ([ordered]@{
                        's' = 'избери друго от списъка'
                        'c' = 'въведи друго име (owner/name)'
                        'x' = 'продължи (публикуването вероятно ще се провали)'
                    }) -Default 'c'
                if ($choice -eq 's') { Select-Repo; continue }
                if ($choice -eq 'c') {
                    $script:Repo = Ask-Text -Question 'Хранилище (owner/name)' -Default $Repo
                    continue
                }
                Write-Warn2 'продължавам с недостатъчни права'
            }

            $branch = ''
            if ($info.PSObject.Properties['defaultBranchRef'] -and $info.defaultBranchRef) { $branch = [string]$info.defaultBranchRef.name }
            if ($branch) {
                Write-Info "клон по подразбиране: $branch"
                if (-not $script:TargetExplicit -and $script:Target -and $branch -ne $script:Target) {
                    Write-Warn2 "тагът по подразбиране ще се създаде върху '$($script:Target)', а клонът по подразбиране е '$branch'"
                    $choice = Ask-Choice -Question 'Върху кой клон да сочи тагът?' -Choices ([ordered]@{
                            'y' = "$branch (клонът по подразбиране)"
                            'k' = "$($script:Target) (както е зададено)"
                        }) -Default 'y'
                    if ($choice -eq 'y') { $script:Target = $branch }
                    Write-Ok "клон за тага: $($script:Target)"
                }
            }
        }
        return
    }
}

# ── Слой 1 · Източник ──────────────────────────────────────────────────────
function Get-ManifestVersion([string]$Directory) {
    $manifest = Join-Path $Directory 'custom_components/hapi_enterprise/manifest.json'
    if (-not (Test-Path -LiteralPath $manifest)) { return $null }
    try { return [string](Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).version } catch { return $null }
}

function Collect-DistAssets([string]$Directory, [string]$Version) {
    $result = [System.Collections.Generic.List[string]]::new()
    $tar = Join-Path $Directory "hapi_enterprise-$Version.tar.gz"
    $zip = Join-Path $Directory "hapi_enterprise-integration-$Version.zip"
    if (Test-Path -LiteralPath $tar) { $result.Add($tar) }
    if (Test-Path -LiteralPath $zip) { $result.Add($zip) }
    else { Write-Warn2 "липсва hapi_enterprise-integration-$Version.zip" }

    $releaseJson = Join-Path $Directory 'RELEASE.json'
    if (Test-Path -LiteralPath $releaseJson) {
        $metaVersion = $null
        try {
            $meta = Get-Content -LiteralPath $releaseJson -Raw | ConvertFrom-Json
            if ($meta.PSObject.Properties['version']) { $metaVersion = [string]$meta.version }
        }
        catch { $metaVersion = $null }
        if ($metaVersion -eq $Version) { $result.Add($releaseJson) }
        elseif ($metaVersion) { Write-Warn2 "RELEASE.json е за $metaVersion, не за $Version — няма да го прикача" }
    }

    $sums = Join-Path $Directory 'SHA256SUMS.txt'
    if (Test-Path -LiteralPath $sums) {
        $names = [System.Collections.Generic.List[string]]::new()
        foreach ($line in Get-Content -LiteralPath $sums -ErrorAction SilentlyContinue) {
            if ($line -match '^[a-f0-9]{64}\s{2}(.+)$') { $names.Add($Matches[1].Trim()) }
        }
        if ($names.Contains("hapi_enterprise-$Version.tar.gz")) { $result.Add($sums) }
        elseif ($names.Count) { Write-Warn2 "SHA256SUMS.txt не покрива версия $Version (за друга версия е) — няма да го прикача" }
    }
    return @($result)
}

function New-DistCandidate([string]$TarPath) {
    if ($TarPath -notmatch '^(?:.*[\\/])?hapi_enterprise-(\d+\.\d+\.\d+)\.tar\.gz$') { return $null }
    $version = $Matches[1]
    $directory = Split-Path -Parent $TarPath
    $assets = @(Collect-DistAssets $directory $version)
    $totalMb = 0
    if ($assets.Count) {
        $sum = ($assets | ForEach-Object { (Get-Item -LiteralPath $_).Length } | Measure-Object -Sum).Sum
        if ($sum) { $totalMb = [math]::Round($sum / 1MB, 2) }
    }
    return [pscustomobject]@{
        Kind    = 'dist'
        Path    = $TarPath
        Version = $version
        Label   = "dist/hapi_enterprise-$version.tar.gz"
        Note    = "готови артефакти · $($assets.Count) файла · $totalMb MB"
        Assets  = $assets
    }
}

function Get-Candidates {
    $list = [System.Collections.Generic.List[object]]::new()

    if (Test-Path -LiteralPath $ReleaseRoot) {
        foreach ($dir in Get-ChildItem -LiteralPath $ReleaseRoot -Directory -Force | Sort-Object Name) {
            $version = Get-ManifestVersion $dir.FullName
            if (-not $version) { continue }
            $files = @(Get-ChildItem -LiteralPath $dir.FullName -Recurse -File -Force)
            $kind = if ($dir.Name -eq 'haoss') { 'текущо HACS издание' } else { 'версионна снимка' }
            $list.Add([pscustomobject]@{
                    Kind    = 'folder'
                    Path    = $dir.FullName
                    Version = $version
                    Label   = "release/$($dir.Name)"
                    Note    = "$kind · $($files.Count) файла"
                    Assets  = @()
                })
        }
    }

    if (Test-Path -LiteralPath $DistRoot) {
        foreach ($tar in Get-ChildItem -LiteralPath $DistRoot -Filter 'hapi_enterprise-*.tar.gz' -File | Sort-Object Name -Descending) {
            $candidate = New-DistCandidate $tar.FullName
            if ($candidate) { $list.Add($candidate) }
        }
    }
    return $list
}

function Get-CandidateFromPath([string]$Path) {
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolved) { return $null }
    $full = $resolved.Path
    if (Test-Path -LiteralPath $full -PathType Leaf) { return (New-DistCandidate $full) }
    $manifest = Join-Path $full 'custom_components/hapi_enterprise/manifest.json'
    if (-not (Test-Path -LiteralPath $manifest)) { return $null }
    $version = Get-ManifestVersion $full
    if (-not $version) { return $null }
    $files = @(Get-ChildItem -LiteralPath $full -Recurse -File -Force)
    return [pscustomobject]@{
        Kind    = 'folder'
        Path    = $full
        Version = $version
        Label   = $full
        Note    = "ръчно указана папка · $($files.Count) файла"
        Assets  = @()
    }
}

function Invoke-Build {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Warn2 'липсва Node.js — не мога да изградя изданието'
        return $false
    }
    $buildScript = Join-Path $Root 'scripts/build-release.cjs'
    if (-not (Test-Path -LiteralPath $buildScript)) {
        Write-Warn2 "липсва $buildScript"
        return $false
    }
    Write-Step 'Изграждане на ново издание (node scripts/build-release.cjs)'
    & node $buildScript
    if ($LASTEXITCODE -ne 0) {
        Write-Warn2 'изграждането се провали'
        return $false
    }
    Write-Ok 'изградено — презареждам списъка'
    return $true
}

function Select-Source {
    Write-Step 'Слой 1 · Къде се намира новата версия'

    if ($script:SourcePath) {
        $candidate = Get-CandidateFromPath $script:SourcePath
        if ($candidate) {
            Write-Ok "$($candidate.Label) · версия $($candidate.Version)"
            $script:Chosen = $candidate
            $script:SourcePath = $candidate.Path
            return $true
        }
        if ($script:NonInteractive) {
            $exists = Test-Path -LiteralPath $script:SourcePath
            $reason = if ($exists) { 'не е издание (липсва custom_components/hapi_enterprise/manifest.json)' } else { 'пътят не съществува' }
            Stop-WithError "-Source '$($script:SourcePath)' е невалиден: $reason."
        }
        Write-Warn2 "не разпознавам издание в '$($script:SourcePath)'"
        $choice = Ask-Choice -Question 'Параметърът -Source не сочи валидно издание.' -AllowQuit -Choices ([ordered]@{
                'l' = 'покажи списъка с наличните издания'
                'm' = 'въведи друг път'
                'q' = 'прекрати'
            }) -Default 'l'
        if ($choice -eq 'm') {
            $script:SourcePath = Ask-Text -Question 'Път до папка или dist/*.tar.gz'
            return (Select-Source)
        }
        if ($choice -eq 'q') { Stop-Gracefully 'Отказано от потребителя.' }
        $script:SourcePath = $null
    }

    $restarts = 0
    while ($true) {
        $restarts++
        if ($restarts -gt 6) { Stop-WithError 'Твърде много опити за избор на източник.' }
        $candidates = @(Get-Candidates)
        if (-not $candidates.Count) {
            Write-Warn2 'няма намерени издания'
            $choice = Ask-Choice -Question 'Какво да правим?' -AllowQuit -Choices ([ordered]@{
                    'b' = 'изгради сега (node scripts/build-release.cjs)'
                    'm' = 'въведи път ръчно'
                    'r' = 'презареди'
                }) -Default 'b'
            if ($choice -eq 'b') { $null = Invoke-Build; continue }
            if ($choice -eq 'm') {
                $answer = Ask-Text -Question 'Път до папка или dist/*.tar.gz'
                $candidate = Get-CandidateFromPath $answer
                if ($candidate) { $script:Chosen = $candidate; $script:SourcePath = $candidate.Path; return $true }
                Write-Warn2 'пътят не е разпознат като издание'
            }
            continue
        }

        $choices = [ordered]@{}
        for ($i = 0; $i -lt $candidates.Count; $i++) {
            $choices["$($i + 1)"] = "$($candidates[$i].Label)  —  версия $($candidates[$i].Version) · $($candidates[$i].Note)"
        }
        $choices['m'] = 'друг път (ръчно въвеждане)'
        $choices['b'] = 'изгради ново издание сега'
        $choices['r'] = 'презареди списъка'

        $answer = Ask-Choice -Question 'Кое издание публикуваме?' -Choices $choices -Default '1' -AllowQuit `
            -Help 'Списъкът включва версионни снимки (release/haoss_v.*), текущото HACS издание и готовите dist артефакти.'

        if ($answer -eq 'm') {
            $path = Ask-Text -Question 'Път до папка или dist/*.tar.gz'
            $candidate = Get-CandidateFromPath $path
            if ($candidate) {
                Write-Ok "$($candidate.Label) · версия $($candidate.Version)"
                $script:Chosen = $candidate
                $script:SourcePath = $candidate.Path
                return $true
            }
            Write-Warn2 'не разпознавам издание по този път'
            continue
        }
        if ($answer -eq 'b') { $null = Invoke-Build; continue }
        if ($answer -eq 'r') { continue }

        $index = 0
        if ([int]::TryParse($answer, [ref]$index) -and $index -ge 1 -and $index -le $candidates.Count) {
            $script:Chosen = $candidates[$index - 1]
            $script:SourcePath = $script:Chosen.Path
            Write-Ok "$($script:Chosen.Label) · версия $($script:Chosen.Version)"
            return $true
        }
        Write-Warn2 'невалиден избор'
    }
}

# ── Слой 2 · Цялост на източника ───────────────────────────────────────────
function Test-Integrity {
    Write-Step 'Слой 2 · Цялост на източника'
    $chosen = $script:Chosen
    $version = [string]$chosen.Version

    if ($version -notmatch '^\d+\.\d+\.\d+$') {
        Write-Warn2 "невалидна версия: '$version'"
        $choice = Ask-Choice -Question 'Версията не е във формат X.Y.Z. Какво да правим?' -AllowQuit -Choices ([ordered]@{
                's' = 'смени източника'
                'm' = 'въведи версия ръчно'
                'q' = 'прекрати'
            }) -Default 's'
        if ($choice -eq 'm') {
            $version = Ask-Text -Question 'Версия (X.Y.Z)' -Default '0.0.0' -Validate {
                param($value)
                if ($value -notmatch '^\d+\.\d+\.\d+$') { return 'Очаквам формат X.Y.Z (напр. 0.64.0).' }
                return $null
            }
            $script:Version = $version
        }
        else {
            return $false
        }
    }
    $script:Version = $version
    Write-Ok "версия $version"

    $assets = @($chosen.Assets)
    if ($chosen.Kind -eq 'folder') {
        $fromDist = @(Collect-DistAssets $DistRoot $version)
        if ($fromDist.Count) {
            Write-Info "намерих готови артефакти за $version в dist/ — ще ги прикача"
            $assets = $fromDist
        }
        else {
            Write-Warn2 "няма dist артефакти за $version"
        }
    }

    if (-not $assets.Count) {
        if ($script:NonInteractive) {
            Stop-WithError "Няма артефакти за версия $version. Изгради ги (node scripts/build-release.cjs) или подай -Source към dist/*.tar.gz."
        }
        $choice = Ask-Choice -Question 'Изданието е без прикачени файлове. Продължаваме ли така?' -AllowQuit -Choices ([ordered]@{
                't' = 'само текст (без файлове)'
                'b' = 'изгради артефактите сега'
                's' = 'смени източника'
                'q' = 'прекрати'
            }) -Default 'b' -Help 'Add-on и HACS интеграцията се разпространяват чрез тези файлове; издание само с текст е непълно.'
        if ($choice -eq 'b') { $null = Invoke-Build; return $false }
        if ($choice -eq 's') { return $false }
        if ($choice -eq 'q') { Stop-Gracefully 'Отказано от потребителя.' }
    }

    $bad = @()
    foreach ($file in $assets) {
        if (-not (Test-Path -LiteralPath $file)) { $bad += "липсва: $file"; continue }
        $item = Get-Item -LiteralPath $file
        if ($item.Length -eq 0) { $bad += "празен файл: $($item.Name)" }
    }
    if ($bad.Count) {
        foreach ($entry in $bad) { Write-Warn2 $entry }
        if ($script:NonInteractive) {
            Stop-WithError "Проблемни файлове: $($bad -join '; '). Изгради наново или коригирай -Source."
        }
        $choice = Ask-Choice -Question 'Има проблемни файлове. Какво да правим?' -AllowQuit -Choices ([ordered]@{
                'x' = 'пропусни проблемните и продължи'
                'b' = 'изгради наново'
                's' = 'смени източника'
                'q' = 'прекрати'
            }) -Default 'b'
        if ($choice -eq 'x') {
            $assets = @($assets | Where-Object { (Test-Path -LiteralPath $_) -and (Get-Item -LiteralPath $_).Length -gt 0 })
            if (-not $assets.Count) { Write-Warn2 'не остана нито един файл'; return $false }
        }
        elseif ($choice -eq 'b') { $null = Invoke-Build; return $false }
        elseif ($choice -eq 's') { return $false }
        else { Stop-Gracefully 'Отказано от потребителя.' }
    }

    $script:Assets = @($assets)
    $script:AssetInfo = @()
    foreach ($file in $script:Assets) {
        $item = Get-Item -LiteralPath $file
        $script:AssetInfo += [pscustomobject]@{
            Name = $item.Name
            Path = $item.FullName
            Size = $item.Length
        }
    }
    if ($script:AssetInfo.Count) {
        Write-Ok "артефакти: $($script:AssetInfo.Count) файла · $([math]::Round((($script:AssetInfo | Measure-Object -Property Size -Sum).Sum) / 1MB, 2)) MB"
    }
    return $true
}

# ── Слой 3 · Съгласуваност с работното копие ────────────────────────────────
function Get-ConfigVersion {
    $configPath = Join-Path $Root 'hapi_enterprise/config.yaml'
    if (-not (Test-Path -LiteralPath $configPath)) { return $null }
    $match = Select-String -LiteralPath $configPath -Pattern '^version:\s*["'']?([^"''\s]+)' | Select-Object -First 1
    if ($match) { return $match.Matches[0].Groups[1].Value }
    return $null
}

function Get-ChangelogSection([string]$Version) {
    if (-not (Test-Path -LiteralPath $Changelog)) { return '' }
    $lines = Get-Content -LiteralPath $Changelog
    $escaped = [regex]::Escape($Version)
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^#{2,3}\s*\[?$escaped\]?(?:\s|$|—|-|–)") { $start = $i + 1; break }
    }
    if ($start -lt 0) { return '' }
    $collected = @()
    for ($i = $start; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^#{1,3}\s') { break }
        $collected += $lines[$i]
    }
    return (($collected -join "`n").Trim())
}

function Test-Consistency {
    Write-Step 'Слой 3 · Съгласуваност'
    $version = $script:Version
    $errors = [System.Collections.Generic.List[string]]::new()
    $warnings = [System.Collections.Generic.List[string]]::new()

    $configVersion = Get-ConfigVersion
    if (-not $configVersion) { $warnings.Add('hapi_enterprise/config.yaml: не намирам версия') }
    elseif ($configVersion -ne $version) { $errors.Add("config.yaml е $configVersion, източникът е $version") }
    else { Write-Ok "config.yaml: $configVersion" }

    $componentVersion = Get-ManifestVersion (Join-Path $Root 'custom_components/hapi_enterprise') 2>$null
    if (-not $componentVersion) {
        $manifestPath = Join-Path $Root 'custom_components/hapi_enterprise/manifest.json'
        if (Test-Path -LiteralPath $manifestPath) {
            try { $componentVersion = [string](Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).version } catch { $componentVersion = $null }
        }
    }
    if ($componentVersion) {
        if ($componentVersion -ne $version) { $warnings.Add("custom_components/hapi_enterprise/manifest.json е $componentVersion, източникът е $version") }
        else { Write-Ok "custom_components: $componentVersion" }
    }

    $haossVersion = Get-ManifestVersion (Join-Path $ReleaseRoot 'haoss')
    if ($haossVersion) {
        if ($haossVersion -ne $version) { $warnings.Add("release/haoss е $haossVersion, източникът е $version") }
        else { Write-Ok "release/haoss: $haossVersion" }
    }

    $section = Get-ChangelogSection $version
    if (-not $section) { $warnings.Add("CHANGELOG.md няма раздел за $version") }
    else { Write-Ok "CHANGELOG.md: има раздел за $version ($($section.Length) знака)" }

    $addonAssets = @($script:AssetInfo | Where-Object { $_.Name -match '^hapi_enterprise-\d' })
    if ($Repo -match 'integration' -and $addonAssets.Count) {
        $warnings.Add("хранилището '$Repo' изглежда е за HACS интеграцията, а артефактите са add-on архив")
    }

    if ($warnings.Count) { foreach ($entry in $warnings) { Write-Warn2 $entry } }
    if ($errors.Count) { foreach ($entry in $errors) { Write-Warn2 "ГРЕШКА: $entry" } }

    if ($errors.Count -and -not $Force) {
        if ($script:NonInteractive) {
            Stop-WithError ("Несъответствие на версиите: " + ($errors -join '; ') + '. Добави -Force, ако е нарочно.')
        }
        $choice = Ask-Choice -Question 'Има несъответствия във версиите. Какво да правим?' -AllowQuit -Choices ([ordered]@{
                'f' = 'продължи въпреки това (както с -Force)'
                's' = 'върни се и смени източника'
                'q' = 'прекрати'
            }) -Default 's' -Help 'Публикуване на версия, различна от работното копие, е допустимо само ако е нарочно (напр. преиздаване).'
        if ($choice -eq 'f') { $script:Force = $true; Write-Warn2 'продължавам с несъответствие' }
        else { return $false }
    }
    elseif ($warnings.Count) {
        $choice = Ask-Choice -Question 'Има предупреждения. Продължаваме ли?' -AllowQuit -Choices ([ordered]@{
                'c' = 'продължи'
                's' = 'върни се и смени източника'
            }) -Default 'c'
        if ($choice -eq 's') { return $false }
    }
    return $true
}

# ── Слой 4 · Контролни суми ────────────────────────────────────────────────
function Update-SumsFile([string]$SumsPath) {
    $directory = Split-Path -Parent $SumsPath
    $names = [System.Collections.Generic.List[string]]::new()
    foreach ($line in Get-Content -LiteralPath $SumsPath) {
        if ($line -match '^[a-f0-9]{64}\s{2}(.+)$') { $names.Add($Matches[1].Trim()) }
    }
    $out = [System.Collections.Generic.List[string]]::new()
    foreach ($name in $names) {
        $file = Join-Path $directory $name
        if (-not (Test-Path -LiteralPath $file)) { Write-Warn2 "пропускам липсващ $name"; continue }
        $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        $out.Add("$hash  $name")
    }
    Set-Content -LiteralPath $SumsPath -Value $out -Encoding utf8
    return $out.Count
}

function Test-Checksums {
    Write-Step 'Слой 4 · Контролни суми'

    $sumsFile = $script:Assets | Where-Object { [IO.Path]::GetFileName($_) -eq 'SHA256SUMS.txt' } | Select-Object -First 1
    if (-not $sumsFile) {
        Write-Warn2 'няма SHA256SUMS.txt — няма с какво да сверя'
        foreach ($asset in $script:AssetInfo) {
            $hash = (Get-FileHash -LiteralPath $asset.Path -Algorithm SHA256).Hash.ToLowerInvariant()
            Write-Info ("{0}  {1}" -f $hash.Substring(0, 16), $asset.Name)
        }
        if (-not $script:Force) {
            $choice = Ask-Choice -Question 'Продължаваме без сверка на контролни суми?' -AllowQuit -Choices ([ordered]@{
                    'c' = 'продължи (сумите са изчислени и показани)'
                    's' = 'смени източника'
                    'q' = 'прекрати'
                }) -Default 'c'
            if ($choice -eq 's') { return $false }
            if ($choice -eq 'q') { Stop-Gracefully 'Отказано от потребителя.' }
        }
        return $true
    }

    $attempt = 0
    while ($true) {
        $attempt++
        if ($attempt -gt 5) { Stop-WithError 'Твърде много опити за сверка на контролните суми.' }
        $directory = Split-Path -Parent $sumsFile
        $checked = 0
        $mismatch = [System.Collections.Generic.List[string]]::new()
        $missing = [System.Collections.Generic.List[string]]::new()
        foreach ($line in Get-Content -LiteralPath $sumsFile) {
            if ($line -notmatch '^([a-f0-9]{64})\s{2}(.+)$') { continue }
            $expected = $Matches[1]
            $name = $Matches[2].Trim()
            $file = Join-Path $directory $name
            if (-not (Test-Path -LiteralPath $file)) { $missing.Add($name); continue }
            $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $expected) { $mismatch.Add("$name ($expected → $actual)") }
            $checked++
        }

        if (-not $mismatch.Count -and -not $missing.Count) {
            Write-Ok "контролни суми: $checked файла съвпадат"
            return $true
        }
        foreach ($entry in $mismatch) { Write-Warn2 "разлика: $entry" }
        foreach ($entry in $missing) { Write-Warn2 "липсва: $entry" }

        $choice = Ask-Choice -Question 'Контролните суми не съвпадат. Публикацията е рискова.' -AllowQuit -Choices ([ordered]@{
                'r' = 'сверявай пак'
                'u' = 'преизчисли SHA256SUMS.txt от файловете'
                'x' = 'продължи въпреки разликата (изрично потвърждение)'
                's' = 'смени източника'
                'q' = 'прекрати'
            }) -Default 'q' -Help 'Разликата обикновено значи стар SHA256SUMS.txt или променен артефакт. Преизчисляването е коректно само ако артефактите са пресни.'
        if ($choice -eq 'u') {
            if (Confirm-Strict -Question 'Да презапиша ли SHA256SUMS.txt с нови стойности?' -Expected 'да') {
                $count = Update-SumsFile $sumsFile
                Write-Ok "обновени $count записа"
            }
            continue
        }
        if ($choice -eq 'x') {
            if (Confirm-Strict -Question 'Да продължа ли въпреки несъвпадащите суми?' -Expected 'да') {
                Write-Warn2 'продължавам без сверка'
                return $true
            }
            continue
        }
        if ($choice -eq 's') { return $false }
        Stop-Gracefully 'Отказано от потребителя.'
    }
}

# ── Слой 5 · Текст на изданието ────────────────────────────────────────────
function New-DefaultNotes([string]$Version, [string[]]$Files) {
    $section = Get-ChangelogSection $Version
    if (-not $section) { $section = '_Няма запис в CHANGELOG.md за тази версия._' }
    $assetLines = if ($Files.Count) {
        ($Files | ForEach-Object { "- ``$([IO.Path]::GetFileName($_))``" }) -join "`n"
    }
    else {
        '- (изданието е само с текст, без прикачени файлове)'
    }
    return @"
hAPI Enterprise $Version — Home Assistant add-on + HACS интеграция

$section

**Файлове в изданието**
$assetLines

Проверка на изтегленото: ``sha256sum -c SHA256SUMS.txt`` (Windows: ``Get-FileHash -Algorithm SHA256``).
"@
}

function Get-PreviousReleaseNotes([string]$TagToFind) {
    $list = Invoke-Gh -Arguments @('release', 'list', '--repo', $Repo, '--limit', '10', '--json', 'tagName,name') -AllowFailure -What 'gh release list'
    if (-not $list.Ok) { return '' }
    $items = @()
    try { $items = @($list.Text | ConvertFrom-Json) } catch { $items = @() }
    $previous = $items | Where-Object { $_.tagName -ne $TagToFind } | Select-Object -First 1
    if (-not $previous) { Write-Warn2 'не намирам предишно издание'; return '' }
    $view = Invoke-Gh -Arguments @('release', 'view', [string]$previous.tagName, '--repo', $Repo, '--json', 'body', '--jq', '.body') -AllowFailure -What 'gh release view'
    if (-not $view.Ok -or [string]::IsNullOrWhiteSpace($view.Text)) { return '' }
    Write-Info "текст от предишното издание $($previous.tagName)"
    return $view.Text
}

function Build-Notes {
    Write-Step 'Слой 5 · Текст на изданието'
    $version = $script:Version
    $tagName = $script:TagName

    if ($NotesFile) {
        if (-not (Test-Path -LiteralPath $NotesFile)) { Stop-WithError "Липсва файл с текст: $NotesFile" }
        $script:NotesText = Get-Content -LiteralPath $NotesFile -Raw
        $script:NotesOrigin = "файл $NotesFile"
        Write-Ok "текст от $NotesFile"
        return (Test-Notes)
    }

    $script:NotesText = New-DefaultNotes $version $script:Assets
    $script:NotesOrigin = 'CHANGELOG.md'
    return (Test-Notes)
}

function Test-Notes {
    $version = $script:Version
    $tagName = $script:TagName
    $editor = Join-Path ([IO.Path]::GetTempPath()) "hapi-release-notes-$version.md"
    $attempt = 0

    while ($true) {
        $attempt++
        if ($attempt -gt 12) { Stop-WithError 'Твърде много опити за текст на изданието.' }
        Write-Host ''
        Write-Host "  ── текст ($($script:NotesText.Length) знака, източник: $($script:NotesOrigin)) ──" -ForegroundColor DarkCyan
        Write-Host $script:NotesText -ForegroundColor Gray
        Write-Host '  ── край на текста ──' -ForegroundColor DarkCyan

        if ($script:NotesText -notmatch [regex]::Escape($version)) { Write-Warn2 "текстът не споменава версия $version" }
        if ($script:NotesText.Length -lt 200) { Write-Warn2 'текстът е много кратък' }
        if ([string]::IsNullOrWhiteSpace($script:NotesText)) { Write-Warn2 'текстът е празен' }

        $choice = Ask-Choice -Question 'Приемаш ли този текст?' -Choices ([ordered]@{
                'c' = 'приемам'
                'e' = 'редактирай в Notepad'
                'n' = 'въведи нов текст ръчно'
                'g' = 'върни се към CHANGELOG за тази версия'
                'p' = 'вземи текста от предишното издание'
                'f' = 'зареди текст от файл'
                'd' = 'добави списък с файловете и указания за проверка'
            }) -Default 'c' -AllowQuit -Help 'Текстът се записва като тяло на GitHub изданието (Markdown).'

        if ($choice -eq 'c') {
            if ([string]::IsNullOrWhiteSpace($script:NotesText)) { Write-Warn2 'празен текст не се приема'; continue }
            return $true
        }
        if ($choice -eq 'e') {
            Set-Content -LiteralPath $editor -Value $script:NotesText -Encoding utf8
            Start-Process -FilePath 'notepad.exe' -ArgumentList "`"$editor`"" -Wait
            $script:NotesText = (Get-Content -LiteralPath $editor -Raw)
            $script:NotesOrigin = 'Notepad'
            continue
        }
        if ($choice -eq 'n') {
            $text = Read-MultilineText 'Въведи текста на изданието:'
            if ([string]::IsNullOrWhiteSpace($text)) { Write-Warn2 'нищо не е въведено'; continue }
            $script:NotesText = $text
            $script:NotesOrigin = 'ръчно въвеждане'
            continue
        }
        if ($choice -eq 'g') {
            $section = Get-ChangelogSection $version
            if (-not $section) { Write-Warn2 "няма раздел за $version в CHANGELOG.md"; continue }
            $script:NotesText = New-DefaultNotes $version $script:Assets
            $script:NotesOrigin = 'CHANGELOG.md'
            continue
        }
        if ($choice -eq 'p') {
            $previous = Get-PreviousReleaseNotes $tagName
            if (-not $previous) { continue }
            $script:NotesText = $previous
            $script:NotesOrigin = 'предишно издание'
            continue
        }
        if ($choice -eq 'f') {
            $path = Ask-Text -Question 'Път до файл с текст'
            if (-not (Test-Path -LiteralPath $path)) { Write-Warn2 'файлът не съществува'; continue }
            $script:NotesText = Get-Content -LiteralPath $path -Raw
            $script:NotesOrigin = "файл $path"
            continue
        }
        if ($choice -eq 'd') {
            $lines = @($script:Assets | ForEach-Object { "- ``$([IO.Path]::GetFileName($_))``" }) -join "`n"
            $script:NotesText = $script:NotesText.TrimEnd() + "`n`n**Файлове в изданието**`n$lines`n`nПроверка: ``sha256sum -c SHA256SUMS.txt``." + "`n"
            Write-Ok 'добавен списък с файлове'
            continue
        }
    }
}

# ── Слой 6 · Състояние в GitHub ────────────────────────────────────────────
function Test-RemoteState {
    Write-Step 'Слой 6 · Състояние в GitHub'
    $tagName = $script:TagName

    if (-not $script:GhReady) {
        Write-Warn2 'без gh не мога да проверя отдалеченото състояние — приемам, че изданието липсва'
        $script:Mode = 'create'
        $script:TagOnRemote = $false
        return $true
    }

    $view = Invoke-Gh -Arguments @('release', 'view', $tagName, '--repo', $Repo, '--json', 'tagName,name,url,isDraft,isPrerelease,assets') -AllowFailure -What 'gh release view'
    $script:ExistingRelease = $null
    if ($view.Ok -and $view.Text) {
        try { $script:ExistingRelease = $view.Text | ConvertFrom-Json } catch { $script:ExistingRelease = $null }
    }

    if ($script:ExistingRelease) {
        $existing = $script:ExistingRelease
        $existingUrl = if ($existing.PSObject.Properties['url']) { [string]$existing.url } else { "$Repo ($($script:TagName))" }
        Write-Warn2 "изданието $tagName вече съществува: $existingUrl"
        if ($existing.PSObject.Properties['isDraft'] -and $existing.isDraft) { Write-Info 'съществуващото е чернова' }
        if ($existing.PSObject.Properties['isPrerelease'] -and $existing.isPrerelease) { Write-Info 'съществуващото е prerelease' }
        $assetCount = 0
        if ($existing.PSObject.Properties['assets'] -and $existing.assets) { $assetCount = @($existing.assets).Count }
        Write-Info "прикачени файлове в него: $assetCount"

        $default = if ($script:Force) { 'u' } else { 'a' }
        $choice = Ask-Choice -Question 'Какво да правим със съществуващото издание?' -AllowQuit -Choices ([ordered]@{
                'u' = 'обнови го (нов текст + качи файловете с --clobber)'
                'a' = 'прекрати (избери друг таг или версия)'
                'n' = 'смени тага'
                'd' = 'изтрий го и създай наново'
            }) -Default $default -Help 'Обновяването е безопасно: текстът се заменя, а файловете се презаписват по име.'
        if ($choice -eq 'n') {
            $script:TagName = Ask-Text -Question 'Нов таг' -Default "v$($script:Version)"
            return (Test-RemoteState)
        }
        if ($choice -eq 'd') {
            if (Confirm-Strict -Question "Да изтрия ли изданието $tagName (и тага му)?" -Expected $tagName) {
                $null = Invoke-Gh -Arguments @('release', 'delete', $tagName, '--repo', $Repo, '--yes', '--cleanup-tag') -What 'gh release delete'
                Write-Ok 'изтрито'
                return (Test-RemoteState)
            }
            return (Test-RemoteState)
        }
        if ($choice -eq 'a') { Stop-Gracefully 'Спряно — съществуващо издание.' }
        $script:Mode = 'update'
    }
    else {
        $script:Mode = 'create'
        Write-Info "няма издание за '$tagName' — режим: създаване на ново"
        if ($script:Force) { Write-Info '-Force е за обновяване или за нарочно разминаване на версията; за ново издание не е нужен' }
        $tagRef = Invoke-Gh -Arguments @('api', "repos/$Repo/git/ref/tags/$tagName") -AllowFailure -What 'gh api tag'
        if ($tagRef.Ok) {
            Write-Warn2 "тагът $tagName вече съществува (изданието — не)"
            $choice = Ask-Choice -Question 'Тагът съществува. Какво да правим?' -AllowQuit -Choices ([ordered]@{
                    'u' = 'създай изданието върху съществуващия таг (без --target)'
                    'n' = 'смени тага'
                    'd' = 'изтрий тага и го създай наново'
                    'a' = 'прекрати'
                }) -Default 'u' -Help 'Ако тагът сочи към стар commit, изданието ще сочи към него.'
            if ($choice -eq 'n') {
                $script:TagName = Ask-Text -Question 'Нов таг' -Default "v$($script:Version)"
                return (Test-RemoteState)
            }
            if ($choice -eq 'd') {
                if (Confirm-Strict -Question "Да изтрия ли тага $tagName от GitHub?" -Expected $tagName) {
                    $null = Invoke-Gh -Arguments @('api', '-X', 'DELETE', "repos/$Repo/git/refs/tags/$tagName") -What 'gh api delete tag'
                    Write-Ok 'тагът е изтрит'
                    return (Test-RemoteState)
                }
                return (Test-RemoteState)
            }
            if ($choice -eq 'a') { Stop-Gracefully 'Спряно — съществуващ таг.' }
            $script:TagOnRemote = $true
        }
        else {
            $script:TagOnRemote = $false
            while ($true) {
                $branch = Invoke-Gh -Arguments @('api', "repos/$Repo/branches/$Target", '--jq', '.name') -AllowFailure -What 'gh api branch'
                if ($branch.Ok) { Write-Info "тагът ще се създаде върху '$Target'"; break }
                Write-Warn2 "клонът '$Target' не е намерен в $Repo"
                $choice = Ask-Choice -Question 'Върху какво да сочи тагът?' -AllowQuit -Choices ([ordered]@{
                        'c' = 'въведи друг клон/ревизия'
                        'r' = 'провери пак'
                        'x' = 'остави gh да реши (без --target)'
                    }) -Default 'c'
                if ($choice -eq 'c') {
                    $script:Target = Ask-Text -Question 'Клон или ревизия' -Default $script:Target
                    continue
                }
                if ($choice -eq 'x') { $script:Target = $null; break }
            }
        }
    }

    # Флагове на изданието — питаме само ако не са зададени изрично.
    if (-not $script:NonInteractive -and -not $script:Force) {
        $script:Draft = [bool]$Draft
        $script:Prerelease = [bool]$Prerelease
        $script:Latest = [bool]$Latest
        while ($true) {
            $draftLabel = if ($script:Draft) { 'да' } else { 'не' }
            $preLabel = if ($script:Prerelease) { 'да' } else { 'не' }
            $latestLabel = if ($script:Latest) { 'да' } else { 'не (по подразбиране)' }
            $choice = Ask-Choice -Question "Настройки: чернова=$draftLabel · prerelease=$preLabel · latest=$latestLabel" -Choices ([ordered]@{
                    '1' = "смени чернова → $(if ($script:Draft) { 'не' } else { 'да' })"
                    '2' = "смени prerelease → $(if ($script:Prerelease) { 'не' } else { 'да' })"
                    '3' = "смени latest → $(if ($script:Latest) { 'не' } else { 'да' })"
                    'c' = 'продължи с тези настройки'
                }) -Default 'c' -Help 'Черновата не се вижда публично. Prerelease не се маркира като latest, освен ако не зададеш latest.'
            if ($choice -eq '1') { $script:Draft = -not $script:Draft; continue }
            if ($choice -eq '2') { $script:Prerelease = -not $script:Prerelease; continue }
            if ($choice -eq '3') { $script:Latest = -not $script:Latest; continue }
            break
        }
    }
    return $true
}

# ── Слой 6б · Тагът пуска CI ────────────────────────────────────────────
function Get-ReleaseWorkflowInfo {
    $workflowPath = Join-Path $Root '.github/workflows/release.yml'
    if (-not (Test-Path -LiteralPath $workflowPath)) { return $null }
    $workflowText = Get-Content -LiteralPath $workflowPath -Raw -ErrorAction SilentlyContinue
    if (-not $workflowText) { return $null }
    # Шаблоните са важни: таг '0.63.0' НЕ задейства 'v*', значи CI няма да публикува нищо.
    $triggers = [System.Collections.Generic.List[string]]::new()
    $tagBlock = [regex]::Match($workflowText, 'tags:\s*\[([^\]]*)\]')
    if ($tagBlock.Success) {
        foreach ($m in [regex]::Matches($tagBlock.Groups[1].Value, '([A-Za-z0-9_.*-]+)')) { $triggers.Add($m.Groups[1].Value) }
    }
    return [pscustomobject]@{
        Path          = $workflowPath
        OnTags        = ($triggers.Count -gt 0)
        Triggers      = @($triggers)
        Attaches      = ($workflowText -match 'action-gh-release')
        GeneratesBody = ($workflowText -match 'generate_release_notes:\s*true')
    }
}

function Test-WorkflowConflict {
    # Новият таг сам по себе си е действие: `.github/workflows/release.yml` се задейства от
    # push на таг 'v*', строи наново артефактите и ги прикача към изданието. Ако ползва
    # generate_release_notes, текстът, който човекът е написал тук, се заменя с автоматичен.
    # Затова това се казва ПРЕДИ публикуването, а не се разбира след като текстът изчезне.
    $info = Get-ReleaseWorkflowInfo
    if (-not $info -or -not $info.OnTags -or -not $info.Attaches) { return $true }

    if ($script:Mode -ne 'create' -or $script:TagOnRemote) {
        if ($script:Mode -eq 'update') { Write-Info 'workflow-ът за тагове няма да се пусне пак (тагът вече съществува)' }
        return $true
    }

    # Ако тагът не съвпада с шаблоните (напр. '0.63.0' срещу 'v*'), CI НЕ се пуска и
    # съветът „остави го на workflow-а“ би бил грешен — тогава нищо не би се появило.
    $triggered = $false
    foreach ($tagPattern in $info.Triggers) { if ($script:TagName -like $tagPattern) { $triggered = $true } }
    if (-not $triggered) {
        Write-Info ("таг '{0}' не съвпада с шаблоните на workflow-а ({1}) — CI няма да се пусне" -f $script:TagName, ($info.Triggers -join ', '))
        return $true
    }

    Write-Step 'Слой 6б · Тагът пуска CI, който също пише по изданието'
    Write-Warn2 "$($info.Path) се задейства от таг 'v*' и прикача същите файлове към изданието"
    if ($info.GeneratesBody) {
        Write-Warn2 'ползва generate_release_notes: true — написаният тук текст ще бъде заменен с автоматичен'
    }

    # Dry run не пипа нищо отдалечено — включително не създава таг.
    if (-not $script:Execute) {
        Write-Info 'dry run: няма да създам таг. При -Execute тук се избира между „само таг + CI“ и „публикувай сега“.'
        Write-Info "препоръчаният ред при -Execute: таг $($script:TagName) → изчакай Release → пусни пак с -Force за своя текст"
        return $true
    }

    if ($script:NonInteractive) {
        Write-Warn2 'неинтерактивен режим: продължавам; след ~2 минути CI ще обнови текста и файловете'
        return $true
    }

    Write-Info "изборът 't' НЕ качва нищо сега: скриптът само създава тага, а изданието го прави CI."

    $choice = Ask-Choice -Question 'Как да продължа с новия таг?' -AllowQuit -Choices ([ordered]@{
            't' = 'създай само тага и остави CI да публикува (после -Force за текста) — препоръчано'
            'd' = 'направи изданието чернова, за да го прегледам след CI'
            'a' = 'продължи сега — приемам, че CI ще смени текста и файловете'
            'q' = 'прекъсни'
        }) -Default 't' -Help 'Ако CI строи и прикача файловете, двойното качване е излишно. Най-сигурното е: таг → изчакай Release → пусни скрипта пак с -Force, за да сложиш своя текст.'

    if ($choice -eq 'q') { Stop-Gracefully 'Отказано от потребителя.' }
    if ($choice -eq 'a') {
        Write-Warn2 'продължавам — текстът ще бъде заменен от workflow-а'
        return $true
    }
    if ($choice -eq 'd') {
        $script:Draft = $true
        Write-Warn2 'изданието ще е чернова; след CI го прегледай и публикувай ръчно'
        return $true
    }

    # 't' — създаваме само тага и оставяме CI да направи изданието.
    $target = $script:Target
    if (-not $target) {
        $repoInfo = Invoke-Gh -Arguments @('api', "repos/$Repo", '--jq', '.default_branch') -AllowFailure -What 'gh api default_branch'
        if ($repoInfo.Ok -and $repoInfo.Text) { $target = $repoInfo.Text.Trim() }
    }
    if (-not $target) { Stop-WithError 'Не знам върху какво да сложа тага (липсва -Target и клон по подразбиране).' }

    $sha = Invoke-Gh -Arguments @('api', "repos/$Repo/commits/$target", '--jq', '.sha') -AllowFailure -What 'gh api commit'
    if (-not $sha.Ok -or -not $sha.Text) { Stop-WithError "Не намирам '$target' в $Repo, за да сложа тага." }
    $commitSha = $sha.Text.Trim()

    if (-not (Confirm-Strict -Question "Да създам ли тага $($script:TagName) в $Repo (върху $target)?" -Expected $script:TagName)) {
        Stop-Gracefully "Тагът не е създаден — потвърждението не съвпадна с '$($script:TagName)'. Нищо не е променено."
    }

    $created = Invoke-Gh -Arguments @('api', '-X', 'POST', "repos/$Repo/git/refs", '-f', "ref=refs/tags/$($script:TagName)", '-f', "sha=$commitSha") -AllowFailure -What 'gh api create tag'
    if (-not $created.Ok) { Stop-WithError "Тагът не е създаден: $($created.Text)" }

    Write-Ok "таг $($script:TagName) → $target ($($commitSha.Substring(0, 7)))"
    Write-Info 'Изчакай workflow-а Release да приключи, после пусни същото с -Force, за да сложиш своя текст:'
    $rerun = 'pwsh -File release/publish-release.ps1 -Source "' + $script:Chosen.Path + '" -Force -Execute'
    Write-Host "  $rerun" -ForegroundColor Yellow
    Write-Info 'Тогава тагът вече съществува, CI няма да се пусне пак и скриптът само обновява текста и проверява файловете.'
    Stop-Gracefully 'Тагът е създаден - изданието ще го направи workflow-ът.'
}

# ── Слой 7 · Преглед и потвърждение ────────────────────────────────────────
function Show-Summary {
    Write-Step 'Слой 7 · Какво ще се публикува'
    Write-Info "хранилище: $Repo"
    Write-Info "таг:        $($script:TagName)"
    if ($script:Mode -eq 'create') {
        if ($script:TagOnRemote) { Write-Info 'тагът вече съществува — изданието се създава върху него' }
        elseif ($script:Target) { Write-Info "тагът се създава върху '$($script:Target)'" }
        else { Write-Info 'тагът се създава върху клона по подразбиране' }
    }
    else {
        Write-Info 'режим: обновяване на съществуващо издание'
    }
    Write-Info "заглавие:   $($script:Title)"
    Write-Info "източник:   $($script:Chosen.Label)"
    Write-Info "версия:     $($script:Version)"
    if ($script:Draft) { Write-Info 'чернова:    да' }
    if ($script:Prerelease) { Write-Info 'prerelease: да' }
    if ($script:Latest) { Write-Info 'latest:     да' }

    if ($script:AssetInfo.Count) {
        foreach ($asset in $script:AssetInfo) {
            $hash = (Get-FileHash -LiteralPath $asset.Path -Algorithm SHA256).Hash.ToLowerInvariant()
            Write-Host ("  · {0} · {1:N0} KB · sha256 {2}…" -f $asset.Name, ($asset.Size / 1KB), $hash.Substring(0, 12)) -ForegroundColor DarkGray
        }
    }
    else {
        Write-Warn2 'без прикачени файлове'
    }
    Write-Info ("текст:      {0} знака (източник: {1})" -f $script:NotesText.Length, $script:NotesOrigin)
}

function Get-PublishArguments([string]$NotesPath) {
    $arguments = [System.Collections.Generic.List[string]]::new()
    if ($script:Mode -eq 'create') {
        foreach ($part in @('release', 'create', $script:TagName, '--repo', $Repo, '--title', $script:Title, '--notes-file', $NotesPath)) { $arguments.Add($part) }
        if (-not $script:TagOnRemote -and $script:Target) { $arguments.Add('--target'); $arguments.Add($script:Target) }
    }
    else {
        foreach ($part in @('release', 'edit', $script:TagName, '--repo', $Repo, '--title', $script:Title, '--notes-file', $NotesPath)) { $arguments.Add($part) }
        if ($script:Draft -and $script:ExistingRelease -and [bool]$script:ExistingRelease.isDraft) { $arguments.Add('--draft') }
        elseif (-not $script:Draft -and $script:ExistingRelease -and [bool]$script:ExistingRelease.isDraft) { $arguments.Add('--draft=false') }
    }
    if ($script:Prerelease) { $arguments.Add('--prerelease') }
    elseif ($script:Mode -eq 'update') { $arguments.Add('--prerelease=false') }
    if ($script:Latest) { $arguments.Add('--latest') }
    return , @($arguments)
}

# ── Слой 8 · Публикуване ───────────────────────────────────────────────────
function Invoke-Publish {
    Write-Step "Слой 8 · Публикуване в $Repo"
    $notesPath = Join-Path ([IO.Path]::GetTempPath()) "hapi-release-notes-$($script:Version).md"
    Set-Content -LiteralPath $notesPath -Value $script:NotesText -Encoding utf8
    try {
        $arguments = Get-PublishArguments $notesPath
        $result = Invoke-Gh -Arguments $arguments -What "gh release $($script:Mode)"
        if (-not $result.Ok -and -not $result.Skipped) { Stop-WithError 'Публикуването на изданието се провали.' }
        Write-Ok 'изданието е записано'

        if ($result.Skipped) {
            Write-Warn2 'стъпката е пропусната — проверявам какво реално съществува'
        }

        if ($script:AssetInfo.Count) {
            $uploadArgs = @('release', 'upload', $script:TagName, '--repo', $Repo, '--clobber') + @($script:AssetInfo | ForEach-Object { $_.Path })
            $upload = Invoke-Gh -Arguments $uploadArgs -What 'gh release upload'
            if ($upload.Ok) { Write-Ok "качени $($script:AssetInfo.Count) файла" }
            elseif ($upload.Skipped) { Write-Warn2 'качването е пропуснато — ще го проверя след това' }
        }
    }
    finally {
        Remove-Item -LiteralPath $notesPath -ErrorAction SilentlyContinue
    }
}

# ── Слой 9 · Проверка на публикуваното ─────────────────────────────────────
function Test-Published {
    Write-Step 'Слой 9 · Проверка на публикуваното'
    $view = Invoke-Gh -Arguments @('release', 'view', $script:TagName, '--repo', $Repo, '--json', 'tagName,name,url,isDraft,isPrerelease,body,assets') -AllowFailure -What 'gh release view'
    if (-not $view.Ok) { Stop-WithError "Изданието не се чете след публикуване: $($view.Text)" }

    $release = $null
    try { $release = $view.Text | ConvertFrom-Json } catch { $release = $null }
    if (-not $release) { Stop-WithError 'Не мога да разчета отговора на gh.' }

    Write-Ok "изданието е налично: $($release.url)"
    if ($release.PSObject.Properties['isDraft'] -and $release.isDraft) { Write-Warn2 'все още е чернова — публично не се вижда' }
    if ($release.PSObject.Properties['isPrerelease'] -and $release.isPrerelease) { Write-Info 'маркирано като prerelease' }

    $remoteAssets = @()
    if ($release.PSObject.Properties['assets'] -and $release.assets) { $remoteAssets = @($release.assets) }
    $remoteNames = @($remoteAssets | ForEach-Object { [string]$_.name })
    $bodyLength = 0
    if ($release.PSObject.Properties['body'] -and $release.body) { $bodyLength = ([string]$release.body).Length }
    if ($bodyLength -gt 0) { Write-Ok "текст: $bodyLength знака" } else { Write-Warn2 'текстът е празен' }

    $missing = @($script:AssetInfo | Where-Object { $remoteNames -notcontains $_.Name })
    if ($script:AssetInfo.Count -eq 0) { Write-Info 'няма очаквани файлове' }
    elseif (-not $missing.Count) { Write-Ok "файлове: $($script:AssetInfo.Count)/$($script:AssetInfo.Count) качени" }
    else {
        foreach ($asset in $missing) { Write-Warn2 "липсва като прикачен файл: $($asset.Name)" }
        $choice = Ask-Choice -Question 'Липсват файлове в изданието. Какво да правим?' -AllowQuit -Choices ([ordered]@{
                'u' = 'качи липсващите пак'
                's' = 'остави така'
                'q' = 'прекрати (изданието остава непълно)'
            }) -Default 'u'
        if ($choice -eq 'u') {
            $uploadArgs = @('release', 'upload', $script:TagName, '--repo', $Repo, '--clobber') + @($missing | ForEach-Object { $_.Path })
            $null = Invoke-Gh -Arguments $uploadArgs -What 'gh release upload (повторно)'
            return (Test-Published)
        }
        if ($choice -eq 'q') { Stop-Gracefully 'Изданието остава непълно.' }
    }

    # Името стига само за да се види, че файлът е прикачен. Размерът показва дали е качен ЦЯЛИЯТ:
    # прекъснато качване оставя файл с правилно име и грешен размер.
    if ($script:AssetInfo.Count -and -not $missing.Count) {
        $remoteByName = @{}
        foreach ($remoteAsset in $remoteAssets) {
            if ($remoteAsset.PSObject.Properties['name']) { $remoteByName[[string]$remoteAsset.name] = $remoteAsset }
        }
        $sizeProblems = @()
        foreach ($localAsset in $script:AssetInfo) {
            if (-not $remoteByName.ContainsKey($localAsset.Name)) { continue }
            $remoteAsset = $remoteByName[$localAsset.Name]
            if (-not $remoteAsset.PSObject.Properties['size']) { continue }
            $remoteSize = [long]$remoteAsset.size
            if ($remoteSize -ne [long]$localAsset.Size) {
                $sizeProblems += [pscustomobject]@{ Name = $localAsset.Name; Local = [long]$localAsset.Size; Remote = $remoteSize; Path = $localAsset.Path }
            }
        }
        if (-not $sizeProblems.Count) {
            Write-Ok 'размерите на качените файлове съвпадат с локалните'
        }
        else {
            foreach ($problem in $sizeProblems) {
                Write-Warn2 ("размерът на качения файл е различен: {0} · локално {1:N0} B · в GitHub {2:N0} B" -f $problem.Name, $problem.Local, $problem.Remote)
            }
            $choice = Ask-Choice -Question 'Качването може да е прекъснато. Какво да правим?' -AllowQuit -Choices ([ordered]@{
                    'u' = 'качи тези файлове отново'
                    's' = 'остави така (провери ръчно)'
                    'q' = 'прекрати'
                }) -Default 'u' -Help 'Разлика в размера обикновено значи прекъснато качване или различен артефакт на сървъра.'
            if ($choice -eq 'u') {
                $uploadArgs = @('release', 'upload', $script:TagName, '--repo', $Repo, '--clobber') + @($sizeProblems | ForEach-Object { $_.Path })
                $null = Invoke-Gh -Arguments $uploadArgs -What 'gh release upload (по размер)'
                return (Test-Published)
            }
            if ($choice -eq 'q') { Stop-Gracefully 'Качването остава непроверено.' }
        }
    }

    if ($script:NonInteractive) {
        Write-Info 'неинтерактивен режим — не питам за отваряне/изтриване'
        return
    }

    while ($true) {
        $choice = Ask-Choice -Question 'Какво следва?' -Choices ([ordered]@{
                'e' = 'край'
                'o' = 'отвори изданието в браузър'
                'v' = 'покажи изданието в конзолата'
                'a' = 'покажи адреса на артефактите'
                'd' = 'изтрий изданието (връщане назад)'
            }) -Default 'e' -Help 'Изтриването премахва и тага, ако е създаден от gh. Действието е необратимо.'
        if ($choice -eq 'e') { return }
        if ($choice -eq 'o') {
            Start-Process ([string]$release.url)
            continue
        }
        if ($choice -eq 'v') {
            $null = Invoke-Gh -Arguments @('release', 'view', $script:TagName, '--repo', $Repo) -What 'gh release view'
            continue
        }
        if ($choice -eq 'a') {
            foreach ($asset in $remoteAssets) {
                $size = 0
                if ($asset.PSObject.Properties['size']) { $size = [long]$asset.size }
                Write-Host ("  · {0} · {1:N0} KB · {2}" -f $asset.name, ($size / 1KB), $asset.url) -ForegroundColor DarkGray
            }
            continue
        }
        if ($choice -eq 'd') {
            if (Confirm-Strict -Question "Да изтрия ли изданието $($script:TagName)?" -Expected $script:TagName) {
                $null = Invoke-Gh -Arguments @('release', 'delete', $script:TagName, '--repo', $Repo, '--yes', '--cleanup-tag') -What 'gh release delete'
                Write-Ok 'изданието е изтрито'
                # Изтрито издание не бива да води до обновяване на HACS — то ще сочи към таг, който вече го няма.
                $script:ReleaseGone = $true
                return
            }
            continue
        }
    }
}

# ── Слой 10 · HACS хранилището ──────────────────────────────────
function Invoke-HacsUpdate {
    Write-Step 'Слой 10 · HACS хранилището'
    if ($script:SkipHacs) {
        Write-Info 'пропуснато заради -SkipHacs'
        return
    }
    if ($script:ReleaseGone) {
        Write-Info 'изданието е изтрито — HACS остава непроменен'
        return
    }
    $hacsScript = Join-Path $Root 'scripts/publish-haoss.ps1'
    if (-not (Test-Path -LiteralPath $hacsScript)) {
        Write-Warn2 'липсва scripts/publish-haoss.ps1 — стъпката се пропуска'
        return
    }

    Write-Info 'HACS чете интеграцията от отделно хранилище — add-on изданието не го обновява'
    $choice = 'n'
    if ($script:HacsWanted) {
        $choice = 'y'
        Write-Info 'избрано с -Hacs'
    }
    elseif ($script:NonInteractive) {
        Write-Info 'неинтерактивен режим (-Yes) — HACS НЕ се пипа; за целта: -Hacs или npm run publish:haoss'
        return
    }
    else {
        $choice = Ask-Choice -Question "Да обновя ли и HACS хранилището до $($script:Version)?" -Choices ([ordered]@{
                'n' = 'не — оставям HACS както е'
                'p' = 'само покажи какво би направил (dry run)'
                'y' = "да — публикувай интеграцията $($script:Version)"
            }) -Default 'n' -Help 'HACS хранилището е release/haoss (интеграцията). Публикуването му вдига таг в друго хранилище и пуска неговия release.yml; add-on изданието остава непокътнато.'
    }
    if ($choice -eq 'n') {
        Write-Info 'HACS остава непроменен'
        return
    }

    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $hacsScript, '-Version', $script:Version)
    if ($choice -eq 'y') { $arguments += '-Execute' }
    Write-Host ("  pwsh " + ($arguments -join ' ')) -ForegroundColor White
    & pwsh @arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Warn2 "publish-haoss.ps1 завърши с код $code — HACS не е обновен (add-on изданието е налично)"
        return
    }
    if ($choice -eq 'y') { Write-Ok "HACS хранилището е обновено до $($script:Version)" }
    else { Write-Ok 'HACS dry run мина без грешка' }
}

# ── Главен поток ───────────────────────────────────────────────────────────
if (-not $LogFile) {
    $LogFile = Join-Path ([IO.Path]::GetTempPath()) ("hapi-publish-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
try { Set-Content -LiteralPath $LogFile -Value "hAPI publish · $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Encoding utf8; $script:LogPath = $LogFile }
catch { $script:LogPath = $null }

Write-Host ''
Write-Host '  hAPI Enterprise — публикуване на издание' -ForegroundColor Cyan
Write-Host "  хранилище: $Repo · режим: $(if ($Execute) { 'РЕАЛНО КАЧВАНЕ' } else { 'dry run (нищо не се качва)' })" -ForegroundColor DarkGray

Test-Environment

if ($script:GhReady) {
    Select-Repo
    Test-RepoAccess
}
else {
    Write-Warn2 'без gh: хранилището не се проверява и публикуване няма да има'
}

$round = 0
while ($true) {
    $round++
    if ($round -gt $script:RestartLimit) { Stop-WithError 'Твърде много повторения — спирам, за да не зацикля.' }

    if (-not (Select-Source)) { continue }
    if (-not (Test-Integrity)) {
        # Връщаме се към списъка — иначе -Source ще избере същия проблемен източник отново.
        $script:SourcePath = $null
        Write-Info 'връщам се към избора на източник'
        continue
    }

    if (-not $script:TagName) { $script:TagName = "v$($script:Version)" }
    if (-not $script:Title) { $script:Title = "hAPI Enterprise $($script:Version)" }
    $script:TagName = Ask-Text -Question 'Таг' -Default $script:TagName -Help 'По подразбиране v<версия>.' -Validate {
        param($value)
        if ($value -in @('q', 'quit', 'exit')) { return 'Това прилича на опит за отказ. Остави Enter за подразбирането.' }
        if ($value -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*$') { return 'Позволени са латиница, цифри, точка, тире, подчертавка и наклонена черта.' }
        # Таг без версия е грешка, която се вижда чак в CI (и в HACS): тагът 'c' се приема за
        # реален таг и създава ref в GitHub, без никой да разбере защо.
        if ($value -notmatch [regex]::Escape($script:Version)) { return "Тагът трябва да съдържа версията $($script:Version) (напр. v$($script:Version))." }
        return $null
    }
    # Таг без 'v' не задейства release.yml и не е конвенцията на проекта — питаме веднага,
    # защото последицата е „пуснах го, а нищо не се появи“.
    if (-not $script:TagExplicit -and $script:TagName -notmatch '^v') {
        Write-Warn2 "тагът '$($script:TagName)' не започва с 'v': release.yml се задейства само от 'v*'"
        $choice = Ask-Choice -Question "Да добавя ли 'v' отпред?" -Choices ([ordered]@{
                'y' = "да - v$($script:TagName)"
                'k' = "не - остави $($script:TagName) (CI няма да се пусне)"
            }) -Default 'y'
        if ($choice -eq 'y') { $script:TagName = "v$($script:TagName)" }
        $script:TagExplicit = $true
        Write-Ok "таг: $($script:TagName)"
    }
    $script:Title = Ask-Text -Question 'Заглавие на изданието' -Default $script:Title -Validate {
        param($value)
        if ($value -in @('q', 'quit', 'exit')) { return 'Това прилича на опит за отказ. Остави Enter за подразбирането.' }
        return $null
    }

    $restart = $false
    if (-not (Test-Consistency)) { $restart = $true }
    elseif (-not (Test-Checksums)) { $restart = $true }
    elseif (-not (Build-Notes)) { $restart = $true }

    if ($restart) {
        # Отказ в по-късен слой значи „смени източника“ — показваме списъка отначало.
        $script:SourcePath = $null
        Write-Info 'връщам се към избора на източник'
        continue
    }

    $null = Test-RemoteState
    $null = Test-WorkflowConflict
    break
}

Show-Summary

if (-not $Execute) {
    Write-Step 'Dry run — нищо не се качва'
    $notesPath = '<временен файл>'
    $arguments = Get-PublishArguments $notesPath
    Write-Host "  gh $($arguments -join ' ')" -ForegroundColor White
    if ($script:AssetInfo.Count) {
        Write-Host "  gh release upload $($script:TagName) --repo $Repo --clobber $($script:AssetInfo | ForEach-Object { $_.Name } | Join-String -Separator ' ')" -ForegroundColor White
    }
    Write-Host ''
    Write-Host '  За реално публикуване добави -Execute.' -ForegroundColor Yellow
    if ($script:LogPath) { Write-Host "  лог: $($script:LogPath)" -ForegroundColor DarkGray }
    exit 0
}

Write-Step 'Потвърждение'
Write-Info "предстои: $($script:Mode) на $($script:TagName) в $Repo"
if (-not $script:Force) {
    if (-not (Confirm-Strict -Question 'Потвърждаваш ли публикуването?' -Expected $script:Version)) {
        Stop-Gracefully 'Потвърждението не съвпада — публикация отказана.'
    }
}
else {
    Write-Warn2 'потвърждението е пропуснато заради -Force'
}

Invoke-Publish
Test-Published
Invoke-HacsUpdate

Write-Host ''
Write-Host "  Провери: gh release view $($script:TagName) --repo $Repo" -ForegroundColor DarkGray
if ($script:LogPath) { Write-Host "  лог: $($script:LogPath)" -ForegroundColor DarkGray }
