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
    Tags: () => <div data-testid="icon-Tags">Tg</div>,
    Users: () => <div data-testid="icon-Users">Us</div>,
    Bot: () => <div data-testid="icon-Bot">Bt</div>,
    Copy: () => <div data-testid="icon-Copy">Cp</div>,
    RefreshCw: () => <div data-testid="icon-RefreshCw">Rw</div>,
    Wrench: () => <div data-testid="icon-Wrench">Wr</div>,
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
        // Arrange: first call is the API key load (returns null), second is notification settings, third is undo_send_delay, fourth is sound_enabled, then connection test returns success
        mockIpcInvoke.mockResolvedValueOnce(null); // apikeys:get-openrouter
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get notifications_enabled
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get undo_send_delay
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get sound_enabled
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
        // Arrange: first call is the API key load (returns null), second is notification settings, third is undo_send_delay, fourth is sound_enabled, then simulate a hard IPC-layer rejection
        mockIpcInvoke.mockResolvedValueOnce(null); // apikeys:get-openrouter
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get notifications_enabled
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get undo_send_delay
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get sound_enabled
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
            .mockResolvedValueOnce(null)                 // settings:get sound_enabled
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
        // call 3 is settings:get (undo_send_delay), call 4 is settings:get (sound_enabled), call 5 is accounts:test, call 6 is accounts:add
        expect(mockIpcInvoke).toHaveBeenNthCalledWith(
            5, 'accounts:test', expect.objectContaining({ email: 'user@gmail.com' })
        );
        expect(mockIpcInvoke).toHaveBeenNthCalledWith(
            6, 'accounts:add', expect.objectContaining({ email: 'user@gmail.com' })
        );
        // Verify accounts:test was invoked exactly once across the whole flow
        const testCalls = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'accounts:test');
        expect(testCalls).toHaveLength(1);
    });

    it('does not load rules or templates on mount (lazy loading)', async () => {
        mockIpcInvoke.mockResolvedValueOnce(null); // apikeys:get-openrouter
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get notifications_enabled
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get undo_send_delay
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get sound_enabled

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

    // --- Agentic / MCP tab tests ---

    /**
     * Helper: set up IPC mocks, render, and navigate to the Agentic tab.
     * Returns the userEvent instance so callers can continue interacting.
     */
    async function switchToAgenticTab(overrides?: {
        running?: boolean;
        port?: number;
        connectedCount?: number;
        token?: string;
        enabled?: string | null;
        tools?: Array<{ name: string; description: string }>;
    }) {
        const user = userEvent.setup();
        const opts = {
            running: true,
            port: 3000,
            connectedCount: 0,
            token: 'test-token-abc123',
            enabled: null,
            tools: [{ name: 'search_emails', description: 'Search emails' }],
            ...overrides,
        };

        // Use mockImplementation so that both the mount calls (apikeys:get-openrouter,
        // settings:get notifications_enabled, settings:get undo_send_delay,
        // settings:get sound_enabled) and the tab-activation calls are handled
        // correctly regardless of invocation order.
        mockIpcInvoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
            if (channel === 'mcp:get-status') return { running: opts.running, port: opts.port, connectedCount: opts.connectedCount };
            if (channel === 'mcp:get-token') return { token: opts.token };
            if (channel === 'mcp:get-tools') return { tools: opts.tools };
            if (channel === 'settings:get' && args[0] === 'mcp_enabled') return opts.enabled;
            return null;
        });

        renderSettings();
        const tab = screen.getByRole('tab', { name: /mcp\.title/i });
        await user.click(tab);
        return user;
    }

    it('renders Agentic tab trigger with correct role and label', () => {
        renderSettings();

        // The tab trigger must be present in the tab list with the i18n key as its accessible name
        const agenticTab = screen.getByRole('tab', { name: /mcp\.title/i });
        expect(agenticTab).toBeInTheDocument();

        // It must behave as an inactive tab on initial render (accounts tab is default)
        expect(agenticTab).toHaveAttribute('data-state', 'inactive');
    });

    it('lazy-loads MCP status on Agentic tab activation and shows running state', async () => {
        await switchToAgenticTab({ running: true });

        // Wait for async IPC data to populate the UI
        await waitFor(() => {
            expect(screen.getByText(/mcp\.running/i)).toBeInTheDocument();
        });

        // The four tab-activation IPC calls must have been made
        expect(mockIpcInvoke).toHaveBeenCalledWith('mcp:get-status');
        expect(mockIpcInvoke).toHaveBeenCalledWith('mcp:get-token');
        expect(mockIpcInvoke).toHaveBeenCalledWith('mcp:get-tools');
        expect(mockIpcInvoke).toHaveBeenCalledWith('settings:get', 'mcp_enabled');
    });

    it('shows stopped status text when server is not running', async () => {
        await switchToAgenticTab({ running: false });

        await waitFor(() => {
            expect(screen.getByText(/mcp\.stopped/i)).toBeInTheDocument();
        });

        // Running text must not be present when the server is stopped
        expect(screen.queryByText(/mcp\.running/i)).not.toBeInTheDocument();
    });

    it('shows connected agent count when connectedCount is greater than zero', async () => {
        await switchToAgenticTab({ running: true, connectedCount: 3 });

        await waitFor(() => {
            // The component renders: t('mcp.connectedAgents'): {connectedCount}
            // In the test environment the key resolves to its raw form "mcp.connectedAgents"
            expect(screen.getByText(/mcp\.connectedAgents/i)).toBeInTheDocument();
        });

        // The numeric count must be visible in the status agents area
        expect(screen.getByText(/mcp\.connectedAgents/i).textContent).toContain('3');
    });

    it('port input reflects current port value and Apply button is disabled when unchanged', async () => {
        await switchToAgenticTab({ port: 3000 });

        await waitFor(() => {
            expect(screen.getByText(/mcp\.running/i)).toBeInTheDocument();
        });

        const portInput = screen.getByRole('spinbutton');
        expect(portInput).toHaveValue(3000);

        // Apply button is disabled because the input matches the current port
        const applyBtn = screen.getByText(/mcp\.portApply/i).closest('button');
        expect(applyBtn).toBeDisabled();

        // Changing the port value enables the Apply button
        fireEvent.change(portInput, { target: { value: '3001' } });
        expect(applyBtn).not.toBeDisabled();
    });

    it('token input is password type by default and clicking eye icon reveals it as text', async () => {
        const user = await switchToAgenticTab({ token: 'super-secret-token' });

        await waitFor(() => {
            expect(screen.getByText(/mcp\.running/i)).toBeInTheDocument();
        });

        // The token input is hidden by default
        const tokenInput = screen.getByDisplayValue('super-secret-token');
        expect(tokenInput).toHaveAttribute('type', 'password');

        // Click the Eye icon button to reveal the token
        const eyeBtn = screen.getByTitle(/mcp\.showToken/i);
        await user.click(eyeBtn);

        // After the toggle the input type becomes text
        expect(tokenInput).toHaveAttribute('type', 'text');

        // Clicking again conceals the token
        const eyeOffBtn = screen.getByTitle(/mcp\.hideToken/i);
        await user.click(eyeOffBtn);
        expect(tokenInput).toHaveAttribute('type', 'password');
    });

    it('clicking the toggle switch calls mcp:toggle with the opposite enabled value', async () => {
        // Server currently enabled (enabled = null means not 'false', so treated as true)
        const user = await switchToAgenticTab({ running: true, enabled: null });

        await waitFor(() => {
            expect(screen.getByText(/mcp\.running/i)).toBeInTheDocument();
        });

        // Prepare the mcp:toggle response
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'mcp:toggle') return { success: true, running: false };
            return null;
        });

        const toggleSwitch = screen.getByRole('switch', { name: /mcp\.serverToggle/i });
        expect(toggleSwitch).toHaveAttribute('aria-checked', 'true');

        await user.click(toggleSwitch);

        expect(mockIpcInvoke).toHaveBeenCalledWith('mcp:toggle', false);
    });

    it('renders all tool names from the tools response in the tools list', async () => {
        const tools = [
            { name: 'search_emails', description: 'Search your emails using FTS5' },
            { name: 'send_email', description: 'Send an email via SMTP' },
        ];

        await switchToAgenticTab({ tools });

        await waitFor(() => {
            expect(screen.getByText('search_emails')).toBeInTheDocument();
        });

        // Both tool names must be rendered
        expect(screen.getByText('search_emails')).toBeInTheDocument();
        expect(screen.getByText('send_email')).toBeInTheDocument();

        // Tool descriptions must also be visible
        expect(screen.getByText('Search your emails using FTS5')).toBeInTheDocument();
        expect(screen.getByText('Send an email via SMTP')).toBeInTheDocument();

        // The tools count label includes the number of tools
        expect(screen.getByText(/mcp\.toolsTitle/i).textContent).toContain('2');
    });
});
