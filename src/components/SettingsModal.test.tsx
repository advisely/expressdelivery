import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from './SettingsModal';
import { ThemeProvider } from './ThemeContext';
import { useThemeStore } from '../stores/themeStore';
import { ipcInvoke } from '../lib/ipc';

// Hoist IPC mock so it is available before module imports resolve
vi.mock('../lib/ipc', () => ({
    ipcInvoke: vi.fn(),
}));

// Mock lucide icons to avoid SVGs cluttering snapshots and dom queries
vi.mock('lucide-react', () => ({
    X: () => <div data-testid="icon-X">X</div>,
    Layout: () => <div data-testid="icon-Layout">L</div>,
    Monitor: () => <div data-testid="icon-Monitor">M</div>,
    Moon: () => <div data-testid="icon-Moon">N</div>,
    Sun: () => <div data-testid="icon-Sun">S</div>,
    Droplets: () => <div data-testid="icon-Droplets">D</div>,
    Mail: () => <div data-testid="icon-Mail">Ma</div>,
    Plus: () => <div data-testid="icon-Plus">+</div>,
    Trash2: () => <div data-testid="icon-Trash2">T</div>,
    Eye: () => <div data-testid="icon-Eye">E</div>,
    EyeOff: () => <div data-testid="icon-EyeOff">EO</div>,
    Server: () => <div data-testid="icon-Server">Sv</div>,
    CheckCircle2: () => <div data-testid="icon-CheckCircle2">CC</div>,
    XCircle: () => <div data-testid="icon-XCircle">XC</div>,
    Loader: () => <div data-testid="icon-Loader">Lo</div>,
    Key: () => <div data-testid="icon-Key">K</div>,
    Bell: () => <div data-testid="icon-Bell">B</div>,
    Filter: () => <div data-testid="icon-Filter">F</div>,
    GripVertical: () => <div data-testid="icon-GripVertical">GV</div>,
    Pencil: () => <div data-testid="icon-Pencil">Pe</div>,
    FileText: () => <div data-testid="icon-FileText">Ft</div>,
}));

const mockIpcInvoke = vi.mocked(ipcInvoke);

function renderSettings(onClose = () => { }) {
    return render(
        <ThemeProvider>
            <SettingsModal onClose={onClose} />
        </ThemeProvider>
    );
}

async function switchToAppearanceTab() {
    const user = userEvent.setup();
    const appearanceTab = screen.getByRole('tab', { name: /appearance/i });
    await user.click(appearanceTab);
    await waitFor(() => expect(screen.getByText('Light')).toBeInTheDocument());
}

describe('SettingsModal Integration Tests', () => {
    beforeEach(() => {
        // Clear all mock state (calls, instances, Once queues) and reset to a safe default.
        // This prevents Once-queue bleed between tests when running the full suite.
        vi.clearAllMocks();
        mockIpcInvoke.mockResolvedValue(null);
    });

    it('renders all customized themes and pane layouts correctly', async () => {
        renderSettings();
        await switchToAppearanceTab();

        expect(screen.getByText('Light')).toBeInTheDocument();
        expect(screen.getByText('Cream')).toBeInTheDocument();
        expect(screen.getByText('Midnight')).toBeInTheDocument();
        expect(screen.getByText('Forest')).toBeInTheDocument();

        expect(screen.getByText('Vertical Split (3-Pane)')).toBeInTheDocument();
        expect(screen.getByText('Horizontal Split')).toBeInTheDocument();
    });

    it('updates global Zustand store when new themes are clicked', async () => {
        useThemeStore.setState({ themeName: 'light' });

        renderSettings();
        await switchToAppearanceTab();

        fireEvent.click(screen.getByText('Midnight'));
        expect(useThemeStore.getState().themeName).toBe('midnight');

        fireEvent.click(screen.getByText('Forest'));
        expect(useThemeStore.getState().themeName).toBe('forest');
    });

    it('triggers onClose when close button is clicked', () => {
        const mockClose = vi.fn();
        renderSettings(mockClose);

        fireEvent.click(screen.getByLabelText('Close settings'));
        expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('applies the active state only to the selected theme and layout options', async () => {
        useThemeStore.setState({ themeName: 'light' });

        renderSettings();
        await switchToAppearanceTab();

        const lightBtn = screen.getByText('Light').closest('button');
        const midnightBtn = screen.getByText('Midnight').closest('button');

        expect(lightBtn).toHaveAttribute('aria-pressed', 'true');
        expect(midnightBtn).toHaveAttribute('aria-pressed', 'false');

        const verticalBtn = screen.getByText('Vertical Split (3-Pane)').closest('button');
        const horizontalBtn = screen.getByText('Horizontal Split').closest('button');

        expect(verticalBtn).toHaveAttribute('aria-pressed', 'true');
        expect(horizontalBtn).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(horizontalBtn!);
        expect(verticalBtn).toHaveAttribute('aria-pressed', 'false');
        expect(horizontalBtn).toHaveAttribute('aria-pressed', 'true');
    });

    it('renders accounts tab with add account button', () => {
        renderSettings();

        expect(screen.getByText('settings.emailAccounts')).toBeInTheDocument();
        expect(screen.getByText('settings.addAccount')).toBeInTheDocument();
    });

    it('shows add account form when Add Account is clicked', () => {
        renderSettings();

        fireEvent.click(screen.getByText('settings.addAccount'));
        expect(screen.getByText('settings.addAccount', { selector: 'h3' })).toBeInTheDocument();
        expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
        expect(screen.getByText('Gmail')).toBeInTheDocument();
    });

    it('uses Radix tabs with proper data-state attributes', () => {
        renderSettings();

        const accountsTab = screen.getByRole('tab', { name: /accounts/i });
        const appearanceTab = screen.getByRole('tab', { name: /appearance/i });

        expect(accountsTab).toHaveAttribute('data-state', 'active');
        expect(appearanceTab).toHaveAttribute('data-state', 'inactive');
    });

    it('associates form labels with inputs via htmlFor/id', () => {
        renderSettings();

        fireEvent.click(screen.getByText('settings.addAccount'));

        // Click a provider first to show the form
        fireEvent.click(screen.getByText('Gmail'));

        expect(screen.getByLabelText('settings.email')).toBeInTheDocument();
        expect(screen.getByLabelText('settings.displayName')).toBeInTheDocument();
        expect(screen.getByLabelText('settings.password')).toBeInTheDocument();
    });

    it('shows Test Connection button in account form', () => {
        renderSettings();

        fireEvent.click(screen.getByText('settings.addAccount'));
        fireEvent.click(screen.getByText('Gmail'));

        const testBtn = screen.getByText('settings.testConnection');
        expect(testBtn).toBeInTheDocument();
    });

    it('disables Test Connection button when email or password is empty', () => {
        renderSettings();

        fireEvent.click(screen.getByText('settings.addAccount'));
        fireEvent.click(screen.getByText('Gmail'));

        const testBtn = screen.getByText('settings.testConnection').closest('button');
        expect(testBtn).toBeDisabled();

        // Fill email but not password — still disabled
        fireEvent.change(screen.getByLabelText('settings.email'), { target: { value: 'test@gmail.com' } });
        expect(testBtn).toBeDisabled();

        // Fill password too — now enabled
        fireEvent.change(screen.getByLabelText('settings.password'), { target: { value: 'secret' } });
        expect(testBtn).not.toBeDisabled();
    });

    it('shows error with role="alert" on validation failure', () => {
        renderSettings();

        fireEvent.click(screen.getByText('settings.addAccount'));

        // Click Gmail provider
        fireEvent.click(screen.getByText('Gmail'));

        // Submit without filling fields — button text is now the testAndAdd key
        fireEvent.click(screen.getByText('settings.testAndAdd'));

        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        expect(alert).toHaveTextContent('Email address is required');
    });

    // --- New tests for Test Connection feature ---

    it('resets test status to idle when a credential field changes after a successful test', async () => {
        // Arrange: first call is the API key load (returns null), second is notification settings, third is undo_send_delay, then connection test returns success
        mockIpcInvoke.mockResolvedValueOnce(null); // apikeys:get-openrouter
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get notifications_enabled
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get undo_send_delay
        mockIpcInvoke.mockResolvedValueOnce({ success: true }); // accounts:test

        renderSettings();
        fireEvent.click(screen.getByText('settings.addAccount'));
        fireEvent.click(screen.getByText('Gmail'));

        fireEvent.change(screen.getByLabelText('settings.email'), { target: { value: 'user@gmail.com' } });
        fireEvent.change(screen.getByLabelText('settings.password'), { target: { value: 'pass' } });

        const testBtn = screen.getByText('settings.testConnection').closest('button')!;

        // Run the test — button label should update to "Connected"
        fireEvent.click(testBtn);
        await waitFor(() =>
            expect(screen.getByText('settings.connected')).toBeInTheDocument()
        );

        // Primary button should now be "Add Account" (test already passed)
        expect(screen.getByText('settings.addAccount', { selector: 'button' })).toBeInTheDocument();

        // Change the email — status must revert to idle
        fireEvent.change(screen.getByLabelText('settings.email'), { target: { value: 'other@gmail.com' } });

        // Button label reverts to "Test Connection"
        expect(screen.getByText('settings.testConnection')).toBeInTheDocument();
        // Primary button reverts to requiring a fresh test
        expect(screen.getByText('settings.testAndAdd')).toBeInTheDocument();
    });

    it('shows inline error and Failed label when the IPC call itself throws (network failure)', async () => {
        // Arrange: first call is the API key load (returns null), second is notification settings, third is undo_send_delay, then simulate a hard IPC-layer rejection
        mockIpcInvoke.mockResolvedValueOnce(null); // apikeys:get-openrouter
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get notifications_enabled
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get undo_send_delay
        mockIpcInvoke.mockRejectedValueOnce(new Error('IPC channel closed')); // accounts:test

        renderSettings();
        fireEvent.click(screen.getByText('settings.addAccount'));
        fireEvent.click(screen.getByText('Gmail'));

        fireEvent.change(screen.getByLabelText('settings.email'), { target: { value: 'user@gmail.com' } });
        fireEvent.change(screen.getByLabelText('settings.password'), { target: { value: 'pass' } });

        fireEvent.click(screen.getByText('settings.testConnection').closest('button')!);

        await waitFor(() =>
            expect(screen.getByRole('alert')).toBeInTheDocument()
        );

        expect(screen.getByRole('alert')).toHaveTextContent(
            'Connection test failed. Check your credentials and server settings.'
        );
        // The button span should now read the failed key
        expect(screen.getByText('settings.failed')).toBeInTheDocument();
    });

    it('skips the connection test on submit when the standalone test already passed', async () => {
        // First call: API key load (returns null)
        // Second call: standalone test button -> success
        // Third call: accounts:add -> new account id
        // Fourth call: folders:list -> empty list (post-add flow)
        // A second accounts:test must NOT occur
        mockIpcInvoke
            .mockResolvedValueOnce(null)                 // apikeys:get-openrouter
            .mockResolvedValueOnce(null)                 // settings:get notifications_enabled
            .mockResolvedValueOnce(null)                 // settings:get undo_send_delay
            .mockResolvedValueOnce({ success: true })    // accounts:test
            .mockResolvedValueOnce({ id: 'new-acc-id' }) // accounts:add
            .mockResolvedValueOnce([]);                  // folders:list (post-add flow)

        renderSettings();
        fireEvent.click(screen.getByText('settings.addAccount'));
        fireEvent.click(screen.getByText('Gmail'));

        fireEvent.change(screen.getByLabelText('settings.email'), { target: { value: 'user@gmail.com' } });
        fireEvent.change(screen.getByLabelText('settings.password'), { target: { value: 'pass' } });

        // Run the standalone test
        fireEvent.click(screen.getByText('settings.testConnection').closest('button')!);
        await waitFor(() => expect(screen.getByText('settings.connected')).toBeInTheDocument());

        // Primary button label must confirm the test is no longer required
        expect(screen.getByText('settings.addAccount', { selector: 'button' })).toBeInTheDocument();

        // Submit the form
        fireEvent.click(screen.getByText('settings.addAccount', { selector: 'button' }));

        // Wait for the form to reset (back to account list view)
        await waitFor(() =>
            expect(screen.getByText('settings.emailAccounts')).toBeInTheDocument()
        );

        // Call 1 is apikeys:get-openrouter, call 2 is settings:get (notifications_enabled),
        // call 3 is settings:get (undo_send_delay), call 4 is accounts:test, call 5 is accounts:add
        expect(mockIpcInvoke).toHaveBeenNthCalledWith(
            4, 'accounts:test', expect.objectContaining({ email: 'user@gmail.com' })
        );
        expect(mockIpcInvoke).toHaveBeenNthCalledWith(
            5, 'accounts:add', expect.objectContaining({ email: 'user@gmail.com' })
        );
        // Verify accounts:test was invoked exactly once across the whole flow
        const testCalls = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'accounts:test');
        expect(testCalls).toHaveLength(1);
    });

    it('does not load rules or templates on mount (lazy loading)', async () => {
        mockIpcInvoke.mockResolvedValueOnce(null); // apikeys:get-openrouter
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get notifications_enabled
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get undo_send_delay

        renderSettings();

        // Wait for mount effects to settle
        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('apikeys:get-openrouter');
        });

        // Neither rules:list nor templates:list should have been called on mount
        const rulesCalls = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'rules:list');
        const templatesCalls = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'templates:list');
        expect(rulesCalls).toHaveLength(0);
        expect(templatesCalls).toHaveLength(0);
    });
});
