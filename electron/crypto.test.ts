import { describe, it, expect, vi, afterEach } from 'vitest';
import { encryptData, decryptData } from './crypto';
import { safeStorage } from 'electron';

describe('Crypto Utility (safeStorage)', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should successfully encrypt data when encryption is available', () => {
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
        const buffer = encryptData('super_secret_password');

        expect(safeStorage.encryptString).toHaveBeenCalledWith('super_secret_password');
        expect(buffer).toBeInstanceOf(Buffer);
        // The mock from setupTests.ts returns Buffer.from(val, 'utf-8')
        expect(buffer.toString('utf-8')).toBe('super_secret_password');
    });

    it('should successfully decrypt data when encryption is available', () => {
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
        const encrypted = Buffer.from('super_secret_password', 'utf-8');
        const decrypted = decryptData(encrypted);

        expect(safeStorage.decryptString).toHaveBeenCalledWith(encrypted);
        expect(decrypted).toBe('super_secret_password');
    });

    it('should throw an error on encryption if OS encryption is unavailable', () => {
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
        expect(() => encryptData('fail')).toThrow('OS encryption is not available');
    });

    it('should throw an error on decryption if OS encryption is unavailable', () => {
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
        expect(() => decryptData(Buffer.from('fail'))).toThrow('OS encryption is not available');
    });
});
