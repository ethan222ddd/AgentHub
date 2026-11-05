param(
  [ValidateSet('install-old','upgrade','uninstall')][string]$Phase,
  [ValidatePattern('^\d+\.\d+\.\d+$')][string]$FromVersion='0.9.0',
  [string]$ToVersion=''
)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $ToVersion){$ToVersion=(Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version}
if($ToVersion -notmatch '^\d+\.\d+\.\d+$' -or $ToVersion -eq $FromVersion){throw 'Expected distinct, valid release versions'}
$taskTestRoot=[IO.Path]::GetFullPath((Join-Path $taskRoot '.local/installer-roundtrip'))
$taskInstall=[IO.Path]::GetFullPath((Join-Path $taskTestRoot 'application'))
if(-not $taskInstall.StartsWith($taskRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Installer target outside workspace'}
foreach($taskAncestor in @($taskRoot,(Join-Path $taskRoot '.local'),$taskTestRoot,$taskInstall)){
  if((Test-Path -LiteralPath $taskAncestor) -and ((Get-Item -LiteralPath $taskAncestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Installer validation path was redirected'}
}
$taskStatePath=Join-Path $taskTestRoot 'ownership.json'
$taskRegistry=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
function InstalledAgentHub { @(foreach($key in $taskRegistry){Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object DisplayName -Like '*AgentHub*'}) }
$taskInstalled=@(InstalledAgentHub)
if(Get-Process AgentHub -ErrorAction SilentlyContinue){throw 'Close AgentHub first. No process was stopped.'}
if($Phase -eq 'install-old'){
  if($taskInstalled.Count -or (Test-Path -LiteralPath $taskInstall) -or (Test-Path -LiteralPath $taskStatePath)){throw 'Existing installation or validation state found; user state is protected'}
  New-Item -ItemType Directory -Path $taskTestRoot -Force | Out-Null
  $taskState=[pscustomobject]@{createdBy='AgentHub isolated installer validation';nonce=[Guid]::NewGuid().ToString();target=$taskInstall;from=$FromVersion;to=$ToVersion;phase='starting';baselineInstallerSha256='';upgradeInstallerSha256=''}
}else{
  $taskState=Get-Content -LiteralPath $taskStatePath -Raw | ConvertFrom-Json
  if($taskState.createdBy -ne 'AgentHub isolated installer validation' -or $taskState.target -ne $taskInstall -or $taskState.from -ne $FromVersion -or $taskState.to -ne $ToVersion){throw 'Installer ownership/version mismatch'}
  $taskExpectedUninstall='"'+(Join-Path $taskInstall 'Uninstall AgentHub.exe')+'"'
  if($taskInstalled.Count -ne 1 -or -not $taskInstalled[0].UninstallString.StartsWith($taskExpectedUninstall,[StringComparison]::OrdinalIgnoreCase)){throw 'Registry points to another installation; refusing mutation'}
  if($taskInstalled[0].InstallLocation -and [IO.Path]::GetFullPath($taskInstalled[0].InstallLocation).TrimEnd('\') -ne $taskInstall.TrimEnd('\')){throw 'Unexpected install location'}
  if($Phase -eq 'upgrade' -and $taskState.phase -ne 'install-old'){throw 'Expected completed baseline installation'}
  if($Phase -eq 'uninstall' -and $taskState.phase -ne 'upgrade'){throw 'Expected completed upgraded installation'}
}
$taskInstaller=if($Phase -eq 'uninstall'){Join-Path $taskInstall 'Uninstall AgentHub.exe'}else{
  $taskVersion=if($Phase -eq 'install-old'){$FromVersion}else{$ToVersion}
  Join-Path $taskRoot "release/$taskVersion/AgentHub Setup $taskVersion.exe"
}
if(-not(Test-Path -LiteralPath $taskInstaller -PathType Leaf)){throw 'Expected installer not found; build or restore the named release first'}
if($Phase -ne 'uninstall'){
  $taskHash=(Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
  $taskName=[IO.Path]::GetFileName($taskInstaller)
  $taskSum=Get-Content -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName($taskInstaller)) 'SHA256SUMS.txt') | Where-Object {$_ -match ('^'+$taskHash+'  '+[regex]::Escape($taskName)+'$')}
  if(-not $taskSum){throw 'Installer does not match its release checksum'}
  if($Phase -eq 'install-old'){$taskState.baselineInstallerSha256=$taskHash}else{$taskState.upgradeInstallerSha256=$taskHash}
}
$taskState | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $taskStatePath -Encoding utf8
# NSIS /D must be the final argument; its remainder is the literal directory.
# Installed builder templates confirm silent assisted installers do not auto-run.
$taskArgs=if($Phase -eq 'uninstall'){@('/S')}else{@('/S',"/D=$taskInstall")}
$taskProcess=Start-Process -FilePath $taskInstaller -ArgumentList $taskArgs -WindowStyle Hidden -PassThru
if(-not $taskProcess.WaitForExit(60000)){throw 'Installer timed out; owned state retained for inspection'}
if($taskProcess.ExitCode -ne 0){throw ('Installer failed: '+$taskProcess.ExitCode)}
$taskExe=Join-Path $taskInstall 'AgentHub.exe'
if($Phase -eq 'uninstall'){
  $taskDeadline=[DateTime]::UtcNow.AddSeconds(30)
  while(((Test-Path -LiteralPath $taskExe) -or @(InstalledAgentHub).Count) -and [DateTime]::UtcNow -lt $taskDeadline){Start-Sleep -Milliseconds 250}
  if(Test-Path -LiteralPath $taskExe){throw 'Uninstaller did not remove validation executable'}
  if(@(InstalledAgentHub).Count){throw 'Uninstall registry entry remains'}
}else{
  $taskExpected=if($Phase -eq 'upgrade'){$ToVersion}else{$FromVersion}
  if(-not(Test-Path -LiteralPath $taskExe) -or (Get-Item -LiteralPath $taskExe).VersionInfo.ProductVersion -notlike "$taskExpected*"){throw 'Installed executable version mismatch'}
  $taskNow=@(InstalledAgentHub)
  if($taskNow.Count -ne 1 -or $taskNow[0].DisplayVersion -ne $taskExpected){throw 'Installed registry version mismatch'}
}
$taskState.phase=$Phase
$taskState | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $taskStatePath -Encoding utf8
Write-Output "PASS: $Phase $FromVersion -> $ToVersion at verified validation target"
