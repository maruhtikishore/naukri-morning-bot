# Stops the Naukri bot and undoes the Windows changes made for it. Started by shutdown-bot.bat.
#
# Undoes:
#   1. a bot run that is in progress (the bot's node/Chrome/PowerShell processes only)
#   2. the "NaukriMorningBot" scheduled task (7:00 AM run, wake-the-PC)
#   3. "Allow wake timers" ON BATTERY, back to Disable (its value before this project)
#   4. config.json mode, back to "dry" (so nothing can apply by accident)
# Optional (asks first, default No): delete the saved Naukri login and your private answers/tokens.
#
# NOT undone (these live outside your PC): changes made on Naukri itself (resume headline, applications
# already sent), and WhatsApp messages already delivered. Use Naukri's own pages for those.

$ErrorActionPreference = 'Continue'
$bot = Split-Path -Parent $PSScriptRoot
$taskName = 'NaukriMorningBot'

Write-Host ''
Write-Host '=== Naukri bot: shutting down and undoing settings ===' -ForegroundColor Cyan

# 1. Stop a run in progress (only processes tied to this folder; never other Chrome windows).
$mine = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -and
    $_.Name -in @('node.exe', 'chrome.exe', 'powershell.exe') -and
    ($_.CommandLine -like "*$bot*")
}
if ($mine) {
    $mine | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host "[1/4] Stopped $(@($mine).Count) bot process(es)."
} else {
    Write-Host '[1/4] No bot run in progress.'
}

# 2. Remove the scheduled task.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "[2/4] Removed scheduled task '$taskName'."
} else {
    Write-Host "[2/4] Scheduled task '$taskName' was not found (already removed)."
}

# 3. Wake timers on battery back to Disable. (Plugged-in setting was already Enable before this project; left alone.)
powercfg /setdcvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 0 | Out-Null
powercfg /setactive SCHEME_CURRENT | Out-Null
Write-Host '[3/4] "Allow wake timers" on battery set back to Disable.'

# 4. Make sure the bot cannot apply to anything if someone starts it again.
$cfg = Join-Path $bot 'config.json'
if (Test-Path $cfg) {
    $text = Get-Content $cfg -Raw
    $new = $text -replace '"mode"\s*:\s*"apply"', '"mode": "dry"'
    if ($new -ne $text) { Set-Content -Path $cfg -Value $new -Encoding UTF8 -NoNewline }
    Write-Host '[4/4] config.json mode is "dry".'
}

Write-Host ''
$ans = Read-Host 'Also delete the saved Naukri login, WhatsApp token and your private answers? (y/N)'
if ($ans -match '^(y|yes)$') {
    foreach ($p in @('.profile', 'notify.local.json', 'answers.local.json')) {
        $full = Join-Path $bot $p
        if (Test-Path $full) { Remove-Item $full -Recurse -Force; Write-Host "  deleted $p" }
    }
} else {
    Write-Host 'Kept your saved login and private files.'
}

Write-Host ''
Write-Host 'Done. The bot will not run again until you set it up again (see README.md).' -ForegroundColor Green
