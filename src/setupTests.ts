import '@testing-library/jest-dom';
import { vi } from 'vitest';
import os from 'os';

const tmpDir = os.tmpdir();

// Mock electron globally for vitest
vi.mock('electron', () => {
    return {
        app: {
            getPath: vi.fn(() => tmpDir),
        },
        safeStorage: {
            isEncryptionAvailable: vi.fn().mockReturnValue(true),
            encryptString: vi.fn((val: string) => Buffer.from(val, 'utf-8')),
            decryptString: vi.fn((buf: Buffer) => buf.toString('utf-8')),
        },
    };
});
