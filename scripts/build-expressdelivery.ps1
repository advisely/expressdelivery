# build-expressdelivery.ps1
# Packages the NSIS installer into a .expressdelivery update package.
#
# Usage:
#   cd expressdelivery
#   powershell -ExecutionPolicy Bypass -File scripts/build-expressdelivery.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build-expressdelivery.ps1 -VerifySignature
#
# The script reads version from package.json, finds the installer in release/,
# computes SHA-256, writes manifest.json, and produces a .expressdelivery ZIP.
#
# If -VerifySignature is set, the script checks the installer's Authenticode
# signature and embeds the signer identity + thumbprint into the manifest.
#
# Output: release/<version>/ExpressDelivery-<version>.expressdelivery

param(
  [string]$Type = "full",
  [string]$Description = "",
  [string[]]$Changelog = @(),
  [switch]$VerifySignature
)

$ErrorActionPreference = "Stop"

# Read version from package.json
if (-not (Test-Path "package.json")) {
  Write-Error "package.json not found. Run this script from the expressdelivery/ directory."
  exit 1
}

$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$version = $packageJson.version
$productName = "ExpressDelivery"

Write-Host "Building .expressdelivery package for v$version (type: $Type)" -ForegroundColor Cyan

# Find the installer .exe in release/<version>/
$exeName = "$productName-Windows-$version-Setup.exe"
$exePath = Join-Path (Join-Path "release" $version) $exeName

if (-not (Test-Path $exePath)) {
  Write-Error "Installer not found: $exePath"
  Write-Error "Run 'npm run build:win:nsis' first to build the installer."
  exit 1
}

$exeItem = Get-Item $exePath
$exeSize = $exeItem.Length
Write-Host "Found installer: $exeName ($([math]::Round($exeSize / 1MB, 1)) MB)" -ForegroundColor Green

# Compute SHA-256 of the installer
Write-Host "Computing SHA-256..." -ForegroundColor Yellow
$sha256 = (Get-FileHash $exePath -Algorithm SHA256).Hash.ToLower()
Write-Host "SHA-256: $sha256" -ForegroundColor Gray

# Check Authenticode signature if requested
$signerSubject = $null
$signerThumbprint = $null

if ($VerifySignature) {
  Write-Host "Checking Authenticode signature..." -ForegroundColor Yellow
  $sig = Get-AuthenticodeSignature $exePath
  if ($sig.Status -eq "Valid") {
    $signerSubject = $sig.SignerCertificate.Subject
    $signerThumbprint = [System.BitConverter]::ToString($sig.SignerCertificate.GetCertHash("SHA256")).Replace("-", "")
    Write-Host "Signature valid" -ForegroundColor Green
    Write-Host "  Signer:             $signerSubject" -ForegroundColor Gray
    Write-Host "  Thumbprint SHA-256: $signerThumbprint" -ForegroundColor Gray
    Write-Host "  Thumbprint SHA-1:   $($sig.SignerCertificate.Thumbprint)" -ForegroundColor Gray
    Write-Host "  Issuer:             $($sig.SignerCertificate.Issuer)" -ForegroundColor Gray
  } else {
    Write-Warning "Installer is not signed (status: $($sig.Status)). Manifest will not include signer identity."
  }
}

# Build manifest
if ([string]::IsNullOrEmpty($Description)) {
  $Description = "Full application update to v$version"
}

$manifestObj = [ordered]@{
  formatVersion    = 1
  type             = $Type
  version          = $version
  productName      = $productName
  description      = $Description
  createdAt        = (Get-Date -Format "o")
  payload          = @{
    fileName = $exeName
    size     = $exeSize
    sha256   = $sha256
  }
}

# Add changelog if provided
if ($Changelog.Count -gt 0) {
  $manifestObj["changelog"] = $Changelog
}

# Add signer identity if available
if ($signerSubject) {
  if ($signerSubject -match 'CN=([^,]+)') {
    $manifestObj["signer"] = $Matches[1].Trim()
  } else {
    $manifestObj["signer"] = $signerSubject
  }
  $manifestObj["signerThumbprint"] = $signerThumbprint
}

$manifest = $manifestObj | ConvertTo-Json -Depth 4

Write-Host "`nManifest:" -ForegroundColor Yellow
Write-Host $manifest -ForegroundColor Gray

# Create temp directory for ZIP contents
$tempDir = Join-Path $env:TEMP "expressdelivery-build-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
  # Write manifest.json
  $manifest | Set-Content (Join-Path $tempDir "manifest.json") -Encoding UTF8

  # Copy installer to temp dir
  Write-Host "`nCopying installer to staging..." -ForegroundColor Yellow
  Copy-Item $exePath $tempDir

  # Create .expressdelivery (ZIP with custom extension)
  $outputName = "ExpressDelivery-$version.expressdelivery"
  $outputDir = Join-Path "release" $version
  $outputPath = Join-Path $outputDir $outputName
  $zipPath = Join-Path $outputDir "ExpressDelivery-$version.zip"

  # Remove existing files if present
  if (Test-Path $outputPath) {
    Remove-Item $outputPath -Force
  }
  if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
  }

  Write-Host "Compressing to $outputName..." -ForegroundColor Yellow
  Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -CompressionLevel Optimal
  Rename-Item $zipPath $outputName

  $outputItem = Get-Item $outputPath
  $outputSize = $outputItem.Length

  Write-Host "`n=== Build Complete ===" -ForegroundColor Green
  Write-Host "Output: $outputPath" -ForegroundColor Green
  Write-Host "Size:   $([math]::Round($outputSize / 1MB, 1)) MB" -ForegroundColor Green
  Write-Host "SHA-256 (package): $((Get-FileHash $outputPath -Algorithm SHA256).Hash.ToLower())" -ForegroundColor Gray
}
finally {
  # Clean up temp dir
  if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
