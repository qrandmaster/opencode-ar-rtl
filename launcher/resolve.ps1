#requires -Version 5.1
<#
  resolve.ps1 — يجد مجلد أداة التعريب ثم يشغّل ensure-installed.ps1.
  يُنسخ إلى %LOCALAPPDATA%\OpenCodeRTL (موضع ثابت)، فيصمد أمام نقل/إعادة تسمية
  مجلد المشروع: يقرأ المسار المخزّن، وإن بطل يبحث عنه من جديد ويحدّثه.
#>
$ErrorActionPreference = 'SilentlyContinue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cache = Join-Path $here 'target.txt'

function Test-Tool([string]$dir) {
  return ($dir -and (Test-Path (Join-Path $dir 'ensure-installed.ps1')))
}

$target = $null
if (Test-Path $cache) {
  $cached = (Get-Content $cache -Raw -ErrorAction SilentlyContinue)
  if ($cached) { $cached = $cached.Trim() }
  if (Test-Tool $cached) { $target = $cached }
}

if (-not $target) {
  $roots = @('D:\Workplace\Projects', "$env:USERPROFILE\Projects", "$env:USERPROFILE\Documents\Projects")
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $hit = Get-ChildItem -Path $root -Filter 'ensure-installed.ps1' -Recurse -Depth 8 -File |
      Where-Object { $_.DirectoryName -like '*opencode-ar-rtl' } | Select-Object -First 1
    if ($hit) { $target = $hit.DirectoryName; break }
  }
  if ($target) { $target | Set-Content -Path $cache -Encoding UTF8 }
}

if (-not $target) { exit 0 }
& (Join-Path $target 'ensure-installed.ps1')
