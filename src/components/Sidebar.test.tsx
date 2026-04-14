import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks — define before importing the component under test
// ---------------------------------------------------------------------------

const { mockIpcInvoke, mockIpcOn, onListeners } = vi.hoisted(() => {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    return {
        mockIpcInvoke: vi.fn().mockResolvedValue(null),
        mockIpcOn: vi.fn((channel: string, cb: (...args: unknown[]) => void) => {
            if (!listeners[channel]) listeners[channel] = [];
            listeners[channel].push(cb);
            return () => {
                listeners[channel] = (listeners[channel] ?? []).filter(fn => fn !== cb);
            };
        }),
        onListeners: listeners,
    };
});

vi.mock('../lib/ipc', () => ({
    ipcInvoke: mockIpcInvoke,
    ipcOn: mockIpcOn,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (k: string, opts?: Record<string, unknown>) => {
            if (opts && typeof opts === 'object') {
                let out = k;
                for (const [key, val] of Object.entries(opts)) {
                    out = out.replace(`{{${key}}}`, String(val));
                }
                return out;
            }
            return k;
        },
    }),
}));

import { Sidebar } from './Sidebar';
import { useEmailStore, type Account } from '../stores/emailStore';
import { useThemeStore } from '../stores/themeStore';

const sampleAccount = (overrides: Partial<Account> = {}): Account => ({
    id: 'a1',
    email: 'user@gmail.com',
    provider: 'gmail',
    display_name: 'User One',
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    smtp_host: 'smtp.gmail.com',
    smtp_port: 465,
    signature_html: null,
    ...overrides,
});

function resetStores() {
    useEmailStore.setState({
        accounts: [],
        folders: [],
        emails: [],
        selectedEmail: null,
        selectedAccountId: null,
        selectedFolderId: null,
        selectedEmailId: null,
        selectedEmailIds: new Set<string>(),
        searchQuery: '',
        tags: [],
        savedSearches: [],
        drafts: [],
        contextAccountId: null,
    });
    useThemeStore.setState({ sidebarCollapsed: false });
}

describe('Sidebar reauth indicators (Task 23)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIpcInvoke.mockResolvedValue(null);
        for (const k of Object.keys(onListeners)) delete onListeners[k];
        resetStores();
    });

    afterEach(() => {
        for (const k of Object.keys(onListeners)) delete onListeners[k];
    });

    it('renders a red reauth badge for an account in reauth_required state', async () => {
        useEmailStore.setState({
            accounts: [
                sampleAccount({ id: 'a1', email: 'ok@gmail.com', auth_type: 'oauth', auth_state: 'ok' }),
                sampleAccount({ id: 'a2', email: 'bad@gmail.com', display_name: 'Bad One', auth_type: 'oauth', auth_state: 'reauth_required' }),
            ],
            selectedAccountId: 'a1',
        });

        render(<Sidebar onCompose={vi.fn()} onSettings={vi.fn()} />);

        // Open account picker so per-account rows render
        const user = userEvent.setup();
        await user.click(screen.getByLabelText('sidebar.switchAccount'));

        const badge = screen.getByTestId('reauth-badge-a2');
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveAttribute('data-auth-state', 'reauth_required');
        expect(badge).toHaveAttribute('aria-label', 'oauth.reauth.badge.needed');
    });

    it('renders an amber reauth badge for recommended_reauth state', async () => {
        useEmailStore.setState({
            accounts: [
                sampleAccount({ id: 'a1', auth_type: 'oauth', auth_state: 'ok' }),
                sampleAccount({ id: 'a2', email: 'soon@gmail.com', display_name: 'Soon User', auth_type: 'oauth', auth_state: 'recommended_reauth' }),
            ],
            selectedAccountId: 'a1',
        });

        render(<Sidebar onCompose={vi.fn()} onSettings={vi.fn()} />);
        const user = userEvent.setup();
        await user.click(screen.getByLabelText('sidebar.switchAccount'));

        const badge = screen.getByTestId('reauth-badge-a2');
        expect(badge).toHaveAttribute('data-auth-state', 'recommended_reauth');
        expect(badge).toHaveAttribute('aria-label', 'oauth.reauth.badge.recommended');
    });

    it('does NOT render a reauth badge for accounts in ok state', () => {
        useEmailStore.setState({
            accounts: [
                sampleAccount({ id: 'a1', auth_type: 'oauth', auth_state: 'ok' }),
                sampleAccount({ id: 'a2', email: 'ok2@gmail.com', display_name: 'OK 2', auth_type: 'oauth', auth_state: 'ok' }),
            ],
            selectedAccountId: 'a1',
        });

        render(<Sidebar onCompose={vi.fn()} onSettings={vi.fn()} />);
        screen.getByLabelText('sidebar.switchAccount').click();

        expect(screen.queryByTestId('reauth-badge-a1')).not.toBeInTheDocument();
        expect(screen.queryByTestId('reauth-badge-a2')).not.toBeInTheDocument();
    });

    it('renders a reauth badge on the active-account button in the sidebar header', () => {
        useEmailStore.setState({
            accounts: [
                sampleAccount({ id: 'a1', email: 'sel@gmail.com', display_name: 'Sel One', auth_type: 'oauth', auth_state: 'reauth_required' }),
                sampleAccount({ id: 'a2' }),
            ],
            selectedAccountId: 'a1',
        });

        render(<Sidebar onCompose={vi.fn()} onSettings={vi.fn()} />);
        // Active-account badge appears without having to open the picker
        expect(screen.getByTestId('reauth-badge-a1')).toBeInTheDocument();
    });

    it('shows a sign-in-again CTA in the account picker that calls onSettings', async () => {
        const onSettings = vi.fn();
        useEmailStore.setState({
            accounts: [
                sampleAccount({ id: 'a1', auth_type: 'oauth', auth_state: 'ok' }),
                sampleAccount({ id: 'a2', email: 'needs@gmail.com', display_name: 'Needs User', auth_type: 'oauth', auth_state: 'reauth_required' }),
            ],
            selectedAccountId: 'a1',
        });

        render(<Sidebar onCompose={vi.fn()} onSettings={onSettings} />);
        const user = userEvent.setup();

        await user.click(screen.getByLabelText('sidebar.switchAccount'));

        // The context-menu CTA label comes from oauth.reauth.contextMenuItem
        const cta = screen.getAllByText('oauth.reauth.contextMenuItem')[0];
        await user.click(cta);

        expect(onSettings).toHaveBeenCalledTimes(1);
    });

    it('does NOT render a sign-in-again CTA for accounts in ok state', () => {
        useEmailStore.setState({
            accounts: [
                sampleAccount({ id: 'a1', auth_type: 'oauth', auth_state: 'ok' }),
                sampleAccount({ id: 'a2', email: 'b@gmail.com', display_name: 'B', auth_type: 'oauth', auth_state: 'ok' }),
            ],
            selectedAccountId: 'a1',
        });

        render(<Sidebar onCompose={vi.fn()} onSettings={vi.fn()} />);
        screen.getByLabelText('sidebar.switchAccount').click();

        expect(screen.queryByText('oauth.reauth.contextMenuItem')).not.toBeInTheDocument();
    });

    it('subscribes to auth:needs-reauth and refreshes accounts:list on event', async () => {
        useEmailStore.setState({
            accounts: [
                sampleAccount({ id: 'a1', auth_type: 'oauth', auth_state: 'ok' }),
            ],
            selectedAccountId: 'a1',
        });

        // Provide the refreshed account list response
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'accounts:list') {
                return [sampleAccount({ id: 'a1', auth_type: 'oauth', auth_state: 'reauth_required' })];
            }
            return null;
        });

        render(<Sidebar onCompose={vi.fn()} onSettings={vi.fn()} />);

        // Listener must be installed
        expect(onListeners['auth:needs-reauth']).toBeDefined();
        expect(onListeners['auth:needs-reauth'].length).toBeGreaterThan(0);

        // Fire the event — component should refetch accounts:list and push to store
        onListeners['auth:needs-reauth'].forEach(cb => cb({ accountId: 'a1' }));

        await waitFor(() => {
            expect(useEmailStore.getState().accounts[0].auth_state).toBe('reauth_required');
        });
    });

    it('unsubscribes from auth:needs-reauth on unmount', () => {
        useEmailStore.setState({
            accounts: [sampleAccount({ id: 'a1' })],
            selectedAccountId: 'a1',
        });

        const { unmount } = render(<Sidebar onCompose={vi.fn()} onSettings={vi.fn()} />);
        expect(onListeners['auth:needs-reauth']?.length).toBe(1);
        unmount();
        expect(onListeners['auth:needs-reauth']?.length ?? 0).toBe(0);
    });
});
