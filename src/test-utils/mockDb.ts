import { vi } from 'vitest';

/**
 * Creates a mock database object matching the better-sqlite3 API surface
 * used throughout the electron/ modules.
 *
 * Usage in tests:
 *   const { mockDb, mockDbAll, mockDbGet, mockDbRun } = createMockDb();
 *   vi.mock('./db.js', () => ({ getDatabase: () => mockDb }));
 */
export function createMockDb() {
    const mockDbAll = vi.fn().mockReturnValue([]);
    const mockDbGet = vi.fn().mockReturnValue(null);
    const mockDbRun = vi.fn().mockReturnValue({ changes: 1 });

    const mockPrepare = vi.fn(() => ({
        all: mockDbAll,
        get: mockDbGet,
        run: mockDbRun,
    }));

    // transaction() returns a function that, when called, executes the callback
    const mockTransaction = vi.fn((fn: () => void) => {
        const wrapper = () => fn();
        return wrapper;
    });

    const mockDb = {
        prepare: mockPrepare,
        transaction: mockTransaction,
    };

    return { mockDb, mockPrepare, mockDbAll, mockDbGet, mockDbRun, mockTransaction };
}
