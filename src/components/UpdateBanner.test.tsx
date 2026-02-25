import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockIpcInvoke, mockIpcOn } = vi.hoisted(() => ({
    mockIpcInvoke: vi.fn().mockResolvedValue(null),
    mockIpcOn: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('../lib/ipc', () => ({
    ipcInvoke: mockIpcInvoke,
    ipcOn: mockIpcOn,
}));

import { UpdateBanner } from './UpdateBanner';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UpdateBanner', () => {
    // Capture IPC event listeners for simulation
    let listeners: Record<string, (...args: unknown[]) => void>;

    beforeEach(() => {
        vi.clearAllMocks();
        listeners = {};
        mockIpcOn.mockImplementation((channel: string, cb: (...args: unknown[]) => void) => {
            listeners[channel] = cb;
            return vi.fn();
        });
    });

    it('renders nothing when no update is available', () => {
        const { container } = render(<UpdateBanner />);
        expect(container.querySelector('.update-banner')).toBeNull();
    });

    it('shows version when update:available fires', () => {
        render(<UpdateBanner />);
        act(() => { listeners['update:available']?.({ version: '1.2.3' }); });
        expect(screen.getByRole('status')).toHaveTextContent('update.available');
    });

    it('shows Download button when update available', () => {
        render(<UpdateBanner />);
        act(() => { listeners['update:available']?.({ version: '1.2.3' }); });
        expect(screen.getByText('update.download')).toBeInTheDocument();
    });

    it('shows Restart & Update after update:downloaded fires', () => {
        render(<UpdateBanner />);
        act(() => { listeners['update:available']?.({ version: '1.2.3' }); });
        act(() => { listeners['update:downloaded']?.(); });
        expect(screen.getByText('update.restartUpdate')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('update.readyToInstall');
    });

    it('dismisses banner when X button is clicked', async () => {
        render(<UpdateBanner />);
        act(() => { listeners['update:available']?.({ version: '1.2.3' }); });
        expect(screen.getByRole('status')).toBeInTheDocument();
        await userEvent.click(screen.getByLabelText('update.dismiss'));
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('calls update:download when Download button clicked', async () => {
        render(<UpdateBanner />);
        act(() => { listeners['update:available']?.({ version: '1.2.3' }); });
        await userEvent.click(screen.getByText('update.download'));
        expect(mockIpcInvoke).toHaveBeenCalledWith('update:download');
    });

    it('calls update:install when Restart & Update clicked', async () => {
        render(<UpdateBanner />);
        act(() => { listeners['update:available']?.({ version: '1.2.3' }); });
        act(() => { listeners['update:downloaded']?.(); });
        await userEvent.click(screen.getByText('update.restartUpdate'));
        expect(mockIpcInvoke).toHaveBeenCalledWith('update:install');
    });
});
