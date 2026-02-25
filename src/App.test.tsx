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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('App', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIpcInvoke.mockResolvedValue(null);
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

    it('renders OnboardingScreen when no accounts exist', () => {
        renderApp();
        expect(screen.getByTestId('onboarding')).toBeInTheDocument();
    });

    it('renders main layout when accounts exist', () => {
        useEmailStore.setState({ accounts: mockAccounts });
        renderApp();
        expect(screen.getByTestId('sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('threadlist')).toBeInTheDocument();
        expect(screen.getByTestId('readingpane')).toBeInTheDocument();
        expect(screen.getByTestId('update-banner')).toBeInTheDocument();
    });

    it('opens ComposeModal when compose button is clicked', async () => {
        useEmailStore.setState({ accounts: mockAccounts });
        renderApp();
        await userEvent.click(screen.getByTestId('compose-btn'));
        expect(screen.getByTestId('compose-modal')).toBeInTheDocument();
    });

    it('closes ComposeModal when onClose is called', async () => {
        useEmailStore.setState({ accounts: mockAccounts });
        renderApp();
        await userEvent.click(screen.getByTestId('compose-btn'));
        expect(screen.getByTestId('compose-modal')).toBeInTheDocument();
        await userEvent.click(screen.getByText('Close'));
        expect(screen.queryByTestId('compose-modal')).not.toBeInTheDocument();
    });

    it('opens SettingsModal when settings button is clicked', async () => {
        useEmailStore.setState({ accounts: mockAccounts });
        renderApp();
        await userEvent.click(screen.getByTestId('settings-btn'));
        expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    it('loads accounts on mount via IPC', async () => {
        mockIpcInvoke.mockResolvedValueOnce(mockAccounts);
        await act(async () => { renderApp(); });
        expect(mockIpcInvoke).toHaveBeenCalledWith('accounts:list');
    });

    it('loads folders when selectedAccountId changes', async () => {
        mockIpcInvoke.mockResolvedValue(null);
        useEmailStore.setState({ accounts: mockAccounts, selectedAccountId: 'a1' });
        await act(async () => { renderApp(); });
        expect(mockIpcInvoke).toHaveBeenCalledWith('folders:list', 'a1');
    });

    it('shows toast on reminder:due IPC event', async () => {
        useEmailStore.setState({ accounts: mockAccounts });
        vi.useFakeTimers();

        // Capture the reminder:due listener
        let reminderCallback: ((...args: unknown[]) => void) | null = null;
        mockIpcOn.mockImplementation((channel: string, cb: (...args: unknown[]) => void) => {
            if (channel === 'reminder:due') reminderCallback = cb;
            return vi.fn();
        });

        renderApp();

        // Simulate reminder event
        act(() => {
            reminderCallback?.({ subject: 'Follow up', emailId: 'e1' });
        });

        expect(screen.getByRole('alert')).toHaveTextContent('toast.reminderSubject');

        // Auto-dismiss after 8 seconds
        act(() => { vi.advanceTimersByTime(9000); });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        vi.useRealTimers();
    });

    it('shows toast on scheduled:sent event', async () => {
        useEmailStore.setState({ accounts: mockAccounts });

        let sentCallback: ((...args: unknown[]) => void) | null = null;
        mockIpcOn.mockImplementation((channel: string, cb: (...args: unknown[]) => void) => {
            if (channel === 'scheduled:sent') sentCallback = cb;
            return vi.fn();
        });

        renderApp();

        act(() => { sentCallback?.({ scheduledId: 's1' }); });
        expect(screen.getByRole('alert')).toHaveTextContent('toast.scheduledSent');
    });

    it('shows toast on scheduled:failed event', async () => {
        useEmailStore.setState({ accounts: mockAccounts });

        let failedCallback: ((...args: unknown[]) => void) | null = null;
        mockIpcOn.mockImplementation((channel: string, cb: (...args: unknown[]) => void) => {
            if (channel === 'scheduled:failed') failedCallback = cb;
            return vi.fn();
        });

        renderApp();

        act(() => { failedCallback?.({ error: 'Connection timeout' }); });
        expect(screen.getByRole('alert')).toHaveTextContent('toast.scheduledFailed');
    });

    it('dismisses toast when close button is clicked', async () => {
        useEmailStore.setState({ accounts: mockAccounts });

        let sentCallback: ((...args: unknown[]) => void) | null = null;
        mockIpcOn.mockImplementation((channel: string, cb: (...args: unknown[]) => void) => {
            if (channel === 'scheduled:sent') sentCallback = cb;
            return vi.fn();
        });

        renderApp();
        act(() => { sentCallback?.({ scheduledId: 's1' }); });
        expect(screen.getByRole('alert')).toBeInTheDocument();

        await userEvent.click(screen.getByLabelText('toast.dismissNotification'));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
