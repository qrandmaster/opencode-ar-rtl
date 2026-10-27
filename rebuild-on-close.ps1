#requires -Version 5.1
<#
  rebuild-on-close.ps1 — ينتظر إغلاق OpenCode، يسترجع app.asar الأصلي،
  يعيد بناءه بالحزمة العربية المحدّثة، ثم يفتح التطبيق من جديد.
  إن فشل أي خطوة أو خرج التطبيق بعد التبديل → استرجاع الأصل.
#>
param(
  [string]$AppDir = "",
  [int]$TimeoutMinutes = 45
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here 'rebuild-on-close.log'
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Add-Content -Path $log -Encoding UTF8 }

# يكتشف مجلد التثبيت تلقائياً (تغيّر اسمه بين إصدارات التطبيق)
if (-not $AppDir) {
  foreach ($c in @(
      "$env:LOCALAPPDATA\Programs\ai.opencode.desktop",
      "$env:LOCALAPPDATA\Programs\@opencodedesktop"
    )) {
    if (Test-Path (Join-Path $c 'resources\app.asar')) { $AppDir = $c; break }
  }
}
if (-not $AppDir) { Write-Host 'لم يُعثر على مجلد التثبيت.' -ForegroundColor Red; exit 1 }

Set-Content -Path $log -Value "بدء المراقبة $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Encoding UTF8

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
while ((Get-Process -Name OpenCode -ErrorAction SilentlyContinue)) {
  if ((Get-Date) -gt $deadline) { Log 'انتهت المدة دون إغلاق التطبيق — أُلغي.'; exit 1 }
  Start-Sleep -Milliseconds 700
}
Log 'أُغلق التطبيق.'
Start-Sleep -Milliseconds 1500

$exe = Join-Path $AppDir 'OpenCode.exe'

function Run-Patch([string]$mode) {
  for ($i = 1; $i -le 3; $i++) {
    & node (Join-Path $here 'build\patch.mjs') --app $AppDir $mode *>> $log
    if ($LASTEXITCODE -eq 0) { return $true }
    Log "محاولة $i لـ$mode فشلت (exit $LASTEXITCODE) — إعادة"
    Start-Sleep -Seconds 2
  }
  return $false
}

if (Test-Path (Join-Path $AppDir 'resources\app.asar.orig-*')) {
  if (-not (Run-Patch '--revert')) {
    Log 'تعذّر استرجاع الأصل — إقلاع التطبيق كما هو.'
    Start-Process -FilePath $exe | Out-Null
    exit 1
  }
  Log 'تم استرجاع app.asar الأصلي.'
} else {
  Log 'لا توجد نسخة أصلية محفوظة (تثبيت جديد) — بناء أول مباشرة.'
}

if (-not (Run-Patch '--apply')) {
  Log 'تعذّر البناء أو التبديل — إقلاع التطبيق بالنسخة الأصلية.'
  Start-Process -FilePath $exe | Out-Null
  exit 1
}
Log 'تم بناء الحزمة وتبديلها.'

$proc = Start-Process -FilePath $exe -PassThru
Log ("أُعيد فتح التطبيق pid=" + $proc.Id)

Start-Sleep -Seconds 45
if ($proc.HasExited) {
  Log ("خرج التطبيق بعد " + [int]((Get-Date) - $proc.StartTime).TotalSeconds + " ثانية — استرجاع تلقائي")
  & node (Join-Path $here 'build\patch.mjs') --app $AppDir --revert *>> $log
  Start-Process -FilePath $exe | Out-Null
  Log 'أُعيد الأصل.'
} else {
  Log 'التطبيق يعمل — نجاح.'
}
