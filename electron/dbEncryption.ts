/**
 * Database Encryption Module
 *
 * SQLCipher integration for at-rest database encryption.
 * This module provides the infrastructure for encrypting the SQLite database.
 *
 * ## Migration Path (better-sqlite3 → @journeyapps/sqlcipher)
 *
 * 1. Replace `better-sqlite3` with `@journeyapps/sqlcipher` (same API, adds PRAGMA key)
 * 2. On first run with SQLCipher, export existing plaintext DB to encrypted copy:
 *    - ATTACH DATABASE 'encrypted.db' AS encrypted KEY 'passphrase';
 *    - SELECT sqlcipher_export('encrypted');
 *    - DETACH DATABASE encrypted;
 *    - Swap file paths
 * 3. On subsequent runs, open with PRAGMA key = 'passphrase';
 * 4. Key derived from OS keychain (safeStorage) — same pattern as password encryption
 *
 * ## Why not done yet
 *
 * - @journeyapps/sqlcipher requires OpenSSL at compile time (adds build complexity)
 * - Cross-platform native builds (Windows NSIS, Linux deb/rpm, macOS DMG) each need testing
 * - Performance: SQLCipher adds ~5-15% overhead on queries (acceptable for email client)
 * - The existing safeStorage encryption for passwords + API keys covers the most sensitive data
 *
 * ## When to enable
 *
 * Enable when handling enterprise/compliance requirements (HIPAA, SOC 2) or when
 * users store sensitive attachments locally. The current threat model (desktop app,
 * single user, OS-level disk encryption available) makes this a Phase 5 priority.
 */

import { logDebug } from './logger.js';

/**
 * Checks if the database is encrypted (for future use).
 * Returns false until SQLCipher is integrated.
 */
export function isDatabaseEncrypted(): boolean {
  logDebug('[DB-ENCRYPT] Encryption check: not yet implemented (plaintext DB)');
  return false;
}

/**
 * Placeholder for future database encryption key derivation.
 * Will use safeStorage to encrypt/decrypt the SQLCipher passphrase.
 */
export function getDatabaseKey(): string | null {
  // Future: return decryptData(storedEncryptedKey)
  return null;
}
