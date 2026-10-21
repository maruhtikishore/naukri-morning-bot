# Windows entry point for the scheduled task.
# Keeps the PC awake while the bot runs (it takes ~20 minutes), then lets it sleep again.
# This only affects this process; it does not change any Windows power setting.
Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[void][Win32.Power]::SetThreadExecutionState(0x80000001)   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
try {
    Set-Location $PSScriptRoot
    New-Item -ItemType Directory -Force -Path "data\logs" | Out-Null
    "[{0}] scheduled run starting" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | Add-Content "data\logs\scheduler.log"
    & npm.cmd run run *>> "data\logs\scheduler.log"
}
finally {
    [void][Win32.Power]::SetThreadExecutionState(0x80000000)  # ES_CONTINUOUS only: allow sleep again
}
