#requires -Version 5.1
<#
  ensure-installed.ps1 — يضمن بقاء الحزمة العربية مثبتة وحديثة دائماً.
  يفحص app.asar: إن كانت الحزمة سليمة ومطابقة لملفات التعريب الحالية خرج فوراً
  بلا أي أثر، وإلا طبّقها (بانتظار إغلاق التطبيق إن كان يعمل، ثم إعادة فتحه).
  مصمّم للتشغيل الدوري من مجدول المهام — لا يسجّل إلا عند العمل الفعلي أو الخطأ.
#>
param(
  [string]$AppDir = "",
  [int]$TimeoutMinutes = 60
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here 'ensure-installed.log'
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Add-Content -Path $log -Encoding UTF8 }

# قفل يمنع تداخل النسخ (المجدول يشغّل السكربت كل بضع دقائق)
$lock = Join-Path $here 'ensure.lock'
if (Test-Path $lock) {
  $oldPid = (Get-Content $lock -ErrorAction SilentlyContinue) -as [int]
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) { exit 0 }
}
$PID | Set-Content -Path $lock

try {
  # اكتشاف مجلد التثبيت تلقائياً (تغيّر اسمه بين إصدارات التطبيق)
  if (-not $AppDir) {
    foreach ($c in @(
        "$env:LOCALAPPDATA\Programs\ai.opencode.desktop",
        "$env:LOCALAPPDATA\Programs\@opencodedesktop"
      )) {
      if (Test-Path (Join-Path $c 'resources\app.asar')) { $AppDir = $c; break }
    }
  }
  if (-not $AppDir) { Log 'لم يُعثر على مجلد التثبيت.'; exit 1 }

  $check = & node (Join-Path $here 'build\check.mjs') $AppDir | ConvertFrom-Json
  if (-not $check.exists) { Log 'app.asar غير موجود.'; exit 1 }
  if ($check.patched -and -not $check.stale) { exit 0 }

  if ($check.patched) { Log ("الحزمة قديمة (" + $check.reason + ") — إعادة البناء.") }
  else { Log ("الحزمة غير مثبتة على الإصدار " + $check.version + " — إعداد التثبيت.") }

  function Run-Patch([string]$mode) {
    for ($i = 1; $i -le 3; $i++) {
      Log ("تشغيل patch " + $mode + " (محاولة " + $i + ")")
      & node (Join-Path $here 'build\patch.mjs') --app $AppDir $mode 2>&1 |
        ForEach-Object { "$_" | Add-Content -Path $log -Encoding UTF8 }
      if ($LASTEXITCODE -eq 0) { return $true }
      Log "محاولة $i لـ$mode فشلت (exit $LASTEXITCODE)"
      Start-Sleep -Seconds 2
    }
    return $false
  }

  # بناء مسبق بينما التطبيق يعمل: لا يمسّ app.asar، ويجعل التبديل لاحقاً فورياً
  # (نافذة التبديل تصير أجزاء من الثانية بدل ثانية كاملة — التطبيق قد يعيد فتح نفسه).
  $prebuilt = $false
  if (-not $check.patched) {
    Log 'بناء مسبق لـ app.asar.new…'
    if (Run-Patch '') { $prebuilt = $true } else { Log 'تحذير: تعذّر البناء المسبق — سيُبنى عند الإغلاق.' }
  }

  # انتظار تحرّر app.asar (لا انتظار اختفاء العملية): إعادة تشغيل التطبيق السريعة
  # قد تُغلق النافذة وتفتحها في أقل من ثانية، فيفوت الفحص القائم على العمليات.
  $asarPath = Join-Path $AppDir 'resources\app.asar'
  function Test-AsarFree {
    try {
      $fs = [System.IO.File]::Open($asarPath, 'Open', 'ReadWrite', 'None')
      $fs.Close()
      return $true
    } catch { return $false }
  }

  $wasRunning = [bool](Get-Process -Name OpenCode -ErrorAction SilentlyContinue)
  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  while (-not (Test-AsarFree)) {
    if ((Get-Date) -gt $deadline) { Log 'انتهت المدة دون إغلاق التطبيق — أُلغي (ستُعاد المحاولة دورياً).'; exit 1 }
    Start-Sleep -Milliseconds 500
  }
  if ($wasRunning) { Log 'تحرّر app.asar — بدء التبديل.' }
  Start-Sleep -Milliseconds 300

  if ($prebuilt) {
    $swapped = $false
    for ($i = 1; $i -le 10; $i++) {
      & node (Join-Path $here 'build\patch.mjs') --app $AppDir --swap 2>&1 |
        ForEach-Object { "$_" | Add-Content -Path $log -Encoding UTF8 }
      if ($LASTEXITCODE -eq 0) { $swapped = $true; break }
      Start-Sleep -Milliseconds 200
    }
    if (-not $swapped) { Log 'تعذّر التبديل الفوري — ستُعاد المحاولة دورياً.'; exit 1 }
  } else {
    if (Test-Path (Join-Path $AppDir 'resources\app.asar.orig-*')) {
      if (-not (Run-Patch '--revert')) { Log 'تعذّر استرجاع الأصل — إلغاء.'; exit 1 }
    }
    if (-not (Run-Patch '--apply')) { Log 'تعذّر البناء أو التبديل.'; exit 1 }
  }
  Log ("تم التثبيت على الإصدار " + $check.version + ".")

  # إعادة فتح التطبيق إن لم يكن يعمل الآن (المستخدم أغلقه ليُطبَّق البناء)
  if (-not (Get-Process -Name OpenCode -ErrorAction SilentlyContinue)) {
    $proc = Start-Process -FilePath (Join-Path $AppDir 'OpenCode.exe') -PassThru
    Log ("أُعيد فتح التطبيق pid=" + $proc.Id)
    Start-Sleep -Seconds 40
    if ($proc.HasExited) {
      Log 'خرج التطبيق بعد التبديل — استرجاع الأصل.'
      & node (Join-Path $here 'build\patch.mjs') --app $AppDir --revert 2>&1 |
        ForEach-Object { "$_" | Add-Content -Path $log -Encoding UTF8 }
      Start-Process -FilePath (Join-Path $AppDir 'OpenCode.exe') | Out-Null
      Log 'أُعيد الأصل وفتح التطبيق.'
    }
  } else {
    Log 'التطبيق يعمل الآن — أعد تشغيله لرؤية التعريب.'
  }
} finally {
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
