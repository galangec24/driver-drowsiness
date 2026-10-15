<#
.SYNOPSIS
  Frees disk space taken by build caches and temporary files (Gradle, Flutter, npm, test leftovers).

.DESCRIPTION
  Everything removed is re-created automatically when it is needed again (the next APK build
  downloads the Gradle files again, ~3 GB, and takes longer once). Your documents, the APK/EXE
  files, ML datasets and browser data are never touched.

  By default it only cleans when C: is low on space (-MinFreeGB, default 3 GB). Use -Force to
  clean now regardless. -Register installs a Windows scheduled task that runs this check
  automatically at every sign-in and every day at 12:00; -Unregister removes it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\clean-caches.ps1            # clean if C: < 3 GB free
  powershell -ExecutionPolicy Bypass -File tools\clean-caches.ps1 -Force     # clean now
  powershell -ExecutionPolicy Bypass -File tools\clean-caches.ps1 -Register  # automatic from now on
  powershell -ExecutionPolicy Bypass -File tools\clean-caches.ps1 -Unregister
#>
param(
  [double]$MinFreeGB = 3,
  [switch]$Force,
  [switch]$Register,
  [switch]$Unregister,
  [switch]$IncludeGradle = $true
)

$ErrorActionPreference = 'SilentlyContinue'
$TaskName = 'Guardian Drive - clean build caches'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $env:LOCALAPPDATA 'GuardianDrive\clean-caches.log'

function Write-Log([string]$text) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $text
  Write-Output $line
  New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
  Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Get-FreeGB { [math]::Round((Get-PSDrive C).Free / 1GB, 1) }

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed the scheduled task '$TaskName'."
  exit 0
}

if ($Register) {
  $script = $MyInvocation.MyCommand.Path
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -MinFreeGB $MinFreeGB"
  $triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME),
    (New-ScheduledTaskTrigger -Daily -At 12:00)
  )
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
    -Description "Cleans Gradle/Flutter/npm caches and temp files when C: has less than $MinFreeGB GB free." -Force | Out-Null
  Write-Output "Scheduled: '$TaskName' runs at sign-in and daily at 12:00, cleaning only when C: < $MinFreeGB GB free."
  Write-Output "Log: $LogFile    Remove with: tools\clean-caches.ps1 -Unregister"
  exit 0
}

$freeBefore = Get-FreeGB
if (-not $Force -and $freeBefore -ge $MinFreeGB) {
  Write-Log "C: has $freeBefore GB free (>= $MinFreeGB GB): nothing to do."
  exit 0
}

# Running builds/tests would hold files open (and break half-way), so wait for none of them.
$busy = Get-Process java, dart, dartaotruntime, mongod, node | Where-Object { $_.Path -like '*gradle*' -or $_.Name -in 'dart', 'dartaotruntime', 'mongod' }
if ($busy -and -not $Force) {
  Write-Log "A build or test is running ($(($busy | Select-Object -ExpandProperty Name -Unique) -join ', ')): skipped, will try next time."
  exit 0
}

# Stop the Gradle daemons first: deleting their cache while they run corrupts it (seen 2026-10).
$gradlew = Join-Path $RepoRoot 'mobile_app\android\gradlew.bat'
if (Test-Path $gradlew) { & $gradlew --stop *> $null }

$targets = [ordered]@{
  'Temp: test databases (mongo-mem-*)' = (Get-ChildItem $env:TEMP -Directory -Filter 'mongo-mem-*')
  'Temp: Flutter test compiler'        = (Get-ChildItem $env:TEMP -Directory -Filter 'flutter_tools.*')
  'Temp: other files older than 2 days' = (Get-ChildItem $env:TEMP -Force | Where-Object { $_.Name -ne 'claude' -and $_.LastWriteTime -lt (Get-Date).AddDays(-2) })
  'Flutter build output (mobile_app\build)' = (Get-Item (Join-Path $RepoRoot 'mobile_app\build'))
  'npm cache'                          = (Get-Item "$env:LOCALAPPDATA\npm-cache")
  'Electron download caches'           = @((Get-Item "$env:LOCALAPPDATA\electron\Cache"), (Get-Item "$env:LOCALAPPDATA\electron-builder\Cache"))
  'Crash dumps'                        = (Get-Item "$env:LOCALAPPDATA\CrashDumps")
}
if ($IncludeGradle) {
  $targets['Gradle caches (re-downloaded by the next APK build)'] = @(
    (Get-Item "$env:USERPROFILE\.gradle\caches"),
    (Get-Item "$env:USERPROFILE\.gradle\wrapper\dists"),
    (Get-Item "$env:USERPROFILE\.gradle\daemon")
  )
}

Write-Log "Cleaning (C: had $freeBefore GB free)"
foreach ($name in $targets.Keys) {
  $items = @($targets[$name]) | Where-Object { $_ }
  if (-not $items) { continue }
  $bytes = 0
  foreach ($it in $items) {
    $bytes += if ($it.PSIsContainer) {
      (Get-ChildItem $it.FullName -Recurse -Force -File | Measure-Object Length -Sum).Sum
    } else { $it.Length }
    Remove-Item $it.FullName -Recurse -Force
  }
  Write-Log ('  {0,8:N0} MB  {1}' -f ($bytes / 1MB), $name)
}
$freeAfter = Get-FreeGB
Write-Log "Done: C: now has $freeAfter GB free (freed $([math]::Round($freeAfter - $freeBefore, 1)) GB)."
