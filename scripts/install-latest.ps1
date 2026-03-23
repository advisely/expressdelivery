param([string]$Version = "1.15.1")
$ErrorActionPreference = "Stop"
$url = "https://github.com/advisely/expressdelivery/releases/download/v$Version/ExpressDelivery-Windows-$Version-Setup.exe"
$installer = Join-Path $env:TEMP "ExpressDelivery-$Version-Setup.exe"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\ExpressDelivery"
$exePath = Join-Path $installDir "ExpressDelivery.exe"

# Kill any lingering processes
Get-Process -Name "ExpressDelivery*" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 3

Write-Host "Downloading v$Version..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
Write-Host "Downloaded: $('{0:N1} MB' -f ((Get-Item $installer).Length / 1MB))"

Write-Host "Installing..." -ForegroundColor Cyan
Start-Process -FilePath $installer -ArgumentList "/S", "/D=$installDir" -Wait
Write-Host "Installed." -ForegroundColor Green

Start-Process -FilePath $exePath
Remove-Item $installer -Force -ErrorAction SilentlyContinue
Write-Host "Launched ExpressDelivery v$Version" -ForegroundColor Green
