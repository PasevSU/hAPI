# Помощен скрипт (не се пуска в издания): проверява синтаксиса на .ps1 файловете.
# Причината да е файл: вложените кавички на `pwsh -Command "..."` се чупят от PowerShell.
param([string[]]$Files = @('scripts/update-integration.ps1', 'scripts/check-addon-image.ps1', 'scripts/publish-haoss.ps1', 'scripts/audit-ha-secrets.ps1'))
$bad = 0
foreach ($f in $Files) {
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $f), [ref]$null, [ref]$errors)
    if ($errors -and $errors.Count -gt 0) {
        $bad++
        Write-Host "  ГРЕШКА $f"
        $errors | ForEach-Object { Write-Host ('    ред ' + $_.Extent.StartLineNumber + ': ' + $_.Message) }
    }
    else {
        Write-Host "  OK   $f"
    }
}
if ($bad -gt 0) { exit 1 }
Write-Host "Синтаксисът на $($Files.Count) скрипта е валиден."
