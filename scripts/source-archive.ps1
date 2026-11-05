$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$staging = Join-Path $projectRoot ('.local/source-' + [guid]::NewGuid().ToString('N'))
$archive = Join-Path $projectRoot "release/$version/AgentHub-$version-source.zip"
if ((Test-Path -LiteralPath (Join-Path $projectRoot '.local')) -and ((Get-Item -LiteralPath (Join-Path $projectRoot '.local') -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Source staging parent is redirected' }
New-Item -ItemType Directory -Path $staging | Out-Null
try {
# Explicit public-source allowlist: never package .local, credentials, .env or installed runtimes.
foreach ($entry in @('src','tests','docs','scripts','assets','.github','.gitignore','.gitattributes','.prettierrc.json','electron.vite.config.ts','eslint.config.js','LICENSE','package-lock.json','package.json','playwright.config.ts','README.md','tsconfig.json','vitest.config.ts')) {
  $sourcePath = Join-Path $projectRoot $entry
  if (Test-Path -LiteralPath $sourcePath) {
    $sourceEntry = Get-Item -LiteralPath $sourcePath -Force
    if (($sourceEntry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($sourceEntry.PSIsContainer -and (Get-ChildItem -LiteralPath $sourcePath -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1))) { throw 'Public source contains a link requiring review' }
    Copy-Item -LiteralPath $sourcePath -Destination $staging -Recurse
  }
}
Compress-Archive -LiteralPath @((Get-ChildItem -LiteralPath $staging -Force).FullName) -DestinationPath $archive -Force
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$sumsPath = Join-Path $projectRoot "release/$version/SHA256SUMS.txt"
$lines = if (Test-Path -LiteralPath $sumsPath) { @(Get-Content -LiteralPath $sumsPath | Where-Object { $_ -notmatch '-source\.zip$' }) } else { @() }
Set-Content -LiteralPath $sumsPath -Value @($lines + "$hash  AgentHub-$version-source.zip") -Encoding utf8
Write-Output $archive
Write-Output $hash
} finally {
  $resolvedStaging = [IO.Path]::GetFullPath($staging)
  $allowedParent = [IO.Path]::GetFullPath((Join-Path $projectRoot '.local'))
  if (-not $resolvedStaging.StartsWith($allowedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedStaging) -notmatch '^source-[a-f0-9]{32}$') { throw 'Refusing cleanup outside source staging' }
  if (Test-Path -LiteralPath $resolvedStaging) { Remove-Item -LiteralPath $resolvedStaging -Recurse -Force }
}
