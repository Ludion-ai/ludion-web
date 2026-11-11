# アプリの絵（.ico と MSIX のタイル）を、Ludion の印（apps/web/public/logo.png と同じ形）から作る。
# 印は 512 の格子の上の2つの L（黒 #111114 と赤 #E5412A）。白い角丸の地に置く（暗いタスクバーでも黒い L が見えるように）。
# 使い方：pwsh apps/windows/scripts/make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assets = Join-Path $PSScriptRoot '..\Package\Assets'
New-Item -ItemType Directory -Force $assets | Out-Null

function New-Mark([int]$width, [int]$height, [double]$markScale, [bool]$tile) {
  $bitmap = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $side = [Math]::Min($width, $height)
  if ($tile) {
    # 白い角丸の地
    $r = $side * 0.22
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $x = ($width - $side) / 2; $y = ($height - $side) / 2
    $path.AddArc($x, $y, 2 * $r, 2 * $r, 180, 90)
    $path.AddArc($x + $side - 2 * $r, $y, 2 * $r, 2 * $r, 270, 90)
    $path.AddArc($x + $side - 2 * $r, $y + $side - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $path.AddArc($x, $y + $side - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $path.CloseFigure()
    $g.FillPath([System.Drawing.Brushes]::White, $path)
  }
  # 印の大きさ：512 の格子のうち 96〜416（320）を、辺の markScale にする
  $unit = $side * $markScale / 320.0
  $ox = $width / 2 - 256 * $unit
  $oy = $height / 2 - 256 * $unit
  $black = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0x11, 0x11, 0x14))
  $red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0xE5, 0x41, 0x2A))
  function Add-Bar($b, $x1, $y1, $x2, $y2) { $g.FillRectangle($b, [single]($ox + $x1 * $unit), [single]($oy + $y1 * $unit), [single](($x2 - $x1) * $unit), [single](($y2 - $y1) * $unit)) }
  Add-Bar $black 96 96 288 160
  Add-Bar $black 96 96 160 352
  Add-Bar $red 352 160 416 416
  Add-Bar $red 224 352 416 416
  $g.Dispose()
  return $bitmap
}

function Save-Png($bitmap, $name) {
  $bitmap.Save((Join-Path $assets $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

function Save-Ico([int[]]$sizes, [double]$markScale, $name) {
  # PNG を入れた .ico（Windows Vista から読める形）
  $images = foreach ($size in $sizes) {
    $bitmap = New-Mark $size $size $markScale $true
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    , @($size, $stream.ToArray())
  }
  $out = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter $out
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$images.Count)
  $offset = 6 + 16 * $images.Count
  foreach ($image in $images) {
    $size = $image[0]; $data = $image[1]
    $b = if ($size -ge 256) { 0 } else { $size }
    $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$data.Length); $w.Write([uint32]$offset)
    $offset += $data.Length
  }
  foreach ($image in $images) { $w.Write([byte[]]$image[1]) }
  $w.Flush()
  [System.IO.File]::WriteAllBytes((Join-Path $assets $name), $out.ToArray())
}

# .exe とスタートメニューの絵
Save-Ico @(16, 20, 24, 32, 40, 48, 64, 256) 0.66 'ludion.ico'
# 通知領域（小さいので、印を大きめに）
Save-Ico @(16, 20, 24, 32, 40, 48) 0.74 'tray.ico'

# MSIX のタイル（Package/AppxManifest.xml）
Save-Png (New-Mark 50 50 0.66 $true) 'StoreLogo.png'
Save-Png (New-Mark 44 44 0.66 $true) 'Square44x44Logo.png'
foreach ($s in 16, 24, 32, 48, 256) {
  Save-Png (New-Mark $s $s 0.66 $true) "Square44x44Logo.targetsize-$s.png"
  Save-Png (New-Mark $s $s 0.66 $true) "Square44x44Logo.targetsize-${s}_altform-unplated.png"
}
Save-Png (New-Mark 150 150 0.5 $true) 'Square150x150Logo.png'
Save-Png (New-Mark 310 150 0.5 $false) 'Wide310x150Logo.png'
Save-Png (New-Mark 300 300 0.5 $true) 'Store-300.png'
Write-Host "icons: $assets"
