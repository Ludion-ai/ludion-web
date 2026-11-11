# Ludion の Windows アプリを作る。
#   pwsh apps/windows/scripts/build.ps1 -Target exe   … 段階 A：署名のない1つの .exe（out/LudionSetup.exe）
#   pwsh apps/windows/scripts/build.ps1 -Target msix  … Store に出す MSIX（out/Ludion.msix。署名は Store がする）
# MSIX の Identity の既定は、Partner Center で予約した「Ludion」の値（秘密ではない。STORE001）。
#   -IdentityName "Ludion.Ludion" -Publisher "CN=A8199335-A692-41A8-8E63-3FE3DF581A81" -PublisherDisplayName "Ludion"
# 版は3つの数で渡す（-Version 1.0.0）。MSIX には4つ目に 0 を足す（4つ目は Store が使うので 0 のまま）。
# 要るもの：.NET 10 SDK。makeappx は NuGet の Microsoft.Windows.SDK.BuildTools から取る（Windows SDK を入れなくてよい）。
param(
  [ValidateSet('exe', 'msix', 'all')][string]$Target = 'all',
  [ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version = '1.0.0',
  [string]$IdentityName = 'Ludion.Ludion',
  [string]$Publisher = 'CN=A8199335-A692-41A8-8E63-3FE3DF581A81',
  [string]$PublisherDisplayName = 'Ludion'
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$out = Join-Path $root 'out'
$project = Join-Path $root 'Ludion.Wallpaper.csproj'
$dotnet = if (Get-Command dotnet -ErrorAction SilentlyContinue) { 'dotnet' } else { Join-Path $env:USERPROFILE '.dotnet\dotnet.exe' }
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
New-Item -ItemType Directory -Force $out | Out-Null

function Invoke-Checked([string]$exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "$exe が失敗した（$LASTEXITCODE）" }
}

if ($Target -in 'exe', 'all') {
  $dir = Join-Path $out 'exe'
  Invoke-Checked $dotnet @('publish', $project, '-c', 'Release', '-p:LudionSingleFile=true', "-p:Version=$Version", '-o', $dir)
  Copy-Item (Join-Path $dir 'Ludion.exe') (Join-Path $out 'LudionSetup.exe') -Force
  $file = Get-Item (Join-Path $out 'LudionSetup.exe')
  $hash = (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  LudionSetup.exe" | Set-Content (Join-Path $out 'LudionSetup.exe.sha256') -NoNewline
  Write-Host ("exe: {0}（{1:N1} MB）sha256 {2}" -f $file.FullName, ($file.Length / 1MB), $hash)
}

if ($Target -in 'msix', 'all') {
  $dir = Join-Path $out 'msix-root'
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  # MSIX の中は1つの .exe にしない（Store が差分で更新できるように、ふつうのファイルで並べる）
  Invoke-Checked $dotnet @('publish', $project, '-c', 'Release', "-p:Version=$Version", '-p:DebugType=none', '-o', $dir)
  Get-ChildItem $dir -Filter '*.xml' | Remove-Item
  New-Item -ItemType Directory -Force (Join-Path $dir 'Assets') | Out-Null
  Get-ChildItem (Join-Path $root 'Package\Assets') -Filter '*.png' | Where-Object { $_.Name -ne 'Store-300.png' } |
    Copy-Item -Destination (Join-Path $dir 'Assets')
  $manifest = Get-Content (Join-Path $root 'Package\AppxManifest.xml') -Raw
  $manifest = $manifest.Replace('__IDENTITY_NAME__', $IdentityName).Replace('__PUBLISHER__', $Publisher).
    Replace('__PUBLISHER_DISPLAY_NAME__', $PublisherDisplayName).Replace('__VERSION__', "$Version.0")
  Set-Content (Join-Path $dir 'AppxManifest.xml') $manifest -Encoding utf8NoBOM

  # makeappx を NuGet から取る
  $tools = Join-Path $out 'tools'
  $makeappx = Get-ChildItem $tools -Recurse -Filter makeappx.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1
  if (-not $makeappx) {
    New-Item -ItemType Directory -Force $tools | Out-Null
    $nupkg = Join-Path $tools 'buildtools.zip'
    Invoke-WebRequest 'https://www.nuget.org/api/v2/package/Microsoft.Windows.SDK.BuildTools/10.0.28000.2957' -OutFile $nupkg
    Expand-Archive $nupkg (Join-Path $tools 'buildtools') -Force
    $makeappx = Get-ChildItem $tools -Recurse -Filter makeappx.exe | Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1
  }
  $msix = Join-Path $out 'Ludion.msix'
  Invoke-Checked $makeappx.FullName @('pack', '/d', $dir, '/p', $msix, '/o', '/h', 'SHA256')
  $file = Get-Item $msix
  Write-Host ("msix: {0}（{1:N1} MB）" -f $file.FullName, ($file.Length / 1MB))
}
