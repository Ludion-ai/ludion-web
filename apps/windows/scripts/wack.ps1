# Store に出す MSIX を、Windows App Certification Kit（WACK）で確かめる。
#   pwsh apps/windows/scripts/wack.ps1                       … out/Ludion.msix を確かめ、out/wack/report.xml に結果を書く
# - 管理者の権限が要る（WACK が試しに入れて動かすため）。Actions の Windows の機械は管理者で動く
# - WACK は入れられる（署名のある）パッケージを要るので、試しのためだけの自分の署名を付けた写しを作って確かめる。
#   Store に上げるのは、署名のない out/Ludion.msix のまま（署名は Store がする）。試しの鍵は、この機械の中でだけ作って捨てる
param(
  [string]$Package = (Join-Path $PSScriptRoot '..\out\Ludion.msix'),
  [string]$OutDir = (Join-Path $PSScriptRoot '..\out\wack')
)
$ErrorActionPreference = 'Stop'
$Package = (Resolve-Path $Package).Path
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'WACK は管理者の権限で動かす' }

# WACK を探す（Windows SDK の中の App Certification Kit）
$kit = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\App Certification Kit'
$appcert = Join-Path $kit 'appcert.exe'
if (-not (Test-Path $appcert)) { throw "WACK が見つからない：$appcert" }
$signtool = Get-ChildItem (Join-Path $PSScriptRoot '..\out\tools') -Recurse -Filter signtool.exe | Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1
if (-not $signtool) { throw 'signtool がない（先に build.ps1 -Target msix を動かす）' }

# 試しのための署名（Publisher と同じ名前の、自分で作った鍵）
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($Package)
try {
  $reader = New-Object IO.StreamReader(($zip.Entries | Where-Object FullName -eq 'AppxManifest.xml').Open())
  $manifest = [xml]$reader.ReadToEnd(); $reader.Close()
} finally { $zip.Dispose() }
$publisher = $manifest.Package.Identity.Publisher
$name = $manifest.Package.Identity.Name
Write-Host "パッケージ：$name $($manifest.Package.Identity.Version) $publisher"
$cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature -FriendlyName 'Ludion WACK test' `
  -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddDays(1) `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$cer = Join-Path $OutDir 'test.cer'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
$signed = Join-Path $OutDir 'Ludion.test-signed.msix'
Copy-Item $Package $signed -Force
try {
  & $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint /s My $signed
  if ($LASTEXITCODE -ne 0) { throw "signtool が失敗した（$LASTEXITCODE）" }

  $report = Join-Path $OutDir 'report.xml'
  if (Test-Path $report) { Remove-Item $report }
  & $appcert reset | Out-Null
  & $appcert test -appxpackagepath $signed -reportoutputpath $report
  if (-not (Test-Path $report)) { throw "WACK の結果がない（$LASTEXITCODE）" }
} finally {
  Get-AppxPackage -Name $name -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
  Get-ChildItem 'Cert:\LocalMachine\TrustedPeople', 'Cert:\CurrentUser\My' | Where-Object Thumbprint -eq $cert.Thumbprint | Remove-Item
  Remove-Item $signed, $cer -ErrorAction SilentlyContinue
}

# 結果を並べる。FAIL が1つでもあれば落とす（WARNING は出すだけ。Store も警告では止めない）
$xml = [xml](Get-Content $report -Raw)
$overall = $xml.REPORT.OVERALL_RESULT
$failed = 0
foreach ($test in $xml.SelectNodes('//TEST')) {
  $result = $test.RESULT.'#cdata-section'
  if (-not $result) { $result = "$($test.RESULT)" }
  $result = $result.Trim()
  if ($result -eq 'FAIL') { $failed++ }
  Write-Host ("{0,-8} {1}" -f $result, $test.NAME)
  if ($result -ne 'PASS') {
    foreach ($m in $test.SelectNodes('.//MESSAGE')) { Write-Host "         $($m.TEXT)" }
  }
}
Write-Host "OVERALL_RESULT=$overall"
if ($overall -eq 'FAIL' -or $failed -gt 0) { throw "WACK に落ちた（FAIL $failed）" }
