param([ValidateSet('install','uninstall')][string]$Phase='install')
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskVersion=(Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskTestRoot=Join-Path $taskRoot '.local/ci-installer'
$taskTarget=[IO.Path]::GetFullPath((Join-Path $taskTestRoot 'application'))
if(-not $taskTarget.StartsWith($taskRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Target outside the checked-out workspace'}
foreach($taskPath in @($taskRoot,(Join-Path $taskRoot '.local'),$taskTestRoot,$taskTarget)){
  if((Test-Path -LiteralPath $taskPath) -and ((Get-Item -LiteralPath $taskPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Installer target is redirected'}
}
if(Get-Process AgentHub -ErrorAction SilentlyContinue){throw 'An AgentHub process is running; no process was stopped'}
$taskKeys=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
function Get-AgentHubInstallations { @(foreach($taskKey in $taskKeys){Get-ChildItem -LiteralPath $taskKey -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object DisplayName -Like '*AgentHub*'}) }
$taskInstalled=@(Get-AgentHubInstallations)
$taskOwner=Join-Path $taskTestRoot 'ownership.json'
$taskUninstaller=Join-Path $taskTarget 'Uninstall AgentHub.exe'
if(Test-Path -LiteralPath $taskOwner){
  $taskState=Get-Content -LiteralPath $taskOwner -Raw | ConvertFrom-Json
  if($taskState.createdBy -ne 'AgentHub clean installer validation' -or $taskState.target -ne $taskTarget){throw 'Installer ownership mismatch'}
}else{
  if($taskInstalled.Count -or (Test-Path -LiteralPath $taskTarget)){throw 'Existing user installation or target; refusing replacement'}
  New-Item -ItemType Directory -Force -Path $taskTestRoot | Out-Null
  $taskState=[pscustomobject]@{createdBy='AgentHub clean installer validation';target=$taskTarget;version=$taskVersion;phase='prepared'}
}
if($taskInstalled.Count){
  if($taskInstalled.Count -ne 1 -or -not $taskInstalled[0].UninstallString.StartsWith(('"'+$taskUninstaller+'"'),[StringComparison]::OrdinalIgnoreCase)){throw 'Registry belongs to another installation'}
}elseif($Phase -eq 'uninstall'){throw 'Owned installation is missing'}
$taskState | ConvertTo-Json | Set-Content -LiteralPath $taskOwner -Encoding utf8
$taskExecutable=if($Phase -eq 'install'){Join-Path $taskRoot "release/$taskVersion/AgentHub Setup $taskVersion.exe"}else{$taskUninstaller}
if(-not(Test-Path -LiteralPath $taskExecutable -PathType Leaf)){throw 'Installer executable is missing'}
$taskArguments=if($Phase -eq 'install'){@('/S',"/D=$taskTarget")}else{@('/S')}
$taskProcess=Start-Process -FilePath $taskExecutable -ArgumentList $taskArguments -WindowStyle Hidden -PassThru
if(-not $taskProcess.WaitForExit(60000)){throw 'Installer timed out; state preserved'}
if($taskProcess.ExitCode -ne 0){throw "Installer exit code $($taskProcess.ExitCode)"}
$taskApp=Join-Path $taskTarget 'AgentHub.exe'
if($Phase -eq 'install'){
  if(-not(Test-Path -LiteralPath $taskApp) -or (Get-Item -LiteralPath $taskApp).VersionInfo.ProductVersion -notlike "$taskVersion*"){throw 'Installed version mismatch'}
  $taskNow=@(Get-AgentHubInstallations)
  if($taskNow.Count -ne 1 -or $taskNow[0].DisplayVersion -ne $taskVersion){throw 'Install registry mismatch'}
}else{
  $taskDeadline=[DateTime]::UtcNow.AddSeconds(30)
  while(((Test-Path -LiteralPath $taskApp) -or @(Get-AgentHubInstallations).Count) -and [DateTime]::UtcNow -lt $taskDeadline){Start-Sleep -Milliseconds 250}
  if((Test-Path -LiteralPath $taskApp) -or @(Get-AgentHubInstallations).Count){throw 'Uninstall incomplete'}
}
$taskState.phase=$Phase
$taskState | ConvertTo-Json | Set-Content -LiteralPath $taskOwner -Encoding utf8
Write-Output "PASS: owned $Phase $taskVersion"
