import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockIpcInvoke } = vi.hoisted(() => ({
    mockIpcInvoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/ipc', () => ({
    ipcInvoke: mockIpcInvoke,
}));

import { OnboardingScreen } from './OnboardingScreen';
import { useEmailStore } from '../stores/emailStore';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnboardingScreen', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIpcInvoke.mockResolvedValue(null);
        useEmailStore.setState({
            accounts: [], folders: [], emails: [],
            selectedAccountId: null, selectedFolderId: null,
            selectedEmailId: null, selectedEmail: null, searchQuery: '',
        });
    });

    it('renders welcome step by default', () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        expect(screen.getByText('onboarding.welcome')).toBeInTheDocument();
        expect(screen.getByText('onboarding.getStarted')).toBeInTheDocument();
    });

    it('advances to provider step on Get Started click', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        expect(screen.getByText('onboarding.chooseProvider')).toBeInTheDocument();
    });

    it('shows all 6 provider cards in provider step', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        expect(screen.getByText('Gmail')).toBeInTheDocument();
        expect(screen.getByText('Outlook.com (Personal)')).toBeInTheDocument();
        expect(screen.getByText('Microsoft 365 (Work/School)')).toBeInTheDocument();
        expect(screen.getByText('Yahoo Mail')).toBeInTheDocument();
        expect(screen.getByText('iCloud Mail')).toBeInTheDocument();
        expect(screen.getByText('Other / Custom')).toBeInTheDocument();
    });

    it('advances to credentials step when a provider is selected', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        expect(screen.getByLabelText('settings.email')).toBeInTheDocument();
        expect(screen.getByLabelText('settings.password')).toBeInTheDocument();
    });

    it('shows validation error for empty email', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        // Try to proceed without filling fields
        await userEvent.click(screen.getByText('onboarding.connect'));
        expect(screen.getByText('onboarding.emailRequired')).toBeInTheDocument();
    });

    it('shows validation error for empty password', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        await userEvent.type(screen.getByLabelText('settings.email'), 'user@gmail.com');
        await userEvent.click(screen.getByText('onboarding.connect'));
        expect(screen.getByText('onboarding.passwordRequired')).toBeInTheDocument();
    });

    it('calls onAccountAdded on successful submit', async () => {
        const onAccountAdded = vi.fn();
        mockIpcInvoke
            .mockResolvedValueOnce({ success: true }) // accounts:test
            .mockResolvedValueOnce({ id: 'a1' });     // accounts:add

        render(<OnboardingScreen onAccountAdded={onAccountAdded} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        await userEvent.type(screen.getByLabelText('settings.email'), 'user@gmail.com');
        await userEvent.type(screen.getByLabelText('settings.password'), 'app-password');

        await act(async () => {
            await userEvent.click(screen.getByText('onboarding.connect'));
        });

        expect(onAccountAdded).toHaveBeenCalledTimes(1);
    });

    it('shows connection error on test failure', async () => {
        mockIpcInvoke.mockResolvedValueOnce({ success: false, error: 'Invalid credentials' });

        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        await userEvent.type(screen.getByLabelText('settings.email'), 'user@gmail.com');
        await userEvent.type(screen.getByLabelText('settings.password'), 'wrong-pass');

        await act(async () => {
            await userEvent.click(screen.getByText('onboarding.connect'));
        });

        expect(screen.getByText('onboarding.connectionFailed')).toBeInTheDocument();
    });

    it('renders ProviderHelpPanel on credentials step for gmail', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        expect(screen.getByText('providerHelp.gmail.shortNote')).toBeInTheDocument();
    });

    it('renders OAuth sign-in button for Outlook.com Personal with custom fallback CTA', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Outlook.com (Personal)'));
        expect(screen.getByText('oauth.button.microsoft')).toBeInTheDocument();
        expect(screen.queryByLabelText('settings.password')).not.toBeInTheDocument();
        expect(screen.queryByText('onboarding.connect')).not.toBeInTheDocument();
        expect(screen.getByText('onboarding.useCustomInstead')).toBeInTheDocument();
    });

    it('announces the Outlook OAuth-only state via role="status" / aria-live', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Outlook.com (Personal)'));
        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-live', 'polite');
        // The OAuth button is rendered inside the status region
        expect(status).toHaveTextContent('oauth.button.microsoft');
    });

    it('renders OAuth sign-in button for Microsoft 365 business', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Microsoft 365 (Work/School)'));
        expect(screen.getByText('oauth.button.microsoft')).toBeInTheDocument();
        expect(screen.queryByLabelText('settings.password')).not.toBeInTheDocument();
    });

    it('Use Custom Instead button pivots an oauth2-gated flow to the server step', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Outlook.com (Personal)'));

        // Still on credentials step showing the OAuth button
        expect(screen.getByText('oauth.button.microsoft')).toBeInTheDocument();

        // Click the custom fallback button
        await userEvent.click(screen.getByText('onboarding.useCustomInstead'));

        // Jumped straight to the server step — OAuth button gone, server heading present
        expect(screen.queryByText('oauth.button.microsoft')).not.toBeInTheDocument();
        expect(screen.getByText('onboarding.serverSettings')).toBeInTheDocument();
    });

    it('renders OAuth sign-in button on the Gmail credentials step', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        expect(screen.getByText('oauth.button.google')).toBeInTheDocument();
        // The password fields are still present underneath the divider
        expect(screen.getByLabelText('settings.password')).toBeInTheDocument();
        expect(screen.getByText('oauth.divider.orUseAppPassword')).toBeInTheDocument();
    });

    it('completes onboarding on a successful Gmail OAuth flow', async () => {
        const onAccountAdded = vi.fn();
        mockIpcInvoke
            .mockResolvedValueOnce({ success: true, accountId: 'oauth-1' }) // auth:start-oauth-flow
            .mockResolvedValueOnce([{ // accounts:list
                id: 'oauth-1',
                email: 'new@gmail.com',
                provider: 'gmail',
                display_name: null,
                imap_host: 'imap.gmail.com',
                imap_port: 993,
                smtp_host: 'smtp.gmail.com',
                smtp_port: 465,
                signature_html: null,
                auth_type: 'oauth',
                auth_state: 'ok',
            }]);

        render(<OnboardingScreen onAccountAdded={onAccountAdded} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));

        await act(async () => {
            await userEvent.click(screen.getByText('oauth.button.google'));
        });

        expect(mockIpcInvoke).toHaveBeenCalledWith('auth:start-oauth-flow', { provider: 'google' });
        expect(onAccountAdded).toHaveBeenCalledTimes(1);
    });

    it('surfaces a classification-mismatch warning when personal selected but business detected', async () => {
        mockIpcInvoke
            .mockResolvedValueOnce({ // auth:start-oauth-flow
                success: true,
                accountId: 'oauth-b',
                classifiedProvider: 'microsoft_business',
            })
            .mockResolvedValueOnce([]); // accounts:list

        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Outlook.com (Personal)'));

        await act(async () => {
            await userEvent.click(screen.getByText('oauth.button.microsoft'));
        });

        expect(screen.getByText('oauth.mismatch.personalSelectedBusinessDetected')).toBeInTheDocument();
    });

    it('surfaces an error when OAuth flow fails', async () => {
        mockIpcInvoke.mockResolvedValueOnce({ success: false, error: 'user cancelled' });

        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));

        await act(async () => {
            await userEvent.click(screen.getByText('oauth.button.google'));
        });

        // oauth.reauth.failed is the error prefix used by handleOAuthError
        expect(screen.getByRole('alert')).toHaveTextContent('oauth.reauth.failed');
    });
});
