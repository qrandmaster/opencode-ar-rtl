#requires -Version 5.1
<#
  uninstall.ps1 — استرجاع app.asar الأصلي وإزالة طبقة العربية/RTL
#>
[CmdletBinding()]
param(
  [string]$AppDir = "",
  [switch]$WaitForClose
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$patch = Join-Path $here 'build\patch.mjs'

# إزالة المراقب الدوري أولاً حتى لا يعيد التثبيت بعد التراجع
Unregister-ScheduledTask -TaskName 'OpenCodeRTL-Ensure' -Confirm:$false -ErrorAction SilentlyContinue

function Get-Running { @(Get-Process -Name OpenCode -ErrorAction SilentlyContinue) }

# يكتشف مجلد التثبيت تلقائياً (تغيّر اسمه بين إصدارات التطبيق)
if (-not $AppDir) {
  foreach ($c in @(
      "$env:LOCALAPPDATA\Programs\ai.opencode.desktop",
      "$env:LOCALAPPDATA\Programs\@opencodedesktop"
    )) {
    if (Test-Path (Join-Path $c 'resources\app.asar')) { $AppDir = $c; break }
  }
}
$asar = Join-Path $AppDir 'resources\app.asar'
if (-not $AppDir -or -not (Test-Path $asar)) { Write-Host "لم يُعثر على التطبيق — مرّر -AppDir <مجلد التثبيت>" -ForegroundColor Red; exit 1 }

$procs = Get-Running
if ($procs.Count -gt 0 -and -not $WaitForClose) {
  Write-Host "OpenCode مفتوح. أغلق التطبيق ثم أعد المحاولة، أو استخدم: uninstall.bat -WaitForClose" -ForegroundColor Yellow
  exit 2
}
if ($procs.Count -gt 0) {
  Write-Host "بانتظار إغلاق OpenCode…" -ForegroundColor Cyan
  $deadline = (Get-Date).AddMinutes(15)
  while ((Get-Running).Count -gt 0) {
    if ((Get-Date) -gt $deadline) { Write-Host "انتهت المدة" -ForegroundColor Red; exit 1 }
    Start-Sleep -Milliseconds 800
  }
  Start-Sleep -Milliseconds 600
}

& node $patch --app $AppDir --revert
if ($LASTEXITCODE -ne 0) { Write-Host "فشل الاسترجاع" -ForegroundColor Red; exit 1 }

Write-Host "تم استرجاع الواجهة الأصلية." -ForegroundColor Green
