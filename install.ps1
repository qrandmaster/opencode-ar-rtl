#requires -Version 5.1
<#
  install.ps1 — تثبيت طبقة العربية/RTL في OpenCode Desktop
  يُنبّه إذا كان التطبيق مفتوحاً، ويستطيع الانتظار حتى إغلاقه ثم التبديل.
#>
[CmdletBinding()]
param(
  [string]$AppDir = "",
  [switch]$WaitForClose,
  [switch]$Force,
  [switch]$NoWatcher
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$patch = Join-Path $here 'build\patch.mjs'

function Fail($msg) { Write-Host "خطأ: $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host $msg -ForegroundColor Cyan }

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
if (-not $AppDir -or -not (Test-Path $asar)) { Fail "لم يُعثر على التطبيق — مرّر --AppDir <مجلد التثبيت>" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js غير مثبّت أو غير موجود في PATH' }

function Get-Running { @(Get-Process -Name OpenCode -ErrorAction SilentlyContinue) }

$procs = Get-Running
if ($procs.Count -gt 0 -and -not $WaitForClose) {
  Write-Host ""
  Write-Host "OpenCode مفتوح الآن — لا يمكن تعديل app.asar وهو قيد الاستخدام." -ForegroundColor Yellow
  Write-Host "أغلق التطبيق ثم أعد تشغيل هذا الملف، أو شغّله بهذا الخيار:" -ForegroundColor Yellow
  Write-Host "  install.bat -WaitForClose" -ForegroundColor White
  exit 2
}

if ($procs.Count -gt 0) {
  Info "بانتظار إغلاق OpenCode…"
  $deadline = (Get-Date).AddMinutes(15)
  while ((Get-Running).Count -gt 0) {
    if ((Get-Date) -gt $deadline) { Fail 'انتهت مدة الانتظار (15 دقيقة) — لم يُغلق التطبيق' }
    Start-Sleep -Milliseconds 800
  }
  Start-Sleep -Milliseconds 600
  Info 'أُغلق التطبيق — جارٍ التثبيت'
}

Info '== بناء الأرشيف المعدّل وتثبيته =='
& node $patch --app $AppDir --apply
if ($LASTEXITCODE -ne 0) { Fail 'فشل البناء أو التبديل' }

# تسجيل مراقب دوري يعيد التثبيت تلقائياً بعد كل تحديث للتطبيق
if (-not $NoWatcher) {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $here 'ensure-launch.vbs') + '"')
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  try {
    Register-ScheduledTask -TaskName 'OpenCodeRTL-Ensure' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Info 'سُجّل المراقب الدوري (كل 5 دقائق) — يعيد التثبيت تلقائياً بعد كل تحديث للتطبيق.'
  } catch {
    Write-Host "تحذير: تعذّر تسجيل المراقب الدوري: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "تم التثبيت. افتح OpenCode — ستظهر الواجهة بالعربية من اليمين إلى اليسار." -ForegroundColor Green
Write-Host "إن أردت التراجع: uninstall.bat" -ForegroundColor DarkGray
