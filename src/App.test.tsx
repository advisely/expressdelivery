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

vi.mock('./lib/ipc', () => ({
    ipcInvoke: mockIpcInvoke,
    ipcOn: mockIpcOn,
}));

vi.mock('./lib/useKeyboardShortcuts', () => ({
    useKeyboardShortcuts: vi.fn(),
}));

// Stub child components to keep tests focused on App orchestration
vi.mock('./components/Sidebar', () => ({
    Sidebar: ({ onCompose, onSettings }: { onCompose: () => void; onSettings: () => void }) => (
        <div data-testid="sidebar">
            <button data-testid="compose-btn" onClick={onCompose}>Compose</button>
            <button data-testid="settings-btn" onClick={onSettings}>Settings</button>
        </div>
    ),
}));

vi.mock('./components/ThreadList', () => ({
    ThreadList: () => <div data-testid="threadlist" />,
}));

vi.mock('./components/ReadingPane', () => ({
    ReadingPane: () => <div data-testid="readingpane" />,
}));

vi.mock('./components/ComposeModal', () => ({
    ComposeModal: ({ onClose }: { onClose: () => void }) => (
        <div data-testid="compose-modal"><button onClick={onClose}>Close</button></div>
    ),
}));

vi.mock('./components/SettingsModal', () => ({
    SettingsModal: ({ onClose }: { onClose: () => void }) => (
        <div data-testid="settings-modal"><button onClick={onClose}>Close</button></div>
    ),
}));

vi.mock('./components/OnboardingScreen', () => ({
    OnboardingScreen: ({ onAccountAdded }: { onAccountAdded: () => void }) => (
        <div data-testid="onboarding"><button onClick={onAccountAdded}>Add Account</button></div>
    ),
}));

vi.mock('./components/UpdateBanner', () => ({
    UpdateBanner: () => <div data-testid="update-banner" />,
}));

import App from './App';
import { useEmailStore } from './stores/emailStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockAccounts = [
    { id: 'a1', email: 'test@example.com', provider: 'gmail', display_name: 'Test', imap_host: 'imap.gmail.com', imap_port: 993, smtp_host: 'smtp.gmail.com', smtp_port: 465, signature_html: null },
];

function renderApp() {
    return render(<App />);
}

/** Render App with accounts pre-loaded (startup:load resolves with accounts + settings) */
async function renderAppWithAccounts() {
    mockIpcInvoke
        .mockResolvedValueOnce({
            accounts: mockAccounts, folders: [], emails: [],
            selectedAccountId: 'a1', selectedFolderId: null,
            settings: { undo_send_delay: '5' },
        })              // startup:load (includes settings)
        .mockResolvedValueOnce([]);    // folders:list (triggered by selectedAccountId change)
    let result: ReturnType<typeof render>;
    await act(async () => { result = render(<App />); });
    return result!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('App', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: startup:load returns empty (triggers onboarding)
        mockIpcInvoke.mockResolvedValue({ accounts: [], folders: [], emails: [], selectedAccountId: null, selectedFolderId: null, settings: { undo_send_delay: '5' } });
        mockIpcOn.mockReturnValue(vi.fn());
        // Reset email store to empty (no accounts = onboarding)
        useEmailStore.setState({
            accounts: [],
            folders: [],
            emails: [],
            selectedAccountId: null,
            selectedFolderId: null,
            selectedEmailId: null,
            selectedEmail: null,
            searchQuery: '',
        });
    });

    it('renders OnboardingScreen when no accounts exist', async () => {
        await act(async () => { renderApp(); });
        expect(screen.getByTestId('onboarding')).toBeInTheDocument();
    });

    it('renders main layout when accounts exist', async () => {
        await renderAppWithAccounts();
        expect(screen.getByTestId('sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('threadlist')).toBeInTheDocument();
        expect(screen.getByTestId('readingpane')).toBeInTheDocument();
        expect(screen.getByTestId('update-banner')).toBeInTheDocument();
    });

    it('opens ComposeModal when compose button is clicked', async () => {
        await renderAppWithAccounts();
        await userEvent.click(screen.getByTestId('compose-btn'));
        expect(await screen.findByTestId('compose-modal')).toBeInTheDocument();
    });

    it('closes ComposeModal when onClose is called', async () => {
        await renderAppWithAccounts();
        await userEvent.click(screen.getByTestId('compose-btn'));
        expect(await screen.findByTestId('compose-modal')).toBeInTheDocument();
        await userEvent.click(screen.getByText('Close'));
        expect(screen.queryByTestId('compose-modal')).not.toBeInTheDocument();
    });

    it('opens SettingsModal when settings button is clicked', async () => {
        await renderAppWithAccounts();
        await userEvent.click(screen.getByTestId('settings-btn'));
        expect(await screen.findByTestId('settings-modal')).toBeInTheDocument();
    });

    it('loads accounts on mount via IPC (startup:load)', async () => {
        mockIpcInvoke.mockResolvedValueOnce({
            accounts: mockAccounts,
            folders: [],
            emails: [],
            selectedAccountId: null,
            selectedFolderId: null,
        });
        await act(async () => { renderApp(); });
        expect(mockIpcInvoke).toHaveBeenCalledWith('startup:load');
    });

    it('loads folders when selectedAccountId changes', async () => {
        await renderAppWithAccounts();
        expect(mockIpcInvoke).toHaveBeenCalledWith('folders:list', 'a1');
    });

    it('shows toast on reminder:due IPC event', async () => {
        vi.useFakeTimers();

        let reminderCallback: ((...args: unknown[]) => void) | null = null;
        mockIpcOn.mockImplementation((channel: string, cb: (...args: unknown[]) => void) => {
            if (channel === 'reminder:due') reminderCallback = cb;
            return vi.fn();
        });

        mockIpcInvoke
            .mockResolvedValueOnce({
                accounts: mockAccounts, folders: [], emails: [],
                selectedAccountId: 'a1', selectedFolderId: null,
                settings: { undo_send_delay: '5' },
            })
            .mockResolvedValueOnce([]);    // folders:list
        await act(async () => { renderApp(); });

        act(() => {
            reminderCallback?.({ subject: 'Follow up', emailId: 'e1' });
        });

        expect(screen.getByRole('alert')).toHaveTextContent('toast.reminderSubject');

        act(() => { vi.advanceTimersByTime(9000); });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        vi.useRealTimers();
    });

    it('shows toast on scheduled:sent event', async () => {
        let sentCallback: ((...args: unknown[]) => void) | null = null;
        mockIpcOn.mockImplementation((channel: string, cb: (...args: unknown[]) => void) => {
            if (channel === 'scheduled:sent') sentCallback = cb;
            return vi.fn();
        });

        await renderAppWithAccounts();

        act(() => { sentCallback?.({ scheduledId: 's1' }); });
        expect(screen.getByRole('alert')).toHaveTextContent('toast.scheduledSent');
    });

    it('shows toast on scheduled:failed event', async () => {
        let failedCallback: ((...args: unknown[]) => void) | null = null;
        mockIpcOn.mockImplementation((channel: string, cb: (...args: unknown[]) => void) => {
            if (channel === 'scheduled:failed') failedCallback = cb;
            return vi.fn();
        });

        await renderAppWithAccounts();

        act(() => { failedCallback?.({ error: 'Connection timeout' }); });
        expect(screen.getByRole('alert')).toHaveTextContent('toast.scheduledFailed');
    });

    it('dismisses toast when close button is clicked', async () => {
        let sentCallback: ((...args: unknown[]) => void) | null = null;
        mockIpcOn.mockImplementation((channel: string, cb: (...args: unknown[]) => void) => {
            if (channel === 'scheduled:sent') sentCallback = cb;
            return vi.fn();
        });

        await renderAppWithAccounts();
        act(() => { sentCallback?.({ scheduledId: 's1' }); });
        expect(screen.getByRole('alert')).toBeInTheDocument();

        await userEvent.click(screen.getByLabelText('toast.dismissNotification'));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
