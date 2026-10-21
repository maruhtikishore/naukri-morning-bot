# Lets Windows wake this laptop for the 7:00 AM bot run even when it is on battery.
# This changes ONE Windows power setting ("Allow wake timers" while on battery) in your current power plan.
# Run it yourself, once. To undo: change the same setting back to Disable in Power Options.
#
#   powershell -ExecutionPolicy Bypass -File deploy\enable-wake-on-battery.ps1

Write-Host "Before:"
powercfg /query SCHEME_CURRENT SUB_SLEEP RTCWAKE | Select-String "Current (AC|DC) Power Setting Index"

powercfg /setdcvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
powercfg /setactive SCHEME_CURRENT

Write-Host "`nAfter (both should show 0x00000001 = Enable):"
powercfg /query SCHEME_CURRENT SUB_SLEEP RTCWAKE | Select-String "Current (AC|DC) Power Setting Index"
