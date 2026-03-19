#!/usr/bin/env node
/**
 * e2e-rebuild.mjs — Rebuild better-sqlite3 for Electron ABI before E2E tests.
 *
 * In CI (Visual Studio / gcc available): runs @electron/rebuild.
 * Locally without build tools: warns and exits — E2E tests will fail on app
 * launch but the host binary is preserved for vitest.
 *
 * Usage: node scripts/e2e-rebuild.mjs [--restore]
 *   --restore  Rebuild for host Node.js ABI (after E2E, so vitest keeps working)
 */
import { execSync } from 'node:child_process';

const isRestore = process.argv.includes('--restore');

if (isRestore) {
  console.log('Restoring better-sqlite3 for host Node.js ABI...');
  try {
    execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
    console.log('Host binary restored.');
  } catch {
    console.warn('Warning: Could not restore host binary. Run: npm rebuild better-sqlite3');
  }
  process.exit(0);
}

console.log('Rebuilding better-sqlite3 for Electron ABI...');
try {
  execSync('npx @electron/rebuild -m . --only better-sqlite3 --force', {
    stdio: 'inherit',
    timeout: 180_000,
  });
  console.log('Rebuild succeeded.');
} catch (err) {
  // Check if the error is about missing build tools
  const msg = err.stderr?.toString?.() || err.stdout?.toString?.() || err.message || '';
  const noBuildTools = msg.includes('Visual Studio') || msg.includes('build-essential') || msg.includes('gcc');

  if (noBuildTools) {
    console.warn('\n========================================');
    console.warn('  E2E SKIPPED: No C++ build tools found');
    console.warn('========================================');
    console.warn('E2E tests require better-sqlite3 compiled for Electron ABI.');
    console.warn('Options:');
    console.warn('  1. Install Visual Studio Build Tools (Windows) or build-essential (Linux)');
    console.warn('  2. Run E2E after a full build: npm run build:win && npm run test:e2e');
    console.warn('  3. E2E runs automatically in CI (GitHub Actions has build tools)');
    console.warn('');
  } else {
    console.error('Rebuild failed:', err.message);
  }

  // In CI, always fail — build tools must be available
  if (process.env.CI) {
    process.exit(1);
  }
  // Locally: exit 0 so npm doesn't abort the chain
  process.exit(0);
}
