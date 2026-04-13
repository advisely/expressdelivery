import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from './SettingsModal';
import { ThemeProvider } from './ThemeContext';
import { useThemeStore } from '../stores/themeStore';
import { useEmailStore } from '../stores/emailStore';
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
    AlertTriangle: () => <div data-testid="icon-AlertTriangle">AT</div>,
    ChevronDown: () => <div data-testid="icon-ChevronDown">CD</div>,
    ChevronRight: () => <div data-testid="icon-ChevronRight">CR</div>,
    ExternalLink: () => <div data-testid="icon-ExternalLink">EL</div>,
    Download: () => <div data-testid="icon-Download">Dl</div>,
    Shield: () => <div data-testid="icon-Shield">Sh</div>,
    HardDrive: () => <div data-testid="icon-HardDrive">Hd</div>,
    Power: () => <div data-testid="icon-Power">Pw</div>,
    Rocket: () => <div data-testid="icon-Rocket">Rk</div>,
    Upload: () => <div data-testid="icon-Upload">Up</div>,
    Globe: () => <div data-testid="icon-Globe">Gl</div>,
    CheckCircle: () => <div data-testid="icon-CheckCircle">Ck</div>,
    FileArchive: () => <div data-testid="icon-FileArchive">Fa</div>,
    Loader2: () => <div data-testid="icon-Loader2">L2</div>,
    Package: () => <div data-testid="icon-Package">Pk</div>,
    Sparkles: () => <div data-testid="icon-Sparkles">Sp</div>,
    Settings2: () => <div data-testid="icon-Settings2">S2</div>,
    Database: () => <div data-testid="icon-Database">Db</div>,
    ArrowUpDown: () => <div data-testid="icon-ArrowUpDown">AUD</div>,
    Info: () => <div data-testid="icon-Info">In</div>,
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

        expect(screen.getByText('settings.layoutVertical')).toBeInTheDocument();
        expect(screen.getByText('settings.layoutHorizontal')).toBeInTheDocument();
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

        fireEvent.click(screen.getByLabelText('settings.closeSettings'));
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

        const verticalBtn = screen.getByText('settings.layoutVertical').closest('button');
        const horizontalBtn = screen.getByText('settings.layoutHorizontal').closest('button');

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
        expect(alert).toHaveTextContent('settings.addAccountEmailRequired');
    });

    // --- New tests for Test Connection feature ---

    it('resets test status to idle when a credential field changes after a successful test', async () => {
        // Arrange: first call is the API key load (returns null), second is notification settings, third is undo_send_delay, fourth is sound_enabled, then 3 sync settings, then connection test returns success
        mockIpcInvoke.mockResolvedValueOnce(null); // apikeys:get-openrouter
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get notifications_enabled
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get undo_send_delay
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get sound_enabled
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get sync_interval_inbox
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get sync_interval_folders
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get reconnect_max_interval
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
        // Arrange: first call is the API key load (returns null), second is notification settings, third is undo_send_delay, fourth is sound_enabled, then 3 sync settings, then simulate a hard IPC-layer rejection
        mockIpcInvoke.mockResolvedValueOnce(null); // apikeys:get-openrouter
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get notifications_enabled
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get undo_send_delay
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get sound_enabled
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get sync_interval_inbox
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get sync_interval_folders
        mockIpcInvoke.mockResolvedValueOnce(null); // settings:get reconnect_max_interval
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
            'settings.connectionTestFailed'
        );
        // The button span should now read the failed key
        expect(screen.getByText('settings.failed')).toBeInTheDocument();
    });

    it('skips the connection test on submit when the standalone test already passed', async () => {
        // First call: API key load (returns null)
        // Calls 2-4: notification/undo/sound settings
        // Calls 5-7: sync interval settings
        // Call 8: standalone test button -> success
        // Call 9: accounts:add -> new account id
        // Call 10: folders:list -> empty list (post-add flow)
        // A second accounts:test must NOT occur
        mockIpcInvoke
            .mockResolvedValueOnce(null)                 // apikeys:get-openrouter
            .mockResolvedValueOnce(null)                 // settings:get notifications_enabled
            .mockResolvedValueOnce(null)                 // settings:get undo_send_delay
            .mockResolvedValueOnce(null)                 // settings:get sound_enabled
            .mockResolvedValueOnce(null)                 // settings:get sync_interval_inbox
            .mockResolvedValueOnce(null)                 // settings:get sync_interval_folders
            .mockResolvedValueOnce(null)                 // settings:get reconnect_max_interval
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

        // Call 1 is apikeys:get-openrouter, calls 2-4 are notification/undo/sound settings,
        // calls 5-7 are sync interval settings, call 8 is accounts:test, call 9 is accounts:add
        expect(mockIpcInvoke).toHaveBeenNthCalledWith(
            8, 'accounts:test', expect.objectContaining({ email: 'user@gmail.com' })
        );
        expect(mockIpcInvoke).toHaveBeenNthCalledWith(
            9, 'accounts:add', expect.objectContaining({ email: 'user@gmail.com' })
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
        // First click the AI & Agents category tab, then the Agentic sub-tab
        const aiCategory = screen.getByRole('tab', { name: /settings\.categoryAI/i });
        await user.click(aiCategory);
        const tab = screen.getByRole('tab', { name: /mcp\.title/i });
        await user.click(tab);
        return user;
    }

    it('renders Agentic tab trigger after clicking AI category', async () => {
        const user = userEvent.setup();
        renderSettings();

        // Switch to AI & Agents category to reveal the Agentic sub-tab
        const aiCategory = screen.getByRole('tab', { name: /settings\.categoryAI/i });
        await user.click(aiCategory);

        const agenticTab = screen.getByRole('tab', { name: /mcp\.title/i });
        expect(agenticTab).toBeInTheDocument();
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

    // --- Provider help panel integration ---

    describe('Provider help panel integration', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            mockIpcInvoke.mockResolvedValue(null);
            // Reset the email store so legacy-account fixtures don't bleed
            // between tests in the suite.
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

        it('shows ProviderHelpPanel when adding a Gmail account', async () => {
            renderSettings();

            fireEvent.click(screen.getByText('settings.addAccount'));
            fireEvent.click(screen.getByText('Gmail'));

            expect(screen.getByText('providerHelp.gmail.shortNote')).toBeInTheDocument();
            // Password input must still be present for a password-supported provider
            expect(screen.getByLabelText('settings.password')).toBeInTheDocument();
        });

        it('disables add flow for outlook-personal with coming soon message', async () => {
            renderSettings();

            fireEvent.click(screen.getByText('settings.addAccount'));
            fireEvent.click(screen.getByText('Outlook.com (Personal)'));

            // Warning banner from ProviderHelpPanel
            expect(screen.getByText('providerHelp.outlookPersonal.warning')).toBeInTheDocument();
            // Coming-soon block — exposed as role="status" / aria-live="polite" so
            // assistive tech announces the disabled state when it appears.
            const status = screen.getByRole('status');
            expect(status).toHaveTextContent('providerHelp.outlookPersonal.comingSoonMessage');
            expect(status).toHaveAttribute('aria-live', 'polite');
            // Password input must NOT be rendered while the flow is gated
            expect(screen.queryByLabelText('settings.password')).not.toBeInTheDocument();
            // The custom-fallback button must be present
            expect(screen.getByText('onboarding.useCustomInstead')).toBeInTheDocument();
        });

        it('custom fallback button switches oauth2-gated add flow to Other / Custom', async () => {
            renderSettings();

            fireEvent.click(screen.getByText('settings.addAccount'));
            fireEvent.click(screen.getByText('Microsoft 365 (Work/School)'));

            // Coming-soon message visible, password hidden
            expect(screen.getByText('providerHelp.outlookBusiness.comingSoonMessage')).toBeInTheDocument();
            expect(screen.queryByLabelText('settings.password')).not.toBeInTheDocument();

            // Click the custom fallback button
            fireEvent.click(screen.getByText('onboarding.useCustomInstead'));

            // Coming-soon banner gone; password input back
            expect(screen.queryByText('providerHelp.outlookBusiness.comingSoonMessage')).not.toBeInTheDocument();
            expect(screen.getByLabelText('settings.password')).toBeInTheDocument();
            // Help panel now shows the custom preset short note
            expect(screen.getByText('providerHelp.custom.shortNote')).toBeInTheDocument();
        });

        it('shows legacy warning but keeps form editable for stored provider="outlook"', async () => {
            // Seed the email store with a legacy Outlook account row (the
            // SettingsModal component reads accounts from Zustand, not from
            // accounts:list IPC).
            useEmailStore.setState({
                accounts: [{
                    id: 'acc-legacy',
                    email: 'legacy@outlook.com',
                    provider: 'outlook',
                    display_name: 'Legacy',
                    imap_host: 'outlook.office365.com',
                    imap_port: 993,
                    smtp_host: 'smtp.office365.com',
                    smtp_port: 587,
                    signature_html: null,
                }],
            });

            // The save flow calls accounts:test then accounts:update. Mock
            // both to succeed so handleUpdateAccount completes and we can
            // assert on the update payload.
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'accounts:test') return { success: true };
                if (channel === 'accounts:update') return { success: true };
                return null;
            });

            const user = userEvent.setup();
            renderSettings();

            // Legacy account row visible with the Outlook (Legacy) label
            expect(screen.getByText('legacy@outlook.com')).toBeInTheDocument();
            expect(screen.getByText('Outlook (Legacy)')).toBeInTheDocument();

            // Click the row to enter edit mode
            await user.click(screen.getByText('legacy@outlook.com'));

            // Warning banner from ProviderHelpPanel with role="alert"
            const alerts = screen.getAllByRole('alert');
            const legacyWarning = alerts.find(el =>
                el.textContent?.includes('providerHelp.outlookLegacy.warning')
            );
            expect(legacyWarning).toBeDefined();

            // Form remains editable: password input rendered and enabled
            const passwordInput = screen.getByLabelText('settings.password') as HTMLInputElement;
            expect(passwordInput).toBeInTheDocument();
            expect(passwordInput.disabled).toBe(false);

            // The coming-soon block must NOT appear on the legacy edit path
            expect(screen.queryByText('providerHelp.outlookPersonal.comingSoonMessage')).not.toBeInTheDocument();

            // Type a new password and save. This exercises handleUpdateAccount
            // which must preserve the original stored provider ('outlook'),
            // NOT rewrite it to the preset-derived 'outlook-legacy' id. This
            // asserts the editingOriginalProvider invariant.
            await user.clear(passwordInput);
            await user.type(passwordInput, 'new-app-password');

            // In edit mode with a new password the primary button is labeled
            // settings.testAndSave (see getPrimaryButtonLabel).
            const saveButton = screen.getByRole('button', { name: 'settings.testAndSave' });
            await user.click(saveButton);

            await waitFor(() => {
                const updateCall = mockIpcInvoke.mock.calls.find(call => call[0] === 'accounts:update');
                expect(updateCall).toBeDefined();
                // The payload (second arg) must carry provider: 'outlook',
                // NOT 'outlook-legacy' — this locks in the
                // editingOriginalProvider invariant.
                expect(updateCall![1]).toMatchObject({
                    id: 'acc-legacy',
                    provider: 'outlook',
                });
            });
        });
    });
});
