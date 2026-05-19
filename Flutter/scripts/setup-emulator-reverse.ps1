param(
  [int]$Port = 5175
)

$ErrorActionPreference = 'Stop'

$adb = "C:\Users\dev9\AppData\Local\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
  throw "adb introuvable: $adb"
}

$devicesOutput = & $adb devices
$emulators = @()

foreach ($line in $devicesOutput) {
  if ($line -match '^(emulator-\d+)\s+device$') {
    $emulators += $matches[1]
  }
}

if ($emulators.Count -eq 0) {
  Write-Output 'Aucun emulateur Android en etat device.'
  exit 0
}

foreach ($emulator in $emulators) {
  & $adb -s $emulator reverse "tcp:$Port" "tcp:$Port" | Out-Null
  Write-Output "Reverse configure pour $emulator (tcp:$Port -> tcp:$Port)"
}

Write-Output ''
Write-Output 'Mappings actifs:'
foreach ($emulator in $emulators) {
  Write-Output "[$emulator]"
  & $adb -s $emulator reverse --list
}
