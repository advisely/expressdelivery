import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { join, extname, basename } from 'path';
import { tmpdir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync, rmSync, createReadStream } from 'fs';
import { spawn, execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { logDebug } from './logger.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UpdateManifest {
  formatVersion: number;
  type: string;
  version: string;
  productName?: string;
  description?: string;
  createdAt?: string;
  minCurrentVersion?: string;
  signer?: string;
  signerThumbprint?: string;
  changelog?: string[];
  payload: {
    fileName: string;
    size: number;
    sha256: string;
  };
}

export interface UpdateFileInfo {
  valid: boolean;
  fileName: string;
  fileSize: number;
  fileSizeFormatted: string;
  version: string | null;
  productName: string | null;
  packageType: string | null;
  description: string | null;
  changelog: string[] | null;
  warnings: string[];
  error: string | null;
}

export interface UpdateInfo {
  currentVersion: string;
  buildDate: string;
  installMode: 'installed' | 'portable' | 'development';
}

export type UpdateApplyPhase = 'validating' | 'extracting' | 'verifying' | 'checking-signature' | 'shutting-down' | 'launching';

export interface UpdateApplyStep {
  phase: UpdateApplyPhase;
  done: boolean;
}

interface SignatureVerification {
  status: 'valid' | 'not_signed' | 'hash_mismatch' | 'not_trusted' | 'error';
  signer: string | null;
  issuer: string | null;
  thumbprintSha256: string | null;
  thumbprintSha1: string | null;
  timestamp: string | null;
  error: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STAGING_DIR_NAME = 'updates';
const MIN_PACKAGE_SIZE = 1 * 1024 * 1024;     // 1 MB minimum
const MAX_PACKAGE_SIZE = 600 * 1024 * 1024;    // 600 MB maximum
const PRODUCT_NAME_MARKER = 'ExpressDelivery';
const SUPPORTED_FORMAT_VERSION = 1;
const SUPPORTED_PACKAGE_TYPES = ['full'] as const;
const PACKAGE_EXTENSION = '.expressdelivery';

// Set to true when a code signing certificate is in place.
// When false: unsigned payloads produce a warning log but are allowed.
// When true: only validly signed payloads are accepted; unsigned = blocked.
const REQUIRE_SIGNED_PAYLOAD = false;

// ── Input Sanitization ──────────────────────────────────────────────────────

/**
 * Validate and sanitize a file path to prevent path traversal (CWE-22).
 * Uses pure string checks — no path.resolve/join on untrusted input.
 * Only accepts absolute Windows paths without traversal components or null bytes.
 */
function validateSafePath(inputPath: string): string {
  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new Error('Path must be a non-empty string');
  }
  // Reject null bytes (CWE-158)
  if (inputPath.includes('\0')) {
    throw new Error('Null byte in path');
  }
  // Reject path traversal before any path operations
  if (inputPath.includes('..')) {
    throw new Error('Path traversal detected');
  }
  // Must be an absolute path (Windows drive letter or UNC or Unix root)
  if (!/^[a-zA-Z]:[/\\]/.test(inputPath) && !inputPath.startsWith('/')) {
    throw new Error('Path must be absolute');
  }
  // Input is validated — safe to return as-is (paths from dialog.showOpenDialog
  // are already fully resolved absolute paths)
  return inputPath;
}

/**
 * Sanitize a payload file name from manifest to prevent path traversal.
 * Only allows a simple filename (no directory separators, no ".." components).
 */
function sanitizePayloadFileName(fileName: string): string {
  if (typeof fileName !== 'string' || fileName.length === 0) {
    throw new Error('Payload file name must be a non-empty string');
  }
  // Strip any directory components — only allow the base name
  const safe = basename(fileName);
  if (safe !== fileName || safe.includes('..') || safe.includes('/') || safe.includes('\\')) {
    throw new Error('Payload file name contains path traversal characters');
  }
  // Only allow safe characters: alphanumeric, spaces, hyphens, underscores, dots, parens
  if (!/^[a-zA-Z0-9\s\-_.()]+$/.test(safe)) {
    throw new Error('Payload file name contains invalid characters');
  }
  return safe;
}

/**
 * Run a PowerShell script safely via a temp .ps1 file with -File flag.
 * User-controlled values are passed as arguments after -File — they become
 * $args[0], $args[1], etc. in the script. No shell interpolation (CWE-78).
 *
 * NOTE: PowerShell's -Command flag concatenates extra args as command text,
 * so $args is never populated with -Command. -File is required for $args.
 */
function runPowerShell(script: string, args: string[], timeoutMs = 15_000): string {
  const tmpScript = join(tmpdir(), `ed-ps-${randomUUID().slice(0, 8)}.ps1`);
  writeFileSync(tmpScript, script, 'utf-8');
  try {
    return execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', tmpScript,
      ...args
    ], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      windowsHide: true
    }).trim();
  } finally {
    try { unlinkSync(tmpScript); } catch { /* cleanup best-effort */ }
  }
}

// ── electron-updater (GitHub Releases auto-update) ───────────────────────────

type UpdateCallback = (event: string, data?: unknown) => void;
let callback: UpdateCallback | null = null;

export function setUpdateCallback(cb: UpdateCallback) {
  callback = cb;
}

export function initAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    logDebug('[UPDATER] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    logDebug(`[UPDATER] Update available: ${info.version}`);
    callback?.('update:available', { version: info.version, releaseNotes: info.releaseNotes });
  });

  autoUpdater.on('update-not-available', () => {
    logDebug('[UPDATER] No updates available.');
  });

  autoUpdater.on('download-progress', (progress) => {
    logDebug(`[UPDATER] Download progress: ${progress.percent.toFixed(1)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    logDebug(`[UPDATER] Update downloaded: ${info.version}`);
    callback?.('update:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    logDebug(`[UPDATER] Error: ${err.message}`);
    callback?.('update:error', { error: err.message });
  });
}

export function checkForUpdatesOnline() {
  return autoUpdater.checkForUpdates();
}

export function downloadUpdateOnline() {
  return autoUpdater.downloadUpdate();
}

export function installUpdateOnline() {
  autoUpdater.quitAndInstall();
}

// ── Utilities ────────────────────────────────────────────────────────────────

function getStagingDir(): string {
  return join(app.getPath('userData'), STAGING_DIR_NAME);
}

function ensureStagingDir(): string {
  const dir = getStagingDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

function normalizeThumbprint(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-:]/g, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(cleaned)) return null;
  return cleaned;
}

function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── Authenticode Signature Verification ──────────────────────────────────────

/**
 * Verify Authenticode digital signature on an extracted payload (.exe).
 * Uses execFileSync with $args[0] to pass the path — no shell interpolation.
 */
function verifyAuthenticodeSignature(safePath: string): SignatureVerification {
  // Script uses $args[0] for the file path — safe from injection
  const psScript = [
    '$p = $args[0]',
    '$sig = Get-AuthenticodeSignature $p',
    '$c = $sig.SignerCertificate',
    '$r = @{',
    '  Status = $sig.Status.ToString()',
    '  SignerSubject = if ($c) { $c.Subject } else { $null }',
    '  Issuer = if ($c) { $c.Issuer } else { $null }',
    '  ThumbprintSha1 = if ($c) { $c.Thumbprint } else { $null }',
    '  ThumbprintSha256 = if ($c) { [BitConverter]::ToString($c.GetCertHash("SHA256")).Replace("-","") } else { $null }',
    '  Timestamp = if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.NotAfter.ToString("o") } else { $null }',
    '}',
    '$r | ConvertTo-Json'
  ].join('; ');

  try {
    const raw = runPowerShell(psScript, [safePath]);

    const info = JSON.parse(raw);
    const statusMap: Record<string, SignatureVerification['status']> = {
      'Valid': 'valid',
      'NotSigned': 'not_signed',
      'HashMismatch': 'hash_mismatch',
      'NotTrusted': 'not_trusted',
      'UnknownError': 'error'
    };

    return {
      status: statusMap[info.Status] || 'error',
      signer: info.SignerSubject || null,
      issuer: info.Issuer || null,
      thumbprintSha256: info.ThumbprintSha256 || null,
      thumbprintSha1: info.ThumbprintSha1 || null,
      timestamp: info.Timestamp || null,
      error: info.Status === 'Valid' || info.Status === 'NotSigned'
        ? null
        : `Authenticode status: ${info.Status}`
    };
  } catch (err) {
    return {
      status: 'error',
      signer: null,
      issuer: null,
      thumbprintSha256: null,
      thumbprintSha1: null,
      timestamp: null,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

// ── .expressdelivery Package Operations ──────────────────────────────────────

/**
 * Read manifest.json from a .expressdelivery (ZIP) package.
 * Uses execFileSync with $args[0] — user path never interpolated into command.
 */
function readManifestFromPackage(safePath: string): UpdateManifest {
  const psScript = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$z = [IO.Compression.ZipFile]::OpenRead($args[0])',
    'try {',
    "  $e = $z.GetEntry('manifest.json')",
    "  if ($null -eq $e) { throw 'No manifest.json found in package' }",
    '  $r = New-Object IO.StreamReader($e.Open())',
    '  try { $r.ReadToEnd() } finally { $r.Close() }',
    '} finally { $z.Dispose() }'
  ].join('; ');

  try {
    const raw = runPowerShell(psScript, [safePath]);
    if (!raw) throw new Error('Empty manifest.json in package');
    return JSON.parse(raw) as UpdateManifest;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error('manifest.json is not valid JSON');
    throw err;
  }
}

/**
 * Extract a specific file from the .expressdelivery (ZIP) package to a destination path.
 * Uses execFileSync with $args[0..2] — no shell interpolation of user input.
 */
function extractPayloadFromPackage(safePackagePath: string, safeEntryName: string, safeDestPath: string): void {
  const psScript = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$z = [IO.Compression.ZipFile]::OpenRead($args[0])',
    'try {',
    '  $e = $z.GetEntry($args[1])',
    "  if ($null -eq $e) { throw 'Payload file not found in package' }",
    '  [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $args[2], $true)',
    '} finally { $z.Dispose() }'
  ].join('; ');

  runPowerShell(psScript, [safePackagePath, safeEntryName, safeDestPath], 300_000);
}

// ── Core File-Based Update Functions ─────────────────────────────────────────

export function getInstallMode(): 'installed' | 'portable' | 'development' {
  if (!app.isPackaged) return 'development';
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'portable';
  return 'installed';
}

export function getUpdateInfo(): UpdateInfo {
  return {
    currentVersion: app.getVersion(),
    buildDate: new Date().toISOString(),
    installMode: getInstallMode()
  };
}

export async function pickUpdateFile(): Promise<{ filePath: string } | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select Update Package',
    filters: [
      { name: 'ExpressDelivery Update Package', extensions: ['expressdelivery'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return { filePath: result.filePaths[0] };
}

export function validateFile(inputFilePath: string): UpdateFileInfo {
  // Sanitize input path to prevent path traversal (CWE-22)
  let safePath: string;
  try {
    safePath = validateSafePath(inputFilePath);
  } catch {
    return {
      valid: false, fileName: '', fileSize: 0, fileSizeFormatted: '0 B',
      version: null, productName: null, packageType: null, description: null,
      changelog: null, warnings: [], error: 'Invalid file path'
    };
  }

  const fileName = basename(safePath);
  const empty: UpdateFileInfo = {
    valid: false, fileName, fileSize: 0, fileSizeFormatted: '0 B',
    version: null, productName: null, packageType: null, description: null,
    changelog: null, warnings: [], error: null
  };

  // Blocking: extension
  if (extname(safePath).toLowerCase() !== PACKAGE_EXTENSION) {
    return { ...empty, error: `Only ${PACKAGE_EXTENSION} update packages are accepted` };
  }

  // Blocking: existence
  if (!existsSync(safePath)) {
    return { ...empty, error: 'File not found' };
  }

  const stat = statSync(safePath);
  const fileSize = stat.size;
  const fileSizeFormatted = formatSize(fileSize);

  // Blocking: size bounds
  if (fileSize < MIN_PACKAGE_SIZE) {
    return { ...empty, fileSize, fileSizeFormatted, error: 'File too small to be a valid update package' };
  }
  if (fileSize > MAX_PACKAGE_SIZE) {
    return { ...empty, fileSize, fileSizeFormatted, error: 'File exceeds maximum size (600 MB)' };
  }

  // Read manifest from ZIP (safePath already validated)
  let manifest: UpdateManifest;
  try {
    manifest = readManifestFromPackage(safePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...empty, fileSize, fileSizeFormatted, error: `Invalid package: ${msg}` };
  }

  // Blocking: format version
  if (manifest.formatVersion !== SUPPORTED_FORMAT_VERSION) {
    return { ...empty, fileSize, fileSizeFormatted, error: `Unsupported package format version: ${manifest.formatVersion}. This app supports format version ${SUPPORTED_FORMAT_VERSION}.` };
  }

  // Blocking: required fields
  if (!manifest.type || !manifest.version || !manifest.payload?.fileName) {
    return { ...empty, fileSize, fileSizeFormatted, error: 'Invalid package: manifest is missing required fields (type, version, payload)' };
  }

  // Blocking: supported type
  if (!(SUPPORTED_PACKAGE_TYPES as readonly string[]).includes(manifest.type)) {
    return { ...empty, fileSize, fileSizeFormatted, error: `Unsupported update type: "${manifest.type}". This version only supports: ${SUPPORTED_PACKAGE_TYPES.join(', ')}.` };
  }

  // Blocking: product name mismatch
  if (manifest.productName && !manifest.productName.includes(PRODUCT_NAME_MARKER)) {
    return { ...empty, fileSize, fileSizeFormatted, error: `This package is not for ${PRODUCT_NAME_MARKER}` };
  }

  // Blocking: minimum version requirement
  const currentVersion = app.getVersion();
  if (manifest.minCurrentVersion && compareVersions(currentVersion, manifest.minCurrentVersion) < 0) {
    return {
      ...empty, fileSize, fileSizeFormatted,
      version: manifest.version, productName: manifest.productName || null,
      packageType: manifest.type, description: manifest.description || null,
      error: `This update requires v${manifest.minCurrentVersion} or later. You have v${currentVersion}. Please update incrementally.`
    };
  }

  // Blocking: same version
  if (manifest.version === currentVersion) {
    return {
      ...empty, fileSize, fileSizeFormatted,
      version: manifest.version, productName: manifest.productName || null,
      packageType: manifest.type, description: manifest.description || null,
      changelog: null,
      error: `This package is the same version already installed (v${currentVersion}). No update needed.`
    };
  }

  // Warnings
  const warnings: string[] = [];
  if (compareVersions(manifest.version, currentVersion) < 0) {
    warnings.push(`This is an older version (v${manifest.version}). Downgrading may cause settings or data incompatibilities.`);
  }

  if (!manifest.signer && !manifest.signerThumbprint) {
    warnings.push('This package has no declared signing identity. The installer will be verified after extraction, but the package origin cannot be confirmed. Only use packages from sources you trust.');
  }

  return {
    valid: true, fileName, fileSize, fileSizeFormatted,
    version: manifest.version,
    productName: manifest.productName || null,
    packageType: manifest.type,
    description: manifest.description || null,
    changelog: Array.isArray(manifest.changelog) && manifest.changelog.length > 0
      ? manifest.changelog : null,
    warnings, error: null
  };
}

export async function applyUpdate(
  inputFilePath: string,
  onProgress?: (step: UpdateApplyStep) => void
): Promise<{ success: boolean; error?: string }> {
  const progress = (step: UpdateApplyStep): void => { onProgress?.(step); };

  // Sanitize input path to prevent path traversal (CWE-22)
  let safePath: string;
  try {
    safePath = validateSafePath(inputFilePath);
  } catch {
    return { success: false, error: 'Invalid file path' };
  }

  const installMode = getInstallMode();

  if (installMode === 'development') {
    return { success: false, error: 'Updates are not available in development mode' };
  }
  if (installMode === 'portable') {
    return { success: false, error: 'Portable mode detected. Please extract the new portable .zip manually.' };
  }

  // Re-validate
  progress({ phase: 'validating', done: false });
  const info = validateFile(safePath);
  if (!info.valid) {
    return { success: false, error: info.error || 'Validation failed' };
  }
  progress({ phase: 'validating', done: true });

  try {
    const manifest = readManifestFromPackage(safePath);

    // Sanitize payload file name from manifest to prevent path traversal
    const safePayloadName = sanitizePayloadFileName(manifest.payload.fileName);

    const stagingDir = ensureStagingDir();
    const payloadPath = join(stagingDir, safePayloadName);

    // Extract payload
    progress({ phase: 'extracting', done: false });
    logDebug(`[UPDATER] Extracting payload: ${safePayloadName} -> ${payloadPath}`);
    extractPayloadFromPackage(safePath, safePayloadName, payloadPath);

    if (!existsSync(payloadPath)) {
      return { success: false, error: 'Payload extraction failed: file not found after extraction' };
    }
    progress({ phase: 'extracting', done: true });

    // Verify payload SHA-256
    progress({ phase: 'verifying', done: false });
    if (manifest.payload.sha256) {
      logDebug('[UPDATER] Verifying payload integrity (SHA-256)...');
      const hash = await computeSha256(payloadPath);
      if (hash.toLowerCase() !== manifest.payload.sha256.toLowerCase()) {
        try { unlinkSync(payloadPath); } catch { /* cleanup */ }
        return { success: false, error: 'Payload integrity check failed (SHA-256 mismatch). The package may be corrupted.' };
      }
      logDebug('[UPDATER] Payload integrity verified');
    }
    progress({ phase: 'verifying', done: true });

    // Verify Authenticode digital signature
    progress({ phase: 'checking-signature', done: false });
    logDebug('[UPDATER] Checking Authenticode signature...');
    const sigResult = verifyAuthenticodeSignature(payloadPath);

    if (sigResult.status === 'hash_mismatch') {
      try { unlinkSync(payloadPath); } catch { /* cleanup */ }
      return { success: false, error: 'Installer signature is invalid (hash mismatch). The file may have been tampered with.' };
    }

    if (sigResult.status === 'valid') {
      logDebug(`[UPDATER] Signature valid — signer: ${sigResult.signer}, SHA-256: ${sigResult.thumbprintSha256}`);
      if (manifest.signerThumbprint && sigResult.thumbprintSha256) {
        const expected = normalizeThumbprint(manifest.signerThumbprint);
        const actual = normalizeThumbprint(sigResult.thumbprintSha256);
        if (!expected || !actual) {
          try { unlinkSync(payloadPath); } catch { /* cleanup */ }
          return { success: false, error: 'Invalid thumbprint format in manifest or certificate.' };
        }
        if (actual !== expected) {
          try { unlinkSync(payloadPath); } catch { /* cleanup */ }
          return { success: false, error: `Certificate thumbprint mismatch. Expected ${expected.substring(0, 8)}... but got ${actual.substring(0, 8)}.... The package may not be authentic.` };
        }
        logDebug('[UPDATER] SHA-256 thumbprint pinning verified');
      }
      if (manifest.signer && sigResult.signer && !sigResult.signer.includes(manifest.signer)) {
        try { unlinkSync(payloadPath); } catch { /* cleanup */ }
        return { success: false, error: `Signature signer mismatch. Expected "${manifest.signer}" but got "${sigResult.signer}".` };
      }
    } else if (REQUIRE_SIGNED_PAYLOAD) {
      try { unlinkSync(payloadPath); } catch { /* cleanup */ }
      return { success: false, error: `Installer is not properly signed (status: ${sigResult.status}). Only signed updates are accepted.` };
    } else {
      logDebug(`[UPDATER] Signature: ${sigResult.status} (allowed — REQUIRE_SIGNED_PAYLOAD is off)`);
    }
    progress({ phase: 'checking-signature', done: true });

    // Resolve install directory from current executable path (trusted, not user input)
    const installDir = join(app.getPath('exe'), '..');

    // Graceful shutdown
    progress({ phase: 'shutting-down', done: false });
    logDebug('[UPDATER] Preparing for update...');
    progress({ phase: 'shutting-down', done: true });

    // Write batch script that waits for installer to finish, then relaunches
    const batchPath = join(stagingDir, 'update.bat');
    const exePath = app.getPath('exe');
    const batchContent = [
      '@echo off',
      'echo ExpressDelivery Update: waiting for installer to finish...',
      'timeout /t 2 /nobreak >nul',
      `start /wait "" "${payloadPath}" /S /D=${installDir}`,
      'echo Installer finished. Relaunching app...',
      `start "" "${exePath}"`,
      `del /f /q "${payloadPath}" 2>nul`,
      'del /f /q "%~f0" 2>nul'
    ].join('\r\n');

    writeFileSync(batchPath, batchContent, 'utf-8');

    progress({ phase: 'launching', done: false });
    logDebug(`[UPDATER] Launching update script: ${batchPath}`);
    const child = spawn('cmd.exe', ['/c', batchPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();

    logDebug('[UPDATER] Quitting app for update...');
    app.quit();

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logDebug(`[UPDATER] Failed to apply update: ${msg}`);
    return { success: false, error: msg };
  }
}

export function cleanStaging(): number {
  const dir = getStagingDir();
  if (!existsSync(dir)) return 0;
  let freedBytes = 0;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const st = statSync(fullPath);
        freedBytes += st.size;
        if (st.isDirectory()) {
          rmSync(fullPath, { recursive: true });
        } else {
          unlinkSync(fullPath);
        }
      } catch { /* skip locked files */ }
    }
    logDebug(`[UPDATER] Cleaned staging dir: freed ${formatSize(freedBytes)}`);
  } catch { /* dir may not exist */ }
  return freedBytes;
}
