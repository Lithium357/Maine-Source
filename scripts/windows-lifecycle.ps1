param([Parameter(Mandatory=$true)][string]$CurrentInstaller, [Parameter(Mandatory=$true)][string]$LegacyInstaller)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Run lifecycle installation tests only on the disposable GitHub Actions Windows runner.' }
$testParent = Join-Path $env:RUNNER_TEMP ('maine-source-lifecycle-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testParent | Out-Null
$installPath = Join-Path $testParent 'Installed app'
$desktop = [Environment]::GetFolderPath('Desktop')
$dataPath = Join-Path $desktop 'data/Maine-Source'
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
$sentinel = Join-Path $dataPath 'lifecycle-preserve-sentinel.txt'
Set-Content -LiteralPath $sentinel -Value 'User datasets must survive upgrade and uninstall.' -Encoding utf8
function Install-Build([string]$Installer) {
  $process = Start-Process -FilePath (Resolve-Path -LiteralPath $Installer) -ArgumentList @('/S', "/D=$installPath") -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)" }
  if (-not (Test-Path -LiteralPath (Join-Path $installPath 'Maine Source.exe'))) { throw 'Installed executable missing' }
}
Install-Build $LegacyInstaller
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  $process = Start-Process -FilePath (Join-Path $installPath 'Maine Source.exe') -ArgumentList @("`"$PWD/scripts/seed-legacy.cjs`"", "`"$installPath`"", "`"$dataPath`"") -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw 'Legacy dataset fixture failed' }
} finally { Remove-Item Env:\ELECTRON_RUN_AS_NODE }
Install-Build $CurrentInstaller
if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Upgrade removed data' }
$oldPath = $env:PATH
try {
  # The installed application must work without externally installed Node/Python on PATH.
  $env:PATH = "$env:SystemRoot\system32;$env:SystemRoot"
  $process = Start-Process -FilePath (Join-Path $installPath 'Maine Source.exe') -ArgumentList @('--self-test', "`"$testParent`"", '--legacy-data', "`"$dataPath`"") -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw 'Installed runtime self-test failed' }
} finally { $env:PATH = $oldPath }
$report = Get-Content -LiteralPath (Join-Path $testParent 'maine-source-self-test.json') | ConvertFrom-Json
if (-not $report.passed) { throw 'Installed self-test did not confirm success' }
$uninstaller = Get-ChildItem -LiteralPath $installPath -Filter '*Uninstall*.exe' | Select-Object -First 1
if (-not $uninstaller) { throw 'Uninstaller missing' }
$process = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode -ne 0) { throw 'Uninstaller failed' }
for ($attempt = 0; $attempt -lt 30 -and (Test-Path -LiteralPath (Join-Path $installPath 'Maine Source.exe')); $attempt++) { Start-Sleep -Milliseconds 500 }
if (Test-Path -LiteralPath (Join-Path $installPath 'Maine Source.exe')) { throw 'Uninstall left the main executable installed' }
if ((Get-Content -LiteralPath $sentinel -Raw) -notmatch 'must survive') { throw 'Uninstall removed user data' }
if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'datasets/jobs.json'))) { throw 'Uninstall removed the legacy dataset' }
@{ passed=$true; installed=$true; upgradedFrom='0.1.5'; uninstalled=$true; dataPreserved=$true; externalRuntimesOnPath=$false; runtime=$report } | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 'release/windows-lifecycle-report.json'
