param([ValidateSet('install-old','upgrade','uninstall')][string]$Phase)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot '.local\installer-roundtrip'))
$installDir = [IO.Path]::GetFullPath((Join-Path $testRoot 'application'))
if (-not $installDir.StartsWith($workspaceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer target escapes the workspace' }
$statePath = Join-Path $testRoot 'ownership.json'
$registryRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
$installed = @(foreach ($key in $registryRoots) { Get-ChildItem $key -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -like '*AgentHub*' } })
if (Get-Process AgentHub -ErrorAction SilentlyContinue) { throw 'Close all AgentHub applications before the opt-in installer test; no process will be killed.' }
if ($Phase -eq 'install-old') {
  if ($installed.Count -or (Test-Path -LiteralPath $installDir)) { throw 'Existing AgentHub installation or target detected; refusing to replace user state.' }
  New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
  @{ target = $installDir; createdBy = 'AgentHub isolated installer validation'; nonce = [Guid]::NewGuid().ToString(); phase = 'starting' } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
  $installer = Join-Path $workspaceRoot 'release\0.1.1\AgentHub Setup 0.1.1.exe'
} else {
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if ($state.createdBy -ne 'AgentHub isolated installer validation' -or $state.target -ne $installDir) { throw 'Installer test ownership verification failed' }
  $expectedUninstaller = '"' + (Join-Path $installDir 'Uninstall AgentHub.exe') + '"'
  if ($installed.Count -ne 1 -or -not $installed[0].UninstallString.StartsWith($expectedUninstaller,[StringComparison]::OrdinalIgnoreCase)) { throw 'Registry points to a different installation; refusing mutation' }
  if ($installed[0].InstallLocation -and [IO.Path]::GetFullPath($installed[0].InstallLocation).TrimEnd('\') -ne $installDir.TrimEnd('\')) { throw 'Install location differs; refusing mutation' }
  $installer = if ($Phase -eq 'upgrade') { Join-Path $workspaceRoot 'release\0.2.0\AgentHub Setup 0.2.0.exe' } else { Join-Path $installDir 'Uninstall AgentHub.exe' }
}
if (-not (Test-Path -LiteralPath $installer)) { throw 'Expected installer does not exist' }
$arguments = if ($Phase -eq 'uninstall') { @('/S') } else { @('/S',"/D=$installDir") }
$process = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Hidden -PassThru
if (-not $process.WaitForExit(120000)) { throw 'Installer timed out; state preserved for inspection' }
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
$executable = Join-Path $installDir 'AgentHub.exe'
if ($Phase -eq 'uninstall') {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ((Test-Path -LiteralPath $executable) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (Test-Path -LiteralPath $executable) { throw 'Uninstall did not remove the test executable' }
} else {
  if (-not (Test-Path -LiteralPath $executable)) { throw 'Installer did not create the expected executable' }
  $expected = if ($Phase -eq 'upgrade') { '0.2.0' } else { '0.1.1' }
  if ((Get-Item -LiteralPath $executable).VersionInfo.ProductVersion -notlike "$expected*") { throw 'Installed version mismatch' }
}
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$state.phase = $Phase; $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
Write-Output "PASS: $Phase at verified workspace target $installDir"
