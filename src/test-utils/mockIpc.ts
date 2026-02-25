import { vi } from 'vitest';

/**
 * Creates mock IPC functions matching the preload API.
 *
 * Usage in tests:
 *   const { mockIpcInvoke, mockIpcOn } = createMockIpc();
 *   vi.mock('../lib/ipc', () => ({ ipcInvoke: mockIpcInvoke, ipcOn: mockIpcOn }));
 */
export function createMockIpc() {
    const mockIpcInvoke = vi.fn().mockResolvedValue(null);
    const mockIpcOn = vi.fn().mockReturnValue(vi.fn()); // returns cleanup fn

    return { mockIpcInvoke, mockIpcOn };
}
