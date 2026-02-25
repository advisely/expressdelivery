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

// Mock react-i18next globally so components with useTranslation() work in tests
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) => {
            // Return interpolated key for testing (e.g., "toast.scheduledFailed" with {error: "x"} => "toast.scheduledFailed")
            void opts;
            return key;
        },
        i18n: {
            language: 'en',
            changeLanguage: vi.fn().mockResolvedValue(undefined),
        },
    }),
    Trans: ({ children }: { children: React.ReactNode }) => children,
    initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
