import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock electron globally for vitest
vi.mock('electron', () => {
    return {
        app: {
            getPath: vi.fn((name) => {
                if (name === 'userData') return '/tmp';
                return '/tmp';
            }),
        },
        safeStorage: {
            isEncryptionAvailable: vi.fn().mockReturnValue(true),
            encryptString: vi.fn((val) => Buffer.from(val, 'utf-8')),
            decryptString: vi.fn((buf) => buf.toString('utf-8')),
        },
    };
});
