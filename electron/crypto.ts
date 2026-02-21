import { safeStorage } from 'electron';

/**
 * Encrypt a plain text string using OS-native keychain encryption.
 */
export function encryptData(text: string): Buffer {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS encryption is not available');
    }
    return safeStorage.encryptString(text);
}

/**
 * Decrypt a Buffer to plain text string using OS-native keychain encryption.
 */
export function decryptData(encrypted: Buffer): string {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS encryption is not available');
    }
    return safeStorage.decryptString(encrypted);
}
