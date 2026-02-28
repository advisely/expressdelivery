#!/usr/bin/env node
/**
 * clean-build.mjs — Hydration + clean packaging script for ExpressDelivery.
 *
 * Purges stale native-module binaries and electron-builder caches, rebuilds
 * better-sqlite3 for the exact Electron ABI, then packages the app.
 *
 * Usage:
 *   node scripts/clean-build.mjs [--win] [--linux] [--nsis] [--restore-host]
 *
 * Flags:
 *   --win           Package for Windows (unpacked locally, NSIS installer in CI)
 *   --linux         Package for Linux (unpacked locally, AppImage+deb+rpm in CI)
 *   --nsis          Produce Windows NSIS installer even locally (implies --win)
 *   --restore-host  After packaging, rebuild better-sqlite3 for host Node
 *                   so vitest keeps working (default: true)
 *   --no-restore    Skip the host restore step
 *
 * In CI (CI=true), full installers are always produced regardless of flags.
 *
 * Examples:
 *   node scripts/clean-build.mjs --win              # Windows unpacked only (local)
 *   node scripts/clean-build.mjs --win --nsis        # Windows NSIS installer (local)
 *   node scripts/clean-build.mjs --linux --win       # Linux + Windows (correct order)
 *   node scripts/clean-build.mjs                     # Defaults to --win
 */

import { execSync } from 'node:child_process';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Parse flags ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let buildWin = args.includes('--win');
let buildLinux = args.includes('--linux');
const buildNsis = args.includes('--nsis');
const noRestore = args.includes('--no-restore');
const restoreHost = !noRestore; // default: restore

// --nsis implies --win
if (buildNsis) buildWin = true;

// Default to --win if nothing specified
if (!buildWin && !buildLinux) buildWin = true;

// ── Helpers ──────────────────────────────────────────────────────────────────
function run(cmd, label) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`  $ ${cmd}`);
  console.log('='.repeat(60));
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', timeout: 300_000 });
}

function rmSafe(p) {
  if (existsSync(p)) {
    console.log(`  Removing: ${p}`);
    rmSync(p, { recursive: true, force: true });
  } else {
    console.log(`  (skip) Not found: ${p}`);
  }
}

// ── Read Electron version from package.json ──────────────────────────────────
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const electronRange = pkg.devDependencies?.electron;
if (!electronRange) {
  console.error('ERROR: No "electron" in devDependencies');
  process.exit(1);
}

// Resolve exact installed version
let electronVersion;
try {
  const ePkg = JSON.parse(
    readFileSync(join(ROOT, 'node_modules/electron/package.json'), 'utf-8')
  );
  electronVersion = ePkg.version;
} catch {
  console.error('ERROR: Cannot read node_modules/electron/package.json. Run npm install first.');
  process.exit(1);
}

const appVersion = pkg.version || '0.0.0';

console.log(`\nExpressDelivery Clean Build`);
console.log(`  Version:  ${appVersion}`);
console.log(`  Electron: ${electronVersion}`);
console.log(`  Targets:  ${[buildLinux && 'Linux', buildWin && 'Windows', buildNsis && 'NSIS'].filter(Boolean).join(', ')}`);
console.log(`  Restore host binary: ${restoreHost}`);

// ── Step 1: Kill running app (Windows) ───────────────────────────────────────
console.log('\n--- Step 1: Kill running app ---');
try {
  execSync('taskkill /F /IM ExpressDelivery.exe', { cwd: ROOT, stdio: 'pipe' });
  console.log('  Killed ExpressDelivery.exe');
} catch {
  console.log('  (app not running)');
}

// ── Step 2: Purge stale artifacts ────────────────────────────────────────────
console.log('\n--- Step 2: Purge stale artifacts ---');
rmSafe(join(ROOT, 'release'));
rmSafe(join(ROOT, 'dist'));
rmSafe(join(ROOT, 'dist-electron'));

// Purge the native module build so there's no stale .forge-meta / wrong ABI
rmSafe(join(ROOT, 'node_modules/better-sqlite3/build'));
rmSafe(join(ROOT, 'node_modules/better-sqlite3/prebuilds'));

// ── Step 3: Rebuild better-sqlite3 for Electron ABI ──────────────────────────
run(
  `npx @electron/rebuild -v ${electronVersion} -m . --only better-sqlite3 --force`,
  `Rebuild better-sqlite3 for Electron ${electronVersion}`
);

// ── Step 4: Verify the rebuilt binary ────────────────────────────────────────
console.log('\n--- Step 4: Verify rebuilt binary ---');
const forgeMeta = join(ROOT, 'node_modules/better-sqlite3/build/Release/.forge-meta');
if (existsSync(forgeMeta)) {
  const meta = readFileSync(forgeMeta, 'utf-8').trim();
  console.log(`  .forge-meta: ${meta}`);
  // meta format is "x64--{ABI}" e.g. "x64--143"
  const abiMatch = meta.match(/--(\d+)$/);
  if (abiMatch) {
    console.log(`  Target ABI: ${abiMatch[1]}`);
  }
} else {
  console.warn('  WARNING: No .forge-meta found after rebuild');
}

// ── Step 5: TypeScript + Vite build ──────────────────────────────────────────
run('npx tsc', 'TypeScript compilation');
run('npx vite build', 'Vite bundle');

// ── Step 6: Package ──────────────────────────────────────────────────────────
// IMPORTANT: Build Linux first, then Windows (Linux overwrites the native
// binary in node_modules, but electron-builder re-rebuilds per platform).
// With clean purge + force rebuild, the order matters less, but we keep it
// correct for safety.

if (buildLinux) {
  // In CI, build full installers (AppImage/deb/rpm); locally, use --dir for speed
  const linuxFlag = process.env.CI ? '' : ' --dir';
  run(`npx electron-builder --linux${linuxFlag}`, `Package Linux${linuxFlag ? ' (unpacked)' : ' (AppImage + deb + rpm)'}`);
}

if (buildWin) {
  // Re-rebuild for Windows if we just did Linux (Linux rebuild may have
  // overwritten the native module with a Linux ELF binary)
  if (buildLinux) {
    console.log('\n--- Re-rebuilding better-sqlite3 for Windows after Linux build ---');
    rmSafe(join(ROOT, 'node_modules/better-sqlite3/build'));
    run(
      `npx @electron/rebuild -v ${electronVersion} -m . --only better-sqlite3 --force`,
      `Re-rebuild better-sqlite3 for Electron ${electronVersion} (Windows)`
    );
  }

  // In CI, always produce NSIS installer; locally, use --dir unless --nsis flag
  const winFlag = (process.env.CI || buildNsis) ? '' : ' --dir';
  run(`npx electron-builder --win${winFlag}`, `Package Windows${winFlag ? ' (unpacked)' : ' (NSIS installer)'}`);

}

// ── Step 7: Verify packaged binary ───────────────────────────────────────────
console.log('\n--- Step 7: Verify packaged binary ---');
const winBinary = join(
  ROOT,
  `release/${appVersion}/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node`
);
if (existsSync(winBinary)) {
  const stat = readFileSync(winBinary);
  // PE32+ magic: 4D5A at offset 0
  const isPE = stat[0] === 0x4D && stat[1] === 0x5A;
  console.log(`  Windows binary: ${isPE ? 'PE32+ (correct)' : 'NOT PE32+ (WRONG!)'}`);
  console.log(`  Size: ${stat.length} bytes`);
  if (!isPE) {
    console.error('  ERROR: The packaged binary is NOT a Windows DLL!');
    process.exit(1);
  }
}

const linuxBinary = join(
  ROOT,
  `release/${appVersion}/linux-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node`
);
if (existsSync(linuxBinary)) {
  const stat = readFileSync(linuxBinary);
  // ELF magic: 7F454C46
  const isELF = stat[0] === 0x7F && stat[1] === 0x45 && stat[2] === 0x4C && stat[3] === 0x46;
  console.log(`  Linux binary: ${isELF ? 'ELF (correct)' : 'NOT ELF (WRONG!)'}`);
  console.log(`  Size: ${stat.length} bytes`);
}

// ── Step 8: Restore host binary for vitest ───────────────────────────────────
if (restoreHost) {
  console.log('\n--- Step 8: Restore host binary for vitest ---');
  rmSafe(join(ROOT, 'node_modules/better-sqlite3/build'));
  run('npm rebuild better-sqlite3', 'Rebuild better-sqlite3 for host Node.js');

  // Quick sanity check
  try {
    execSync(
      'node -e "const db = require(\'better-sqlite3\')(\':memory:\'); db.close(); console.log(\'  better-sqlite3 OK on host Node\')"',
      { cwd: ROOT, stdio: 'inherit' }
    );
  } catch {
    console.warn('  WARNING: better-sqlite3 failed to load on host Node');
  }
}

console.log('\n' + '='.repeat(60));
console.log('  BUILD COMPLETE');
console.log('='.repeat(60));
if (buildWin) {
  console.log(`  Windows: release/${appVersion}/win-unpacked/ExpressDelivery.exe`);
}
if (buildLinux) {
  console.log(`  Linux:   release/${appVersion}/linux-unpacked/expressdelivery`);
}
console.log();
