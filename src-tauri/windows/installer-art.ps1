# Renders the installer logo bitmaps from icons/app-icon.svg.
# NSIS can only show BMP images, so the logo is flattened onto the installer
# background (#0a0e15) at every common display scale (100% to 300%).
# Run from anywhere with Windows PowerShell or PowerShell 7; needs Google Chrome or Microsoft Edge.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$svg = (Resolve-Path (Join-Path $here '..\icons\app-icon.svg')).Path
$out = Join-Path $here 'installer'
New-Item -ItemType Directory -Force $out | Out-Null

$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Chrome or Edge is required to render the SVG.' }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('aoze-art-' + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
try {
  # Logo is 72 px at 100%; the svg's own 64 px margin is cropped away so the tile fills the bitmap.
  foreach ($px in 72, 90, 108, 126, 144, 180, 216) {
    $html = Join-Path $tmp "logo-$px.html"
    $png = Join-Path $tmp "logo-$px.png"
    $svgUri = ([Uri]$svg).AbsoluteUri
    $scaled = [math]::Round($px * 1024 / 896, 3)
    $offset = [math]::Round(- $px * 64 / 896, 3)
    Set-Content -Encoding UTF8 $html "<html><body style='margin:0;background:#0a0e15;overflow:hidden'><img src='$svgUri' style='position:absolute;left:${offset}px;top:${offset}px;width:${scaled}px;height:${scaled}px'></body></html>"
    & $browser --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
      --default-background-color=0a0e15ff --window-size="$px,$px" --screenshot="$png" ([Uri]$html).AbsoluteUri 2>$null | Out-Null
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Path $png) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
    $src = [System.Drawing.Bitmap]::new($png)
    $bmp = $src.Clone([System.Drawing.Rectangle]::new(0, 0, $px, $px), [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $bmp.Save((Join-Path $out "logo-$px.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
    $bmp.Dispose(); $src.Dispose()
    Write-Host "logo-$px.bmp"
  }
} finally {
  Remove-Item -Recurse -Force $tmp
}
