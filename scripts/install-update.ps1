$ErrorActionPreference = "Stop"
$url = "https://github.com/advisely/expressdelivery/releases/download/v1.15.0/ExpressDelivery-Windows-1.15.0-Setup.exe"
$installer = Join-Path $env:TEMP "ExpressDelivery-1.15.0-Setup.exe"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\ExpressDelivery"
$exePath = Join-Path $installDir "ExpressDelivery.exe"

Write-Host "Downloading v1.15.0 installer..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
Write-Host "Downloaded: $installer ($('{0:N1} MB' -f ((Get-Item $installer).Length / 1MB)))"

Write-Host "Running installer silently..." -ForegroundColor Cyan
Start-Process -FilePath $installer -ArgumentList "/S", "/D=$installDir" -Wait
Write-Host "Installer finished." -ForegroundColor Green

Write-Host "Launching ExpressDelivery v1.15.0..." -ForegroundColor Cyan
Start-Process -FilePath $exePath

Remove-Item $installer -Force -ErrorAction SilentlyContinue
Write-Host "Done." -ForegroundColor Green
