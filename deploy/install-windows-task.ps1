# Registers the daily Windows task. Run in PowerShell from the bot folder:
#   powershell -ExecutionPolicy Bypass -File deploy\install-windows-task.ps1 [-At 7:00AM]
# Works on any Windows PC (laptop, spare PC). Re-running replaces the existing task.
param([string]$At = '7:00AM', [string]$Name = 'NaukriMorningBot')

$bot = Split-Path -Parent $PSScriptRoot
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$bot\keepawake-run.ps1`"" -WorkingDirectory $bot
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'Naukri morning job search (mode set in config.json)' -Force | Out-Null
Get-ScheduledTask -TaskName $Name | Select-Object TaskName, State,
    @{n = 'NextRun'; e = { (Get-ScheduledTaskInfo $_).NextRunTime } }
