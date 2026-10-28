' ensure-launch.vbs - runs ensure-installed.ps1 fully hidden (no console flash).
' Used by Task Scheduler. Keeps the folder path relative to this script.
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & Replace(WScript.ScriptFullName, "ensure-launch.vbs", "ensure-installed.ps1") & """", 0, False
